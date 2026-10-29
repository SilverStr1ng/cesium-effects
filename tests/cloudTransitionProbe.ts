import type {cloudProbe} from './cloudProbe';

type Uniforms=Record<string,number|boolean|number[]>;
type Inputs=ReturnType<typeof cloudProbe>['inputs'];
type Case={patch:number;footprint:number;mu:number;height:number};
const error=(actual:number[],reference:number[])=>{
 const signed=actual.map((v,i)=>v-reference[i]);
 return {signed,absolute:signed.map(Math.abs),T:Math.abs(signed[3]),L:Math.hypot(...signed.slice(0,3))};
};

/** Independent point-ray quadrature shares production material and approximate
 * lighting, but does not call integrateCloud/far/Q/cache. It is not physical truth.
 * The local prototype keeps EACH sampled column's cumulative L/T before averaging. */
export async function cloudTransitionProbe(gpu:ReturnType<typeof cloudProbe>,header:string,uniforms:Uniforms,inputs:Inputs,local=false){
 const output=document.querySelector('#result')!;
 // The original fixture uses an 8x1 draw. Preserve each patch's fragment
 // coordinate for march jitter when measuring its endpoints in a 1x1 draw.
 let source='uniform float u_sourceMode,u_patch;float diagnosticScreen=0.,diagnosticStep=0.;vec2 diagnosticMip=vec2(-1);\n'+header
  .replaceAll('gl_FragCoord','(gl_FragCoord+vec4(u_patch,0,0,0))')
  .replace('u_moonGain,u_pixelAngle,u_debugView','u_moonGain,u_debugView')
  .replace('vec3 cloudSource(vec3 light){return light;}','float u_pixelAngle;vec3 cloudSource(vec3 light){return u_sourceMode==1.?vec3(1):light;}')
  .replace('if(cloudLayer==0&&u_voxelReady)footprint=max(footprint,(t1-t0)/float(CLOUD_SUBSTEPS)*.35);','diagnosticScreen=max(diagnosticScreen,footprint);diagnosticStep=max(diagnosticStep,(t1-t0)/float(CLOUD_SUBSTEPS)*.35);if(cloudLayer==0&&u_voxelReady)footprint=max(footprint,(t1-t0)/float(CLOUD_SUBSTEPS)*.35);')
  .replace('rho=cloudLayer==0?lowCloudDensity(p,footprint,false):highCloudDensity(p,footprint);','debugMipA=-1.;debugMipB=-1.;rho=cloudLayer==0?lowCloudDensity(p,footprint,false):highCloudDensity(p,footprint);diagnosticMip=max(diagnosticMip,vec2(debugMipA,debugMipB));')
  .replace('vec3 illumination(vec3 p,float rho,float footprint,CloudPhases phases){','vec3 illumination(vec3 p,float rho,float footprint,CloudPhases phases){if(u_sourceMode==2.)footprint=.02;');
 if(local){
  // Freeze weather/type/envelope while moving the voxel phase over the same
  // predefined eight world points. This is a diagnostic, never a product mode.
  source=source
   .replace('vec2 cloudWeather(vec3 p,float footprint){','vec2 cloudWeather(vec3 p,float footprint){return vec2(.7,.75);')
   .replace('float cloudCluster(vec3 column,float cover,float type){','float cloudCluster(vec3 column,float cover,float type){return .65;')
   .replace('float type=cloudTypeValue(w.g),top=cloudTypeTop(type);','float type=.75,top=cloudTypeTop(type);')
   .replace('float cover=clamp((w.r+u_coverage-1.)/max(.05,u_coverage),0.,1.);','float cover=.7;')
   .replace('cover=clamp(cover+(w.b-.5)*.7+(w.a-.5)*1.3,0.,1.);','cover=.7;');
 }
 source+=`uniform float u_grid,u_footprint,u_mu,u_height,u_mode,u_reference,u_steps,u_end,u_metadata;
 void main(){
  float patchIndex=u_patch+floor((gl_FragCoord.x-.5)/u_grid),lon=-1.7+patchIndex*.37,lat=.45+sin(patchIndex*1.7)*.6;
  vec3 n=vec3(cos(lat)*cos(lon),cos(lat)*sin(lon),sin(lat)),east=vec3(-sin(lon),cos(lon),0),north=cross(n,east);
  vec2 uv=(vec2(mod(gl_FragCoord.x-.5,u_grid),gl_FragCoord.y-.5)+.5)/u_grid-.5;
  vec3 direction=-u_mu*n+sqrt(max(0.,1.-u_mu*u_mu))*east;
  vec3 right=u_mu*east+sqrt(max(0.,1.-u_mu*u_mu))*n;
  cloudScreenRight=right;cloudScreenUp=north;
  vec2 path;
  if(u_height==0.&&u_mu==1.){
    n=normalize(n*Rg+(east*uv.x+north*uv.y)*u_footprint);direction=-n;
    u_camera=n*(Rg+u_base+u_thickness+17000.);path=vec2(17000.,17000.+u_thickness);
  }else{
    u_camera=n*(Rg+u_height)+(right*uv.x+north*uv.y)*u_footprint;
    vec2 outer=sphere(u_camera,direction,Rg+u_base+u_thickness),inner=sphere(u_camera,direction,Rg+u_base);
    path=vec2(max(0.,outer.x),outer.y);if(inner.x>path.x)path.y=min(path.y,inner.x);
  }
  if(path.y<=path.x){out_FragColor=vec4(0,0,0,1);return;}
  u_pixelAngle=u_footprint/max(.002,(path.x+path.y)*.5);
  vec3 center=u_camera+direction*((path.x+path.y)*.5);
  if(u_reference<.5){
    cloudRepresentation=int(u_mode);CloudSegment c=integrateCloud(direction,path);out_FragColor=vec4(c.L,c.cloudT);
    if(u_metadata==1.)out_FragColor=vec4(diagnosticMip,diagnosticScreen,diagnosticStep);
    if(u_metadata==2.){vec2 w=cloudWeather(center,.02);out_FragColor=vec4(w,cloudCluster(advect(normalize(center)*(Rg+u_base)),w.x,w.y),farCloudWeight(u_footprint));}
    if(u_metadata==3.)out_FragColor=vec4(path,voxelStretch(),farMoments.a);
    if(u_metadata==4.){vec2 w=cloudWeather(center,.02);vec3 q=advect(normalize(center)*(Rg+u_base));float cluster=cloudCluster(q,w.x,w.y);out_FragColor=vec4(cloudBody(q,w.x,w.y,cluster),0);}
    return;
  }
  float T=1.;vec3 L=vec3(0);CloudPhases phases=scatteringPhases(direction);
  float span=(path.y-path.x)*u_end,ds=span/u_steps;
  for(float j=0.;j<u_steps;j++){
    vec3 p=u_camera+direction*(path.x+(j+.5)*ds);
    if(u_height==0.&&u_mu==1.)p=n*(Rg+u_base+u_thickness-(j+.5)*ds);
    float rho=lowCloudDensity(p,.02,false);
    if(rho>0.){float a=1.-exp(-rho*ds);vec3 light=u_sourceMode==1.?vec3(1):illumination(p,rho,.02,phases);L+=T*a*light;T*=1.-a;}
  }
  out_FragColor=vec4(L,T);
 }`;
 const draw=(c:Case,grid:number,steps:number,mode=0,reference=0,sourceMode=0,end=1,metadata=0)=>{
  const pixels=gpu.draw(source,grid,grid,{...uniforms,u_grid:grid,u_footprint:c.footprint,u_patch:c.patch,u_mu:c.mu,u_height:c.height,u_mode:mode,u_reference:reference,u_steps:steps,u_sourceMode:sourceMode,u_end:end,u_metadata:metadata},inputs,true).pixels;
  const mean=Array.from({length:4},(_,k)=>{let s=0;for(let j=0;j<pixels.length;j+=4)s+=pixels[j+k];return s/grid**2;});
  let occupied=0,tau=0;for(let j=0;j<pixels.length;j+=4){occupied+=pixels[j+3]<.9?1:0;tau-=Math.log(Math.max(1e-30,pixels[j+3]));}
  return {LT:mean,occupied:occupied/grid**2,meanTau:tau/grid**2};
 };
 const rows=[];
 const cases:Case[]=local?Array.from({length:8},(_,patch)=>({patch,footprint:2,mu:1,height:0})):
  [.35,.75,1.25,2,4].flatMap(footprint=>Array.from({length:8},(_,patch)=>({patch,footprint,mu:1,height:0})));
 const extended=!local&&new URLSearchParams(location.search).has('extended');
 // Predetermined world points, never selected by whether the new model is
 // cloudy. Keep the original forty rows first and report occupancy separately.
 if(extended)cases.push(...[.75,2].flatMap(footprint=>Array.from({length:24},(_,i)=>({patch:i+8,footprint,mu:1,height:0}))));
 if(!local)cases.push({patch:3,footprint:.75,mu:.25,height:20},{patch:5,footprint:4,mu:.16,height:80},{patch:7,footprint:.35,mu:.08,height:3});
 for(const c of cases){
  const near=draw(c,1,192,1),far=draw(c,1,192,2),auto=draw(c,1,192);
  const coarse=draw(c,32,96,0,1),reference=draw(c,64,192,0,1);
  const constantSource={near:draw(c,1,192,1,0,1),far:draw(c,1,192,2,0,1)};
  const fineLightingNear=draw(c,1,192,1,0,2),metadata={near:draw(c,1,192,1,0,0,1,1).LT,far:draw(c,1,192,2,0,0,1,1).LT,fields:draw(c,1,192,0,0,0,1,2).LT,path:draw(c,1,192,0,0,0,1,3).LT,body:draw(c,1,192,0,0,0,1,4).LT};
  rows.push({...c,near,far,auto,reference,coarse,constantSource,fineLightingNear,metadata,errors:{near:error(near.LT,reference.LT),far:error(far.LT,reference.LT),auto:error(auto.LT,reference.LT)},convergence:error(coarse.LT,reference.LT)});
  output.textContent=JSON.stringify({complete:false,progress:rows.length,total:cases.length});await new Promise(r=>setTimeout(r,0));
 }
 const convergence=[],localPrototype=[];
 const worst=rows.filter(r=>r.height===0);
 const refine=local?[]:[...[...worst].sort((a,b)=>b.errors.auto.T-a.errors.auto.T).slice(0,1),...[...worst].sort((a,b)=>b.errors.auto.L-a.errors.auto.L).slice(0,1),{patch:4,footprint:.75,mu:1,height:0},{patch:5,footprint:2,mu:1,height:0}];
 // Also refine the worst oblique path in space and along the ray independently.
 if(!local)refine.push(...rows.filter(r=>r.height>0).sort((a,b)=>b.errors.auto.T-a.errors.auto.T).slice(0,1));
 const unique=refine.filter((r,i)=>refine.findIndex(s=>r.patch===s.patch&&r.footprint===s.footprint&&r.height===s.height)===i);
 if(!local)for(const c of unique){
   const base=rows.find(r=>r.patch===c.patch&&r.footprint===c.footprint&&r.height===c.height)!.reference;
   convergence.push({...c,base,spatial:draw(c,128,192,0,1),vertical:draw(c,64,384,0,1)});
 }
 if(local)for(const c of cases){
  const nodes=[.25,.5,.75,1].map(end=>({end,local16:draw(c,16,192,0,1,0,end),reference64:draw(c,64,192,0,1,0,end)}));
  localPrototype.push({...c,nodes});
 }
 return {complete:true,scope:local?'Frozen weather/type/envelope; actual local voxel phase vs global ensemble':`40 original radial cases, ${extended?48:0} predetermined additional points, plus 3 finite oblique paths`,referenceBoundary:'Independent point-ray integrator shares the production near material and approximate lighting; not full physical truth',budget:{height:64,light:5,substeps:3,voxel:true,referenceFootprint:.02},rows,convergence,localPrototype};
}
