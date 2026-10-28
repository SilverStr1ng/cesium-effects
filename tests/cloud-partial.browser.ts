import common from '../src/effects/hillaire-atmosphere/shaders/common.glsl?raw';
import density from '../src/effects/global-clouds/shaders/density.glsl?raw';
import voxel from '../src/effects/global-clouds/shaders/voxel.glsl?raw';
import {cloudProbe} from './cloudProbe';

// Deliberately red-capable diagnostic. A frozen local column separates clipped
// profile statistics from spatial filtering and changing weather along a ray.
const output=document.querySelector('#result')!;
try{
  const gpu=cloudProbe(document.querySelector('canvas')!),checks=[];
  const header=common+density+voxel+`uniform float u_patch,u_filterF,u_h0,u_grid,u_steps;
    void setupColumn(out vec3 n,out vec3 east,out vec3 north){
      float lon=-1.7+u_patch*.37,lat=.45+sin(u_patch*1.7)*.6;
      n=vec3(cos(lat)*cos(lon),cos(lat)*sin(lon),sin(lat));east=vec3(-sin(lon),cos(lon),0);north=cross(n,east);
      cloudRay=-n;cloudScreenRight=east;cloudScreenUp=north;cloudSlant=1.;}
    float remaining(float h){return 1.-h*h*(6.-8.*h+3.*h*h);}`;
  const actual=header+`void main(){vec3 n,east,north;setupColumn(n,east,north);
    float fraction=remaining(u_h0),T=1.,previous=1.;
    for(float i=1.;i<=u_steps;i++){
      float Q=1.-farCommonResponse(n*(Rg+u_base),u_filterF,fraction*i/u_steps).r;
      T*=Q/previous;previous=Q;
    }
    out_FragColor=vec4(1.-T,0,fraction,farTop);}`;
  const reference=header+`void main(){vec3 n,east,north;setupColumn(n,east,north);
    vec2 uv=gl_FragCoord.xy/u_grid-.5;vec3 p=normalize(n*(Rg+u_base)+u_filterF*(east*uv.x+north*uv.y))*(Rg+u_base);
    vec2 w=cloudWeather(p,u_filterF);if(w.x<=0.){out_FragColor=vec4(0);return;}
    vec3 q=advect(p);vec4 bank=cellular(q,71.3,.04);float small=cellular(q+(bank.rga-.5)*3.4+u_seed*.43,29.713,.04).r;
    float cell=mix(small,bank.a,mix(.72,.55,w.y));
    float threshold=mix(.61,.36,w.x)-.035*(1.-w.y),cluster=smoothstep(threshold-.05,threshold+.085,cell);
    // Integrate the SAME local profile fraction in each column BEFORE taking
    // E[T]. This reference never calls farCloudDensity or prepareFarColumns.
    float scale=u_density*u_thickness/3.8*cluster*smoothstep(0.,.2,w.x)*remaining(u_h0);
    out_FragColor=materialOptics((1.-w.x)*.22+(1.-cluster)*.3,w.y,scale);}`;
  const mean=(p:Float32Array|Uint8Array)=>{let sum=0;for(let i=0;i<p.length;i+=4)sum+=p[i];return sum/(p.length/4);};
  for(const patch of [0,3,5,7])for(const h0 of [0,.2,.5,.8]){
    const uniforms={...gpu.uniforms,u_patch:patch,u_filterF:28,u_h0:h0};
    const candidate=Array.from(gpu.draw(actual,1,1,{...uniforms,u_steps:8},gpu.inputs,true).pixels);
    const doubled=Array.from(gpu.draw(actual,1,1,{...uniforms,u_steps:16},gpu.inputs,true).pixels);
    const ref=mean(gpu.draw(reference,192,192,{...uniforms,u_grid:192},gpu.inputs,true).pixels);
    const ref2=mean(gpu.draw(reference,384,384,{...uniforms,u_grid:384},gpu.inputs,true).pixels);
    checks.push({patch,footprintKm:28,h0,profileFraction:candidate[2],opacity:candidate[0],reference:ref,reference384:ref2,
      opacityError:candidate[0]-ref,referenceConvergence:ref2-ref,marchConvergence:doubled[0]-candidate[0],
      pass:Math.abs(candidate[0]-ref)<=.02&&Math.abs(ref-ref2)<=.002&&Math.abs(candidate[0]-doubled[0])<=.002});
  }
  gpu.destroy();output.textContent=JSON.stringify({passed:checks.every(c=>c.pass),scope:'Production cumulative-response spatial rule on a frozen local radial column; same normalized fraction in each unresolved column, 8/16 conditional increments. Not a full procedural oblique-ray reference.',targets:{opacity:.02,convergence:.002},checks},null,2);
  document.title=checks.every(c=>c.pass)?'PASS · Partial far columns':'FAIL · Partial far columns';
}catch(e){output.textContent=String(e);document.title='ERROR · Partial far columns';}
