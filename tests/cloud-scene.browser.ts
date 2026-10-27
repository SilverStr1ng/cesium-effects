import 'cesium/Build/Cesium/Widgets/widgets.css';
import {Cartesian3,Cartographic,Math as CesiumMath,PerspectiveFrustum,buildModuleUrl} from 'cesium';
import {createScene} from '../src/scene/createScene';
import {attachFrameProfiler} from '../src/scene/FrameProfiler';
import {AtmosphereEffect} from '../src/effects/hillaire-atmosphere/AtmosphereEffect';
import {GlobalCloudEffect,cloudDebugViews,type CloudDebugView} from '../src/effects/global-clouds/GlobalCloudEffect';
import {WaterCloudEffect} from '../src/effects/water-clouds/WaterCloudEffect';
import {JulianDate} from 'cesium';
import {cloudComparisonView} from '../src/effects/water-clouds/comparisonView';
import type {CloudQuality} from '../src/effects/global-clouds/config';
import {highCloudPresets} from '../src/effects/global-clouds/config';
import {celestialPositions} from '../src/effects/hillaire-atmosphere/CelestialLighting';
import {horizonView} from './celestialTerrain';
import {prepareCelestialFrame} from './celestialFixture';

const status=document.querySelector('#status')!;
try{
  if(import.meta.env.DEV)(buildModuleUrl as typeof buildModuleUrl&{setBaseUrl:(url:string)=>void}).setBaseUrl('/cesium/');
  const query=new URLSearchParams(location.search);
  const [bufferWidth,bufferHeight]=(query.get('buffer')??'984x652').split('x').map(Number);
  const sceneElement=document.querySelector<HTMLElement>('#scene')!;
  sceneElement.style.width=`${bufferWidth}px`;sceneElement.style.height=`${bufferHeight}px`;
  sceneElement.style.transformOrigin='top left';sceneElement.style.transform=`scale(${Math.min(1,984/bufferWidth)})`;
  document.querySelector('h1')!.textContent=`固定云层测试 · ${bufferWidth} × ${bufferHeight}`;
  const {viewer,setMap}=await createScene(document.querySelector('#scene')!,message=>{status.textContent=message;});
  let renderFailure='';
  viewer.scene.renderError.addEventListener((_scene:unknown,error:unknown)=>{
    const details=typeof error==='object'&&error?Object.getOwnPropertyNames(error).map(key=>`${key}: ${String((error as Record<string,unknown>)[key])}`).join('\n'):String(error);
    renderFailure=details;status.textContent=`RENDER ERROR · ${details}`;
    const pre=document.createElement('pre');pre.id='render-error';pre.textContent=details;document.body.append(pre);
  });
  viewer.useBrowserRecommendedResolution=true;
  viewer.resolutionScale=1;
  viewer.clock.shouldAnimate=false;
  viewer.clock.currentTime=JulianDate.fromIso8601(query.get('time')??'2026-06-21T17:00:00Z');
  await prepareCelestialFrame(viewer.clock.currentTime);
  // Cesium's fov is horizontal in landscape. Pin the vertical angle explicitly.
  const fovy=CesiumMath.toRadians(Number(query.get('fov')??45));
  const frustum=viewer.camera.frustum as PerspectiveFrustum;
  frustum.aspectRatio=bufferWidth/bufferHeight;
  frustum.fov=2*Math.atan(Math.tan(fovy*.5)*frustum.aspectRatio);
  viewer.scene.screenSpaceCameraController.enableInputs=false;
  await setMap('natural');
  const atmosphere=new AtmosphereEffect({hdr:query.get('storage')!=='rgba8'});atmosphere.mount({viewer,onStatus:console.info});
  atmosphere.updateParameters({exposure:8});
  // These optional display fields are deliberately separate from CloudLighting.
  for(const key of ['sunScale','moonScale','sunBrightness','moonBrightness','sunHaloScale','sunHaloBrightness','moonHaloScale','moonHaloBrightness'] as const)
    if(query.has(key))atmosphere.updateParameters({[key]:Number(query.get(key))});
  if(query.has('manualSun')){atmosphere.setClockLinked(false);atmosphere.updateParameters({elevation:Number(query.get('manualSun')),azimuth:245});}
  const model=query.get('model')??'cellular';
  const clouds=new (model==='water'?WaterCloudEffect:GlobalCloudEffect)({sunDirection:()=>atmosphere.sunDirection,moonDirection:()=>atmosphere.moonDirection,
    moonFraction:()=>atmosphere.moonLightFraction,transmittance:()=>atmosphere.transmissionTexture,atmosphereEnabled:()=>atmosphere.enabled,
    multipleScattering:()=>atmosphere.multipleScatteringTexture,medium:()=>atmosphere.mediumParameters,exposure:()=>atmosphere.parameters.exposure,
    skyIrradiance:()=>atmosphere.skyIrradianceTexture,
    backgroundStage:atmosphere.radianceStageName,backgroundIsHdr:()=>atmosphere.renderTargetMode==='RGBA16F'});
  const initializationStart=performance.now();clouds.mount({viewer,onStatus:console.info});
  const mountMs=performance.now()-initializationStart;clouds.setPaused(true);
  clouds.setMotion({angle:0,highAngle:0,evolution:0});
  let removeProfiler=()=>{};
  window.addEventListener('pagehide',()=>{removeProfiler();clouds.destroy();atmosphere.destroy();viewer.destroy();},{once:true});
  status.textContent='生成三维密度与距离场…';await clouds.ready;await atmosphere.ready;
  const assetsReadyMs=performance.now()-initializationStart;
  if(viewer.isDestroyed())throw new Error('Fixture disposed during voxel preparation');
  if(query.get('voxels')==='off')clouds.setVoxelEnabled(false);
  if(query.get('skip')==='off')clouds.setVoxelSkipping(false);
  if(query.get('skip')==='on')clouds.setVoxelSkipping(true);
  if(query.has('debug'))clouds.setDebugView(query.get('debug') as CloudDebugView);
  if(query.get('storage')==='rgba8')clouds.setHdrEnabled(false);
  if(query.get('atmosphere')==='off')atmosphere.setEnabled(false);
  if(query.get('clouds')==='off')clouds.setEnabled(false);
  if(query.has('time'))viewer.clock.currentTime=JulianDate.fromIso8601(query.get('time')!);
  if(query.has('moonLight'))clouds.moonLight=Number(query.get('moonLight'));
  if(query.has('coverage'))clouds.updateParameters({coverage:Number(query.get('coverage'))});
  const highPreset=query.get('highPreset') as keyof typeof highCloudPresets|null;
  if(highPreset&&highCloudPresets[highPreset])clouds.updateParameters(highCloudPresets[highPreset]);
  for(const key of ['seed','type','highCoverage','highBase','highThickness','highWind','highType','highOpticalDepth','highAnisotropy','highAlbedo','highMultiple'] as const)
    if(query.has(key))clouds.updateParameters({[key]:Number(query.get(key))});
  const quality=query.get('quality')??'medium';
  if(['low','medium','high'].includes(quality))clouds.setQuality(quality as CloudQuality);
  const view=query.get('view')??'above';
  const height=Number(query.get('height')??(view==='below'?800:view==='inside'?3020:view==='global'?17000000:view==='orbit'?1200000:view==='high'?12500:view==='between'?7000:8300));
  const pitch=Number(query.get('pitch')??(view==='below'?12:view==='inside'||view==='between'?0:view==='global'||view==='orbit'?-90:-18));
  viewer.camera.setView({destination:Cartesian3.fromDegrees(Number(query.get('lon')??-97.52),Number(query.get('lat')??35.46),height),
    orientation:{heading:CesiumMath.toRadians(Number(query.get('heading')??(view==='global'?0:245))),pitch:CesiumMath.toRadians(pitch),roll:0}});
  if(view==='moon')viewer.camera.setView(cloudComparisonView(viewer.clock.currentTime,true));
  if(view==='sun-disc'||view==='moon-disc'){
    const body=celestialPositions(viewer.clock.currentTime)[view==='sun-disc'?'sun':'moon'];
    const beneath=Cartographic.fromCartesian(body);
    const destination=Cartesian3.fromRadians(beneath.longitude,beneath.latitude,Number(query.get('height')??800));
    const direction=Cartesian3.normalize(Cartesian3.subtract(body,destination,new Cartesian3()),new Cartesian3());
    const right=Cartesian3.normalize(Cartesian3.cross(Cartesian3.UNIT_Z,direction,new Cartesian3()),new Cartesian3());
    viewer.camera.setView({destination,orientation:{direction,up:Cartesian3.cross(direction,right,new Cartesian3())}});
  }
  const terrainFixture=view==='moon-horizon'||view==='sun-horizon'?horizonView(viewer,celestialPositions(viewer.clock.currentTime)[view==='sun-horizon'?'sun':'moon'],query.get('terrain')==='ridge'):undefined;
  const gl=(viewer.scene as unknown as {context:{_gl:WebGL2RenderingContext}}).context._gl;
  const debug=gl.getExtension('WEBGL_debug_renderer_info');
  const state=()=>({initialization:{mountMs,assetsReadyMs},terrainFixture,utc:JulianDate.toIso8601(viewer.clock.currentTime),atmosphere:{...atmosphere.parameters,enabled:atmosphere.enabled,storage:atmosphere.renderTargetMode??'RGBA8',clockLinked:atmosphere.clockLinked,moonFraction:atmosphere.moonFraction,moonLightFraction:atmosphere.moonLightFraction,lunarTexture:atmosphere.lunarTextureInfo,discGeometry:atmosphere.celestialState?.observer},
    clouds:{model,enabled:clouds.enabled,voxels:clouds.voxelReady&&query.get('voxels')!=='off',storage:clouds.renderTargetMode,moonLight:clouds.moonLight,quality:clouds.quality,parameters:{...clouds.parameters},motion:clouds.motion},
    camera:{position:Cartesian3.pack(viewer.camera.positionWC,[]),direction:Cartesian3.pack(viewer.camera.directionWC,[]),up:Cartesian3.pack(viewer.camera.upWC,[]),fovy:frustum.fovy},
    drawingBuffer:[gl.drawingBufferWidth,gl.drawingBufferHeight],renderer:debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER)});
  removeProfiler=attachFrameProfiler(viewer,state);
  const metadata=document.createElement('pre');metadata.id='fixture-state';document.body.append(metadata);
  let frames=0;const removeMetadata=viewer.scene.postRender.addEventListener(()=>{if(++frames>=10&&(!terrainFixture||viewer.scene.globe.tilesLoaded)){
    metadata.textContent=JSON.stringify(state(),null,2);status.textContent=`READY · ${model} · ${quality} · ${view} · ${clouds.renderTargetMode} · ${JulianDate.toIso8601(viewer.clock.currentTime)} · seed 13`;
    if(query.has('capture')){const evidence=document.createElement('div');evidence.id='evidence';const img=new Image();img.dataset.name='cloud-scene';img.alt='Fixed scene';img.width=480;img.src=viewer.canvas.toDataURL('image/png');evidence.append(img);document.body.append(evidence);}
    removeMetadata();}});
  status.textContent=renderFailure?`RENDER ERROR · ${renderFailure}`:'等待 10 个完整渲染帧…';
  if(query.has('validation')){
    const controls=document.createElement('div');controls.id='validation-controls';
    controls.innerHTML='<label>诊断 <select id="debug-mode"></select></label> <label>画质 <select id="quality-mode"><option>low</option><option>medium</option><option>high</option></select></label> <button id="camera-tour">录制全球→低轨→穿云</button> <span id="tour-status"></span><a id="tour-download" hidden>下载固定镜头 WebM</a>';
    document.querySelector('main')!.after(controls);
    const debugSelect=controls.querySelector<HTMLSelectElement>('#debug-mode')!;
    for(const debugView of cloudDebugViews)debugSelect.add(new Option(debugView,debugView));
    debugSelect.value=query.get('debug')??'off';debugSelect.onchange=()=>{clouds.setDebugView(debugSelect.value as CloudDebugView);metadata.textContent=JSON.stringify({...state(),debug:debugSelect.value},null,2);};
    const qualitySelect=controls.querySelector<HTMLSelectElement>('#quality-mode')!;qualitySelect.value=clouds.quality;
    qualitySelect.onchange=()=>{
      clouds.setQuality(qualitySelect.value as CloudQuality);status.textContent=`等待 ${clouds.quality} 画质完成渲染…`;
      let qualityFrames=0;const remove=viewer.scene.postRender.addEventListener(()=>{if(++qualityFrames===10){
        metadata.textContent=JSON.stringify(state(),null,2);
        status.textContent=`READY · ${model} · ${clouds.quality} · ${view} · ${clouds.renderTargetMode} · ${JulianDate.toIso8601(viewer.clock.currentTime)} · seed ${clouds.parameters.seed}`;remove();
      }});
    };
    const button=controls.querySelector<HTMLButtonElement>('#camera-tour')!;
    let tourUrl:string|undefined;
    window.addEventListener('pagehide',()=>{if(tourUrl)URL.revokeObjectURL(tourUrl);},{once:true});
    button.onclick=()=>{
      clouds.setDebugView('off');debugSelect.value='off';button.disabled=true;
      const stream=viewer.canvas.captureStream(30),recorder=new MediaRecorder(stream,{mimeType:'video/webm;codecs=vp9',videoBitsPerSecond:12_000_000}),chunks:Blob[]=[];
      recorder.ondataavailable=event=>{if(event.data.size)chunks.push(event.data);};
      recorder.onstop=()=>{stream.getTracks().forEach(track=>track.stop());if(tourUrl)URL.revokeObjectURL(tourUrl);tourUrl=URL.createObjectURL(new Blob(chunks,{type:'video/webm'}));const link=controls.querySelector<HTMLAnchorElement>('#tour-download')!;link.href=tourUrl;link.download='global-cloud-tour.webm';link.hidden=false;button.disabled=false;};
      const keys=[[17000000,-90],[1200000,-90],[160000,-60],[12500,-18],[8300,-18],[3020,0],[800,12]];
      const start=performance.now();recorder.start();
      const remove=viewer.scene.preUpdate.addEventListener(()=>{
        const t=Math.min(6,(performance.now()-start)/4000),index=Math.min(5,Math.floor(t)),f=t-index,ease=f*f*(3-2*f);
        const h=Math.exp(Math.log(keys[index][0])*(1-ease)+Math.log(keys[index+1][0])*ease),pitch=keys[index][1]*(1-ease)+keys[index+1][1]*ease;
        viewer.camera.setView({destination:Cartesian3.fromDegrees(Number(query.get('lon')??-97.52),Number(query.get('lat')??35.46),h),orientation:{heading:CesiumMath.toRadians(245),pitch:CesiumMath.toRadians(pitch),roll:0}});
        controls.querySelector('#tour-status')!.textContent=`${t===6?'COMPLETE':'RECORDING'} · ${(t*4).toFixed(1)} s · ${(h/1000).toFixed(3)} km`;
        if(t===6){remove();recorder.stop();metadata.textContent=JSON.stringify(state(),null,2);}
      });
      window.addEventListener('pagehide',()=>{remove();if(recorder.state!=='inactive')recorder.stop();stream.getTracks().forEach(track=>track.stop());},{once:true});
    };
  }
  if(query.has('diagnostics')){
    const remove=viewer.scene.postRender.addEventListener(()=>{
      const up=Cartesian3.normalize(viewer.camera.positionWC,new Cartesian3());
      status.textContent+=` · moon fraction ${atmosphere.moonFraction.toFixed(3)} · moon altitude ${CesiumMath.toDegrees(Math.asin(Cartesian3.dot(up,atmosphere.moonDirection))).toFixed(1)}° · sun altitude ${CesiumMath.toDegrees(Math.asin(Cartesian3.dot(up,atmosphere.sunDirection))).toFixed(1)}°`;
      remove();
    });
  }
}catch(error){status.textContent=String(error);console.error(error);}
