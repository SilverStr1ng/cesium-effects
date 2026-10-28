import {createCloudOpticsData,opticsMaterialKey,CLOUD_OPTICS_SIZE,type CloudOpticsMaterial} from './CloudOptics';
import {openCloudAssetCache} from './CloudAssetCache';
import {CLOUD_ASSET_VERSION} from './CloudAssets';
type RecordEntry={key:string;bytes:Uint8Array;components:Uint8Array};
self.onmessage=async(event:MessageEvent<{material:CloudOpticsMaterial;noise:Uint8Array;voxel:Uint8Array;cache:boolean}>)=>{
  const start=performance.timeOrigin+performance.now(),data=event.data;
  const cache=data.cache?await openCloudAssetCache():undefined;
  try{
    const key=`${CLOUD_ASSET_VERSION}/${opticsMaterialKey(data.material)}`,record=await cache?.read('optics');
    const entries=Array.isArray(record)?(record as RecordEntry[]).filter(e=>typeof e.key==='string'&&e.bytes instanceof Uint8Array&&e.bytes.length===CLOUD_OPTICS_SIZE**3*4&&e.components instanceof Uint8Array&&e.components.length===32768).slice(-4):[];
    const hit=entries.find(e=>e.key===key),begin=performance.now();
    const generated=hit?{optics:hit.bytes,components:hit.components}:createCloudOpticsData(data.voxel,data.noise,data.material),bytes=generated.optics,components=generated.components,generationMs=performance.now()-begin;
    await cache?.write('optics',[...entries.filter(e=>e.key!==key),{key,bytes,components}].slice(-4));
    self.postMessage({bytes,components,key,hit:Boolean(hit),generationMs,start,finish:performance.timeOrigin+performance.now()},{transfer:[bytes.buffer,components.buffer]});
  }catch(error){self.postMessage({error:String(error)});}finally{cache?.close();}
};
