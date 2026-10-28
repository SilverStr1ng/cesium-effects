/** Bounded optional disk cache: fixed assets, latest-seed weather, and a separate
 * record containing at most four parameterized optical distributions.
 * Each worker closes its DB connection. Cache failure only means a miss. */
export async function openCloudAssetCache(){
  if(typeof indexedDB==='undefined')return undefined;
  try{
    const db=await new Promise<IDBDatabase>((resolve,reject)=>{const request=indexedDB.open('cesium-effects-cloud-assets',1);
      request.onupgradeneeded=()=>request.result.createObjectStore('assets');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
      request.onblocked=()=>reject(new Error('Cloud asset cache blocked'));});
    return {
      async read(key:'fixed'|'weather'|'optics'):Promise<unknown>{try{return await new Promise((resolve,reject)=>{const request=db.transaction('assets').objectStore('assets').get(key);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});}catch{return undefined;}},
      async write(key:'fixed'|'weather'|'optics',value:unknown){try{await new Promise<void>((resolve,reject)=>{const tx=db.transaction('assets','readwrite');tx.objectStore('assets').put(value,key);tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);});return true;}catch{return false;}},
      close(){db.close();}
    };
  }catch{return undefined;}
}
