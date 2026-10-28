import common from '../src/effects/hillaire-atmosphere/shaders/common.glsl?raw';
import density from '../src/effects/global-clouds/shaders/density.glsl?raw';
import voxel from '../src/effects/global-clouds/shaders/voxel.glsl?raw';
import atmosphere from '../src/effects/hillaire-atmosphere/shaders/integrate.glsl?raw';
import environment from '../src/effects/hillaire-atmosphere/shaders/sky-irradiance-sample.glsl?raw';
import lighting from '../src/effects/global-clouds/shaders/droplet-lighting.glsl?raw';
import {cloudProbe} from './cloudProbe';
const output=document.querySelector('#result')!;
try{
  const gpu=cloudProbe(document.querySelector('canvas')!),checks=[],responseChecks=[];
  const setup=`uniform float u_patch,u_height,u_mu,u_F,u_grid,u_referenceSteps,u_nodes;
    void setup(out vec3 origin,out vec3 d,out vec2 path,out vec3 column,out vec3 a,out vec3 b){
      float lon=-1.7+u_patch*.37,lat=.45+sin(u_patch*1.7)*.6;
      vec3 n=vec3(cos(lat)*cos(lon),cos(lat)*sin(lon),sin(lat)),east=vec3(-sin(lon),cos(lon),0),north=cross(n,east);
      origin=n*(Rg+u_height);d=-u_mu*n+sqrt(1.-u_mu*u_mu)*east;
      cloudRay=d;cloudScreenRight=u_mu*east+sqrt(1.-u_mu*u_mu)*n;cloudScreenUp=north;
      path=sphere(origin,d,Rg+u_base+u_thickness);path.x=max(0.,path.x);
      vec2 inner=sphere(origin,d,Rg+u_base);if(inner.x>path.x)path.y=min(path.y,inner.x);else if(inner.y>path.x)path.x=inner.y;
      vec3 anchor=origin+d*((path.x+path.y)*.5);n=normalize(anchor);column=n*(Rg+u_base);
      cloudSlant=1./max(.04,abs(dot(d,n)));
      vec3 rot=cross(-d,n);float denom=max(.001,1.-dot(d,n));
      a=cloudScreenRight-d*dot(d,cloudScreenRight);b=cloudScreenUp-d*dot(d,cloudScreenUp);
      a+=cross(rot,a)+cross(rot,cross(rot,a))/denom;b+=cross(rot,b)+cross(rot,cross(rot,b))/denom;
      vec3 tangent=d-n*dot(n,d);float stretch=(cloudSlant-1.)/max(1e-6,dot(tangent,tangent));a+=tangent*dot(a,tangent)*stretch;b+=tangent*dot(b,tangent)*stretch;
    }`;
  const actual=common+density+voxel+setup+`void main(){vec3 origin,d,column,a,b;vec2 path;setup(origin,d,path,column,a,b);
    prepareFarResponse(origin,d,path,u_F,int(u_nodes),normalize(vec3(-.2,-.8,.56)),vec3(0,0,1),false);
    float T=1.,previous=1.;for(int i=1;i<=farResponseCount;i++){float q=1.-farResponse[i].r;T*=q/max(1e-7,previous);previous=q;}
    out_FragColor=vec4(1.-T,farResponse[farResponseCount].r,path.y-path.x,1);}`;
  const reference=common+density+voxel+setup+`void main(){vec3 origin,d,column,a,b;vec2 path;setup(origin,d,path,column,a,b);
    vec2 uv=gl_FragCoord.xy/u_grid-.5;vec3 p=normalize(column+u_F*(a*uv.x+b*uv.y))*(Rg+u_base);
    vec2 w=cloudWeather(p,u_F);if(w.x<=0.){out_FragColor=vec4(0);return;}
    vec3 q=advect(p);vec4 bank=cellular(q,71.3,.04);float small=cellular(q+(bank.rga-.5)*3.4+u_seed*.43,29.713,.04).r;
    float cell=mix(small,bank.a,mix(.72,.55,w.y));
    float threshold=mix(.61,.36,w.x)-.035*(1.-w.y),cluster=smoothstep(threshold-.05,threshold+.085,cell),top=cloudTypeTop(w.y);
    // Independent midpoint path integral, never columnPathProfile/response.
    vec2 topHit=sphere(origin,d,Rg+u_base+u_thickness*top);
    float start=max(path.x,topHit.x),end=min(path.y,topHit.y),ds=max(0.,end-start)/u_referenceSteps,fraction=0.;
    for(float i=0.;i<u_referenceSteps;i++){
      float h=(length(origin+d*(start+(i+.5)*ds))-Rg-u_base)/(u_thickness*top);
      if(h>0.&&h<1.)fraction+=12.*h*(1.-h)*(1.-h)*ds/(u_thickness*top);
    }
    float scale=u_density*u_thickness/3.8*cluster*smoothstep(0.,.2,w.x)*fraction;
    out_FragColor=materialOptics((1.-w.x)*.22+(1.-cluster)*.3,w.y,scale);}`;
  const diagnostic=common+density+voxel+setup+`void main(){vec3 origin,d,column,a,b;vec2 path;setup(origin,d,path,column,a,b);
    out_FragColor=vec4(columnPathProfile(origin,d,path,.26),columnPathProfile(origin,d,path,.58),columnPathProfile(origin,d,path,.8),columnPathProfile(origin,d,path,1.));}`;
  const full=common+density+voxel+setup+`void main(){vec3 origin,d,column,a,b;vec2 path;setup(origin,d,path,column,a,b);prepareFarColumns(column,u_F);out_FragColor=vec4(farMoments.r,farTop,cloudSlant,farMoments.g);}`;
  const transport='#define LAYERED_CLOUDS\n#define CLOUD_DIAGNOSTICS\n#define LIGHT_STEPS 5\n'+common+atmosphere+
    density.replace(/const int FAR_RESPONSE_LIMIT=\d+;/,'const int FAR_RESPONSE_LIMIT=64;')+voxel+
    'vec3 u_camera;uniform vec3 u_moon;uniform bool u_atmosphere;uniform float u_moonFraction,u_moonGain,u_counts;struct CloudPhases{vec3 sun;vec3 moon;};'+environment+lighting+setup+`
    void main(){vec3 origin,d,column,a,b;vec2 path;setup(origin,d,path,column,a,b);u_camera=origin;
      if(path.y<=path.x){out_FragColor=u_counts>.5?vec4(0):vec4(0,0,0,1);return;}
      prepareFarResponse(origin,d,path,u_F,int(u_nodes),u_sun,u_moon,false);CloudPhases phases=scatteringPhases(d);
      vec3 L=vec3(0);for(int i=0;i<farResponseCount;i++){
        float absorbed=max(0.,farResponse[i+1].r-farResponse[i].r);vec3 p=origin+d*((farNode(i)+farNode(i+1))*.5);
        if(absorbed>0.)L+=absorbed*farResponseIllumination(p,i,phases);
      }
      out_FragColor=u_counts>.5?cloudWork:vec4(L,1.-farResponse[farResponseCount].r);
    }`;
  const mean=(a:Float32Array|Uint8Array)=>{let s=0;for(let i=0;i<a.length;i+=4)s+=a[i];return s/(a.length/4);};
  for(const [patch,height,mu,F] of [[7,3.4,-.8,28],[5,17000,.97,28],[7,17000,1,28],[3,1200,.65,4],[0,3.02,-.015,4],[5,80,.16,12],[5,80,.15,12]]){
    const u={...gpu.uniforms,u_patch:patch,u_height:height,u_mu:mu,u_F:F};
    const value=Array.from(gpu.draw(actual,1,1,{...u,u_nodes:8},gpu.inputs,true).pixels);
    const ref=mean(gpu.draw(reference,192,192,{...u,u_grid:192,u_referenceSteps:96},gpu.inputs,true).pixels);
    const fine=mean(gpu.draw(reference,384,384,{...u,u_grid:384,u_referenceSteps:192},gpu.inputs,true).pixels);
    const profiles=Array.from(gpu.draw(diagnostic,1,1,u,gpu.inputs,true).pixels),fullColumn=Array.from(gpu.draw(full,1,1,u,gpu.inputs,true).pixels);
    checks.push({patch,height,mu,F,opacity:value[0],response:value[1],span:value[2],profiles,fullColumn,reference:ref,referenceFine:fine,error:value[0]-fine,convergence:fine-ref,subdivisionError:value[0]-value[1],pass:Math.abs(value[0]-fine)<=.02&&Math.abs(fine-ref)<=.002&&Math.abs(value[0]-value[1])<=.002});
    const lon=-1.7+patch*.37,lat=.45+Math.sin(patch*1.7)*.6,sun=[Math.cos(lat)*Math.cos(lon),Math.cos(lat)*Math.sin(lon),Math.sin(lat)];
    const inputs={...gpu.inputs,u_transmittance:gpu.inputs.u_weather,u_multiple:gpu.inputs.u_weather,u_skyIrradiance:gpu.inputs.u_weather};
    const lt=(nodes:number,counts=0)=>Array.from(gpu.draw(transport,1,1,{...u,u_nodes:nodes,u_sun:sun,u_moon:[0,0,1],u_atmosphere:false,u_moonFraction:0,u_moonGain:0,u_counts:counts},inputs,true).pixels);
    const a4=lt(4),a8=lt(8),a16=lt(16),a32=lt(32),a64=lt(64),counts=lt(8,1),max=(a:number[],b:number[],channels:number[])=>Math.max(...channels.map(i=>Math.abs(a[i]-b[i])));
    const Lerror=max(a8,a64,[0,1,2]),Terror=max(a8,a64,[3]),convergence=max(a32,a64,[0,1,2,3]);
    responseChecks.push({patch,height,mu,F,sun,rejected4:a4,error4:max(a4,a64,[0,1,2,3]),production8:a8,recomputed16:a16,recomputed32:a32,recomputed64:a64,Lerror,Terror,convergence,counts:{builds:counts[0],spatialTaps:counts[1],tableQueries:counts[2],legacyCacheHits:counts[3]},pass:Lerror<=.002&&Terror<=.002&&convergence<=.002});
  }
  gpu.destroy();output.textContent=JSON.stringify({passed:checks.every(x=>x.pass)&&responseChecks.every(x=>x.pass),scope:'Production finite response; frozen local weather distribution with distinct child tops and a curved path from the clipped observer. Independent 96/192 midpoint path and 192/384 spatial reference for T. Response-node cache is compared separately against recomputation at 32/64 endpoints using the same production L source. This is not an independent L reference or validation of changing weather along a long ray. Counters use a separate instrumented shader, never GPU timing rounds.',targets:{opacity:.02,convergence:.002,subdivision:.002,responseCache:.002},checks,responseChecks},null,2);
  document.title=checks.every(x=>x.pass)?'PASS · Finite statistics':'FAIL · Finite statistics';
}catch(error){output.textContent=String(error);document.title='ERROR · Finite statistics';}
