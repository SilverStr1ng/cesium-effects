export const summarize=(values:number[])=>{const a=[...values].sort((x,y)=>x-y);return a.length?{count:a.length,meanMs:a.reduce((x,y)=>x+y,0)/a.length,medianMs:a[Math.floor(a.length*.5)],p95Ms:a[Math.min(a.length-1,Math.floor(a.length*.95))]}:null;};
type Mode='frame'|'passes';
type Pending={query:WebGLQuery;label:string;run:number};
type Run={id:number;mode:Mode;target:number;started:number;values:Record<string,number[]>;frameIntervals:number[];submit:number[];hiddenFrames:number;unfocusedFrames:number;disjoint:number;lastFrame:number;resolve:(v:unknown)=>void;timeout:ReturnType<typeof setTimeout>};

/** Fixture-only instrumentation. CPU API wall times and GPU timer queries are
 * separate. Frame and pass rounds are exclusive; no nested TIME_ELAPSED. */
export function webglTrace(gl:WebGL2RenderingContext){
  const ext=gl.getExtension('EXT_disjoint_timer_query_webgl2');
  const timeline:{label:string;kind:string;at:number;durationMs:number;program?:number;sourceHash?:string}[]=[],firstGpu:Record<string,number[]>={};
  const sources=new WeakMap<WebGLShader,string>(),programIds=new WeakMap<WebGLProgram,number>();let programSerial=0;
  const hash=(source:string)=>{let h=2166136261;for(let i=0;i<source.length;i++)h=Math.imul(h^source.charCodeAt(i),16777619);return (h>>>0).toString(16).padStart(8,'0');};
  const attachments:{kind:string;at:number;width?:number;height?:number}[]=[];
  const shaderLabels=new WeakMap<WebGLShader,string>(),programLabels=new WeakMap<WebGLProgram,string>(),drawn=new WeakSet<WebGLProgram>();
  const pending:Pending[]=[],restore:(()=>void)[]=[];
  let current:WebGLProgram|null=null,active:Run|undefined,serial=0,frameQuery:WebGLQuery|null=null,frameStart=0;
  const classify=(source:string)=>source.includes('integrateCloudMedium')?'cloud-volume':source.includes('u_skyRadianceHdr')?'cloud-resolve':source.includes('u_moonAlbedo')?'atmosphere-composite':source.includes('sampleSkyIrradiance')?'sky-irradiance':source.includes('skyViewDirection')?'sky-view':'other';
  const originalShader=gl.shaderSource.bind(gl);gl.shaderSource=(s,source)=>{shaderLabels.set(s,classify(source));sources.set(s,source);originalShader(s,source);};restore.push(()=>{gl.shaderSource=originalShader;});
  const originalLink=gl.linkProgram.bind(gl);gl.linkProgram=p=>{const shaders=gl.getAttachedShaders(p)??[],labels=shaders.map(s=>shaderLabels.get(s)??'other');const label=labels.find(s=>s!=='other')??'other';programLabels.set(p,label);const program=programIds.get(p)??++programSerial;programIds.set(p,program);const start=performance.now();originalLink(p);timeline.push({label,program,sourceHash:hash(shaders.map(s=>sources.get(s)??'').join('\n')),kind:'linkProgram CPU call',at:start,durationMs:performance.now()-start});};restore.push(()=>{gl.linkProgram=originalLink;});
  const originalStatus=gl.getProgramParameter.bind(gl);gl.getProgramParameter=(p,key)=>{const start=performance.now(),value=originalStatus(p,key);if(key===gl.LINK_STATUS)timeline.push({label:programLabels.get(p)??'other',program:programIds.get(p),kind:'LINK_STATUS CPU wait',at:start,durationMs:performance.now()-start});return value;};restore.push(()=>{gl.getProgramParameter=originalStatus;});
  const originalImage=gl.texImage2D.bind(gl);gl.texImage2D=((...args:Parameters<typeof originalImage>)=>{attachments.push({kind:'texImage2D submit',at:performance.now(),width:typeof args[3]==='number'?args[3]:undefined,height:typeof args[4]==='number'?args[4]:undefined});originalImage(...args);}) as typeof gl.texImage2D;restore.push(()=>{gl.texImage2D=originalImage;});
  const originalUse=gl.useProgram.bind(gl);gl.useProgram=p=>{current=p;originalUse(p);};restore.push(()=>{gl.useProgram=originalUse;});
  function draw(operation:()=>void){
    const label=current?programLabels.get(current)??'other':'other',first=Boolean(current&&!drawn.has(current));
    if(current)drawn.add(current);
    const selected=active?.mode==='passes'&&['cloud-volume','cloud-resolve','atmosphere-composite'].includes(label);
    const startup=first&&!active&&label!=='other';
    // First-draw startup queries run only outside benchmark rounds.
    const query=ext&&(selected||startup)&&!frameQuery?gl.createQuery():null;
    if(query)gl.beginQuery(ext!.TIME_ELAPSED_EXT,query);
    const start=performance.now();operation();
    if(first)timeline.push({label,kind:'first draw CPU call',at:start,durationMs:performance.now()-start});
    if(query){gl.endQuery(ext!.TIME_ELAPSED_EXT);pending.push({query,label,run:active?.id??0});}
  }
  const originalArrays=gl.drawArrays.bind(gl);gl.drawArrays=(...args)=>draw(()=>originalArrays(...args));restore.push(()=>{gl.drawArrays=originalArrays;});
  const originalElements=gl.drawElements.bind(gl);gl.drawElements=(...args)=>draw(()=>originalElements(...args));restore.push(()=>{gl.drawElements=originalElements;});
  function poll(){
    if(!ext)return;
    const disjoint=Boolean(gl.getParameter(ext.GPU_DISJOINT_EXT));
    if(disjoint&&active)active.disjoint++;
    for(let i=pending.length-1;i>=0;i--){const p=pending[i];if(!disjoint&&!gl.getQueryParameter(p.query,gl.QUERY_RESULT_AVAILABLE))continue;
      if(!disjoint){const ms=gl.getQueryParameter(p.query,gl.QUERY_RESULT)/1e6;if(p.run===0)(firstGpu[p.label]??=[]).push(ms);else if(active?.id===p.run)(active.values[p.label]??=[]).push(ms);}
      gl.deleteQuery(p.query);pending.splice(i,1);
    }
  }
  function finish(reason:string){
    if(!active)return;const run=active;active=undefined;clearTimeout(run.timeout);
    run.resolve({mode:run.mode,requested:run.target,reason,wallMs:performance.now()-run.started,gpu:Object.fromEntries(Object.entries(run.values).map(([k,v])=>[k,summarize(v)])),rawGpu:run.values,
      frameIntervals:summarize(run.frameIntervals),cpuSubmission:summarize(run.submit),hiddenFrames:run.hiddenFrames,unfocusedFrames:run.unfocusedFrames,disjoint:run.disjoint,
      intervalsOver100ms:run.frameIntervals.filter(v=>v>100).length,supported:Boolean(ext)});
  }
  function beforeFrame(){
    poll();
    if(active){const labels=active.mode==='frame'?['frame']:['cloud-volume','cloud-resolve','atmosphere-composite'];if(labels.every(l=>(active!.values[l]?.length??0)>=active!.target))finish('sample target reached');}
    frameStart=performance.now();if(!active)return;
    if(active.lastFrame)active.frameIntervals.push(frameStart-active.lastFrame);active.lastFrame=frameStart;
    if(document.hidden)active.hiddenFrames++;if(!document.hasFocus())active.unfocusedFrames++;
    if(ext&&active.mode==='frame'&&pending.length<64){frameQuery=gl.createQuery();if(frameQuery)gl.beginQuery(ext.TIME_ELAPSED_EXT,frameQuery);}
  }
  function afterFrame(){
    if(frameQuery&&ext){gl.endQuery(ext.TIME_ELAPSED_EXT);pending.push({query:frameQuery,label:'frame',run:active?.id??-1});frameQuery=null;}
    if(active)active.submit.push(performance.now()-frameStart);
  }
  return {timeline,firstGpu,attachments,beforeFrame,afterFrame,
    collect(mode:Mode,target=200,timeoutMs=90000){if(active)throw new Error('Overlapping timer rounds are forbidden');return new Promise<unknown>(resolve=>{const id=++serial;active={id,mode,target,started:performance.now(),values:{},frameIntervals:[],submit:[],hiddenFrames:0,unfocusedFrames:0,disjoint:0,lastFrame:0,resolve,timeout:setTimeout(()=>finish('time limit; evidence may be insufficient'),timeoutMs)};});},
    destroy(){finish('disposed');if(frameQuery&&ext){gl.endQuery(ext.TIME_ELAPSED_EXT);gl.deleteQuery(frameQuery);frameQuery=null;}pending.forEach(p=>gl.deleteQuery(p.query));pending.length=0;restore.reverse().forEach(fn=>fn());}
  };
}
