import 'cesium/Build/Cesium/Widgets/widgets.css';
import {Cartesian3,Math as CesiumMath,buildModuleUrl} from 'cesium';
import {createScene} from '../src/scene/createScene';
import {attachFrameProfiler} from '../src/scene/FrameProfiler';
import {AtmosphereEffect} from '../src/effects/hillaire-atmosphere/AtmosphereEffect';
import {GlobalCloudEffect} from '../src/effects/global-clouds/GlobalCloudEffect';
import type {CloudQuality} from '../src/effects/global-clouds/config';

const status=document.querySelector('#status')!;
try{
  if(import.meta.env.DEV)(buildModuleUrl as typeof buildModuleUrl&{setBaseUrl:(url:string)=>void}).setBaseUrl('/cesium/');
  const query=new URLSearchParams(location.search);
  const {viewer,setMap}=await createScene(document.querySelector('#scene')!,message=>{status.textContent=message;});
  viewer.useBrowserRecommendedResolution=true;
  viewer.resolutionScale=1;
  viewer.scene.screenSpaceCameraController.enableInputs=false;
  await setMap('natural');
  const atmosphere=new AtmosphereEffect();atmosphere.mount({viewer,onStatus:console.info});
  const clouds=new GlobalCloudEffect({sunDirection:()=>atmosphere.sunDirection,moonDirection:()=>atmosphere.moonDirection,
    moonFraction:()=>atmosphere.moonFraction,transmittance:()=>atmosphere.transmissionTexture,atmosphereEnabled:()=>atmosphere.enabled,
    multipleScattering:()=>atmosphere.multipleScatteringTexture,medium:()=>atmosphere.mediumParameters,exposure:()=>atmosphere.parameters.exposure});
  clouds.mount({viewer,onStatus:console.info});clouds.setPaused(true);
  const quality=query.get('quality')??'medium';
  if(['low','medium','high'].includes(quality))clouds.setQuality(quality as CloudQuality);
  const view=query.get('view')??'above';
  const height=view==='below'?800:view==='inside'?3020:view==='global'?17000000:8300;
  const pitch=view==='below'?12:view==='inside'?0:view==='global'?-90:-18;
  viewer.camera.setView({destination:Cartesian3.fromDegrees(-97.52,35.46,height),
    orientation:{heading:CesiumMath.toRadians(view==='global'?0:245),pitch:CesiumMath.toRadians(pitch),roll:0}});
  const removeProfiler=attachFrameProfiler(viewer,()=>({clouds:{quality:clouds.quality,parameters:clouds.parameters},
    camera:{position:Cartesian3.pack(viewer.camera.positionWC,[]),direction:Cartesian3.pack(viewer.camera.directionWC,[])}}));
  status.textContent=`READY · ${quality} · ${view} · UTC 2026-06-21 17:00 · seed 13`;
  window.addEventListener('pagehide',()=>{removeProfiler();clouds.destroy();atmosphere.destroy();viewer.destroy();},{once:true});
}catch(error){status.textContent=String(error);console.error(error);}
