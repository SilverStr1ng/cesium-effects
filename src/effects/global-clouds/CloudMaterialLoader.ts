import type {Scene} from 'cesium';
import {createRepeatingVolume} from '../../scene/DynamicTexture';
import type {CloudOpticsMaterial} from './CloudOptics';
export interface MaterialSource {noise:Uint8Array;voxel:Uint8Array;}
/** Retain source bytes for cancellation/retry, transferring private copies once
 * per debounced material request. Density/coverage/quality never enter here. */
export function loadCloudMaterial(scene:Scene,source:MaterialSource,material:CloudOpticsMaterial,cache:boolean){
  let worker:Worker|undefined,timer:ReturnType<typeof setTimeout>|undefined,cancelled=false,rejectRequest:(e:unknown)=>void=()=>{};
  const promise=new Promise<{texture:ReturnType<typeof createRepeatingVolume>;components:ReturnType<typeof createRepeatingVolume>;metrics:Record<string,unknown>}>((resolve,reject)=>{
    rejectRequest=reject;const requested=performance.now();
    timer=setTimeout(()=>{
      timer=undefined;
      try{
        worker=new Worker(new URL('./optics.worker.ts',import.meta.url),{type:'module'});
        worker.onerror=e=>{worker?.terminate();reject(new Error(e.message));};
        worker.onmessageerror=()=>{worker?.terminate();reject(new Error('Invalid optics worker message'));};
        worker.onmessage=e=>{
          worker?.terminate();worker=undefined;if(cancelled)return;
          if(e.data.error){reject(new Error(e.data.error));return;}
          const upload=performance.now();let texture:ReturnType<typeof createRepeatingVolume>|undefined;
          try{texture=createRepeatingVolume(scene,32,e.data.bytes);const components=createRepeatingVolume(scene,32,e.data.components,undefined,[32,32,8]);
            resolve({texture,components,metrics:{...e.data,bytes:undefined,components:undefined,thread:'worker',copySubmitMs,uploadSubmitMs:performance.now()-upload,readyWallMs:performance.now()-requested}});
          }catch(error){texture?.destroy();reject(error);}
        };
        const copyStart=performance.now(),noise=source.noise.slice(),voxel=source.voxel.slice();
        worker.postMessage({material,noise,voxel,cache},{transfer:[noise.buffer,voxel.buffer]});
        const copySubmitMs=performance.now()-copyStart;
      }catch(error){worker?.terminate();reject(error);}
    },120);
  });
  return {promise,cancel(){cancelled=true;if(timer!==undefined)clearTimeout(timer);worker?.terminate();worker=undefined;rejectRequest(new DOMException('Material superseded','AbortError'));}};
}
