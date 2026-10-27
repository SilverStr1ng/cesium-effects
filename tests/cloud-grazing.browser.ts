import common from '../src/effects/hillaire-atmosphere/shaders/common.glsl?raw';
import density from '../src/effects/global-clouds/shaders/density.glsl?raw';
import voxel from '../src/effects/global-clouds/shaders/voxel.glsl?raw';
import lighting from '../src/effects/global-clouds/shaders/droplet-lighting.glsl?raw';
import {cloudProbe} from './cloudProbe';

const output=document.querySelector('#result')!;
const checks:{name:string;pass:boolean;[key:string]:unknown}[]=[];
try{
  const gpu=cloudProbe(document.querySelector('canvas')!);
  const declarations=common+density+voxel+`
    uniform float u_patch,u_filterF,u_mu,u_rotation,u_referenceGrid;
    void setupPatch(out vec3 column,out vec3 a,out vec3 b){
      float lon=-1.7+u_patch*.37,lat=.45+sin(u_patch*1.7)*.6;
      vec3 n=vec3(cos(lat)*cos(lon),cos(lat)*sin(lon),sin(lat)),east=vec3(-sin(lon),cos(lon),0),north=cross(n,east);
      column=n*(Rg+u_base);cloudRay=-u_mu*n+sqrt(1.-u_mu*u_mu)*east;
      vec3 right=u_mu*east+sqrt(1.-u_mu*u_mu)*n;
      float c=cos(u_rotation),s=sin(u_rotation);
      cloudScreenRight=c*right+s*north;cloudScreenUp=-s*right+c*north;cloudSlant=1./max(.04,u_mu);
      a=c*cloudSlant*east+s*north;b=-s*cloudSlant*east+c*north;
    }`;
  // Reference samples the same nonlinear cloud/material law independently of
  // prepareFarColumns and its budget. Each pixel is one unfiltered subcolumn.
  const reference=`void main(){vec3 column,a,b;setupPatch(column,a,b);
    vec2 uv=gl_FragCoord.xy/u_referenceGrid-.5;
    vec3 p=normalize(column+u_filterF*(a*uv.x+b*uv.y))*(Rg+u_base);
    vec2 w=cloudWeather(p,u_filterF);if(w.x<=0.){out_FragColor=vec4(0);return;}
    vec3 q=advect(p);float cell=cellular(q+cloudWarp(q)+u_seed*.43,29.713,.04).r;
    float threshold=mix(.76,.38,w.x),cluster=smoothstep(threshold-.035,threshold+.085,cell);
    float scale=u_density*u_thickness/3.8*cloudSlant*cluster*smoothstep(0.,.2,w.x);
    vec4 m=materialOptics((1.-w.x)*.22+(1.-cluster)*.3,w.y,scale);
    out_FragColor=vec4(m.r,m.g,m.b*m.r,m.a);}`;
  const production='void main(){vec3 p,a,b;setupPatch(p,a,b);prepareFarColumns(p,u_filterF);out_FragColor=farMoments;}';
  const mean=(pixels:Float32Array|Uint8Array)=>Array.from({length:4},(_,c)=>{let sum=0;for(let i=c;i<pixels.length;i+=4)sum+=pixels[i];return sum/(pixels.length/4);});
  for(const [patch,footprint,mu] of [[5,28,.25],[3,4,.1],[5,4,.04],[0,4,.1]])for(const rotation of [0,.37,Math.PI/4,1.2]){
    const uniforms={...gpu.uniforms,u_patch:patch,u_filterF:footprint,u_mu:mu,u_rotation:rotation};
    const actual=mean(gpu.draw(declarations+production,1,1,uniforms,gpu.inputs,true).pixels);
    const ref=mean(gpu.draw(declarations+reference,192,192,{...uniforms,u_referenceGrid:192},gpu.inputs,true).pixels);
    const converged=mean(gpu.draw(declarations+reference,384,384,{...uniforms,u_referenceGrid:384},gpu.inputs,true).pixels);
    ref[2]/=Math.max(.0001,ref[0]);converged[2]/=Math.max(.0001,converged[0]);
    checks.push({name:`patch ${patch}, F ${footprint}, mu ${mu}, rotation ${rotation}`,pass:Math.abs(actual[0]-ref[0])<=.02&&Math.abs(ref[0]-converged[0])<=.002,
      actual,reference:ref,converged,opacityError:actual[0]-ref[0],convergence:ref[0]-converged[0]});
  }
  const phase=lighting.match(/float waterPhase\(float c,float g\)\{[^}]+\}/)![0];
  for(const g of [0,.72,.78,.88,.9]){
    const values=gpu.draw(common+phase+`uniform float u_g;void main(){float i=gl_FragCoord.x-.5+512.*(gl_FragCoord.y-.5);out_FragColor=vec4(waterPhase(-1.+2.*(i+.5)/262144.,u_g));}`,512,512,{u_g:g},{},true).pixels;
    const integral=mean(values)[0]*4*Math.PI;
    const peak=gpu.draw(common+phase+'uniform float u_g;void main(){out_FragColor=vec4(waterPhase(1.,u_g));}',1,1,{u_g:g},{},true).pixels[0];
    const expected=(1+g)/(4*Math.PI*(1-g)**2);
    checks.push({name:`production HG ${g}`,pass:Number.isFinite(peak)&&Math.abs(peak-expected)<.0001&&Math.abs(integral-1)<.00001,peak,expected,integral});
  }
  gpu.destroy();output.textContent=JSON.stringify({passed:checks.every(c=>c.pass),checks},null,2);
  document.title=checks.every(c=>c.pass)?'PASS · Grazing clouds':'FAIL · Grazing clouds';
}catch(error){output.textContent=String(error);document.title='ERROR · Grazing clouds';}
