import {cloudProbe} from './cloudProbe';
import common from '../src/effects/hillaire-atmosphere/shaders/common.glsl?raw';
import density from '../src/effects/global-clouds/shaders/density.glsl?raw';
import voxel from '../src/effects/global-clouds/shaders/voxel.glsl?raw';
import transport from '../src/effects/hillaire-atmosphere/shaders/integrate.glsl?raw';
import environment from '../src/effects/hillaire-atmosphere/shaders/sky-irradiance-sample.glsl?raw';
import lighting from '../src/effects/global-clouds/shaders/droplet-lighting.glsl?raw';
import march from '../src/effects/global-clouds/shaders/march.glsl?raw';
import cloudTransport from '../src/effects/global-clouds/shaders/transport.glsl?raw';
interface TransitionRow {
  envelope:number;footprint:number;patch:number;
  actualLT:number[];referenceLT:number[];referenceCoarse:number[];
  Terror:number;Lerror:number;convergence:number;
}
const output=document.querySelector('#result')!;
const gpu=cloudProbe(document.querySelector<HTMLCanvasElement>('#probe')!);
try{
  const envelopeExperiment=new URLSearchParams(location.search).get('transition')==='envelope';
  // Test-only single-factor experiment: vary bank connectivity without changing
  // material statistics, march budget, filtering or illumination. Every variant
  // is compared with its own independently integrated point-ray reference.
  const densitySource=envelopeExperiment?('uniform float u_envelopeMix;\n'+density
    .replace('mix(.72,.55,type)', 'u_envelopeMix*mix(.72,.55,type)')
    .replace('mix(.61,.36,cover)-.035*(1.-type)', 'mix(mix(.76,.38,cover),mix(.61,.36,cover)-.035*(1.-type),u_envelopeMix)')):density;
  const footprint=17000*2*Math.tan(Math.PI/6)/(1080*.65);
  const header='#define LAYERED_CLOUDS\n#define LIGHT_STEPS 5\n#define CLOUD_STEPS 64\n#define CLOUD_SUBSTEPS 3\n'+common+transport+densitySource+voxel+
    'vec3 u_camera;uniform vec3 u_moon;uniform bool u_atmosphere;uniform float u_moonFraction,u_moonGain,u_pixelAngle,u_debugView;float debugFootprint=0.,debugPathLength=0.,debugWeather=0.,debugWeatherLength=0.;struct CloudPhases{vec3 sun;vec3 moon;};'+environment+lighting+
    'vec3 cloudSource(vec3 light){return light;}'+cloudTransport+march.slice(march.indexOf('CloudSegment integrateCloud'),march.indexOf('void main()'));
  const main=`uniform float u_grid,u_footprint,u_reference,u_steps,u_statistics,u_resolved;void main(){
    float patchIndex=floor((gl_FragCoord.x-.5)/u_grid);float lon=-1.7+patchIndex*.37,lat=.45+sin(patchIndex*1.7)*.6;
    vec3 n=vec3(cos(lat)*cos(lon),cos(lat)*sin(lon),sin(lat));
    vec3 east=vec3(-sin(lon),cos(lon),0),north=cross(n,east);
    vec2 uv=vec2(mod(gl_FragCoord.x-.5,u_grid),gl_FragCoord.y-.5);
    vec2 offset=((uv+.5)/u_grid-.5)*u_footprint;
    n=normalize(n*Rg+east*offset.x+north*offset.y);
    cloudScreenRight=east;cloudScreenUp=north;
    u_camera=n*(Rg+u_base+u_thickness+17000.);
    if(u_reference<.5){
      cloudRepresentation=u_resolved>.5?1:0;
      CloudSegment acc=integrateCloud(-n,vec2(17000.,17000.+u_thickness));
      out_FragColor=vec4(acc.L,acc.cloudT);
      if(u_statistics>.5)out_FragColor=vec4(farMoments.a,debugMipA,debugMipB,1.);
      return;
    }
    float T=1.;vec3 L=vec3(0);CloudPhases phases=scatteringPhases(-n);
    for(float j=0.;j<u_steps;j++){
      float h=1.-(j+.5)/u_steps,ds=u_thickness/u_steps;vec3 p=n*(Rg+u_base+h*u_thickness);
      float rho=u_reference>.5?lowCloudDensity(p,.02,false):cloudDensity(p,u_footprint,false);
      if(rho>0.){float a=1.-exp(-rho*ds);L+=T*a*illumination(p,rho,u_reference>.5?.02:u_footprint,phases);T*=1.-a;}
    }
    out_FragColor=vec4(L,T);
  }`;
  const sun=[-.2,-.8,.56].map(v=>v/Math.hypot(.2,.8,.56));
  const uniforms={...gpu.uniforms,u_steps:96,u_pixelAngle:footprint/17001.9,u_sun:sun,u_moon:sun.map(v=>-v),u_atmosphere:false,u_moonFraction:0,u_moonGain:0};
  const inputs={...gpu.inputs,u_cirrus:gpu.inputs.u_noise,u_transmittance:gpu.inputs.u_weather,u_multiple:gpu.inputs.u_weather,u_skyIrradiance:gpu.inputs.u_weather};
  if(new URLSearchParams(location.search).has('transition')){
    // Actual varying weather and voxel density. Independent high-step point
    // rays are averaged in linear L/T; no far/Q/cache helper makes the reference.
    // This is a model-accuracy diagnostic, separate from endpoint continuity.
    const rows:TransitionRow[]=[];
    for(const envelope of envelopeExperiment?[0,.25,.5,.75,1]:[1])for(const fp of [.35,.75,1.25,2.,4.]){
      const sampleUniforms={...uniforms,u_envelopeMix:envelope};
      const actual=gpu.draw(header+main,8,1,{...sampleUniforms,u_grid:1,u_footprint:fp,u_pixelAngle:fp/17001.9,u_reference:0},inputs,true).pixels;
      const references=[{grid:32,steps:96},{grid:64,steps:192}].map(config=>{
        const data=gpu.draw(header+main,config.grid*8,config.grid,{...sampleUniforms,u_grid:config.grid,u_steps:config.steps,u_footprint:fp,u_reference:1},inputs,true).pixels;
        return Array.from({length:8},(_,patch)=>Array.from({length:4},(_,c)=>{let sum=0;for(let y=0;y<config.grid;y++)for(let x=0;x<config.grid;x++)sum+=data[(y*config.grid*8+patch*config.grid+x)*4+c];return sum/config.grid**2;}));
      });
      for(let patch=0;patch<8;patch++){const a=Array.from(actual.slice(patch*4,patch*4+4)),r=references[1][patch],convergence=Math.max(...r.map((v,c)=>Math.abs(v-references[0][patch][c])));rows.push({envelope,footprint:fp,patch,actualLT:a,referenceLT:r,referenceCoarse:references[0][patch],Terror:Math.abs(a[3]-r[3]),Lerror:Math.hypot(...a.slice(0,3).map((v,c)=>v-r[c])),convergence});}
    }
    const quadrature=[];
    if(new URLSearchParams(location.search).get('transition')==='quadrature'){
      // Controlled experiment only: average completed resolved L/T at subpixel
      // footprints. This deliberately retains the production mip choice for
      // each subpixel, rather than locking LOD0 or averaging density. Measure
      // whether a small bounded rule can replace the biased local filter before
      // considering its substantial per-pixel march/shadow cost in production.
      for(const fp of [.35,.75,1.25,2.,4.])for(const grid of [1,3,5,9]){
        const pixels=gpu.draw(header+main,grid*8,grid,{...uniforms,u_grid:grid,u_footprint:fp,u_pixelAngle:fp/(17001.9*grid),u_reference:0,u_resolved:1},inputs,true).pixels;
        const cases=Array.from({length:8},(_,patch)=>{
          const mean=Array.from({length:4},(_,c)=>{let sum=0;for(let y=0;y<grid;y++)for(let x=0;x<grid;x++)sum+=pixels[(y*grid*8+patch*grid+x)*4+c];return sum/grid**2;});
          const reference=rows.find(r=>r.footprint===fp&&r.patch===patch)!.referenceLT;
          return {patch,LT:mean,Terror:Math.abs(mean[3]-reference[3]),Lerror:Math.hypot(...mean.slice(0,3).map((v,c)=>v-reference[c]))};
        });
        quadrature.push({footprint:fp,grid,resolvedRays:grid*grid,cases});
      }
    }
    output.textContent=JSON.stringify({complete:true,kind:'Independent point-ray average across the real representation band; diagnostic, not the .02 same-far-model spatial gate',reference:'32² x 96 and 64² x 192',rows,quadrature},null,2);
  }else{
  const grid=64;
  const reference=gpu.draw(header+main,grid*8,grid,{...uniforms,u_grid:grid,u_footprint:footprint,u_reference:1},inputs,true).pixels;
  const actual=gpu.draw(header+main,8,1,{...uniforms,u_grid:1,u_footprint:footprint,u_reference:0},inputs,true).pixels;
  const statistics=gpu.draw(header+main,8,1,{...uniforms,u_grid:1,u_footprint:footprint,u_reference:0,u_statistics:1},inputs,true).pixels;
  const patches=Array.from({length:8},(_,patch)=>{
    const mean=[0,0,0,0];let coverage=0;
    for(let y=0;y<grid;y++)for(let x=0;x<grid;x++){
      const i=(y*grid*8+patch*grid+x)*4;
      for(let c=0;c<4;c++)mean[c]+=reference[i+c]/(grid*grid);
      coverage+=Number(reference[i+3]<.9)/(grid*grid);
    }
    const candidate=Array.from(actual.slice(patch*4,patch*4+4));
    return {patch,referenceLT:mean,coverage,actualCoverage:statistics[patch*4],coverageError:Math.abs(statistics[patch*4]-coverage),actualLT:candidate,transmissionError:Math.abs(candidate[3]-mean[3]),radianceError:Math.hypot(...candidate.slice(0,3).map((v,c)=>v-mean[c]))};
  });
  if(new URLSearchParams(location.search).has('quick')){
    output.textContent=JSON.stringify({scope:'Exploratory medium-only radiance check; full acceptance still required',patches},null,2);
  }else{
  const convergence=[{grid:64,steps:192},{grid:128,steps:96}].map(config=>{
    const data=gpu.draw(header+main,config.grid*8,config.grid,{...uniforms,u_steps:config.steps,u_grid:config.grid,u_footprint:footprint,u_reference:1},inputs,true).pixels;
    let maxMeanDelta=0;
    for(let patch=0;patch<8;patch++)for(let c=0;c<4;c++){
      let mean=0;for(let y=0;y<config.grid;y++)for(let x=0;x<config.grid;x++)mean+=data[(y*config.grid*8+patch*config.grid+x)*4+c]/config.grid**2;
      maxMeanDelta=Math.max(maxMeanDelta,Math.abs(mean-patches[patch].referenceLT[c]));
    }
    return {...config,maxMeanDelta};
  });
  const transitionFootprints=[.3499,.3501,.5,.75,1,1.25,1.5,1.75,1.9999,2.0001,3.9999,4.0001,11.9999,12.0001];
  const transition=transitionFootprints.map(fp=>({footprint:fp,LT:Array.from(gpu.draw(header+main,8,1,{...uniforms,u_grid:1,u_footprint:fp,u_pixelAngle:fp/17001.9,u_reference:0},inputs,true).pixels)}));
  const endpointDelta=Math.max(...[0,8,10,12].flatMap(index=>transition[index].LT.map((v,i)=>Math.abs(v-transition[index+1].LT[i]))));
  const qualities=[['low',.5,40,3,2],['medium',.65,64,5,3],['high',1,96,7,4]] as const;
  const qualityComparisons=qualities.map(([quality,scale,steps,lightSteps,substeps])=>{
    const fp=footprint*.65/scale;
    const source=header.replace('#define CLOUD_STEPS 64',`#define CLOUD_STEPS ${steps}`).replace('#define LIGHT_STEPS 5',`#define LIGHT_STEPS ${lightSteps}`).replace('#define CLOUD_SUBSTEPS 3',`#define CLOUD_SUBSTEPS ${substeps}`)+main;
    const candidate=gpu.draw(source,8,1,{...uniforms,u_grid:1,u_footprint:fp,u_pixelAngle:fp/17001.9,u_reference:0},inputs,true).pixels;
    const reference=gpu.draw(header+main,grid*8,grid,{...uniforms,u_grid:grid,u_footprint:fp,u_reference:1},inputs,true).pixels;
    let maxTError=0,maxLError=0;
    for(let patch=0;patch<8;patch++){
      const mean=[0,0,0,0];for(let y=0;y<grid;y++)for(let x=0;x<grid;x++)for(let c=0;c<4;c++)mean[c]+=reference[(y*grid*8+patch*grid+x)*4+c]/(grid*grid);
      maxTError=Math.max(maxTError,Math.abs(candidate[patch*4+3]-mean[3]));maxLError=Math.max(maxLError,Math.hypot(...mean.slice(0,3).map((v,c)=>v-candidate[patch*4+c])));
    }
    return {quality,footprintKm:fp,maxTError,maxLError};
  });
  const continuitySource=header+`uniform float u_case;void main(){
    float index=floor(gl_FragCoord.x),pair=floor(index/2.),side=mod(index,2.)*2.-1.;
    float lon=mix(-PI,PI,(pair+.5)/64.),lat=asin(.9)+side*.000001;
    if(u_case==1.){lon=side*PI;lat=mix(-1.5,1.5,(pair+.5)/64.);}
    if(u_case==2.){lon=side*PI;lat=PI*.5-.000001;}
    vec3 n=vec3(cos(lat)*cos(lon),cos(lat)*sin(lon),sin(lat));
    cloudRay=-n;cloudScreenRight=vec3(1,0,0);cloudScreenUp=vec3(0,1,0);
    float rho=farCloudDensity(n*(Rg+u_base+.2),28.);
    out_FragColor=vec4(farMoments.ra,farTop,rho);
  }`;
  const fieldContinuity=[0,1,2].map(testCase=>{
    const data=gpu.draw(continuitySource,128,1,{...uniforms,u_case:testCase},inputs,true).pixels;
    let delta=0;for(let pair=0;pair<64;pair++)for(let c=0;c<4;c++)delta=Math.max(delta,Math.abs(data[pair*8+c]-data[pair*8+4+c]));
    return {case:['polar tangent-frame boundary','dateline','north pole'][testCase],maxDelta:delta};
  });
  const checks=[{name:'17000 km / fovy 60 / 1080px / scale .65 reaches the 1-cubed voxel mips',pass:footprint>27&&footprint<29,footprintKm:footprint,mips:[7.83,13.57].map(scale=>Math.min(7,Math.log2(footprint*128/scale)))},
    {name:'local far columns agree with supersampled near-medium transmission (absolute error < .05)',pass:patches.every(p=>p.transmissionError<.05),patches},
    {name:'supersampled reference converges under doubled spatial/vertical resolution',pass:convergence.every(c=>c.maxMeanDelta<.01),convergence},
    {name:'downsampled cloudy area agrees with conditional P(T<.9) (absolute error < .05)',pass:patches.every(p=>p.coverageError<.05)},
    {name:'far density and illumination do not fetch collapsed voxel mips',pass:Array.from(statistics).every((v,i)=>i%4!==1&&i%4!==2||v===-1)},
    {name:'production L/T integration and nested spatial quadrature have continuous endpoints',pass:endpointDelta<.01,maxLTDelta:endpointDelta,transition},
    {name:'each quality filters the same weather against its own pixel reference',pass:qualityComparisons.every(q=>q.maxTError<.06&&q.maxLError<.01),qualityComparisons},
    {name:'final filtered field remains continuous at polar frames and longitude seam',pass:fieldContinuity.every(c=>c.maxDelta<.003),fieldContinuity}];
  output.textContent=JSON.stringify({passed:checks.every(c=>c.pass),initializationMs:gpu.initializationMs,reference:{grid,steps:96},checks},null,2);
  document.title=checks.every(c=>c.pass)?'PASS · Satellite LOD':'FAIL · Satellite LOD';
  }
  }
}catch(error){output.textContent=String(error);document.title='ERROR · Satellite LOD';}finally{gpu.destroy();}
