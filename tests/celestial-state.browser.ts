import 'cesium/Build/Cesium/Widgets/widgets.css';
import {Cartesian3,JulianDate,buildModuleUrl} from 'cesium';
import {createScene} from '../src/scene/createScene';
import {AtmosphereEffect} from '../src/effects/hillaire-atmosphere/AtmosphereEffect';
import {POLAR_SCALE} from '../src/effects/hillaire-atmosphere/atmosphereMath';
import {GlobalCloudEffect} from '../src/effects/global-clouds/GlobalCloudEffect';
import {GpuLut} from '../src/scene/GpuLut';
import {mountEnvironmentPanel} from '../src/ui/EnvironmentPanel';
import {lunarPhasePresets} from '../src/effects/hillaire-atmosphere/celestialPresets';
import {celestialPositions,resolveCelestialState} from '../src/effects/hillaire-atmosphere/CelestialLighting';
import {prepareCelestialFrame} from './celestialFixture';

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
  const record=(check:typeof checks[number])=>{checks.push(check);output.textContent=JSON.stringify({running:true,checks},null,2);};
  await sky.ready;await frame();
  await prepareCelestialFrame(viewer.clock.currentTime);await frame();
  const resolved=resolveCelestialState(celestialPositions(viewer.clock.currentTime),viewer.camera.positionWC);
  const frameError=Cartesian3.distance(resolved.observer.moonDirection,sky.celestialState!.observer.moonDirection);
  record({name:'paused UTC replaces startup frame with ready ICRF geometry',pass:frameError<1e-12,error:frameError});
  const linkedSun=Cartesian3.clone(sky.sunDirection),linkedFraction=sky.moonFraction;
  record({name:'NASA lunar albedo loads at 2K with a complete linear mip chain',pass:sky.lunarTextureInfo?.loaded===true&&sky.lunarTextureInfo.width===2048&&sky.lunarTextureInfo.gpuBytes===11184812});
  sky.setClockLinked(false);sky.updateParameters({elevation:-18,azimuth:245});await frame();
  const expected=(1-Cartesian3.dot(unscale(sky.sunDirection),sky.celestialState!.observer.moonDirection))*.5;
  const cloudExpected=(1-Cartesian3.dot(unscale(sky.sunDirection),unscale(sky.moonDirection)))*.5;
  record({name:'manual mode uses the same synthetic sun with distinct observer and cloud phase geometry',pass:Math.abs(expected-sky.moonFraction)<1e-12&&Math.abs(cloudExpected-sky.moonLightFraction)<1e-12,error:Math.abs(expected-sky.moonFraction)});
  sky.setClockLinked(true);await frame();
  record({name:'relinking frozen UTC restores the astronomical sun and phase',pass:Cartesian3.distance(linkedSun,sky.sunDirection)<1e-9&&Math.abs(linkedFraction-sky.moonFraction)<1e-9});
  const moon=Cartesian3.clone(sky.moonDirection),fraction=sky.moonLightFraction;
  const observerMoon=Cartesian3.clone(sky.celestialState!.observer.moonDirection),observerFraction=sky.moonFraction;
  viewer.camera.setView({destination:Cartesian3.fromDegrees(70,-35,17000000)});await frame();
  record({name:'fixed cloud point moonlight is independent of camera at frozen UTC',pass:Cartesian3.distance(moon,sky.moonDirection)<1e-12&&Math.abs(fraction-sky.moonLightFraction)<1e-12,error:Cartesian3.distance(moon,sky.moonDirection)});
  record({name:'observer movement updates lunar parallax and phase at frozen UTC',pass:Cartesian3.distance(observerMoon,sky.celestialState!.observer.moonDirection)>.01&&Math.abs(observerFraction-sky.moonFraction)>.001});
  const sunBefore=Cartesian3.clone(sky.sunDirection),lightBefore=sky.moonLightFraction;
  sky.updateParameters({sunScale:1,moonScale:1,sunBrightness:.5,sunHaloBrightness:0,moonBrightness:4});await frame();
  record({name:'visual size, brightness and halo controls do not change transport energy or direction',pass:lightBefore===sky.moonLightFraction&&Cartesian3.equals(sunBefore,sky.sunDirection)&&Cartesian3.equals(moon,sky.moonDirection)});
  record({name:'world-wide irradiance cache builds once across sun and observer changes',pass:irradianceBuilds===1});
  sky.updateParameters({ozone:.8});await frame();
  record({name:'medium changes invalidate irradiance cache exactly once',pass:Number(irradianceBuilds)===2});
  GpuLut.prototype.enqueue=enqueue;
  const time=JulianDate.clone(viewer.clock.currentTime);sky.setPaused(true);sky.setEnabled(false);sky.setEnabled(true);sky.reset();await frame();
  record({name:'toggle/reset preserves paused UTC and clock linkage',pass:JulianDate.equals(time,viewer.clock.currentTime)&&!viewer.clock.shouldAnimate&&sky.clockLinked});
  const sidebar=document.createElement('aside');sidebar.innerHTML='<div class="library-heading"></div>';document.body.append(sidebar);
  const panel=mountEnvironmentPanel(sidebar,sky,()=>{},viewer),click=(selector:string)=>panel.element.querySelector<HTMLButtonElement>(selector)!.click();
  for(const key of Object.keys(lunarPhasePresets) as (keyof typeof lunarPhasePresets)[]){
    sky.setClockLinked(false);click(`[data-moon-phase="${key}"]`);await frame();
    record({name:`${key} phase preset restores ephemeris UTC and paused state`,pass:sky.clockLinked&&!viewer.clock.shouldAnimate&&JulianDate.equals(viewer.clock.currentTime,JulianDate.fromIso8601(lunarPhasePresets[key].utc))});
  }
  sky.setClockLinked(false);const before=JulianDate.clone(viewer.clock.currentTime);click('[data-date-step="24"]');await frame();
  record({name:'date stepping preserves manual mode and advances exactly one UTC day',pass:!sky.clockLinked&&JulianDate.secondsDifference(viewer.clock.currentTime,before)===86400});
  click('#clock-play');
  record({name:'playback button and explicit status update immediately',pass:viewer.clock.shouldAnimate&&panel.element.querySelector('#clock-state')!.textContent!.includes('播放中')&&panel.element.querySelector('#clock-play')!.getAttribute('aria-pressed')==='true'});
  click('#clock-play');panel.destroy();sidebar.remove();
  const clouds=new GlobalCloudEffect({sunDirection:()=>sky.sunDirection,moonDirection:()=>sky.moonDirection,moonFraction:()=>sky.moonLightFraction,
    transmittance:()=>sky.transmissionTexture,multipleScattering:()=>sky.multipleScatteringTexture,medium:()=>sky.mediumParameters,
    atmosphereEnabled:()=>sky.enabled,exposure:()=>sky.parameters.exposure,skyIrradiance:()=>sky.skyIrradianceTexture,
    backgroundStage:sky.radianceStageName,backgroundIsHdr:()=>sky.renderTargetMode==='RGBA16F'});
  clouds.mount({viewer,onStatus:console.info});clouds.setPaused(true);await clouds.ready;await frame();
  const stages=viewer.scene.postProcessStages.length;
  for(const quality of ['low','high','medium'] as const){clouds.setQuality(quality);await frame();}
  clouds.setHdrEnabled(false);await frame();sky.setEnabled(false);await frame();sky.setEnabled(true);await frame();
  record({name:'quality rebuild, RGBA8 and independent sky toggle keep valid attachments',pass:viewer.scene.postProcessStages.length===stages&&clouds.renderTargetMode==='RGBA8'});
  clouds.destroy();
  const pending=new GlobalCloudEffect();pending.mount({viewer,onStatus:console.info});pending.destroy();await pending.ready;
  record({name:'destroy during worker preparation settles readiness and removes cloud stages',pass:!pending.voxelReady&&viewer.scene.postProcessStages.length===original.stages+1});
  const textures=[sky.transmissionTexture,sky.multipleScatteringTexture,sky.skyIrradianceTexture,sky.lunarTexture];sky.destroy();
  record({name:'atmosphere destroys transmission, multiple-scattering and diffuse irradiance textures',pass:textures.every(t=>t?.isDestroyed())});
  record({name:'destroy restores owned scene state and removes stages',pass:viewer.scene.light===original.light&&viewer.scene.sun?.show===original.sun&&viewer.scene.moon?.show===original.moon&&viewer.scene.postProcessStages.length===original.stages});
  const pendingSky=new AtmosphereEffect();pendingSky.mount({viewer,onStatus:console.info});const pendingTexture=pendingSky.lunarTexture;pendingSky.destroy();await pendingSky.ready;
  record({name:'destroy during lunar texture loading releases fallback and settles readiness',pass:pendingTexture?.isDestroyed()===true&&viewer.scene.postProcessStages.length===original.stages});
  viewer.destroy();output.textContent=JSON.stringify({passed:checks.every(c=>c.pass),checks},null,2);
  document.title=checks.every(c=>c.pass)?'PASS · Celestial state':'FAIL · Celestial state';
}catch(error){output.textContent=String(error);document.title='ERROR · Celestial state';}
