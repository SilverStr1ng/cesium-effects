import 'cesium/Build/Cesium/Widgets/widgets.css';
import {createScene} from '../src/scene/createScene';
import {GlobalCloudEffect} from '../src/effects/global-clouds/GlobalCloudEffect';
import type {GpuTexture} from '../src/scene/DynamicTexture';

const output=document.querySelector('#result')!,checks:{name:string;pass:boolean;[key:string]:unknown}[]=[];
try{
  const {viewer}=await createScene(document.querySelector('#scene')!,()=>{}),context={viewer,onStatus:()=>{}},originalStages=viewer.scene.postProcessStages.length;
  const assets=(cloud:GlobalCloudEffect)=>{const c=cloud as unknown as Record<string,GpuTexture>&{assets:{textures:{components?:GpuTexture}}};return ['weather','noise','voxels','optics','cirrus','iceRibbon','iceAnisotropic'].map(k=>c[k]).concat(c.assets?.textures.components as GpuTexture).filter(Boolean);};
  const cancelled=new GlobalCloudEffect();cancelled.mount(context);const waiting=cancelled.ready;cancelled.destroy();await waiting;
  checks.push({name:'cancel immediately settles readiness and removes worker/stage resources',pass:cancelled.initialization.status==='cancelled'&&!cancelled.voxelReady&&viewer.scene.postProcessStages.length===originalStages});
  const cold=new GlobalCloudEffect();cold.assetCacheEnabled=false;cold.mount(context);cold.setPaused(true);cold.setQuality('high');cold.setHdrEnabled(false);await cold.ready;
  const coldAssets=assets(cold),coldInfo=structuredClone(cold.initialization);
  checks.push({name:'uncached generation occurs entirely in worker and deferred build preserves latest quality/format',pass:cold.initialization.generation.length===5&&cold.initialization.generation.every(t=>t.thread==='worker')&&cold.voxelReady&&cold.quality==='high'&&cold.renderTargetMode==='RGBA8',initialization:coldInfo});
  cold.destroy();checks.push({name:'successful upload resources are effect-owned and all released',pass:coldAssets.length===8&&coldAssets.every(t=>t.isDestroyed())});
  const cached=new GlobalCloudEffect();cached.mount(context);cached.setPaused(true);await cached.ready;cached.destroy();
  const warm=new GlobalCloudEffect();warm.mount(context);warm.setPaused(true);await warm.ready;
  checks.push({name:'warm cache skips material and weather generation',pass:warm.initialization.cache?.startsWith('fixed-hit/weather-hit')===true&&warm.initialization.generation.length===0,initialization:structuredClone(warm.initialization)});
  const stable=assets(warm).slice(1),oldWeather=assets(warm)[0];
  warm.updateParameters({seed:14});const first=warm.ready;warm.updateParameters({seed:15});const second=warm.ready;warm.updateParameters({seed:13});await Promise.all([first,second,warm.ready]);
  checks.push({name:'superseded seed requests settle, final weather wins, material is not uploaded again',pass:warm.parameters.seed===13&&warm.initialization.status==='ready'&&warm.initialization.uploads.length===1&&oldWeather.isDestroyed()&&assets(warm).slice(1).every((t,i)=>t===stable[i])});
  const displayedSeed=()=> (warm as unknown as {uniforms():{u_seed():number}}).uniforms().u_seed();
  warm.updateParameters({seed:14});const seedBeforeReady=displayedSeed();await warm.ready;
  checks.push({name:'pending seed remains paired with old weather, then adopts atomically',pass:seedBeforeReady===13&&displayedSeed()===14&&assets(warm).slice(1).every((t,i)=>t===stable[i])});
  warm.updateParameters({seed:13});await warm.ready;
  warm.destroy();
  const NativeWorker=window.Worker;
  try{
    window.Worker=class {constructor(){throw new Error('intentional worker-unavailable regression');}} as unknown as typeof Worker;
    const fallback=new GlobalCloudEffect();fallback.mount(context);await fallback.ready;
    const fallbackAssets=assets(fallback);checks.push({name:'worker creation failure retains procedural low/high clouds and settles readiness',pass:fallback.initialization.status==='fallback'&&!fallback.voxelReady&&fallbackAssets.length===5});
    fallback.destroy();checks.push({name:'failure path textures are released',pass:fallbackAssets.every(t=>t.isDestroyed())});
  }finally{window.Worker=NativeWorker;}
  // Fail before the next allocation, after earlier uploads have succeeded.
  // Stop viewer draws so this fault injection targets only the asset queue.
  viewer.useDefaultRenderLoop=false;
  const gl=(viewer.scene as unknown as {context:{_gl:WebGL2RenderingContext}}).context._gl;
  const create=gl.createTexture.bind(gl),allocated:WebGLTexture[]=[];let calls=0;
  gl.createTexture=()=>{if(++calls===3)throw new Error('intentional allocation failure');const t=create();if(t)allocated.push(t);return t;};
  try{
    const failed=new GlobalCloudEffect();failed.mount(context);await failed.ready;
    checks.push({name:'partial upload failure settles as failed and releases earlier GPU allocations',pass:failed.initialization.status==='failed'&&allocated.length===2&&allocated.every(t=>!gl.isTexture(t))});
    failed.destroy();
  }finally{gl.createTexture=create;}
  checks.push({name:'all requests leave original stage count after disposal',pass:viewer.scene.postProcessStages.length===originalStages});
  viewer.destroy();output.textContent=JSON.stringify({passed:checks.every(c=>c.pass),checks},null,2);document.title=checks.every(c=>c.pass)?'PASS · Cloud startup':'FAIL · Cloud startup';
}catch(e){output.textContent=String(e);document.title='ERROR · Cloud startup';}
