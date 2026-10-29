import {cloudProbe} from './cloudProbe';
import common from '../src/effects/hillaire-atmosphere/shaders/common.glsl?raw';
import density from '../src/effects/global-clouds/shaders/density.glsl?raw';
import voxel from '../src/effects/global-clouds/shaders/voxel.glsl?raw';
const output=document.querySelector('#result')!,gpu=cloudProbe(document.querySelector('canvas')!);
try{
 const source=common+density+voxel+`
 void main(){
  vec3 start=vec3(-1663.3855018561753,204.62525407105178,6155.949278911216);
  vec3 point=vec3(-1663.8021338173687,205.51812154556401,6155.84249982);
  float startRho=lowCloudDensity(start,.02,false),startTau=resolvedBody.x;
  float rho=lowCloudDensity(point,.249,false),sampleTau=resolvedBody.x;
  float raw=residualCloudDensity(point,.249,true);
  out_FragColor=vec4(startTau,sampleTau,rho,raw);
 }`;
 const value=Array.from(gpu.draw(source,1,1,gpu.uniforms,gpu.inputs,true).pixels);
 const matching=common+density+voxel+`
 void main(){
  vec3 start=vec3(-1663.3855018561753,204.62525407105178,6155.949278911216);
  float i=gl_FragCoord.x-.5;
  vec3 p=start+vec3(sin(i*1.13),cos(i*.72),sin(i*.39))*2.;
  float rho=lowCloudDensity(p,.249,true),expected=max(0.,rho-resolvedBodyRho);
  lowCloudDensity(start,.02,false);vec3 before=resolvedBody;float beforeRho=resolvedBodyRho;
  float shadow=residualCloudDensity(p,.249,true);
  out_FragColor=vec4(expected,shadow,length(before-resolvedBody)+abs(beforeRho-resolvedBodyRho),rho);
 }`;
 const checks=[];
 for(const angle of [0,.17]){
  const pixels=gpu.draw(matching,64,1,{...gpu.uniforms,u_windAngle:angle},gpu.inputs,true).pixels;
  let maxError=0,stateError=0,cloudy=0,clear=0;
  for(let i=0;i<pixels.length;i+=4){maxError=Math.max(maxError,Math.abs(pixels[i]-pixels[i+1]));stateError=Math.max(stateError,pixels[i+2]);if(pixels[i+3]>0)cloudy++;else clear++;}
  checks.push({angle,maxError,stateError,cloudy,clear,pass:maxError<1e-5&&stateError===0});
 }
 const timing=[];
 if(new URLSearchParams(location.search).has('timing')){
  const gl=gpu.gl,ext=gl.getExtension('EXT_disjoint_timer_query_webgl2');
  if(!ext)throw new Error('GPU timer query unavailable');
  const old=`float previousResidual(vec3 p,float footprint){
    float h=(length(p)-Rg-u_base)/u_thickness;if(h<=0.||h>=1.||u_coverage<=0.)return 0.;
    vec2 w=cloudWeather(p,footprint);if(w.x<=0.)return 0.;
    vec3 q=advect(normalize(p)*(Rg+u_base));
    return residualCloudMaterial(p,footprint,true,w,cloudCluster(q,w.x,w.y));
  }`;
  for(const mode of ['origin gate','sample gate']){
   const shader=common+density+voxel+old+`void main(){
    vec3 start=vec3(-1663.3855018561753,204.62525407105178,6155.949278911216);
    lowCloudDensity(start,.02,false);float gate=CLOUD_RESIDUAL_WEIGHT*smoothstep(0.,.5,resolvedBody.x);
    vec3 p=start+vec3((gl_FragCoord.xy/128.-.5)*4.,sin(gl_FragCoord.x*.13)*.5);
    float rho=${mode==='origin gate'?'gate*previousResidual(p,.249)':'residualCloudDensity(p,.249,true)'};
    out_FragColor=vec4(rho);
   }`;
   const values:number[]=[],initial={visible:!document.hidden,focused:document.hasFocus()};let disjoint=0,hidden=0;
   for(let i=0;i<205;i++){
    const query=gl.createQuery()!;
    const frame=gpu.draw(shader,128,128,gpu.uniforms,gpu.inputs,true,{target:ext.TIME_ELAPSED_EXT,query});
    while(!gl.getQueryParameter(query,gl.QUERY_RESULT_AVAILABLE))await new Promise(requestAnimationFrame);
    if(gl.getParameter(ext.GPU_DISJOINT_EXT))disjoint++;else if(i>=5)values.push(gl.getQueryParameter(query,gl.QUERY_RESULT)/1e6);
    hidden+=Number(document.hidden);gl.deleteQuery(query);
    // Readback texture is not an input to another pass in this microprobe.
    gl.deleteTexture(frame.texture);
   }
   const sorted=[...values].sort((a,b)=>a-b);
   timing.push({mode,scope:'128x128 isolated residual queries, not full cloud pass',initial,final:{visible:!document.hidden,focused:document.hasFocus()},disjoint,hidden,rawGpuMs:values,count:values.length,meanMs:values.reduce((s,v)=>s+v,0)/values.length,medianMs:sorted[Math.floor(sorted.length*.5)],p95Ms:sorted[Math.floor(sorted.length*.95)]});
  }
 }
 output.textContent=JSON.stringify({conditions:{seed:13,wind:24,base:1.5,thickness:3.8,density:1.1,angle:0,evolution:0},startTau:value[0],sampleTau:value[1],actualDensity:value[2],shadowResidual:value[3],checks,timing,passed:value[2]===0&&value[3]===0&&checks.every(c=>c.pass),scope:'Production density/shadow sample support and unchanged observer state, not final pixel T'},null,2);
}catch(error){output.textContent=JSON.stringify({error:String(error),passed:false});}finally{gpu.destroy();}
