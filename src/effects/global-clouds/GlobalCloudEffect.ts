import {Cartesian3,Math as CesiumMath,Matrix4,PixelDatatype,PostProcessStage,PostProcessStageComposite,PostProcessStageSampleMode} from 'cesium';
import type {EffectContext,SceneEffect} from '../types';
import {cloudDefaults,cloudQualities,type CloudParameters,type CloudQuality,type CloudView} from './config';
import type {GpuTexture} from '../../scene/DynamicTexture';
import {POLAR_SCALE} from '../hillaire-atmosphere/atmosphereMath';
import density from './shaders/density.glsl?raw';
import voxel from './shaders/voxel.glsl?raw';
import march from './shaders/march.glsl?raw';
import cloudTransport from './shaders/transport.glsl?raw';
import intervals from './shaders/intervals.glsl?raw';
import lighting from './shaders/droplet-lighting.glsl?raw';
import resolve from './shaders/resolve.glsl?raw';
import radiometry from './shaders/radiometry.glsl?raw';
import storage from './shaders/storage.glsl?raw';
import runtimeQuality from './shaders/quality.glsl?raw';
import display from '../../scene/display.glsl?raw';
import atmosphereCommon from '../hillaire-atmosphere/shaders/common.glsl?raw';
import atmosphereTransport from '../hillaire-atmosphere/shaders/integrate.glsl?raw';
import skyIrradiance from '../hillaire-atmosphere/shaders/sky-irradiance-sample.glsl?raw';
import {emptySceneDepth} from '../../scene/sceneDepth';
import type {CloudInitialization} from './CloudInitialization';
import {CloudAssetManager} from './CloudAssetManager';

export interface CloudLighting {
  sunDirection:()=>Cartesian3;
  /** Same active celestial mode as the disc, but independent of the camera.
   * The application supplies geocentric distant-source lunar lighting. */
  moonDirection:()=>Cartesian3;
  moonFraction:()=>number;
  transmittance:()=>GpuTexture|undefined;
  atmosphereEnabled:()=>boolean;
  multipleScattering?:()=>GpuTexture|undefined;
  /** Unit-sun diffuse E/PI, 64x32x2, owned/invalidated by the atmosphere. */
  skyIrradiance?:()=>GpuTexture|undefined;
  medium?:()=>Cartesian3;
  exposure?:()=>number;
  /** Optional scene-linear sky, before display clipping of the sun. */
  backgroundStage?:string;
  /** Omitted means the legacy RGBA8 radiance encoding. */
  backgroundIsHdr?:()=>boolean;
}
/** A cloud model supplies medium and lighting; shell/depth transport stays shared. */
export interface CloudModel {
  id:string;
  density:string;
  lighting:string;
  defines?:string;
}
export const cloudDebugViews=['off','footprint','mip','weather','density','optical-depth','transmittance','column-coverage'] as const;
export type CloudDebugView=typeof cloudDebugViews[number];
export class GlobalCloudEffect implements SceneEffect {
  readonly id:string;
  moonLight=1;
  readonly parameters={...cloudDefaults};
  enabled=true;paused=false;quality:CloudQuality='medium';
  private context?:EffectContext;
  private assets?:CloudAssetManager;
  private ownsAssets=true;
  private removeAssets?:()=>void;
  private get weather(){return this.assets?.textures.weather;}
  private get weatherSeed(){return this.assets?.seed??cloudDefaults.seed;}
  private get noise(){return this.assets?.textures.noise;}
  private get voxels(){return this.assets?.textures.voxels;}
  private get optics(){return this.assets?.textures.optics;}
  private get cirrus(){return this.assets?.textures.cirrus;}
  private get iceRibbon(){return this.assets?.textures.iceRibbon;}
  private get iceAnisotropic(){return this.assets?.textures.iceAnisotropic;}
  /** Optional bounded disk cache; deterministic diagnostics can bypass it. */
  assetCacheEnabled=true;
  get ready(){return this.assets?.ready??Promise.resolve();}
  get initialization():CloudInitialization{return this.assets?.initialization??{startedAt:0,generation:[],uploads:[],status:'loading'};}
  get materialInitialization(){return this.assets?.materialMetrics;}
  /** The comparison owns this manager; mounted models only borrow its assets. */
  useAssets(assets:CloudAssetManager){if(this.context)throw new Error('Assign cloud assets before mount');this.assets=assets;this.ownsAssets=false;}
  get voxelReady(){return Boolean(this.voxels);}
  private voxelEnabled=true;
  // Dense global banks currently cost more distance fetches than they save.
  private skipVoxels=false;
  private stage?:PostProcessStageComposite;
  private resolveStage?:PostProcessStage;
  private volumeStageName='';
  private camera=new Cartesian3();
  private defaultSun=Cartesian3.normalize(new Cartesian3(-.6,-.6,.5),new Cartesian3());
  private defaultMedium=new Cartesian3(1,1,1);
  private windAngle=0;
  private highWindAngle=0;
  private evolution=0;
  private lastTime=0;
  private pixelAngle=.001;
  private preferHdr=true;
  renderTargetMode:'RGBA16F'|'RGBA8'='RGBA8';
  debugView:CloudDebugView='off';
  private removeUpdate?:()=>void;
  constructor(private light?:CloudLighting,private model:CloudModel={id:'global-clouds',density:density+voxel,lighting,defines:'#define LAYERED_CLOUDS\n'}){this.id=model.id;}
  get motion(){return {angle:this.windAngle,highAngle:this.highWindAngle,evolution:this.evolution};}
  setMotion(motion:{angle:number;highAngle?:number;evolution:number}){this.windAngle=motion.angle;this.highWindAngle=motion.highAngle??0;this.evolution=motion.evolution;}
  private get sun(){return this.light?.sunDirection()??this.defaultSun;}
  private uniforms(){
    return {u_weather:()=>this.weather!,u_noise:()=>this.noise!,u_base:()=>this.parameters.base,
      u_thickness:()=>this.assets?.textures.optics?this.assets.material.thickness:this.parameters.thickness,u_coverage:()=>this.parameters.coverage,u_density:()=>this.parameters.density,
      u_detail:()=>this.assets?.textures.optics?this.assets.material.detail:this.parameters.detail,u_seed:()=>this.weatherSeed,u_windAngle:()=>this.windAngle,
      u_evolution:()=>this.evolution,u_windSpeed:()=>this.assets?.textures.optics?(this.assets.material.wind??24):this.parameters.wind,u_sun:()=>this.sun,
      u_emptySceneDepth:()=>this.context?emptySceneDepth(this.context.viewer.scene):false,
      u_cloudType:()=>this.parameters.type,u_highCoverage:()=>this.parameters.highCoverage,
      u_highBase:()=>Math.max(this.parameters.highBase,this.parameters.base+(this.assets?.textures.optics?this.assets.material.thickness:this.parameters.thickness)+.5),u_highThickness:()=>this.parameters.highThickness,
      u_highType:()=>this.parameters.highType,u_highOpticalDepth:()=>this.parameters.highOpticalDepth,
      u_highAnisotropy:()=>this.parameters.highAnisotropy,u_highAlbedo:()=>this.parameters.highAlbedo,u_highMultiple:()=>this.parameters.highMultiple,
      u_highAngle:()=>this.highWindAngle};
  }
  mount(context:EffectContext){
    if(this.context)throw new Error('Cloud effect is already mounted');
    this.context=context;const scene=context.viewer.scene;
    if(this.ownsAssets){this.assets=new CloudAssetManager(scene,context.onStatus);this.assets.cacheEnabled=this.assetCacheEnabled;}
    this.removeAssets=this.assets!.subscribe(()=>{if(!this.stage)this.buildStage();});
    this.assets!.request(this.parameters.seed,this.parameters);
    this.buildStage();
    this.removeUpdate=scene.preUpdate.addEventListener(()=>{
      // Disabled producers have no output attachment in Cesium's texture cache.
      // Keep a valid sampler even while the atmosphere is independently off.
      const background=this.light?.backgroundStage&&this.light.atmosphereEnabled()?this.light.backgroundStage:this.volumeStageName;
      if(this.resolveStage&&this.resolveStage.uniforms.u_skyRadiance!==background)this.resolveStage.uniforms.u_skyRadiance=background;
      const now=performance.now(),dt=this.lastTime?Math.min(.1,(now-this.lastTime)*.001):0;this.lastTime=now;
      if(!this.enabled)return;
      if(!this.paused){
        this.windAngle+=dt*this.parameters.wind*.001/6378.137;
        this.evolution+=dt*this.parameters.wind*.001*.35;
        this.highWindAngle+=dt*this.parameters.highWind*.001/6378.137;
      }
      const p=context.viewer.camera.positionWC;
      Cartesian3.fromElements(p.x*.001,p.y*.001,p.z*.001*POLAR_SCALE,this.camera);
      const frustum=context.viewer.camera.frustum as {fovy?:number};
      this.pixelAngle=2*Math.tan((frustum.fovy??Math.PI/3)*.5)/Math.max(1,scene.drawingBufferHeight*cloudQualities[this.quality].scale);
    });
  }
  private buildStage(){
    if(!this.context||!this.weather||!this.noise)return;const stages=this.context.viewer.scene.postProcessStages;
    if(this.stage)stages.remove(this.stage);
    const quality=cloudQualities[this.quality];
    const {context}=this.context.viewer.scene as unknown as {context:{colorBufferHalfFloat:boolean;halfFloatingPointTexture:boolean;textureHalfFloatLinear:boolean}};
    const hdr=this.preferHdr&&context.colorBufferHalfFloat&&context.halfFloatingPointTexture&&context.textureHalfFloatLinear;
    this.renderTargetMode=hdr?'RGBA16F':'RGBA8';
    const outputSource='#define CLOUD_RUNTIME_STORAGE\n'+atmosphereCommon+display+storage+radiometry;
    const volume=new PostProcessStage({name:`${this.id}-volume`,textureScale:quality.scale,
      pixelDatatype:hdr?PixelDatatype.HALF_FLOAT:PixelDatatype.UNSIGNED_BYTE,
      fragmentShader:runtimeQuality+(this.model.defines??'')+outputSource+atmosphereTransport+this.model.density+
        `uniform sampler2D depthTexture;uniform bool u_atmosphere;uniform vec3 u_camera,u_moon;
        uniform float u_pixelAngle,u_moonFraction,u_moonGain;struct CloudPhases {vec3 sun;vec3 moon;};`+
        skyIrradiance+this.model.lighting+'\n#ifdef LAYERED_CLOUDS\n'+intervals+'\n#endif\n'+cloudTransport+march,
      sampleMode:PostProcessStageSampleMode.LINEAR,
      uniforms:{...this.uniforms(),
        u_cloudSteps:quality.steps,u_lightSteps:quality.lightSteps,u_cloudSubsteps:quality.substeps,u_cloudIntervals:4,u_cloudRepresentations:2,u_cloudHdr:hdr,
        // Cesium 1.146 allocates by each stage's immediate dependencies, not
        // future consumers. Keep the HDR producer live through this write:
        // at scale=1 its attachment otherwise aliases the cloud volume before
        // resolve can read it. Metadata-only uniform; no shader texture fetch.
        ...(this.light?.backgroundStage?{u_preserveSkyRadiance:this.light.backgroundStage}:{}),
        u_camera:()=>this.camera,u_pixelAngle:()=>this.pixelAngle,u_debugView:()=>cloudDebugViews.indexOf(this.debugView),
        u_voxels:()=>this.voxels??this.noise!,u_voxelReady:()=>Boolean(this.voxels&&this.voxelEnabled),u_skipVoxels:()=>this.skipVoxels,
        u_cloudOptics:()=>this.optics??this.noise!,u_opticsReady:()=>Boolean(this.optics&&this.voxelEnabled),u_columnGrid:12,u_columnSections:2,u_columnQuadrature:4,u_columnOrders:3,
        u_cloudComponents:()=>this.assets?.textures.components??this.noise!,u_columnComponents:8,
        u_cirrus:()=>this.cirrus??this.noise!,
        u_iceRibbon:()=>this.iceRibbon??this.weather!,
        u_iceAnisotropic:()=>this.iceAnisotropic??this.noise!,
        u_highFilterGrid:4,
        u_multiple:()=>this.light?.multipleScattering?.()??this.weather!,u_medium:()=>this.light?.medium?.()??this.defaultMedium,
        u_skyIrradiance:()=>this.light?.skyIrradiance?.()??this.weather!,u_hasSkyIrradiance:()=>Boolean(this.light?.skyIrradiance?.()),
        u_exposure:()=>this.light?.exposure?.()??8,
        u_moon:()=>this.light?.moonDirection()??Cartesian3.UNIT_Z,u_moonFraction:()=>this.light?.moonFraction()??0,u_moonGain:()=>this.moonLight,
        u_transmittance:()=>this.light?.transmittance()??this.weather!,u_atmosphere:()=>Boolean(this.light?.atmosphereEnabled()&&this.light.transmittance()&&this.light.multipleScattering?.())}});
    const output=new PostProcessStage({name:`${this.id}-resolve`,fragmentShader:outputSource+resolve,uniforms:{
      u_cloudHdr:hdr,
      u_emptySceneDepth:()=>emptySceneDepth(this.context!.viewer.scene),
      u_clouds:volume.name,u_exposure:()=>this.light?.exposure?.()??8,u_debugView:()=>cloudDebugViews.indexOf(this.debugView),
      u_skyRadiance:this.light?.backgroundStage&&this.light.atmosphereEnabled()?this.light.backgroundStage:volume.name,
      u_skyRadianceHdr:()=>this.light?.backgroundIsHdr?.()??false,
      u_hasSkyRadiance:()=>Boolean(this.light?.backgroundStage&&this.light.atmosphereEnabled())}});
    this.resolveStage=output;this.volumeStageName=volume.name;
    this.stage=new PostProcessStageComposite({name:this.id,stages:[volume,output],inputPreviousStageTexture:false});
    this.stage.enabled=this.enabled;stages.add(this.stage);
  }
  updateParameters(p:Partial<CloudParameters>){
    Object.assign(this.parameters,p);const v=this.parameters;
    v.coverage=Math.max(0,Math.min(1,v.coverage));v.base=Math.max(.2,Math.min(15,v.base));v.thickness=Math.max(.5,Math.min(12,v.thickness));
    v.density=Math.max(0,Math.min(4,v.density));v.detail=Math.max(0,Math.min(1,v.detail));v.seed=Math.max(0,Math.min(9999,Math.round(v.seed)));
    v.type=Math.max(0,Math.min(3,Math.round(v.type)));v.highCoverage=Math.max(0,Math.min(1,v.highCoverage));
    // Disjoint shells make exact front-to-back interval ordering inexpensive.
    v.highBase=Math.max(v.base+v.thickness+.5,Math.min(32,v.highBase));
    v.highThickness=Math.max(.3,Math.min(4,v.highThickness));v.highWind=Math.max(0,Math.min(200,v.highWind));
    v.highType=Math.round(Math.max(0,Math.min(1,v.highType)));v.highOpticalDepth=Math.max(0,Math.min(2,v.highOpticalDepth));
    v.highAnisotropy=Math.max(0,Math.min(.9,v.highAnisotropy));v.highAlbedo=Math.max(0,Math.min(1,v.highAlbedo));v.highMultiple=Math.max(0,Math.min(.3,v.highMultiple));
    if(this.context)this.assets!.request(v.seed,v);
  }
  setQuality(value:CloudQuality){if(this.quality===value)return;this.quality=value;this.buildStage();}
  /** Also provides a deterministic fallback path for unsupported float targets. */
  setHdrEnabled(value:boolean){if(value===this.preferHdr)return;this.preferHdr=value;this.buildStage();}
  /** Diagnostic switches compare the same field with/without acceleration. */
  setVoxelEnabled(value:boolean){this.voxelEnabled=value;}
  setVoxelSkipping(value:boolean){this.skipVoxels=value;}
  setDebugView(value:CloudDebugView){if(cloudDebugViews.includes(value))this.debugView=value;}
  setEnabled(value:boolean){this.enabled=value;if(this.stage)this.stage.enabled=value;}
  setPaused(value:boolean){this.paused=value;}
  reset(){this.windAngle=0;this.highWindAngle=0;this.evolution=0;this.updateParameters(cloudDefaults);}
  focus(){this.view('below');}
  view(mode:CloudView){
    if(!this.context)return;const camera=this.context.viewer.camera;
    camera.lookAtTransform(Matrix4.IDENTITY);
    const p=this.parameters;
    const profileTop=this.id==='global-clouds'?(p.type===1?.26:p.type===2?.58:1):1;
    const heights={below:Math.max(20,Math.min(800,p.base*1000-200)),inside:(p.base+p.thickness*profileTop*.4)*1000,above:(p.base+p.thickness+3)*1000,
      between:(p.base+p.thickness+p.highBase)*500,high:(p.highBase+p.highThickness+2)*1000,global:17_000_000};
    camera.flyTo({destination:Cartesian3.fromDegrees(-97.52,35.46,heights[mode]),duration:1.4,
      orientation:{heading:CesiumMath.toRadians(mode==='global'?0:245),pitch:CesiumMath.toRadians(mode==='global'?-90:mode==='above'||mode==='high'?-18:mode==='inside'||mode==='between'?0:12),roll:0}});
  }
  destroy(){
    if(!this.context)return;this.removeUpdate?.();this.removeAssets?.();
    const s=this.context.viewer.scene;if(this.stage)s.postProcessStages.remove(this.stage);
    this.resolveStage=undefined;this.stage=undefined;
    if(this.ownsAssets)this.assets?.destroy();
    this.context=undefined;this.lastTime=0;
  }
}
