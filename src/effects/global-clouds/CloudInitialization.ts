/** Synchronous CPU-call wall times include scheduling/GC, never GPU time. */
export interface ResourceTiming {name:string;thread:'main'|'worker';durationMs:number;}
export interface CloudInitialization {
  startedAt:number;generation:ResourceTiming[];uploads:ResourceTiming[];
  workerDispatchAt?:number;workerStartWaitMs?:number;workerDeliveryWaitMs?:number;
  workerWallMs?:number;readyWallMs?:number;status:'loading'|'ready'|'fallback'|'failed'|'cancelled';
  cache?:string;
  cacheReadMs?:number;cacheWriteMs?:number;
}
export function measureResource<T>(target:ResourceTiming[],name:string,thread:ResourceTiming['thread'],operation:()=>T):T{
  const start=performance.now();try{return operation();}finally{target.push({name,thread,durationMs:performance.now()-start});}
}
