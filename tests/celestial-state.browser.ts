import 'cesium/Build/Cesium/Widgets/widgets.css';
import {Cartesian3,JulianDate,buildModuleUrl} from 'cesium';
import {createScene} from '../src/scene/createScene';
import {AtmosphereEffect} from '../src/effects/hillaire-atmosphere/AtmosphereEffect';
import {POLAR_SCALE} from '../src/effects/hillaire-atmosphere/atmosphereMath';
import {GlobalCloudEffect} from '../src/effects/global-clouds/GlobalCloudEffect';
import {GpuLut} from '../src/scene/GpuLut';

const output=document.querySelector('#result')!;
try{
  if(import.meta.env.DEV)(buildModuleUrl as typeof buildModuleUrl&{setBaseUrl:(s:string)=>void}).setBaseUrl('/cesium/');
  const {viewer}=await createScene(document.querySelector('#scene')!,console.info);
  const original={light:viewer.scene.light,sun:viewer.scene.sun?.show,moon:viewer.scene.moon?.show,stages:viewer.scene.postProcessStages.length};
  viewer.clock.shouldAnimate=false;viewer.clock.currentTime=JulianDate.fromIso8601('2026-10-22T00:00:00Z');
  const sky=new AtmosphereEffect();sky.mount({viewer,onStatus:console.info});
  const enqueue=GpuLut.prototype.enqueue;let irradianceBuilds=0;
  GpuLut.prototype.enqueue=function(frame){if(this.texture===sky.skyIrradianceTexture)irradianceBuilds++;enqueue.call(this,frame);};
  const frame=()=>new Promise<void>((resolve,reject)=>{
    const fail=viewer.scene.renderError.addEventListener((_scene,error)=>{remove();fail();reject(error);});
    const remove=viewer.scene.postRender.addEventListener(()=>{remove();fail();resolve();});
  });
  const unscale=(v:Cartesian3)=>Cartesian3.normalize(new Cartesian3(v.x,v.y,v.z/POLAR_SCALE),new Cartesian3());
  const checks:{name:string;pass:boolean;error?:number}[]=[];
  await frame();const linkedSun=Cartesian3.clone(sky.sunDirection),linkedFraction=sky.moonFraction;
  sky.setClockLinked(false);sky.updateParameters({elevation:-18,azimuth:245});await frame();
  const expected=(1-Cartesian3.dot(unscale(sky.sunDirection),unscale(sky.moonDirection)))*.5;
  checks.push({name:'manual sun, displayed terminator and cloud moon fraction agree',pass:Math.abs(expected-sky.moonFraction)<.002,error:Math.abs(expected-sky.moonFraction)});
  sky.setClockLinked(true);await frame();
  checks.push({name:'relinking frozen UTC restores the astronomical sun and phase',pass:Cartesian3.distance(linkedSun,sky.sunDirection)<1e-9&&Math.abs(linkedFraction-sky.moonFraction)<1e-9});
  const moon=Cartesian3.clone(sky.moonDirection),fraction=sky.moonFraction;
  viewer.camera.setView({destination:Cartesian3.fromDegrees(70,-35,17000000)});await frame();
  checks.push({name:'observer movement updates lunar parallax and phase at frozen UTC',pass:Cartesian3.distance(moon,sky.moonDirection)>.01&&Math.abs(fraction-sky.moonFraction)>.001});
  checks.push({name:'world-wide irradiance cache builds once across sun and observer changes',pass:irradianceBuilds===1});
  sky.updateParameters({ozone:.8});await frame();
  checks.push({name:'medium changes invalidate irradiance cache exactly once',pass:Number(irradianceBuilds)===2});
  GpuLut.prototype.enqueue=enqueue;
  const time=JulianDate.clone(viewer.clock.currentTime);sky.setPaused(true);sky.setEnabled(false);sky.setEnabled(true);sky.reset();await frame();
  checks.push({name:'toggle/reset preserves paused UTC and clock linkage',pass:JulianDate.equals(time,viewer.clock.currentTime)&&!viewer.clock.shouldAnimate&&sky.clockLinked});
  const clouds=new GlobalCloudEffect({sunDirection:()=>sky.sunDirection,moonDirection:()=>sky.moonDirection,moonFraction:()=>sky.moonFraction,
    transmittance:()=>sky.transmissionTexture,multipleScattering:()=>sky.multipleScatteringTexture,medium:()=>sky.mediumParameters,
    atmosphereEnabled:()=>sky.enabled,exposure:()=>sky.parameters.exposure,skyIrradiance:()=>sky.skyIrradianceTexture,
    backgroundStage:sky.radianceStageName,backgroundIsHdr:()=>sky.renderTargetMode==='RGBA16F'});
  clouds.mount({viewer,onStatus:console.info});clouds.setPaused(true);await clouds.ready;await frame();
  const stages=viewer.scene.postProcessStages.length;
  for(const quality of ['low','high','medium'] as const){clouds.setQuality(quality);await frame();}
  clouds.setHdrEnabled(false);await frame();sky.setEnabled(false);await frame();sky.setEnabled(true);await frame();
  checks.push({name:'quality rebuild, RGBA8 and independent sky toggle keep valid attachments',pass:viewer.scene.postProcessStages.length===stages&&clouds.renderTargetMode==='RGBA8'});
  clouds.destroy();
  const pending=new GlobalCloudEffect();pending.mount({viewer,onStatus:console.info});pending.destroy();await pending.ready;
  checks.push({name:'destroy during worker preparation settles readiness and removes cloud stages',pass:!pending.voxelReady&&viewer.scene.postProcessStages.length===original.stages+1});
  const textures=[sky.transmissionTexture,sky.multipleScatteringTexture,sky.skyIrradianceTexture];sky.destroy();
  checks.push({name:'atmosphere destroys transmission, multiple-scattering and diffuse irradiance textures',pass:textures.every(t=>t?.isDestroyed())});
  checks.push({name:'destroy restores owned scene state and removes stages',pass:viewer.scene.light===original.light&&viewer.scene.sun?.show===original.sun&&viewer.scene.moon?.show===original.moon&&viewer.scene.postProcessStages.length===original.stages});
  viewer.destroy();output.textContent=JSON.stringify({passed:checks.every(c=>c.pass),checks},null,2);
  document.title=checks.every(c=>c.pass)?'PASS · Celestial state':'FAIL · Celestial state';
}catch(error){output.textContent=String(error);document.title='ERROR · Celestial state';}
