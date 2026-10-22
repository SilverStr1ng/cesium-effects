import { Cartesian3, DirectionalLight, JulianDate, Math as CesiumMath, Matrix3, Matrix4, PostProcessStage, type Light } from 'cesium';
import type { EffectContext, SceneEffect } from '../types';
import { GpuLut, type ComputeFrame } from '../../scene/GpuLut';
import { atmosphereDefaults, POLAR_SCALE, type AtmosphereParameters } from './atmosphereMath';
import common from './shaders/common.glsl?raw';
import transmission from './shaders/transmittance.glsl?raw';
import multiple from './shaders/multiple-scattering.glsl?raw';
import integrate from './shaders/integrate.glsl?raw';
import sky from './shaders/sky-view.glsl?raw';
import composite from './shaders/composite.glsl?raw';
import {celestialPositions,angularRadius,illuminatedFraction} from './CelestialLighting';

export class AtmosphereEffect implements SceneEffect {
  readonly id='hillaire-atmosphere';
  readonly parameters={...atmosphereDefaults};
  readonly sunDirection=new Cartesian3();
  readonly moonDirection=new Cartesian3();
  clockLinked=true;
  moonFraction=0;
  private sunRadius=.00465;
  private moonRadius=.0045;
  private moonPosition=new Cartesian3();
  private lastCelestialTime?:JulianDate;
  private removeClock?:()=>void;
  enabled=true;
  private context?: EffectContext;
  private transmittance?: GpuLut;
  private multiple?: GpuLut;
  private sky?: GpuLut;
  private stage?: PostProcessStage;
  private dirty=true;
  private skyDirty=true;
  private lastCamera=new Cartesian3(Infinity,Infinity,Infinity);
  private camera=new Cartesian3();
  private basis=new Matrix3();
  private medium=new Cartesian3(1,1,1);
  private light=new DirectionalLight({direction:new Cartesian3(0,0,-1),intensity:2});
  private previous?: {sky:boolean;ground:boolean;fog:boolean;sun:boolean;moon:boolean;light:Light;lighting:boolean;fadeIn:number;fadeOut:number};
  private primitive={update:(frame:ComputeFrame)=>this.update(frame),isDestroyed:()=>false,destroy:()=>{}};
  get transmissionTexture(){return this.transmittance?.texture;}
  get multipleScatteringTexture(){return this.multiple?.texture;}
  get mediumParameters(){return this.medium;}
  mount(context:EffectContext){
    this.context=context;
    const s=context.viewer.scene;
    this.previous={sky:s.skyAtmosphere?.show??false,ground:s.globe.showGroundAtmosphere,fog:s.fog.enabled,sun:s.sun?.show??false,moon:s.moon?.show??false,light:s.light,lighting:s.globe.enableLighting,fadeIn:s.globe.lightingFadeInDistance,fadeOut:s.globe.lightingFadeOutDistance};
    if(s.skyAtmosphere)s.skyAtmosphere.show=false;
    s.globe.showGroundAtmosphere=false;s.fog.enabled=false;
    if(s.sun)s.sun.show=false;
    if(s.moon)s.moon.show=false;
    s.globe.enableLighting=true;s.light=this.light;
    s.globe.lightingFadeOutDistance=0;s.globe.lightingFadeInDistance=1;
    const uniforms={u_medium:()=>this.medium};
    this.transmittance=new GpuLut(s,256,64,common+transmission,uniforms);
    this.multiple=new GpuLut(s,32,32,common+multiple,{...uniforms,u_transmittance:()=>this.transmittance!.texture});
    const transport={...uniforms,u_transmittance:()=>this.transmittance!.texture,u_multiple:()=>this.multiple!.texture,u_sun:()=>this.sunDirection};
    const view={...transport,u_camera:()=>this.camera,u_basis:()=>this.basis};
    this.sky=new GpuLut(s,192,108,common+integrate+sky,view);
    this.stage=new PostProcessStage({name:this.id,fragmentShader:common+integrate+composite,
      uniforms:{...view,u_skyView:()=>this.sky!.texture,u_exposure:()=>this.parameters.exposure,
        u_sunRadius:()=>this.sunRadius*this.parameters.sunScale,u_moon:()=>this.moonDirection,u_moonRadius:()=>this.moonRadius}});
    s.primitives.add(this.primitive);s.postProcessStages.add(this.stage);
    this.updateParameters({});
    this.removeClock=context.viewer.scene.preUpdate.addEventListener(()=>this.updateCelestial());
    this.updateCelestial();
  }
  private updateCelestial(){
    if(!this.context)return;
    const viewer=this.context.viewer,time=viewer.clock.currentTime;
    if(!this.lastCelestialTime||Math.abs(JulianDate.secondsDifference(time,this.lastCelestialTime))>=1){
      const bodies=celestialPositions(time);Cartesian3.clone(bodies.moon,this.moonPosition);
      this.moonFraction=illuminatedFraction(bodies.sun,bodies.moon);
      if(this.clockLinked){
        const direction=Cartesian3.normalize(bodies.sun,new Cartesian3());
        Cartesian3.negate(direction,this.light.direction);direction.z*=POLAR_SCALE;
        Cartesian3.normalize(direction,this.sunDirection);this.skyDirty=true;
        this.sunRadius=angularRadius(695700000,Cartesian3.magnitude(bodies.sun));
        const lon=CesiumMath.toRadians(-97.52),lat=CesiumMath.toRadians(35.46);
        const d=Cartesian3.normalize(bodies.sun,new Cartesian3());
        const east=-Math.sin(lon)*d.x+Math.cos(lon)*d.y;
        const north=-Math.sin(lat)*Math.cos(lon)*d.x-Math.sin(lat)*Math.sin(lon)*d.y+Math.cos(lat)*d.z;
        const up=Math.cos(lat)*Math.cos(lon)*d.x+Math.cos(lat)*Math.sin(lon)*d.y+Math.sin(lat)*d.z;
        this.parameters.elevation=CesiumMath.toDegrees(Math.asin(up));
        this.parameters.azimuth=(CesiumMath.toDegrees(Math.atan2(east,north))+360)%360;
      }
      this.lastCelestialTime=JulianDate.clone(time);
    }
    const relative=Cartesian3.subtract(this.moonPosition,viewer.camera.positionWC,new Cartesian3());
    this.moonRadius=angularRadius(1737400,Cartesian3.magnitude(relative));
    relative.z*=POLAR_SCALE;Cartesian3.normalize(relative,this.moonDirection);
  }
  setClockLinked(value:boolean){this.clockLinked=value;this.lastCelestialTime=undefined;if(!value)this.updateParameters({});this.updateCelestial();}
  private update(frame:ComputeFrame){
    if(!this.enabled||!this.context||!frame.passes.render)return;
    const p=this.context.viewer.camera.positionWC;
    Cartesian3.fromElements(p.x*.001,p.y*.001,p.z*.001*POLAR_SCALE,this.camera);
    const up=Cartesian3.normalize(this.camera,new Cartesian3());
    const east=Cartesian3.normalize(Cartesian3.cross(Math.abs(up.z)>.99?Cartesian3.UNIT_Y:Cartesian3.UNIT_Z,up,new Cartesian3()),new Cartesian3());
    const north=Cartesian3.cross(up,east,new Cartesian3());
    Matrix3.setColumn(this.basis,0,east,this.basis);Matrix3.setColumn(this.basis,1,north,this.basis);Matrix3.setColumn(this.basis,2,up,this.basis);
    if(this.dirty){this.transmittance!.enqueue(frame);this.multiple!.enqueue(frame);this.dirty=false;this.skyDirty=true;}
    if(Cartesian3.distance(this.lastCamera,this.camera)>.001)this.skyDirty=true;
    if(this.skyDirty&&Cartesian3.magnitude(this.camera)<6477.137){
      this.sky!.enqueue(frame);this.skyDirty=false;Cartesian3.clone(this.camera,this.lastCamera);
    }
  }
  updateParameters(p:Partial<AtmosphereParameters>){
    Object.assign(this.parameters,p);
    this.skyDirty=true;
    const values=this.parameters;
    const changed=this.medium.x!==values.rayleigh||this.medium.y!==values.mie||this.medium.z!==values.ozone;
    Cartesian3.fromElements(values.rayleigh,values.mie,values.ozone,this.medium);
    if(changed)this.dirty=true;
    if(this.clockLinked){this.lastCelestialTime=undefined;return;}
    // Solar controls are anchored at the lab location; one ECEF direction lights the entire planet.
    const lon=CesiumMath.toRadians(-97.52),lat=CesiumMath.toRadians(35.46);
    const az=CesiumMath.toRadians(values.azimuth),el=CesiumMath.toRadians(values.elevation);
    const east=new Cartesian3(-Math.sin(lon),Math.cos(lon),0);
    const north=new Cartesian3(-Math.sin(lat)*Math.cos(lon),-Math.sin(lat)*Math.sin(lon),Math.cos(lat));
    const up=new Cartesian3(Math.cos(lat)*Math.cos(lon),Math.cos(lat)*Math.sin(lon),Math.sin(lat));
    const d=Cartesian3.add(Cartesian3.multiplyByScalar(east,Math.sin(az)*Math.cos(el),east),Cartesian3.multiplyByScalar(north,Math.cos(az)*Math.cos(el),north),new Cartesian3());
    Cartesian3.add(d,Cartesian3.multiplyByScalar(up,Math.sin(el),up),d);
    Cartesian3.negate(d,this.light.direction);
    d.z*=POLAR_SCALE;Cartesian3.normalize(d,this.sunDirection);
  }
  setEnabled(value:boolean){this.enabled=value;if(this.stage)this.stage.enabled=value;}
  setPaused(paused:boolean){if(this.context)this.context.viewer.clock.shouldAnimate=!paused;}
  reset(){this.updateParameters(atmosphereDefaults);this.dirty=true;}
  focus(){this.view('ground');}
  focusMoon(){
    if(!this.context)return;
    this.updateCelestial();
    // Move beneath the Moon so the demonstration remains useful at any lunar hour.
    const moon=Cartesian3.normalize(this.moonPosition,new Cartesian3());
    this.context.viewer.camera.lookAtTransform(Matrix4.IDENTITY);
    this.context.viewer.camera.flyTo({destination:Cartesian3.fromDegrees(CesiumMath.toDegrees(Math.atan2(moon.y,moon.x)),CesiumMath.toDegrees(Math.asin(moon.z)),1000),
      orientation:{heading:0,pitch:CesiumMath.toRadians(85),roll:0},duration:1.4});
  }
  view(mode:'ground'|'orbit'|'space'){
    if(!this.context)return;
    const camera=this.context.viewer.camera;camera.lookAtTransform(Matrix4.IDENTITY);
    camera.flyTo({destination:Cartesian3.fromDegrees(-97.52,35.46,mode==='ground'?800:mode==='orbit'?1_200_000:17_000_000),
      duration:1.4,orientation:{heading:CesiumMath.toRadians(this.parameters.azimuth),pitch:CesiumMath.toRadians(mode==='ground'?5:mode==='orbit'?-22:-90),roll:0}});
  }
  destroy(){
    if(!this.context)return;
    const s=this.context.viewer.scene;
    this.removeClock?.();
    s.primitives.remove(this.primitive);
    if(this.stage)s.postProcessStages.remove(this.stage);
    this.sky?.destroy();this.multiple?.destroy();this.transmittance?.destroy();
    if(this.previous){const p=this.previous;if(s.skyAtmosphere)s.skyAtmosphere.show=p.sky;s.globe.showGroundAtmosphere=p.ground;s.fog.enabled=p.fog;if(s.sun)s.sun.show=p.sun;if(s.moon)s.moon.show=p.moon;s.light=p.light;s.globe.enableLighting=p.lighting;s.globe.lightingFadeInDistance=p.fadeIn;s.globe.lightingFadeOutDistance=p.fadeOut;}
    this.context=undefined;
  }
}
