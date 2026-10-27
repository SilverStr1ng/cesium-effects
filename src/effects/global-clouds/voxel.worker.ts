import {assetTransferables,CLOUD_ASSET_VERSION,generateFixedCloudAssets,generateWeatherAsset,validFixedCloudAssets,validWeatherAsset,type CloudAssetPayload} from './CloudAssets';
import {openCloudAssetCache} from './CloudAssetCache';
import type {ResourceTiming} from './CloudInitialization';
self.onmessage=async(event:MessageEvent<{seed:number;weatherOnly?:boolean;cache?:boolean}>)=>{
  const startedAt=performance.timeOrigin+performance.now(),timings:ResourceTiming[]=[];
  const cache=event.data.cache===false?undefined:await openCloudAssetCache();
  try{
    const seed=event.data.seed,readStart=performance.now();
    const fixedRecord=event.data.weatherOnly?undefined:await cache?.read('fixed'),weatherRecord=await cache?.read('weather');
    const cacheReadMs=performance.now()-readStart,fixedHit=validFixedCloudAssets(fixedRecord),weatherHit=validWeatherAsset(weatherRecord,seed);
    const fixed=event.data.weatherOnly?undefined:fixedHit?fixedRecord:generateFixedCloudAssets(timings);
    const weather=weatherHit?weatherRecord.weather:generateWeatherAsset(seed,timings);
    const writeStart=performance.now();let written=true;
    if(cache){if(fixed&&!fixedHit)written=await cache.write('fixed',fixed)&&written;
      if(!weatherHit)written=await cache.write('weather',{version:CLOUD_ASSET_VERSION,seed,weather})&&written;}
    const cacheWriteMs=performance.now()-writeStart,data:CloudAssetPayload={seed,weather,fixed};
    // Persist before transferring: postMessage detaches the owning buffers.
    self.postMessage({data,timings,startedAt,finishedAt:performance.timeOrigin+performance.now(),cacheReadMs,cacheWriteMs,
      cache:cache?`${fixedHit?'fixed-hit':'fixed-miss'}/${weatherHit?'weather-hit':'weather-miss'}/${written?'stored':'write-failed'}`:'unavailable-or-disabled'},
      {transfer:assetTransferables(data)});
  }catch(error){self.postMessage({error:String(error)});}finally{cache?.close();}
};
