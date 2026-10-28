import type {Scene} from 'cesium';
import {createRepeatingTexture,createRepeatingVolume,createWeatherTexture,type GpuTexture} from '../../scene/DynamicTexture';
import {createCumulusNoise} from './CumulusNoise';
import {createCirrusField} from './CirrusField';
import {createWeather,WEATHER_WIDTH,WEATHER_HEIGHT} from './WeatherField';
import {measureResource,type CloudInitialization,type ResourceTiming} from './CloudInitialization';
import type {CloudAssetPayload,VolumeAsset} from './CloudAssets';

export interface CloudTextures {weather:GpuTexture;noise?:GpuTexture;cirrus?:GpuTexture;iceRibbon?:GpuTexture;iceAnisotropic?:GpuTexture;voxels?:GpuTexture;optics?:GpuTexture;components?:GpuTexture;}
interface UploadData {weather:Uint8Array;noise?:VolumeAsset;ice?:ReturnType<typeof createCirrusField>;voxel?:VolumeAsset;optics?:Uint8Array;components?:Uint8Array;}
interface WorkerResult {data:CloudAssetPayload;timings:ResourceTiming[];startedAt:number;finishedAt:number;cache:string;cacheReadMs:number;cacheWriteMs:number;error?:string;}
const cancelled=()=>new DOMException('Cloud asset request cancelled','AbortError');
const assertLive=(signal:AbortSignal)=>{if(signal.aborted)throw cancelled();};
function nextFrame(signal:AbortSignal){return new Promise<void>((resolve,reject)=>{
  assertLive(signal);const abort=()=>{cancelAnimationFrame(id);reject(cancelled());};
  const id=requestAnimationFrame(()=>{signal.removeEventListener('abort',abort);resolve();});signal.addEventListener('abort',abort,{once:true});
});}
export function destroyCloudTextures(textures:Partial<CloudTextures>){for(const texture of Object.values(textures))if(texture&&!texture.isDestroyed())texture.destroy();}

/** Effect-owned request. Cancels workers, pending frame uploads and partial GPU
 * allocations; the caller owns a successful result. One texture upload is the
 * smallest indivisible operation, not a promise of a hard 4 ms driver bound. */
export function loadCloudAssets(scene:Scene,seed:number,options:{weatherOnly:boolean;cache:boolean;metrics:CloudInitialization}){
  const controller=new AbortController(),signal=controller.signal,{metrics}=options;
  let worker:Worker|undefined;
  const request=()=>new Promise<WorkerResult>((resolve,reject)=>{
    assertLive(signal);worker=new Worker(new URL('./voxel.worker.ts',import.meta.url),{type:'module'});
    const abort=()=>{worker?.terminate();reject(cancelled());};signal.addEventListener('abort',abort,{once:true});
    const settle=()=>{signal.removeEventListener('abort',abort);worker?.terminate();worker=undefined;};
    worker.onmessage=(event:MessageEvent<WorkerResult>)=>{const result=event.data;settle();result.error?reject(new Error(result.error)):resolve(result);};
    worker.onerror=event=>{settle();reject(new Error(event.message||'Cloud asset worker failed'));};
    worker.onmessageerror=()=>{settle();reject(new Error('Cloud asset worker message could not be decoded'));};
    metrics.workerDispatchAt=performance.timeOrigin+performance.now();
    try{worker.postMessage({seed,weatherOnly:options.weatherOnly,cache:options.cache});}catch(error){settle();reject(error);}
  });
  const fallback=async():Promise<UploadData>=>{
    // Worker-unavailable compatibility retains the procedural model. These
    // synchronous generators cannot be preempted; yield BETWEEN operations.
    await nextFrame(signal);assertLive(signal);
    const weather=measureResource(metrics.generation,'weather','main',()=>createWeather(seed));
    if(options.weatherOnly)return {weather};
    await nextFrame(signal);assertLive(signal);const noise=measureResource(metrics.generation,'noise','main',createCumulusNoise);
    await nextFrame(signal);assertLive(signal);const ice=measureResource(metrics.generation,'cirrus','main',createCirrusField);
    return {weather,noise,ice};
  };
  const promise=(async()=>{
    let data:UploadData,fellBack=false;
    try{
      const result=await request();assertLive(signal);metrics.generation.push(...result.timings);
      metrics.workerStartWaitMs=result.startedAt-metrics.workerDispatchAt!;metrics.workerWallMs=result.finishedAt-result.startedAt;
      metrics.workerDeliveryWaitMs=performance.timeOrigin+performance.now()-result.finishedAt;
      metrics.cache=result.cache;metrics.cacheReadMs=result.cacheReadMs;metrics.cacheWriteMs=result.cacheWriteMs;
      const f=result.data.fixed;metrics.fixedAssetVersion=f?.version;metrics.opticsVersion=f?.opticsVersion;
      data={weather:result.data.weather,noise:f?.noise,ice:f?.ice,voxel:f?.voxel,optics:f?.optics,components:f?.components};
    }catch(error){assertLive(signal);fellBack=true;metrics.cache=`worker failure: ${String(error)}`;data=await fallback();}
    const textures:Partial<CloudTextures>={};
    const queue:[keyof CloudTextures,()=>GpuTexture][]=[['weather',()=>createWeatherTexture(scene,WEATHER_WIDTH,WEATHER_HEIGHT,data.weather)]];
    if(data.noise)queue.push(['noise',()=>createRepeatingVolume(scene,64,data.noise!.bytes,data.noise!.mips)]);
    if(data.ice){const ice=data.ice;queue.push(['cirrus',()=>createRepeatingVolume(scene,64,ice.bytes,ice.mips)],['iceRibbon',()=>createRepeatingTexture(scene,64,ice.ribbon,ice.ribbonMips)],['iceAnisotropic',()=>createRepeatingVolume(scene,64,ice.anisotropic,undefined,[127,64,64])]);}
    if(data.voxel)queue.push(['voxels',()=>createRepeatingVolume(scene,128,data.voxel!.bytes,data.voxel!.mips)]);
    if(data.optics)queue.push(['optics',()=>createRepeatingVolume(scene,32,data.optics!)]);
    if(data.components)queue.push(['components',()=>createRepeatingVolume(scene,32,data.components!,undefined,[32,32,8])]);
    try{
      await nextFrame(signal);let budgetStart=performance.now();
      for(let i=0;i<queue.length;i++){
        assertLive(signal);const [name,upload]=queue[i];textures[name]=measureResource(metrics.uploads,name,'main',upload);
        if(i<queue.length-1&&performance.now()-budgetStart>=4){await nextFrame(signal);budgetStart=performance.now();}
      }
      assertLive(signal);return {textures:textures as CloudTextures,fellBack,
        materialSource:data.voxel&&data.noise?{voxel:data.voxel.bytes,noise:data.noise.bytes}:undefined};
    }catch(error){destroyCloudTextures(textures);throw error;}
  })();
  return {promise,cancel(){controller.abort();worker?.terminate();worker=undefined;}};
}
