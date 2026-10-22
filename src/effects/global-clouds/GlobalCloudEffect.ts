import {Cartesian3,Math as CesiumMath,Matrix4,PixelDatatype,PostProcessStage,PostProcessStageComposite,PostProcessStageSampleMode} from 'cesium';
import type {EffectContext,SceneEffect} from '../types';
import {cloudDefaults,cloudQualities,type CloudParameters,type CloudQuality} from './config';
import {createWeather,WEATHER_WIDTH,WEATHER_HEIGHT} from './WeatherField';
import {createCumulusNoise,CUMULUS_NOISE_SIZE} from './CumulusNoise';
import {createRepeatingVolume,createWeatherTexture,type GpuTexture} from '../../scene/DynamicTexture';
import {POLAR_SCALE} from '../hillaire-atmosphere/atmosphereMath';
import density from './shaders/density.glsl?raw';
import march from './shaders/march.glsl?raw';
import lighting from './shaders/lighting.glsl?raw';
import resolve from './shaders/resolve.glsl?raw';
import radiometry from './shaders/radiometry.glsl?raw';
import storage from './shaders/storage.glsl?raw';
import display from '../../scene/display.glsl?raw';
import atmosphereCommon from '../hillaire-atmosphere/shaders/common.glsl?raw';
import atmosphereTransport from '../hillaire-atmosphere/shaders/integrate.glsl?raw';

export interface CloudLighting {
  sunDirection:()=>Cartesian3;
  moonDirection:()=>Cartesian3;
  moonFraction:()=>number;
  transmittance:()=>GpuTexture|undefined;
  atmosphereEnabled:()=>boolean;
  multipleScattering?:()=>GpuTexture|undefined;
  medium?:()=>Cartesian3;
  exposure?:()=>number;
}
/** A cloud model supplies medium and lighting; shell/depth transport stays shared. */
export interface CloudModel {
  id:string;
  density:string;
  lighting:string;
  defines?:string;
}
export class GlobalCloudEffect implements SceneEffect {
  readonly id:string;
  moonLight=1;
  readonly parameters={...cloudDefaults};
  enabled=true;paused=false;quality:CloudQuality='medium';
  private context?:EffectContext;
  private weather?:GpuTexture;
  private noise?:GpuTexture;
  private stage?:PostProcessStageComposite;
  private camera=new Cartesian3();
  private defaultSun=Cartesian3.normalize(new Cartesian3(-.6,-.6,.5),new Cartesian3());
  private defaultMedium=new Cartesian3(1,1,1);
  private windAngle=0;
  private evolution=0;
  private lastTime=0;
  private pixelAngle=.001;
  private preferHdr=true;
  renderTargetMode:'RGBA16F'|'RGBA8'='RGBA8';
  private removeUpdate?:()=>void;
  constructor(private light?:CloudLighting,private model:CloudModel={id:'global-clouds',density,lighting}){this.id=model.id;}
  get motion(){return {angle:this.windAngle,evolution:this.evolution};}
  setMotion(motion:{angle:number;evolution:number}){this.windAngle=motion.angle;this.evolution=motion.evolution;}
  private get sun(){return this.light?.sunDirection()??this.defaultSun;}
  private uniforms(){
    return {u_weather:()=>this.weather!,u_noise:()=>this.noise!,u_base:()=>this.parameters.base,
      u_thickness:()=>this.parameters.thickness,u_coverage:()=>this.parameters.coverage,u_density:()=>this.parameters.density,
      u_detail:()=>this.parameters.detail,u_seed:()=>this.parameters.seed,u_windAngle:()=>this.windAngle,
      u_evolution:()=>this.evolution,u_windSpeed:()=>this.parameters.wind,u_sun:()=>this.sun};
  }
  mount(context:EffectContext){
    this.context=context;const scene=context.viewer.scene;
    this.weather=createWeatherTexture(scene,WEATHER_WIDTH,WEATHER_HEIGHT,createWeather(this.parameters.seed));
    const noise=createCumulusNoise();
    this.noise=createRepeatingVolume(scene,CUMULUS_NOISE_SIZE,noise.bytes,noise.mips);
    this.buildStage();
    this.removeUpdate=scene.preUpdate.addEventListener(()=>{
      const now=performance.now(),dt=this.lastTime?Math.min(.1,(now-this.lastTime)*.001):0;this.lastTime=now;
      if(!this.enabled)return;
      if(!this.paused){
        this.windAngle+=dt*this.parameters.wind*.001/6378.137;
        this.evolution+=dt*this.parameters.wind*.001*.35;
      }
      const p=context.viewer.camera.positionWC;
      Cartesian3.fromElements(p.x*.001,p.y*.001,p.z*.001*POLAR_SCALE,this.camera);
      const frustum=context.viewer.camera.frustum as {fovy?:number};
      this.pixelAngle=2*Math.tan((frustum.fovy??Math.PI/3)*.5)/Math.max(1,scene.drawingBufferHeight*cloudQualities[this.quality].scale);
    });
  }
  private buildStage(){
    if(!this.context)return;const stages=this.context.viewer.scene.postProcessStages;
    if(this.stage)stages.remove(this.stage);
    const quality=cloudQualities[this.quality];
    const {context}=this.context.viewer.scene as unknown as {context:{colorBufferHalfFloat:boolean;halfFloatingPointTexture:boolean;textureHalfFloatLinear:boolean}};
    const hdr=this.preferHdr&&context.colorBufferHalfFloat&&context.halfFloatingPointTexture&&context.textureHalfFloatLinear;
    this.renderTargetMode=hdr?'RGBA16F':'RGBA8';
    const outputSource=(hdr?'#define CLOUD_HDR\n':'')+atmosphereCommon+display+storage+radiometry;
    const volume=new PostProcessStage({name:`${this.id}-volume`,textureScale:quality.scale,
      pixelDatatype:hdr?PixelDatatype.HALF_FLOAT:PixelDatatype.UNSIGNED_BYTE,
      fragmentShader:`#define CLOUD_STEPS ${quality.steps}\n#define LIGHT_STEPS ${quality.lightSteps}\n#define CLOUD_SUBSTEPS ${quality.substeps}\n`+(this.model.defines??'')+outputSource+atmosphereTransport+this.model.density+
        `uniform sampler2D depthTexture;uniform bool u_atmosphere;uniform vec3 u_camera,u_moon;
        uniform float u_pixelAngle,u_moonFraction,u_moonGain;struct CloudPhases {vec3 sun;vec3 moon;vec3 sky;vec3 horizon;};`+
        this.model.lighting+march,
      sampleMode:PostProcessStageSampleMode.LINEAR,
      uniforms:{...this.uniforms(),u_camera:()=>this.camera,u_pixelAngle:()=>this.pixelAngle,
        u_multiple:()=>this.light?.multipleScattering?.()??this.weather!,u_medium:()=>this.light?.medium?.()??this.defaultMedium,
        u_exposure:()=>this.light?.exposure?.()??8,
        u_moon:()=>this.light?.moonDirection()??Cartesian3.UNIT_Z,u_moonFraction:()=>this.light?.moonFraction()??0,u_moonGain:()=>this.moonLight,
        u_transmittance:()=>this.light?.transmittance()??this.weather!,u_atmosphere:()=>Boolean(this.light?.atmosphereEnabled()&&this.light.transmittance()&&this.light.multipleScattering?.())}});
    const output=new PostProcessStage({name:`${this.id}-resolve`,fragmentShader:outputSource+resolve,uniforms:{u_clouds:volume.name,u_exposure:()=>this.light?.exposure?.()??8}});
    this.stage=new PostProcessStageComposite({name:this.id,stages:[volume,output],inputPreviousStageTexture:false});
    this.stage.enabled=this.enabled;stages.add(this.stage);
  }
  updateParameters(p:Partial<CloudParameters>){
    const seed=this.parameters.seed;Object.assign(this.parameters,p);const v=this.parameters;
    v.coverage=Math.max(0,Math.min(1,v.coverage));v.base=Math.max(.2,Math.min(15,v.base));v.thickness=Math.max(.5,Math.min(12,v.thickness));
    v.density=Math.max(0,Math.min(4,v.density));v.detail=Math.max(0,Math.min(1,v.detail));v.seed=Math.max(0,Math.min(9999,Math.round(v.seed)));
    if(v.seed!==seed&&this.weather)this.weather.copyFrom({source:{width:WEATHER_WIDTH,height:WEATHER_HEIGHT,arrayBufferView:createWeather(v.seed)}});
  }
  setQuality(value:CloudQuality){if(this.quality===value)return;this.quality=value;this.buildStage();}
  /** Also provides a deterministic fallback path for unsupported float targets. */
  setHdrEnabled(value:boolean){if(value===this.preferHdr)return;this.preferHdr=value;this.buildStage();}
  setEnabled(value:boolean){this.enabled=value;if(this.stage)this.stage.enabled=value;}
  setPaused(value:boolean){this.paused=value;}
  reset(){this.windAngle=0;this.evolution=0;this.updateParameters(cloudDefaults);}
  focus(){this.view('below');}
  view(mode:'below'|'inside'|'above'|'global'){
    if(!this.context)return;const camera=this.context.viewer.camera;
    camera.lookAtTransform(Matrix4.IDENTITY);
    const heights={below:800,inside:(this.parameters.base+this.parameters.thickness*.4)*1000,above:(this.parameters.base+this.parameters.thickness+3)*1000,global:17_000_000};
    camera.flyTo({destination:Cartesian3.fromDegrees(-97.52,35.46,heights[mode]),duration:1.4,
      orientation:{heading:CesiumMath.toRadians(mode==='global'?0:245),pitch:CesiumMath.toRadians(mode==='global'?-90:mode==='above'?-18:mode==='inside'?0:12),roll:0}});
  }
  destroy(){
    if(!this.context)return;this.removeUpdate?.();
    const s=this.context.viewer.scene;if(this.stage)s.postProcessStages.remove(this.stage);
    for(const t of [this.noise,this.weather])if(t&&!t.isDestroyed())t.destroy();
    this.context=undefined;
  }
}
