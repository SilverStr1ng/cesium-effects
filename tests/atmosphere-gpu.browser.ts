import {gpuProbe} from './gpuProbe';
import common from '../src/effects/hillaire-atmosphere/shaders/common.glsl?raw';
import transmission from '../src/effects/hillaire-atmosphere/shaders/transmittance.glsl?raw';
import multiple from '../src/effects/hillaire-atmosphere/shaders/multiple-scattering.glsl?raw';
import transport from '../src/effects/hillaire-atmosphere/shaders/integrate.glsl?raw';
import skyParameters from '../src/effects/hillaire-atmosphere/shaders/sky-view-parameters.glsl?raw';
import skySource from '../src/effects/hillaire-atmosphere/shaders/sky-view.glsl?raw';
import irradianceSource from '../src/effects/hillaire-atmosphere/shaders/sky-irradiance.glsl?raw';
import irradianceSample from '../src/effects/hillaire-atmosphere/shaders/sky-irradiance-sample.glsl?raw';
import composite from '../src/effects/hillaire-atmosphere/shaders/composite.glsl?raw';
import display from '../src/scene/display.glsl?raw';
import {transmittance} from '../src/effects/hillaire-atmosphere/atmosphereMath';
const output=document.querySelector('#result')!;
const gpu=gpuProbe(document.querySelector<HTMLCanvasElement>('#probe')!);
try{
  const checks:{name:string;pass:boolean;[key:string]:unknown}[]=[];
  const medium={u_medium:[1,1,1]};
  const lut=gpu.draw(common+transmission,256,64,medium).texture;
  const ray=(height:number,mu:number)=>Array.from(gpu.draw(common+`uniform sampler2D u_lut;uniform vec2 u_ray;void main(){vec3 p=vec3(0,0,Rg+u_ray.x),d=vec3(sqrt(1.-u_ray.y*u_ray.y),0,u_ray.y);out_FragColor=vec4(sunTransmission(u_lut,p,d),1);}`,1,1,{...medium,u_ray:[height,mu]},{u_lut:lut},true).pixels).slice(0,3);
  const miss=ray(17000,-.5);
  checks.push({name:'23378.137 km observer / mu=-0.5 misses atmosphere and returns T=1',pass:miss.every(t=>Math.abs(t-1)<1e-6),actual:miss});
  const blocked=ray(17000,-1);
  checks.push({name:'Earth-occluded space ray returns T=0',pass:blocked.every(t=>t===0),actual:blocked});
  const cases=[[0,-1],[.8,1],[80,0],[99,.1],[100,0],[100,1],[101,1]];
  for(const h of [101,17000])for(const impact of [1,5,20,50,99.9,100,100.1])cases.push([h,-Math.sqrt(1-((6378.137+impact)/(6378.137+h))**2)]);
  const errors=cases.map(([h,mu])=>{const actual=ray(h,mu),expected=transmittance(h,mu,undefined,4096);return {h,mu,actual,expected,error:Math.max(...actual.map((v,c)=>Math.abs(v-expected[c])))};});
  checks.push({name:'inside, boundary and outward rays agree with numerical transmission',pass:errors.every(v=>v.error<.025),cases:errors});
  const multi=gpu.draw(common+multiple,32,32,medium,{u_transmittance:lut}).texture;
  const integration=transport;
  const integrationFixture=`uniform float u_height,u_steps;void main(){
    vec3 p=vec3(0,0,Rg+u_height);
    float horizon=acos(-sqrt(1.-pow(Rg/length(p),2.)));
    float angle=horizon+mix(-.18,.08,(gl_FragCoord.x-.5)/31.);
    vec3 d=vec3(sin(angle),0,cos(angle)),L,T;
    integrateAtmosphere(p,d,1e6,int(u_steps),L,T);out_FragColor=vec4(L,1);
  }`;
  const integrationErrors=[80,99,101].flatMap(h=>[-.12,0,.3,1].map(sunMu=>{
    const render=(steps:number)=>gpu.draw('#define ATMOSPHERE_MAX_STEPS 512\n'+common+integration+integrationFixture,32,1,
      {...medium,u_height:h,u_steps:steps,u_sun:[Math.sqrt(1-sunMu*sunMu),0,sunMu]},{u_transmittance:lut,u_multiple:multi},true).pixels;
    const reference=render(512);
    return {height:h,sunMu,steps:[24,32].map(steps=>{const actual=render(steps);let sq=0,den=0,max=0;
      for(let i=0;i<reference.length;i++)if(i%4!==3){sq+=(actual[i]-reference[i])**2;den+=reference[i]**2;max=Math.max(max,Math.abs(actual[i]-reference[i]));}
      return {steps,relativeRms:Math.sqrt(sq/den),maxAbsolute:max};})};
  }));
  checks.push({name:'limb integration agrees with 512-step reference at 80/99/101 km',pass:integrationErrors.every(v=>v.steps.every(e=>e.relativeRms<.04)),cases:integrationErrors});
  const reciprocal=[.001,.8,80,99,101,17000].map(h=>{
    const values=gpu.draw(common+skyParameters+`uniform float u_height;void main(){
      vec2 uv=vec2((gl_FragCoord.x-.5)/255.,(gl_FragCoord.y-.5)/255.);
      vec3 d=skyViewDirection(uv,Rg+u_height);vec2 actual=skyViewUnitUV(d,Rg+u_height);
      // Azimuth has no unique value at the poles; x=0 and x=1 are periodic.
      vec2 e=abs(actual-uv);e.x=min(e.x,1.-e.x);if(uv.y==0.||uv.y==1.)e.x=0.;
      out_FragColor=vec4(e,abs(dot(d,d)-1.),1);
    }`,256,256,{u_height:h},{},true).pixels;
    let texelError=0;for(let i=0;i<values.length;i++)if(i%4!==3)texelError=Math.max(texelError,values[i]*(i%4===0?192:i%4===1?108:1));
    return {height:h,texelError};
  });
  checks.push({name:'physical-horizon SkyView generation and sampling are reciprocal within 0.1 texel',pass:reciprocal.every(v=>v.texelError<.1),cases:reciprocal});
  const skyErrors=[80,99,101].map(h=>{
    const uniforms={...medium,u_camera:[0,0,6378.137+h],u_basis:[1,0,0,0,1,0,0,0,1],u_sun:[Math.sqrt(1-.3*.3),0,.3]};
    const sky=gpu.draw(common+skyParameters+transport+skySource,192,108,uniforms,{u_transmittance:lut,u_multiple:multi}).texture;
    const sample=`uniform float u_height;uniform sampler2D u_sky;void main(){
      vec3 p=vec3(0,0,Rg+u_height);float angle=skyHorizonAngle(length(p))+mix(-.18,.08,(gl_FragCoord.x-.5)/31.);
      vec3 d=vec3(sin(angle),0,cos(angle));out_FragColor=vec4(decodeL(texture(u_sky,skyViewTextureUV(d,length(p))).rgb),1);}`;
    const actual=gpu.draw(common+skyParameters+sample,32,1,{u_height:h},{u_sky:sky},true).pixels;
    const reference=gpu.draw('#define ATMOSPHERE_MAX_STEPS 512\n'+common+transport+integrationFixture,32,1,{...uniforms,u_height:h,u_steps:512},{u_transmittance:lut,u_multiple:multi},true).pixels;
    let sq=0,den=0;for(let i=0;i<actual.length;i++)if(i%4!==3){sq+=(actual[i]-reference[i])**2;den+=reference[i]**2;}
    return {height:h,relativeRms:Math.sqrt(sq/den)};
  });
  checks.push({name:'SkyView limb matches high-step integration near the atmosphere boundary',pass:skyErrors.every(v=>v.relativeRms<.08),cases:skyErrors});
  const black=gpu.draw('void main(){out_FragColor=vec4(0,0,0,1);}',1,1).texture;
  const continuity=[0,.3].map(mu=>{
    const render=(h:number)=>{
      const uniforms={...medium,u_camera:[0,0,6378.137+h],u_basis:[1,0,0,0,1,0,0,0,1],u_sun:[Math.sqrt(1-mu*mu),0,mu],
        u_sunDisc:[1,0,0],u_sunRadius:.00465,u_moonDisc:[0,1,0],u_moonRadius:.0045,u_moonSun:[1,0,0],u_moonBrightness:2.4,u_exposure:8};
      const sky=gpu.draw(common+skyParameters+transport+skySource,192,108,uniforms,{u_transmittance:lut,u_multiple:multi}).texture;
      const czm=`mat4 czm_inverseProjection;const mat4 czm_inverseView=mat4(1);const vec4 czm_viewport=vec4(0,0,32,1);
        vec4 czm_windowToEyeCoordinates(vec2 uv,float depth){return vec4(0,0,1,1);}`;
      const fixture=`void main(){float impact=Rg+mix(1.,90.,(gl_FragCoord.x-.5)/31.);float mu=-sqrt(1.-pow(impact/length(u_camera),2.));
        czm_inverseProjection=mat4(0);czm_inverseProjection[3]=vec4(sqrt(1.-mu*mu),0,mu,1);compositeMain();}`;
      return gpu.draw('#define SKY_HDR\n'+czm+common+skyParameters+display+transport+composite.replace('void main(){','void compositeMain(){')+fixture,32,1,uniforms,
        {u_transmittance:lut,u_multiple:multi,u_skyView:sky,colorTexture:black,depthTexture:black},true).pixels;
    };
    const inside=render(99.99),outside=render(100.01);let sq=0,den=0,maxAbsolute=0;
    for(let i=0;i<inside.length;i++)if(i%4!==3){sq+=(inside[i]-outside[i])**2;den+=outside[i]**2;maxAbsolute=Math.max(maxAbsolute,Math.abs(inside[i]-outside[i]));}
    return {sunMu:mu,relativeRms:Math.sqrt(sq/den),maxAbsolute};
  });
  checks.push({name:'actual sky composite stays continuous across 99.99 / 100.01 km LUT-to-space switch',pass:continuity.every(v=>v.relativeRms<.03),cases:continuity});
  const gl=gpu.gl,timer=gl.getExtension('EXT_disjoint_timer_query_webgl2'),query=timer?gl.createQuery():null;
  const irradiance=gpu.draw(common+skyParameters+transport+irradianceSource,64,64,medium,{u_transmittance:lut,u_multiple:multi},false,
    query?{target:timer.TIME_ELAPSED_EXT,query}:undefined).texture;
  const sampleEnvironment=common+irradianceSample+`uniform sampler2D u_lut;uniform vec3 u_point,u_sun;void main(){vec3 sky,horizon;sampleSkyIrradiance(u_lut,u_point,u_sun,sky,horizon);out_FragColor=vec4(gl_FragCoord.x<1.?sky:horizon,1);}`;
  const irradianceErrors=[1.5,10,32].flatMap(h=>[-.12,0,.5,1].map(mu=>{
    const actual=gpu.draw(sampleEnvironment,2,1,{u_point:[0,0,6378.137+h],u_sun:[Math.sqrt(1-mu*mu),0,mu]},{u_lut:irradiance},true).pixels;
    const reference=gpu.draw('#define ATMOSPHERE_MAX_STEPS 128\n#define IRRADIANCE_POLAR_SAMPLES 64\n#define IRRADIANCE_AZIMUTH_SAMPLES 64\n#define IRRADIANCE_RAY_STEPS 128\n'+common+skyParameters+transport+irradianceSource.replace('void main(){','void lutMain(){')+`
      uniform float u_height,u_mu;void main(){out_FragColor=vec4(integrateSkyIrradiance(u_height,u_mu,gl_FragCoord.x>1.),1);}`,2,1,{...medium,u_height:h,u_mu:mu},{u_transmittance:lut,u_multiple:multi},true).pixels;
    let sq=0,den=0,maxAbsolute=0;for(let i=0;i<actual.length;i++)if(i%4!==3){sq+=(actual[i]-reference[i])**2;den+=reference[i]**2;maxAbsolute=Math.max(maxAbsolute,Math.abs(actual[i]-reference[i]));}
    return {height:h,mu,relativeRms:Math.sqrt(sq/Math.max(1e-10,den)),maxAbsolute,actual:Array.from(actual),reference:Array.from(reference)};
  }));
  checks.push({name:'diffuse sky cache agrees with 4096-direction / 128-step reference',pass:irradianceErrors.every(v=>v.relativeRms<.15),cases:irradianceErrors});
  const angularError=[16,32,64].map(polar=>({polar,values:Array.from(gpu.draw(`#define IRRADIANCE_POLAR_SAMPLES ${polar}\n`+common+skyParameters+transport+irradianceSource.replace('void main(){','void lutMain(){')+`
    void main(){out_FragColor=vec4(integrateSkyIrradiance(32.,-.12,gl_FragCoord.x>1.),1);}`,2,1,medium,{u_transmittance:lut,u_multiple:multi},true).pixels)}));
  const normalization=gpu.draw(common+skyParameters+`void integrateAtmosphereWithSun(vec3 p,vec3 d,float maximum,int steps,vec3 sun,out vec3 L,out vec3 T){L=vec3(1);T=vec3(1);}`+irradianceSource.replace('void main(){','void lutMain(){')+`
    void main(){out_FragColor=vec4(integrateSkyIrradiance(10.,.3,gl_FragCoord.x>1.),1);}`,2,1,{}, {},true).pixels;
  checks.push({name:'isotropic unit radiance normalizes diffuse irradiance to E/PI=1',pass:[normalization[0],normalization[4]].every(v=>Math.abs(v-1)<.02),actual:[normalization[0],normalization[4]]});
  let cacheGpuMs:number|null=null;
  if(query){for(let attempt=0;attempt<10&&!gl.getQueryParameter(query,gl.QUERY_RESULT_AVAILABLE);attempt++)await new Promise(resolve=>setTimeout(resolve,50));
    if(gl.getQueryParameter(query,gl.QUERY_RESULT_AVAILABLE)&&!gl.getParameter(timer.GPU_DISJOINT_EXT))cacheGpuMs=gl.getQueryParameter(query,gl.QUERY_RESULT)/1e6;
    gl.deleteQuery(query);}
  output.textContent=JSON.stringify({passed:checks.every(c=>c.pass),cacheGpuMs,angularError,checks},null,2);document.title=checks.every(c=>c.pass)?'PASS · Atmosphere GPU':'FAIL · Atmosphere GPU';
}catch(error){output.textContent=String(error);document.title='ERROR · Atmosphere GPU';}finally{gpu.destroy();}
