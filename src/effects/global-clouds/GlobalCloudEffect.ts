import {Cartesian3,Math as CesiumMath,Matrix4,PostProcessStage,PostProcessStageComposite,PostProcessStageSampleMode} from 'cesium';
import type {EffectContext,SceneEffect} from '../types';
import {cloudDefaults,cloudQualities,type CloudParameters,type CloudQuality} from './config';
import {createWeather,WEATHER_WIDTH,WEATHER_HEIGHT} from './WeatherField';
import {createNoiseVolume,NOISE_SIZE} from '../../scene/CloudNoise';
import {createRepeatingVolume,createWeatherTexture,type GpuTexture} from '../../scene/DynamicTexture';
import {GpuLut,type ComputeFrame} from '../../scene/GpuLut';
import {POLAR_SCALE} from '../hillaire-atmosphere/atmosphereMath';
import density from './shaders/density.glsl?raw';
import lighting from './shaders/lighting.glsl?raw';
import march from './shaders/march.glsl?raw';
import resolve from './shaders/resolve.glsl?raw';

export interface CloudLighting {
  sunDirection:()=>Cartesian3;
  moonDirection:()=>Cartesian3;
  moonFraction:()=>number;
  transmittance:()=>GpuTexture|undefined;
  atmosphereEnabled:()=>boolean;
}
export class GlobalCloudEffect implements SceneEffect {
  readonly id='global-clouds';
  readonly parameters={...cloudDefaults};
  enabled=true;paused=false;quality:CloudQuality='medium';
  private context?:EffectContext;
  private weather?:GpuTexture;
  private noise?:GpuTexture;
  private cache?:GpuLut;
  private stage?:PostProcessStageComposite;
  private camera=new Cartesian3();
  private defaultSun=Cartesian3.normalize(new Cartesian3(-.6,-.6,.5),new Cartesian3());
  private lastSun=new Cartesian3(Infinity,0,0);
  private windAngle=0;
  private lastTime=0;
  private lastBake=0;
  private pixelAngle=.001;
  private dirty=true;
  private removeUpdate?:()=>void;
  private primitive={update:(frame:ComputeFrame)=>{
    if(!this.enabled||!frame.passes.render)return;
    const now=performance.now();
    if(this.dirty||Cartesian3.distance(this.sun,this.lastSun)>.0003||(!this.paused&&this.parameters.wind!==0&&now-this.lastBake>1000)){
      this.cache!.enqueue(frame);this.dirty=false;this.lastBake=now;Cartesian3.clone(this.sun,this.lastSun);
    }
  },isDestroyed:()=>false,destroy:()=>{}};
  constructor(private light?:CloudLighting){}
  private get sun(){return this.light?.sunDirection()??this.defaultSun;}
  private uniforms(){
    return {u_weather:()=>this.weather!,u_noise:()=>this.noise!,u_base:()=>this.parameters.base,
      u_thickness:()=>this.parameters.thickness,u_coverage:()=>this.parameters.coverage,u_density:()=>this.parameters.density,
      u_detail:()=>this.parameters.detail,u_windAngle:()=>this.windAngle,u_sun:()=>this.sun};
  }
  mount(context:EffectContext){
    this.context=context;const scene=context.viewer.scene;
    this.weather=createWeatherTexture(scene,WEATHER_WIDTH,WEATHER_HEIGHT,createWeather());
    this.noise=createRepeatingVolume(scene,NOISE_SIZE,createNoiseVolume());
    this.cache=new GpuLut(scene,256,128,density+lighting,this.uniforms());
    scene.primitives.add(this.primitive);this.buildStage();
    this.removeUpdate=scene.preUpdate.addEventListener(()=>{
      const now=performance.now(),dt=this.lastTime?Math.min(.1,(now-this.lastTime)*.001):0;this.lastTime=now;
      if(!this.enabled)return;
      if(!this.paused)this.windAngle+=dt*this.parameters.wind*.001/6378.137;
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
    const volume=new PostProcessStage({name:'global-cloud-volume',textureScale:quality.scale,
      fragmentShader:`#define CLOUD_STEPS ${quality.steps}\n`+density+march,
      sampleMode:PostProcessStageSampleMode.LINEAR,
      uniforms:{...this.uniforms(),u_lightCache:()=>this.cache!.texture,u_camera:()=>this.camera,u_pixelAngle:()=>this.pixelAngle,
        u_moon:()=>this.light?.moonDirection()??Cartesian3.UNIT_Z,u_moonFraction:()=>this.light?.moonFraction()??0,
        u_transmittance:()=>this.light?.transmittance()??this.weather!,u_atmosphere:()=>Boolean(this.light?.atmosphereEnabled()&&this.light.transmittance())}});
    const output=new PostProcessStage({name:'global-cloud-resolve',fragmentShader:resolve,uniforms:{u_clouds:volume.name}});
    this.stage=new PostProcessStageComposite({name:this.id,stages:[volume,output],inputPreviousStageTexture:false});
    this.stage.enabled=this.enabled;stages.add(this.stage);
  }
  updateParameters(p:Partial<CloudParameters>){
    Object.assign(this.parameters,p);const v=this.parameters;
    v.coverage=Math.max(0,Math.min(1,v.coverage));v.base=Math.max(.2,Math.min(15,v.base));v.thickness=Math.max(.5,Math.min(12,v.thickness));
    v.density=Math.max(0,Math.min(4,v.density));v.detail=Math.max(0,Math.min(1,v.detail));this.dirty=true;
  }
  setQuality(value:CloudQuality){if(this.quality===value)return;this.quality=value;this.buildStage();}
  setEnabled(value:boolean){this.enabled=value;if(this.stage)this.stage.enabled=value;this.dirty=true;}
  setPaused(value:boolean){this.paused=value;}
  reset(){this.windAngle=0;this.updateParameters(cloudDefaults);}
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
    s.primitives.remove(this.primitive);this.cache?.destroy();
    for(const t of [this.noise,this.weather])if(t&&!t.isDestroyed())t.destroy();
    this.context=undefined;
  }
}
