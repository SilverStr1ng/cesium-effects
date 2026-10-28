import common from '../src/effects/hillaire-atmosphere/shaders/common.glsl?raw';
import density from '../src/effects/global-clouds/shaders/density.glsl?raw';
import voxel from '../src/effects/global-clouds/shaders/voxel.glsl?raw';
import transport from '../src/effects/hillaire-atmosphere/shaders/integrate.glsl?raw';
import environment from '../src/effects/hillaire-atmosphere/shaders/sky-irradiance-sample.glsl?raw';
import lighting from '../src/effects/global-clouds/shaders/droplet-lighting.glsl?raw';
import intervals from '../src/effects/global-clouds/shaders/intervals.glsl?raw';
import {cloudProbe} from './cloudProbe';
const output=document.querySelector('#result')!;
try{
  const gpu=cloudProbe(document.querySelector('canvas')!),checks=[];
  const build=(cache:'projected'|'old'|'off')=>{
    let field=density.replace('farAnchor=column;','farEvaluations+=1.;farAnchor=column;');
    const guard=/if\(!farBuildingResponse&&distance\(column,farAnchor\)[^\n]+return;/;
    if(cache==='off')field=field.replace(guard,'');
    if(cache==='projected'){
      // Rejected optimization candidate; deliberately kept out of production.
      field='vec3 farMajor=vec3(1,0,0);float farMajorRadius=.25;'+field;
      field=field.replace(guard,'vec3 movement=column-farAnchor;float along=dot(movement,farMajor),radius=max(.25,footprint*.5);if(along*along/(farMajorRadius*farMajorRadius)+max(0.,dot(movement,movement)-along*along)/(radius*radius)<1.&&abs(footprint-farFootprint)<max(.01,footprint*.05)&&abs(cloudSlant-farSlant)<cloudSlant*.05)return;');
      field=field.replace('vec2 support=footprint*(abs(a)+abs(b));','vec2 support=footprint*(abs(a)+abs(b));farMajor=major;farMajorRadius=max(radius,min(2.,support.x*.125));');
    }
    return '#define LAYERED_CLOUDS\n#define LIGHT_STEPS 5\n'+common+transport+
      'float farEvaluations=0.;uniform float u_steps,u_intervals;'+field+voxel+
      'vec3 u_camera;uniform vec3 u_moon;const bool u_atmosphere=false;uniform float u_moonFraction,u_moonGain,u_pixelAngle;struct CloudPhases{vec3 sun;vec3 moon;};'+environment+lighting+intervals+`
      uniform float u_height,u_mu,u_counts;void main(){float patchIndex=floor(gl_FragCoord.x);float lon=-1.7+patchIndex*.37,lat=.45+sin(patchIndex*1.7)*.6;
      vec3 n=vec3(cos(lat)*cos(lon),cos(lat)*sin(lon),sin(lat)),east=vec3(-sin(lon),cos(lon),0),north=cross(n,east);
      u_camera=n*(Rg+u_height);vec3 d=-u_mu*n+sqrt(1.-u_mu*u_mu)*east;
      cloudScreenRight=u_mu*east+sqrt(1.-u_mu*u_mu)*n;cloudScreenUp=north;cloudRay=d;cloudRepresentation=2;
      vec2 spans[4];int layers[4];vec2 ground=sphere(u_camera,d,Rg);cloudIntervals(u_camera,d,ground.x>0.?ground.x:1e8,spans,layers);
      vec3 L=vec3(0);float T=1.;cloudLayer=0;CloudPhases phases=scatteringPhases(d);
      for(int segment=0;segment<int(u_intervals);segment++){
        if(layers[segment]!=0||spans[segment].y<=spans[segment].x)continue;
        vec2 span=spans[segment];float ds=(span.y-span.x)/u_steps;farAnchor=vec3(1e8);
        for(float i=0.;i<u_steps;i++){
          float t=mix(span.x,span.y,(i+.5)/u_steps),footprint=max(.002,t*u_pixelAngle);vec3 p=u_camera+d*t;
          cloudSlant=1./max(.04,abs(dot(d,normalize(p))));float rho=farCloudDensity(p,footprint),opacity=1.-exp(-rho*ds);
          if(rho>0.)L+=T*opacity*illumination(p,rho,footprint,phases);T*=1.-opacity;
        }
      }
      out_FragColor=u_counts>.5?vec4(farEvaluations):vec4(L,T);}`;
  };
  const inputs={...gpu.inputs,u_transmittance:gpu.inputs.u_weather,u_multiple:gpu.inputs.u_weather,u_skyIrradiance:gpu.inputs.u_weather};
  const sun=[-.2,-.8,.56].map(v=>v/Math.hypot(.2,.8,.56));
  const uniforms={...gpu.uniforms,u_sun:sun,u_moon:sun.map(v=>-v),u_moonFraction:0,u_moonGain:0,u_pixelAngle:2*Math.tan(Math.PI/6)/(1080*.65),u_steps:256,u_intervals:4};
  for(const [height,mu] of [[3.02,.015],[.8,-.015],[80,.15],[1200,.65],[17000,.97]]){
    const u={...uniforms,u_height:height,u_mu:mu},draw=(cache:'projected'|'old'|'off',counts=0)=>Array.from(gpu.draw(build(cache),8,1,{...u,u_counts:counts},inputs,true).pixels);
    const actual=draw('projected'),old=draw('old'),reference=draw('off'),counts=draw('projected',1),oldCounts=draw('old',1),referenceCounts=draw('off',1);
    const max=(a:number[],b:number[],channel:number)=>Math.max(...a.filter((_v,i)=>i%4===channel).map((v,i)=>Math.abs(v-b[i*4+channel])));
    const maxT=max(actual,reference,3),maxL=Math.max(...[0,1,2].map(c=>max(actual,reference,c)));
    checks.push({heightKm:height,mu,actual,old,reference,maxT,maxL,oldMaxT:max(old,reference,3),oldMaxL:Math.max(...[0,1,2].map(c=>max(old,reference,c))),
      evaluations:counts.filter((_v,i)=>i%4===0),oldEvaluations:oldCounts.filter((_v,i)=>i%4===0),uncachedEvaluations:referenceCounts.filter((_v,i)=>i%4===0),pass:maxT<=.002&&maxL<=.002});
  }
  gpu.destroy();output.textContent=JSON.stringify({passed:checks.every(c=>c.pass),scope:'Cache reuse only: production farCloudDensity + illumination; fixed 256-step finite shell quadrature, no atmosphere, uncached filtering at every step as reference. This isolates reuse error; it is not independent full-ray transport convergence.',targets:{L:.002,T:.002},checks},null,2);document.title=checks.every(c=>c.pass)?'PASS · Ray cache':'FAIL · Ray cache';
}catch(e){output.textContent=String(e);document.title='ERROR · Ray cache';}
