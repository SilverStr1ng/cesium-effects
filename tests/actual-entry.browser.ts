import {CloudComparison} from '../src/effects/water-clouds/CloudComparison';
import {webglTrace} from './webglTrace';
import type {GlobalCloudEffect} from '../src/effects/global-clouds/GlobalCloudEffect';
import {Cartesian3,JulianDate} from 'cesium';

const started=performance.now(),query=new URLSearchParams(location.search),longTasks:{start:number;duration:number}[]=[];
const observer=new PerformanceObserver(list=>{for(const task of list.getEntries())if(task.startTime>=started)longTasks.push({start:task.startTime-started,duration:task.duration});});
observer.observe({type:'longtask',buffered:true});
type InternalComparison={effects:Record<string,GlobalCloudEffect>};
const effects=(c:CloudComparison)=>(c as unknown as InternalComparison).effects;
const mounted=(c:CloudComparison)=>Object.entries(effects(c)).filter(([,e])=>Boolean((e as unknown as {context?:unknown}).context)).map(([name])=>name);
const mount=CloudComparison.prototype.mount;let mountWallMs=0,firstFrameAfterMountMs:number|undefined,firstInteractiveTimerMs:number|undefined;
CloudComparison.prototype.mount=function(context){
  this.assetCacheEnabled=query.get('cache')!=='off';for(const e of Object.values(effects(this)))e.assetCacheEnabled=this.assetCacheEnabled;
  const remove=context.viewer.scene.postRender.addEventListener(()=>{remove();firstFrameAfterMountMs=performance.now()-started;setTimeout(()=>{firstInteractiveTimerMs=performance.now()-started;},0);});
  const start=performance.now();mount.call(this,context);mountWallMs=performance.now()-start;
};
let trace:ReturnType<typeof webglTrace>|undefined;
const getContext=HTMLCanvasElement.prototype.getContext;
HTMLCanvasElement.prototype.getContext=function(this:HTMLCanvasElement,...args:Parameters<typeof getContext>){
  const result=getContext.apply(this,args);if(args[0]==='webgl2'&&result&&!trace)trace=webglTrace(result as WebGL2RenderingContext);return result;
} as typeof getContext;
try{
  const app=await import('../src/main').then(m=>m.application);
  CloudComparison.prototype.mount=mount;HTMLCanvasElement.prototype.getContext=getContext;
  if(!app)throw new Error('Actual main entry failed');
  const {viewer,clouds}=app,bootReturnedMs=performance.now()-started,initialMounted=mounted(clouds);
  const state=()=>({utc:JulianDate.toIso8601(viewer.clock.currentTime),camera:{position:Cartesian3.pack(viewer.camera.positionWC,[]),direction:Cartesian3.pack(viewer.camera.directionWC,[]),up:Cartesian3.pack(viewer.camera.upWC,[]),fovy:(viewer.camera.frustum as {fovy?:number}).fovy},buffer:[viewer.scene.drawingBufferWidth,viewer.scene.drawingBufferHeight],parameters:{...clouds.parameters},quality:clouds.quality,motion:effects(clouds)[clouds.mode].motion,visible:!document.hidden,focused:document.hasFocus()});
  const panel=document.createElement('section');panel.id='entry-evidence';panel.style.cssText='position:fixed;z-index:500;right:8px;top:70px;width:520px;max-height:75vh;overflow:auto;background:#14202f;color:white;padding:12px;font:12px monospace';
  panel.innerHTML='<h2>Actual main entry</h2><button id="entry-lifecycle">Run lifecycle</button><pre id="entry-startup"></pre><pre id="entry-result"></pre>';
  document.body.append(panel);const startup=panel.querySelector('#entry-startup')!,output=panel.querySelector('#entry-result')!;
  const checks:{name:string;pass:boolean;[key:string]:unknown}[]=[];
  const frame=(n=1)=>new Promise<void>(resolve=>{let i=0;const remove=viewer.scene.postRender.addEventListener(()=>{if(++i>=n){remove();resolve();}});});
  const waitReady=async()=>{await Promise.all(Object.values(effects(clouds)).map(e=>e.ready));};
  const metrics=()=>Object.fromEntries(Object.entries(effects(clouds)).map(([name,e])=>[name,{...e.initialization}]));
  const shaderSeed=(e:GlobalCloudEffect)=>(e as unknown as {uniforms():{u_seed():number}}).uniforms().u_seed();
  checks.push({name:'actual default entry lazily mounts only cellular',pass:initialMounted.join(',')==='cellular',mounted:initialMounted,mountWallMs});
  const run=async()=>{
    const button=panel.querySelector<HTMLButtonElement>('#entry-lifecycle')!;button.disabled=true;
    try{
      const loading=Object.values(effects(clouds)).some(e=>mounted(clouds).includes(e.id==='water-clouds'?'water':'cellular')&&e.initialization.status==='loading');
      clouds.setPaused(true);const switchStart=performance.now();clouds.setMode('water');const firstWaterSubmitMs=performance.now()-switchStart;
      if(!loading){await waitReady();await frame(2);checks.push({name:'first water switch reuses ready assets',pass:effects(clouds).water.initialization.generation.every(t=>t.thread==='worker'),submitMs:firstWaterSubmitMs,frameReadyMs:performance.now()-switchStart});}
      clouds.setMode('cellular');clouds.setMode('water');
      clouds.updateParameters({seed:14});const first=effects(clouds).water.ready;
      clouds.updateParameters({seed:15});const second=effects(clouds).water.ready;
      clouds.updateParameters({seed:13});await Promise.all([first,second]);await waitReady();await frame(2);
      checks.push({name:'loading switch and rapid seeds settle with a single adopted seed',pass:clouds.mode==='water'&&Object.values(effects(clouds)).every(e=>e.parameters.seed===13&&shaderSeed(e)===13),startedWhileLoading:loading,metrics:metrics()});
      checks.push({name:'weather/noise generation never occurs on the main thread',pass:Object.values(effects(clouds)).every(e=>e.initialization.generation.every(t=>t.thread==='worker')),metrics:metrics()});
      const a=effects(clouds).cellular as unknown as Record<string,unknown>,b=effects(clouds).water as unknown as Record<string,unknown>;
      checks.push({name:'models borrow the same adopted weather and noise allocations',pass:a.weather===b.weather&&a.noise===b.noise&&Boolean(a.weather)});
      clouds.setPaused(false);await frame(2);const wind=effects(clouds).water.motion;clouds.setMode('cellular');clouds.setPaused(true);
      checks.push({name:'A/B switch transfers motion without a discontinuity',pass:JSON.stringify(effects(clouds).cellular.motion)===JSON.stringify(wind)});
      clouds.setEnabled(false);await frame(2);clouds.setEnabled(true);await frame(2);
      checks.push({name:'disable/enable preserves resources and selected model',pass:clouds.enabled&&effects(clouds).cellular.enabled&&!effects(clouds).water.enabled&&a.weather===b.weather});
      const materialState=()=>{const u=(effects(clouds).cellular as unknown as {uniforms():{u_detail():number;u_thickness():number;u_windSpeed():number}}).uniforms();return [u.u_detail(),u.u_thickness(),u.u_windSpeed()];};
      const oldMaterial=materialState(),oldOptics=a.optics;clouds.updateParameters({detail:0,thickness:1,wind:0});
      const beforeMaterial=materialState(),superseded=effects(clouds).cellular.ready;clouds.updateParameters({detail:1,thickness:8,wind:120});
      await superseded;await waitReady();
      checks.push({name:'debounced detail/thickness/wind material adopts atomically after cancellation',pass:JSON.stringify(beforeMaterial)===JSON.stringify(oldMaterial)&&materialState()[0]===1&&materialState()[1]===8&&materialState()[2]===120&&a.optics!==oldOptics&&a.optics===b.optics,metrics:effects(clouds).cellular.materialInitialization});
      const unchangedOptics=a.optics,materialMetrics=effects(clouds).cellular.materialInitialization;
      clouds.updateParameters({density:2});await waitReady();checks.push({name:'density scale reuses the material distribution',pass:a.optics===unchangedOptics&&effects(clouds).cellular.materialInitialization===materialMetrics});
      clouds.updateParameters({detail:.55,thickness:3.8,density:1.1,wind:24});await waitReady();
      const resources=[a.weather,a.noise] as {isDestroyed():boolean}[];clouds.updateParameters({seed:16});const pending=effects(clouds).cellular.ready;
      clouds.destroy();await pending;checks.push({name:'destroy cancels pending request and releases shared resources once',pass:resources.every(t=>t.isDestroyed())&&mounted(clouds).length===0});
      output.textContent=JSON.stringify({passed:checks.every(c=>c.pass),checks,longTasks,shaderApi:trace?.timeline,state:state()},null,2);document.title=checks.every(c=>c.pass)?'PASS · Actual entry':'FAIL · Actual entry';
    }catch(e){output.textContent=String(e);document.title='ERROR · Actual entry';}finally{button.disabled=false;}
  };
  panel.querySelector<HTMLButtonElement>('#entry-lifecycle')!.onclick=()=>void run();
  if(query.has('during-load'))void run();
  else{
    await waitReady();const resourcesReadyMs=performance.now()-started;await frame(10);
    startup.textContent=JSON.stringify({bootReturnedMs,mountWallMs,firstFrameAfterMountMs,firstInteractiveTimerMs,resourcesReadyMs,fullFrameMs:performance.now()-started,initialMounted,metrics:metrics(),longTasks,shaderApi:trace?.timeline,state:state(),boundary:'Real src/main.ts. Asset/DOM readiness is wall time, not a GPU fence. First interactive timer is a task after postRender, not measured input latency. Shader cache is not cleared.'},null,2);
    if(query.has('auto'))void run();
  }
  window.addEventListener('pagehide',()=>{trace?.destroy();observer.disconnect();},{once:true});
}catch(e){HTMLCanvasElement.prototype.getContext=getContext;CloudComparison.prototype.mount=mount;document.title='ERROR · Actual entry';const pre=document.createElement('pre');pre.textContent=String(e);document.body.append(pre);}
