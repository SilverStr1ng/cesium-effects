import type { Viewer } from 'cesium';

const summary = (samples: number[]) => {
  if (!samples.length) return null;
  const sorted = [...samples].sort((a,b)=>a-b);
  return { count:samples.length, meanMs: samples.reduce((a,b)=>a+b,0)/samples.length,
    medianMs: sorted[Math.floor(sorted.length*.5)], p95Ms: sorted[Math.floor(sorted.length*.95)] };
};

/** Opt-in, user-visible benchmark. Never equates CPU submission time with GPU time. */
export function attachFrameProfiler(viewer: Viewer, getState: () => object) {
  if (!new URLSearchParams(location.search).has('benchmark')) return () => {};
  const panel = document.createElement('section');
  panel.className='benchmark-panel';
  panel.innerHTML='<button id="benchmark-start">开始 10 秒性能采样</button><pre id="benchmark-result">保持页面前台，相同视口、机位和画质下比较。</pre>';
  document.querySelector('main')!.append(panel);
  const output=panel.querySelector('pre')!;
  const button=panel.querySelector('button')!;
  const gl=(viewer.scene as unknown as {context:{_gl:WebGL2RenderingContext}}).context._gl;
  const ext=gl.getExtension('EXT_disjoint_timer_query_webgl2');
  let started=0,startFrame=0,lastFrame=0,active=false;
  let frames:number[]=[],cpu:number[]=[],gpu:number[]=[];
  let pending:WebGLQuery|undefined,recording=false;
  let initialState:object={};
  button.onclick=()=>{
    frames=[];cpu=[];gpu=[];initialState=getState();
    started=performance.now();lastFrame=0;active=true;
    button.disabled=true;output.textContent='采样中：2 秒预热 + 10 秒测量…';
  };
  const removePre=viewer.scene.preRender.addEventListener(()=>{
    const now=performance.now();
    if (pending && ext && gl.getQueryParameter(pending,gl.QUERY_RESULT_AVAILABLE)) {
      if (active && now-started>2000 && !gl.getParameter(ext.GPU_DISJOINT_EXT)) gpu.push(gl.getQueryParameter(pending,gl.QUERY_RESULT)/1e6);
      gl.deleteQuery(pending);pending=undefined;
    }
    if (!active) return;
    if (document.hidden) { active=false;button.disabled=false;output.textContent='采样取消：页面切到后台。';return; }
    if (now-started>=12000) {
      active=false;button.disabled=false;
      output.textContent=JSON.stringify({state:initialState,endState:getState(),viewport:[innerWidth,innerHeight],
        drawingBuffer:[gl.drawingBufferWidth,gl.drawingBufferHeight],durationSeconds:10,
        frame:summary(frames),cpuSubmission:summary(cpu),gpu:summary(gpu),
        gpuTimerSupported:Boolean(ext)},null,2);
      return;
    }
    if (lastFrame && now-started>2000) frames.push(now-lastFrame);
    lastFrame=now;startFrame=performance.now();
    if (ext && !pending) {
      pending=gl.createQuery()??undefined;
      if(pending){gl.beginQuery(ext.TIME_ELAPSED_EXT,pending);recording=true;}
    }
  });
  const removePost=viewer.scene.postRender.addEventListener(()=>{
    if(recording && ext){gl.endQuery(ext.TIME_ELAPSED_EXT);recording=false;}
    if(active && performance.now()-started>2000)cpu.push(performance.now()-startFrame);
  });
  return ()=>{removePre();removePost();if(pending)gl.deleteQuery(pending);panel.remove();};
}
