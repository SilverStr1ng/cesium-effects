import {Cartesian3,JulianDate,PerspectiveFrustum,Math as M,PostProcessStageComposite} from 'cesium';
import {GlobalCloudEffect,type CloudModel} from '../src/effects/global-clouds/GlobalCloudEffect';
import {cloudDefaults} from '../src/effects/global-clouds/config';
import {webglTrace} from './webglTrace';
import {prepareCelestialFrame} from './celestialFixture';

// Actual main entry, including CloudComparison and its shared resource owner.
// All controls live in this fixture; no browser evaluation mutates app internals.
const query=new URLSearchParams(location.search),started=performance.now();
const tasks:{start:number;duration:number}[]=[];
const observer=new PerformanceObserver(list=>list.getEntries().forEach(e=>tasks.push({start:e.startTime,duration:e.duration})));
observer.observe({type:'longtask',buffered:true});
let trace:ReturnType<typeof webglTrace>|undefined;
const getContext=HTMLCanvasElement.prototype.getContext;
HTMLCanvasElement.prototype.getContext=function(this:HTMLCanvasElement,...args:Parameters<typeof getContext>){const result=getContext.apply(this,args);if(args[0]==='webgl2'&&result&&!trace)trace=webglTrace(result as WebGL2RenderingContext);return result;} as typeof getContext;
let force=0,mask=0;
const mount=GlobalCloudEffect.prototype.mount;
if(query.has('diagnostics'))GlobalCloudEffect.prototype.mount=function(context){
  const internal=this as unknown as {model:CloudModel;uniforms:()=>Record<string,unknown>};
  if(this.id==='global-clouds'){
    const uniforms=internal.uniforms.bind(this);internal.uniforms=()=>({...uniforms(),u_morphForce:()=>force,u_morphMask:()=>mask});
    internal.model={...internal.model,density:'uniform float u_morphForce,u_morphMask;\n'+internal.model.density
      .replace('if(!u_opticsReady)return 0.;','if(!u_opticsReady)return 0.;if(u_morphForce>0.)return u_morphForce<1.5?0.:1.;')
      .replace('if(cluster<=.001)return 0.;','if(u_morphMask==1.)return cover*9.;if(u_morphMask==2.)return cluster*9.;if(cluster<=.001)return 0.;')
      .replace('if(!coarse&&footprint<.8){','if(!coarse&&footprint<.8&&u_morphMask!=3.){')};
  }
  mount.call(this,context);
};
try{
 const app=await import('../src/main').then(m=>m.application);if(!app)throw new Error('main entry failed');
 GlobalCloudEffect.prototype.mount=mount;HTMLCanvasElement.prototype.getContext=getContext;
 const {viewer,clouds,atmosphere}=app;
 const effect=(clouds as unknown as {effects:{cellular:GlobalCloudEffect}}).effects.cellular;
 const style=document.createElement('style');style.textContent=`body{overflow:auto!important;background:#101923;color:#eee}#app{width:1920px;height:1080px;transform:scale(.5);transform-origin:top left;margin-bottom:-540px}#app .topbar,#app .sidebar,#app .viewport>*:not(#cesium-container){display:none!important}#app .viewport{position:relative!important;inset:auto!important;width:1920px!important;height:1080px!important}#cesium-container{position:absolute;inset:0;width:1920px;height:1080px}#controls{position:relative;z-index:100;padding:8px}button{margin:5px;padding:8px}pre{white-space:pre-wrap;font:11px monospace}#evidence img{width:320px}figure{display:inline-block;margin:4px}`;document.head.append(style);
 const panel=document.createElement('section');panel.id='controls';panel.innerHTML='<b id="status">Preparing fixed main entry</b><br><button id="captures">Fixed views</button><button id="tour">Frozen path</button><button id="diagnostics">Single factor diagnostics</button><button id="matrix">GPU matrix</button><button id="seeds">Seeds and types</button><button id="switches">Quality / HDR</button><button id="wind">Fixed-step wind</button><pre id="result"></pre><div id="evidence"></div>';document.body.append(panel);
 const output=panel.querySelector('#result')!,status=panel.querySelector('#status')!,buttons=Array.from(panel.querySelectorAll('button'));buttons.forEach(b=>b.disabled=true);
 viewer.useBrowserRecommendedResolution=true;viewer.resolutionScale=1;viewer.clock.shouldAnimate=false;viewer.camera.cancelFlight();viewer.scene.screenSpaceCameraController.enableInputs=false;
 clouds.setPaused(true);effect.setMotion({angle:0,highAngle:0,evolution:0});
 viewer.clock.currentTime=JulianDate.fromIso8601('2026-06-21T17:00:00Z');await prepareCelestialFrame(viewer.clock.currentTime);
 const f=viewer.camera.frustum as PerspectiveFrustum;f.aspectRatio=1920/1080;f.fov=2*Math.atan(Math.tan(Math.PI/6)*f.aspectRatio);
 const camera=(height:number,pitch:number,heading=245,lon=-97.52,lat=35.46)=>viewer.camera.setView({destination:Cartesian3.fromDegrees(lon,lat,height),orientation:{heading:M.toRadians(heading),pitch:M.toRadians(pitch),roll:0}});
 camera(17e6,-90);viewer.resize();
 const gl=(viewer.scene as unknown as {context:{_gl:WebGL2RenderingContext}}).context._gl;
 const pre=viewer.scene.preRender.addEventListener(()=>trace!.beforeFrame()),post=viewer.scene.postRender.addEventListener(()=>trace!.afterFrame());
 let error='';viewer.scene.renderError.addEventListener((_s:unknown,e:unknown)=>{error=String(e);status.textContent=error;output.textContent=JSON.stringify({complete:false,error,contextLost:gl.isContextLost(),buffer:[gl.drawingBufferWidth,gl.drawingBufferHeight],canvas:[viewer.canvas.width,viewer.canvas.height],viewport:gl.getParameter(gl.VIEWPORT)});});
 const frame=(count=3)=>new Promise<void>((resolve,reject)=>{if(error){reject(new Error(error));return;}let n=0;const removeError=viewer.scene.renderError.addEventListener((_s:unknown,e:unknown)=>{remove();removeError();reject(e);});const remove=viewer.scene.postRender.addEventListener(()=>{if(++n>=count){remove();removeError();resolve();}});});
 const state=()=>({utc:JulianDate.toIso8601(viewer.clock.currentTime),buffer:[gl.drawingBufferWidth,gl.drawingBufferHeight],camera:{position:Cartesian3.pack(viewer.camera.positionWC,[]),direction:Cartesian3.pack(viewer.camera.directionWC,[]),up:Cartesian3.pack(viewer.camera.upWC,[]),fovy:f.fovy},parameters:{...clouds.parameters},quality:effect.quality,storage:effect.renderTargetMode,motion:effect.motion,atmosphere:{...atmosphere.parameters},force,mask,visible:!document.hidden,focused:document.hasFocus()});
 const image=(name:string,url:string)=>{const fig=document.createElement('figure'),img=new Image();img.dataset.name=name;img.alt=name;img.src=url;const cap=document.createElement('figcaption');cap.textContent=name;fig.append(img,cap);panel.querySelector('#evidence')!.append(fig);};
 const raw=(name:string,save=true)=>{
   const stage=(effect as unknown as {stage:PostProcessStageComposite}).stage.get(0) as unknown as {outputTexture:{width:number;height:number;_texture:WebGLTexture}};
   const t=stage.outputTexture,w=t.width,h=t.height,previous=gl.getParameter(gl.FRAMEBUFFER_BINDING),fb=gl.createFramebuffer();gl.bindFramebuffer(gl.FRAMEBUFFER,fb);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,t._texture,0);
   const hdr=effect.renderTargetMode==='RGBA16F',pixels=hdr?new Float32Array(w*h*4):new Uint8Array(w*h*4);gl.readPixels(0,0,w,h,gl.RGBA,hdr?gl.FLOAT:gl.UNSIGNED_BYTE,pixels);gl.bindFramebuffer(gl.FRAMEBUFFER,previous);gl.deleteFramebuffer(fb);
   let opacity=0,occupied=0;const linearMean=[0,0,0];const canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;const ctx=canvas.getContext('2d')!,im=ctx.createImageData(w,h),radiance=ctx.createImageData(w,h);
   for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=(x+w*y)*4,o=(x+w*(h-1-y))*4,a=Number(pixels[i+3])/(hdr?1:255);opacity+=a;occupied+=Number(a>.1);for(let c=0;c<3;c++)im.data[o+c]=Math.round((1-a)*255);im.data[o+3]=255;}
   for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=(x+w*y)*4,o=(x+w*(h-1-y))*4;for(let c=0;c<3;c++){const v=Number(pixels[i+c])/(hdr?1:255),linear=hdr?v:v*v/Math.max(.0001,1-v*v);linearMean[c]+=linear/(w*h);const s=Math.max(0,linear)*8;radiance.data[o+c]=255*Math.pow(Math.min(1,s*(2.51*s+.03)/(s*(2.43*s+.59)+.14)),1/2.2);}radiance.data[o+3]=255;}
   if(save){ctx.putImageData(im,0,0);image(name+'-raw-T',canvas.toDataURL());ctx.putImageData(radiance,0,0);image(name+'-raw-L',canvas.toDataURL());}
   return {width:w,height:h,meanOpacity:opacity/(w*h),occupiedOverPointOne:occupied/(w*h),linearMean,readbackError:gl.getError()};
 };
 const capture=(name:string,attachments=false)=>{image(name,viewer.canvas.toDataURL());return {name,state:state(),content:raw(name,attachments)};};
 await clouds.ready;await atmosphere.ready;const resourceMs=performance.now()-started;await frame(10);
 const renderer=gl.getExtension('WEBGL_debug_renderer_info');const startup={resourceMs,readyMs:performance.now()-started,initialization:clouds.initialization,shader:trace!.timeline,longTasks:tasks,renderer:renderer?gl.getParameter(renderer.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),state:state()};
 output.textContent=JSON.stringify({startup});status.textContent='READY';buttons.forEach(b=>b.disabled=false);
 const scenes:Record<string,[number,number]>={global:[17e6,-90],orbit:[1.2e6,-90],altitude:[160e3,-60],above:[8300,-18],inside:[3020,0],ground:[800,12],'high-only':[7000,0]};
 const configure=async(name:string)=>{clouds.updateParameters({...cloudDefaults,...(name==='high-only'?{coverage:0}:{})});await clouds.ready;force=0;mask=0;effect.setMotion({angle:0,highAngle:0,evolution:0});camera(...scenes[name]);await frame(8);};
 const run=(fn:()=>Promise<unknown>)=>async()=>{buttons.forEach(b=>b.disabled=true);try{output.textContent=JSON.stringify({running:true,startup});const result=await fn();output.textContent=JSON.stringify({complete:true,startup,result});status.textContent='COMPLETE';}catch(e){output.textContent=String(e);status.textContent='ERROR';}finally{buttons.forEach(b=>b.disabled=false);}};
 panel.querySelector<HTMLButtonElement>('#captures')!.onclick=run(async()=>{const rows=[];for(const name of Object.keys(scenes)){await configure(name);rows.push(capture(name,true));}return rows;});
 panel.querySelector<HTMLButtonElement>('#matrix')!.onclick=run(async()=>{const rows=[];for(const name of ['global','orbit','ground','inside','high-only']){await configure(name);const content=raw(name,false);for(const mode of ['frame','passes'] as const)for(let round=0;round<2;round++){status.textContent=`${name} ${mode} ${round}`;rows.push({name,mode,round,content,initial:state(),timing:await trace!.collect(mode,200,90000),final:state()});output.textContent=JSON.stringify({running:true,startup,result:rows});}}return rows;});
 panel.querySelector<HTMLButtonElement>('#tour')!.onclick=run(async()=>{
   await configure('global');const rows=[];const keys:[[number,number],number][]=[[[17e6,-90],6],[[1.2e6,-90],14],[[160e3,-60],8],[[8300,-18],6],[[3020,0],6],[[800,12],0]];
   const frames=[];for(let k=0;k<keys.length-1;k++){const [a,count]=keys[k],b=keys[k+1][0];for(let j=0;j<count*8;j++){const t=j/(count*8),h=Math.exp(Math.log(a[0])*(1-t)+Math.log(b[0])*t);camera(h,a[1]*(1-t)+b[1]*t);await frame(1);frames.push(state());if(j%8===0)rows.push(capture('path-'+String(rows.length).padStart(2,'0')));}}
   camera(800,12);await frame();rows.push(capture('path-'+String(rows.length).padStart(2,'0')));return {frames,samples:rows};
 });
 panel.querySelector<HTMLButtonElement>('#diagnostics')!.onclick=run(async()=>{
   if(!query.has('diagnostics'))throw new Error('Open ?diagnostics for isolated source instrumentation; not GPU timing');const rows=[];
   for(const name of ['ground','altitude','orbit']){await configure(name);clouds.updateParameters({highCoverage:0});await frame();rows.push(capture(name+'-auto',true));
     for(const value of [1,2]){force=value;await frame();rows.push(capture(name+(value===1?'-near':'-far'),true));}force=1;
     for(const value of [1,2,3]){mask=value;await frame();rows.push(capture(name+'-mask'+value));}mask=0;
     effect.setVoxelEnabled(false);await frame();rows.push(capture(name+'-fallback'));effect.setVoxelEnabled(true);force=0;
     clouds.setQuality('high');const volume=(effect as unknown as {stage:PostProcessStageComposite}).stage.get(0) as unknown as {uniforms:Record<string,unknown>};Object.assign(volume.uniforms,{u_cloudSteps:64,u_cloudSubsteps:3,u_lightSteps:5});await frame();rows.push(capture(name+'-resolution-only',true));
     clouds.setQuality('medium');const medium=(effect as unknown as {stage:PostProcessStageComposite}).stage.get(0) as unknown as {uniforms:Record<string,unknown>};Object.assign(medium.uniforms,{u_cloudSteps:96,u_cloudSubsteps:4,u_lightSteps:5});await frame();rows.push(capture(name+'-steps-only',true));Object.assign(medium.uniforms,{u_cloudSteps:64,u_cloudSubsteps:3});
   }return rows;
 });
 panel.querySelector<HTMLButtonElement>('#seeds')!.onclick=run(async()=>{const rows=[];for(const [seed,coverage,type] of [[13,.62,0],[37,.42,0],[91,.8,0],[13,.72,2],[13,.72,3],[37,.55,3]]){clouds.updateParameters({...cloudDefaults,seed,coverage,type});await clouds.ready;for(const [name,h,p] of [['ground',800,12],['above',8300,-18],['orbit',1.2e6,-90]] as const){camera(h,p);await frame(6);rows.push(capture(`seed${seed}-c${coverage}-t${type}-${name}`));}}return rows;});
 const viewpoints=document.createElement('button');viewpoints.textContent='Transition rotation / translation';viewpoints.id='viewpoints';panel.insertBefore(viewpoints,output);buttons.push(viewpoints);
 viewpoints.onclick=run(async()=>{await configure('orbit');const rows=[];for(const h of [220e3,450e3,750e3,1200e3])for(const [label,heading,lon,lat] of [['center',245,-97.52,35.46],['rotated',290,-97.52,35.46],['translated',245,-97.17,35.71]] as const){camera(h,-90,heading,lon,lat);await frame(4);rows.push(capture(`transition-${h}-${label}`,true));}return rows;});
 const shear=document.createElement('button');shear.textContent='Wind shear 0 / 24 / 120';shear.id='shear';panel.insertBefore(shear,output);buttons.push(shear);
 shear.onclick=run(async()=>{await configure('ground');const rows=[];for(const wind of [0,24,120]){clouds.updateParameters({wind});await clouds.ready;effect.setMotion({angle:0,highAngle:0,evolution:0});await frame(5);rows.push(capture(`shear-${wind}`));}return rows;});
 panel.querySelector<HTMLButtonElement>('#switches')!.onclick=run(async()=>{await configure('orbit');const rows=[];for(const [q,hdr] of [['low',true],['high',true],['medium',false],['medium',true],['low',true],['high',true],['medium',true]] as const){const t=performance.now(),start=trace!.timeline.length;clouds.setQuality(q);effect.setHdrEnabled(hdr);await frame();rows.push({q,hdr,wallMs:performance.now()-t,shader:trace!.timeline.slice(start),...capture(`quality-${rows.length}-${q}-${hdr}`)});}return rows;});
 panel.querySelector<HTMLButtonElement>('#wind')!.onclick=run(async()=>{await configure('above');const rows=[];for(let i=0;i<=20;i++){const seconds=i*10;effect.setMotion({angle:seconds*24*.001/6378.137,highAngle:seconds*48*.001/6378.137,evolution:seconds*24*.001*.35});await frame(2);rows.push(capture('wind-'+String(i).padStart(2,'0')));}return rows;});
 window.addEventListener('pagehide',()=>{pre();post();trace!.destroy();observer.disconnect();app.destroy();},{once:true});
}catch(e){GlobalCloudEffect.prototype.mount=mount;HTMLCanvasElement.prototype.getContext=getContext;document.body.append(String(e));observer.disconnect();}
