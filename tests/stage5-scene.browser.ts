import 'cesium/Build/Cesium/Widgets/widgets.css';
import {Cartesian3,Cartographic,JulianDate,PerspectiveFrustum,Math as CesiumMath} from 'cesium';
import {createScene} from '../src/scene/createScene';
import {AtmosphereEffect} from '../src/effects/hillaire-atmosphere/AtmosphereEffect';
import {GlobalCloudEffect} from '../src/effects/global-clouds/GlobalCloudEffect';
import {cloudDefaults,type CloudQuality} from '../src/effects/global-clouds/config';
import {prepareCelestialFrame} from './celestialFixture';
import {celestialPositions} from '../src/effects/hillaire-atmosphere/CelestialLighting';
import {webglTrace} from './webglTrace';
import {reducedCloudModel} from './cloudCompileReduction';

const status=document.querySelector('#status')!,boot=performance.now(),query=new URLSearchParams(location.search);
const longTasks:{startMs:number;durationMs:number}[]=[];
const observer=new PerformanceObserver(list=>{for(const e of list.getEntries())longTasks.push({startMs:e.startTime,durationMs:e.duration});});
try{observer.observe({type:'longtask',buffered:true});}catch{/* Unsupported on some browsers. */}
try{
  const viewerStart=performance.now(),{viewer,setMap}=await createScene(document.querySelector('#scene')!,()=>{}),viewerWallMs=performance.now()-viewerStart;
  viewer.useBrowserRecommendedResolution=true;viewer.resolutionScale=1;viewer.clock.shouldAnimate=false;
  viewer.scene.screenSpaceCameraController.enableInputs=false;
  const gl=(viewer.scene as unknown as {context:{_gl:WebGL2RenderingContext}}).context._gl,trace=webglTrace(gl);
  const pre=viewer.scene.preRender.addEventListener(trace.beforeFrame),post=viewer.scene.postRender.addEventListener(trace.afterFrame);
  let error='';viewer.scene.renderError.addEventListener((_scene:unknown,e:unknown)=>{error=String(e);status.textContent=`ERROR: ${error}`;});
  let firstFrameMs:number|undefined,firstInteractiveTurnMs:number|undefined;
  const removeFirst=viewer.scene.postRender.addEventListener(()=>{firstFrameMs=performance.now()-boot;setTimeout(()=>{firstInteractiveTurnMs=performance.now()-boot;},0);removeFirst();});
  await setMap('natural');viewer.clock.currentTime=JulianDate.fromIso8601('2026-06-21T17:00:00Z');await prepareCelestialFrame(viewer.clock.currentTime);
  const frustum=viewer.camera.frustum as PerspectiveFrustum;frustum.aspectRatio=1920/1080;frustum.fov=2*Math.atan(Math.tan(Math.PI/6)*frustum.aspectRatio);
  const camera=(height:number,pitch:number,lon=-97.52,lat=35.46)=>viewer.camera.setView({destination:Cartesian3.fromDegrees(lon,lat,height),orientation:{heading:CesiumMath.toRadians(245),pitch:CesiumMath.toRadians(pitch),roll:0}});
  camera(17e6,-90);
  const atmosphere=new AtmosphereEffect();const atmosphereStart=performance.now();atmosphere.mount({viewer,onStatus:()=>{}});const atmosphereMountMs=performance.now()-atmosphereStart;
  const clouds=new GlobalCloudEffect({sunDirection:()=>atmosphere.sunDirection,moonDirection:()=>atmosphere.moonDirection,moonFraction:()=>atmosphere.moonLightFraction,
    atmosphereEnabled:()=>atmosphere.enabled,transmittance:()=>atmosphere.transmissionTexture,multipleScattering:()=>atmosphere.multipleScatteringTexture,
    skyIrradiance:()=>atmosphere.skyIrradianceTexture,medium:()=>atmosphere.mediumParameters,exposure:()=>atmosphere.parameters.exposure,
    backgroundStage:atmosphere.radianceStageName,backgroundIsHdr:()=>atmosphere.renderTargetMode==='RGBA16F'},query.has('reduce')?reducedCloudModel(query.get('reduce')!):undefined);
  (clouds as GlobalCloudEffect&{assetCacheEnabled?:boolean}).assetCacheEnabled=query.get('cache')!=='off';
  const cloudStart=performance.now();clouds.mount({viewer,onStatus:m=>{status.textContent=m;}});const cloudMountMs=performance.now()-cloudStart;
  clouds.setPaused(true);clouds.setMotion({angle:0,highAngle:0,evolution:0});
  const frame=(count=1)=>new Promise<void>((resolve,reject)=>{let n=0;const timer=setTimeout(()=>{remove();reject(new Error('No rendered frame within 60 s'));},60000);const remove=viewer.scene.postRender.addEventListener(()=>{if(error){clearTimeout(timer);remove();reject(new Error(error));}else if(++n>=count){clearTimeout(timer);remove();resolve();}});});
  const state=()=>({utc:JulianDate.toIso8601(viewer.clock.currentTime),buffer:[gl.drawingBufferWidth,gl.drawingBufferHeight],camera:{position:Cartesian3.pack(viewer.camera.positionWC,[]),direction:Cartesian3.pack(viewer.camera.directionWC,[]),up:Cartesian3.pack(viewer.camera.upWC,[]),fovy:frustum.fovy},clouds:{quality:clouds.quality,storage:clouds.renderTargetMode,parameters:{...clouds.parameters},motion:clouds.motion},atmosphere:{parameters:{...atmosphere.parameters},storage:atmosphere.renderTargetMode},visible:!document.hidden,focused:document.hasFocus()});
  const capture=(name:string)=>{const figure=document.createElement('figure'),img=new Image();img.alt=name;img.dataset.name=name;img.src=viewer.canvas.toDataURL('image/png');figure.append(img);const caption=document.createElement('figcaption');caption.textContent=name;figure.append(caption);document.querySelector('#evidence')!.append(figure);return {name,state:state()};};
  await clouds.ready;await atmosphere.ready;const resourcesReadyMs=performance.now()-boot;await frame(10);
  const renderer=gl.getExtension('WEBGL_debug_renderer_info');
  const startup={reduction:query.get('reduce'),viewerWallMs,atmosphereMountMs,cloudMountMs,firstFrameMs,firstInteractiveTurnMs,resourcesReadyMs,fullFrameReadyMs:performance.now()-boot,cloudInitialization:clouds.initialization,lunarTexture:atmosphere.lunarTextureInfo,
    longTasks,longestMainTaskMs:Math.max(0,...longTasks.map(t=>t.durationMs)),shaderApi:trace.timeline,firstDrawGpu:trace.firstGpu,state:state(),renderer:renderer?gl.getParameter(renderer.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),
    boundaries:'CPU API times are wall times incl. scheduler/GC/driver waits. Link/status/draw may share deferred compilation. firstInteractiveTurn = first postRender + timer task; no synthetic input latency claim.'};
  document.querySelector('#startup-result')!.textContent=JSON.stringify(startup,null,2);capture('startup-global');status.textContent='READY';
  const matrixButton=document.querySelector<HTMLButtonElement>('#run-matrix')!,switchButton=document.querySelector<HTMLButtonElement>('#run-switches')!,tourButton=document.querySelector<HTMLButtonElement>('#run-tour')!;
  const captureButton=document.querySelector<HTMLButtonElement>('#run-captures')!;
  const buttons=[matrixButton,switchButton,tourButton,captureButton];buttons.forEach(b=>b.disabled=false);
  const run=(fn:()=>Promise<void>)=>async()=>{buttons.forEach(b=>b.disabled=true);try{await fn();}catch(e){status.textContent=String(e);}finally{buttons.forEach(b=>b.disabled=false);}};
  const configure=async(name:string)=>{
    clouds.updateParameters(cloudDefaults);clouds.setMotion({angle:0,highAngle:0,evolution:0});
    viewer.clock.currentTime=JulianDate.fromIso8601(name==='night'?'2026-10-26T04:12:00Z':'2026-06-21T17:00:00Z');await prepareCelestialFrame(viewer.clock.currentTime);
    if(name==='global')camera(17e6,-90);if(name==='orbit')camera(1.2e6,-90);if(name==='inside')camera(3020,0);if(name==='ground')camera(800,12);
    if(name==='high-only'){camera(7000,0);clouds.updateParameters({coverage:0});}
    if(name==='two-layers')camera(17000000,-90);
    if(name==='night'){const p=Cartographic.fromCartesian(celestialPositions(viewer.clock.currentTime).moon);camera(800,12,CesiumMath.toDegrees(p.longitude),CesiumMath.toDegrees(p.latitude));}
    await frame(60);
  };
  matrixButton.onclick=run(async()=>{
    const results:unknown[]=[],output=document.querySelector('#benchmark-result')!;
    const names=['global','orbit','inside','ground','night','high-only','two-layers'].filter(name=>!query.has('scenes')||query.get('scenes')!.split(',').includes(name));
    for(const name of names){
      await configure(name);const evidence=capture(name);
      for(const mode of ['frame','passes'] as const)for(let round=0;round<2;round++){
        status.textContent=`GPU ${name} · ${mode} · round ${round+1}/2`;
        const initial=state(),timing=await trace.collect(mode,200,90000);results.push({name,mode,round:round+1,initial,final:state(),timing,evidence});
        output.textContent=JSON.stringify({complete:false,results},null,2);
      }
    }
    output.textContent=JSON.stringify({complete:true,results},null,2);status.textContent='GPU MATRIX COMPLETE';
  });
  captureButton.onclick=run(async()=>{
    const samples=[];
    for(const name of ['global','orbit','inside','ground','night','high-only','two-layers']){await configure(name);samples.push(capture(name));}
    document.querySelector('#capture-result')!.textContent=JSON.stringify({complete:true,samples},null,2);status.textContent='CAPTURES COMPLETE';
  });
  switchButton.onclick=run(async()=>{
    await configure('global');const results=[];
    for(const [quality,hdr] of [['low',true],['high',true],['medium',false],['medium',true],['low',true],['high',true],['medium',true]] as const){
      const start=performance.now(),timelineStart=trace.timeline.length,attachmentStart=trace.attachments.length;clouds.setQuality(quality as CloudQuality);clouds.setHdrEnabled(hdr);
      await frame(3);
      const wallMs=performance.now()-start,shaderApi=trace.timeline.slice(timelineStart),attachments=trace.attachments.slice(attachmentStart),initial=state();
      // Separate rounds: never nest pass timers inside a whole-frame query.
      const timing=query.has('quality-gpu')?{frame:await trace.collect('frame',200,90000),passes:await trace.collect('passes',200,90000)}:undefined;
      results.push({quality,hdr,wallMs,shaderApi,attachments,initial,final:state(),timing,evidence:capture(`switch-${quality}-${hdr?'hdr':'rgba8'}`)});
      document.querySelector('#switch-result')!.textContent=JSON.stringify({complete:false,results},null,2);
    }
    document.querySelector('#switch-result')!.textContent=JSON.stringify({complete:true,results},null,2);status.textContent='SWITCHES COMPLETE';
  });
  tourButton.onclick=run(async()=>{
    await configure('global');const keys=[[17e6,-90],[1.2e6,-90],[160000,-60],[12500,-18],[8300,-18],[3020,0],[800,12]],frames:unknown[]=[],samples:unknown[]=[];
    const start=performance.now();let nextKey=0,last=0;
    await new Promise<void>(resolve=>{const remove=viewer.scene.preUpdate.addEventListener(()=>{const t=Math.min(6,(performance.now()-start)/4000),i=Math.min(5,Math.floor(t)),f=t-i,e=f*f*(3-2*f);const height=Math.exp(Math.log(keys[i][0])*(1-e)+Math.log(keys[i+1][0])*e);camera(height,keys[i][1]*(1-e)+keys[i+1][1]*e);});
      const post=viewer.scene.postRender.addEventListener(()=>{const elapsed=performance.now()-start;frames.push({elapsed,interval:elapsed-last,state:state()});last=elapsed;if(elapsed>=nextKey*1000){samples.push(capture(`tour-${nextKey.toString().padStart(2,'0')}`));nextKey++;}if(elapsed>=24000){remove();post();resolve();}});
    });
    document.querySelector('#tour-result')!.textContent=JSON.stringify({complete:true,frames,samples},null,2);status.textContent='TOUR COMPLETE';
  });
  window.addEventListener('pagehide',()=>{pre();post();trace.destroy();observer.disconnect();clouds.destroy();atmosphere.destroy();viewer.destroy();},{once:true});
  if(query.has('auto'))matrixButton.click();
}catch(e){status.textContent=`ERROR: ${String(e)}`;observer.disconnect();}
