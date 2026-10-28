import {gpuProbe} from './gpuProbe';
import common from '../src/effects/hillaire-atmosphere/shaders/common.glsl?raw';
import atmosphere from '../src/effects/hillaire-atmosphere/shaders/integrate.glsl?raw';
import transmittance from '../src/effects/hillaire-atmosphere/shaders/transmittance.glsl?raw';
import multiple from '../src/effects/hillaire-atmosphere/shaders/multiple-scattering.glsl?raw';
import skyParameters from '../src/effects/hillaire-atmosphere/shaders/sky-view-parameters.glsl?raw';
import irradiance from '../src/effects/hillaire-atmosphere/shaders/sky-irradiance.glsl?raw';
import environment from '../src/effects/hillaire-atmosphere/shaders/sky-irradiance-sample.glsl?raw';
import lighting from '../src/effects/global-clouds/shaders/droplet-lighting.glsl?raw';
import intervals from '../src/effects/global-clouds/shaders/intervals.glsl?raw';
import march from '../src/effects/global-clouds/shaders/march.glsl?raw';
import transport from '../src/effects/global-clouds/shaders/transport.glsl?raw';
import resolve from '../src/effects/global-clouds/shaders/resolve.glsl?raw';
import storage from '../src/effects/global-clouds/shaders/storage.glsl?raw';
import quality from '../src/effects/global-clouds/shaders/quality.glsl?raw';
import composite from '../src/effects/hillaire-atmosphere/shaders/composite.glsl?raw';

const output=document.querySelector('#result')!,gpu=gpuProbe(document.querySelector('canvas')!);
try{
  const medium={u_medium:[1,1,1]},trans=gpu.draw(common+transmittance,256,64,medium).texture;
  const multi=gpu.draw(common+multiple,32,32,medium,{u_transmittance:trans}).texture;
  const sky=gpu.draw(common+skyParameters+atmosphere+irradiance,64,64,medium,{u_transmittance:trans,u_multiple:multi}).texture;
  const inputs={u_transmittance:trans,u_multiple:multi,u_skyIrradiance:sky};
  const globals=`uniform vec3 u_camera,u_ray,u_moon,u_boundary;
    uniform bool u_atmosphere;uniform float u_moonFraction,u_moonGain,u_pixelAngle,u_debugView;
    uniform float u_base,u_thickness,u_highBase,u_highThickness,u_coverage,u_density,u_highCoverage,u_highOpticalDepth,u_tau,u_maximum,u_steps,u_output;
    struct CloudPhases{vec3 sun;vec3 moon;};
    float debugFootprint=0.,debugPathLength=0.,debugWeather=0.,debugWeatherLength=0.;
    float profile(float h){return h<=0.||h>=1.?0.:30.*h*h*(1.-h)*(1.-h);}
    float cloudDensity(vec3 p,float footprint,bool coarse){float h=length(p)-Rg;return u_tau*profile((h-u_base)/u_thickness)/u_thickness+u_highOpticalDepth*profile((h-u_highBase)/u_highThickness)/u_highThickness;}
    vec3 cloudSource(vec3 L){return max(vec3(0),L);}`;
  const constantQuality='#define CLOUD_STEPS 64\n#define CLOUD_SUBSTEPS 3\n#define LIGHT_STEPS 5\n';
  const shared=common+atmosphere+globals+environment+lighting;
  const production=shared+intervals+transport+march.slice(march.indexOf('CloudSegment integrateCloud'),march.indexOf('void main()'))+`
    void main(){vec2 parts[4];int layers[4];cloudIntervals(u_camera,u_ray,u_maximum,parts,layers);
      vec4 acc=vec4(0);vec3 airL=vec3(0),airT=vec3(1);float cursor=0.;
      for(int i=0;i<4;i++)integrateCloudInterval(u_ray,parts[i],acc,airL,airT,cursor);
      out_FragColor=acc;}`;
  // This source intentionally contains NO cloudTransportStep, appendCloudSegment,
  // integrateCloud* or integrateAtmosphere call. Only optical source laws and LUT
  // lookups are shared. Full-ray extinction and source accumulation are independent.
  const reference=shared+`
    void main(){vec2 domain=atmosphereInterval(u_camera,u_ray,u_maximum);
      float a=domain.x,b=domain.y,ds=max(0.,b-a)/u_steps,cloudDepth=0.,cloudError=0.;
      vec3 L=vec3(0),T=vec3(1),clearL=vec3(0),clearT=vec3(1),depth=vec3(0),depthError=vec3(0),clearDepth=vec3(0),clearDepthError=vec3(0),Lerror=vec3(0),clearLerror=vec3(0);
      CloudPhases phases=scatteringPhases(u_ray);
      for(float i=0.;i<u_steps;i++){
        vec3 p=u_camera+u_ray*(a+(i+.5)*ds),airSource,e;atmosphereSource(p,u_ray,u_sun,airSource,e);
        float rho=cloudDensity(p,.02,false);vec3 source=rho>0.?cloudSource(illumination(p,rho,.02,phases)):vec3(0);
        vec3 k=e+rho,atten=exp(-k*ds),q=k*ds;
        vec3 w=mix((1.-atten)/max(k,vec3(1e-10)),ds*(1.-q*.5+q*q/6.),lessThan(q,vec3(.001)));
        // Compensated optical-depth sums avoid multiplying ~1 thousands of
        // times; float32 drift otherwise defeated reference self-convergence.
        vec3 value=T*(airSource+rho*source)*w-Lerror,next=L+value;Lerror=(next-L)-value;L=next;
        value=k*ds-depthError;next=depth+value;depthError=(next-depth)-value;depth=next;T=exp(-depth);
        float cv=rho*ds-cloudError,cn=cloudDepth+cv;cloudError=(cn-cloudDepth)-cv;cloudDepth=cn;
        vec3 ca=exp(-e*ds),ce=e*ds,cw=mix((1.-ca)/max(e,vec3(1e-10)),ds*(1.-ce*.5+ce*ce/6.),lessThan(ce,vec3(.001)));
        value=clearT*airSource*cw-clearLerror;next=clearL+value;clearLerror=(next-clearL)-value;clearL=next;
        value=e*ds-clearDepthError;next=clearDepth+value;clearDepthError=(next-clearDepth)-value;clearDepth=next;clearT=exp(-clearDepth);
      }
      if(u_output<.5)out_FragColor=vec4(L+T*u_boundary,exp(-cloudDepth));
      else if(u_output<1.5)out_FragColor=vec4(T,exp(-cloudDepth));
      else if(u_output<2.5)out_FragColor=vec4(clearL+clearT*u_boundary,1);
      else out_FragColor=vec4(clearT,1);
    }`;
  const linearResolve='#define CLOUD_HDR\n'+common+storage+`
    vec4 czm_viewport=vec4(0,0,1,1);vec4 czm_windowToEyeCoordinates(vec2 uv,float depth){return vec4(0,0,1,1);}
    vec3 cloudBackground(vec3 c){return c;}vec3 cloudDisplay(vec3 L){return L;}`+resolve;
  // Only the terminal input seam is linear: the actual Hillaire composite and
  // cloud resolve run unchanged. This isolates transport from Cesium's LDR
  // surface input, whose clipped highlights cannot represent a linear basis.
  const productionBackground='#define SKY_HDR\n'+common+skyParameters+atmosphere+`
    uniform vec3 u_ray;uniform float u_maximum;
    mat4 czm_inverseProjection=mat4(1),czm_inverseView;vec4 czm_viewport=vec4(0,0,1,1);
    vec4 czm_windowToEyeCoordinates(vec2 pixel,float z){vec3 wc=normalize(u_ray/vec3(1,1,1.00336409));return vec4(0,0,u_maximum/(.001*length(wc*vec3(1,1,1.00336409))),1);}
    vec3 recoverRadiance(vec3 boundary,float exposure){return boundary;}
    #define main atmosphereCompositeMain
    `+composite+`
    #undef main
    void main(){vec3 wc=normalize(u_ray/vec3(1,1,1.00336409));czm_inverseView=mat4(vec4(1,0,0,0),vec4(0,1,0,0),vec4(wc,0),vec4(0,0,0,1));atmosphereCompositeMain();}`;
  const norm=(v:number[])=>v.map(x=>x/Math.hypot(...v));
  const cases=[
    {name:'zero cloud',camera:[0,0,6378.937],ray:norm([1,0,.2]),tau:0,high:0,maximum:1000,sun:norm([1,0,.5])},
    {name:'single thin cloud / bright boundary',camera:[0,0,23378.137],ray:[0,0,-1],tau:.12,high:0,maximum:17000,sun:norm([1,0,.8])},
    {name:'two cloud layers',camera:[0,0,6398.137],ray:[0,0,-1],tau:.25,high:.08,maximum:20,sun:norm([1,0,.5])},
    {name:'inside partial column',camera:[0,0,6381.337],ray:norm([1,0,.3]),tau:.3,high:.06,maximum:1000,sun:norm([1,0,.1])},
    {name:'grazing finite shell',camera:[-300,0,6380.137],ray:[1,0,0],tau:.025,high:.015,maximum:600,sun:norm([1,0,.2])},
    {name:'sunset long path',camera:[0,0,6378.937],ray:norm([1,0,.02]),tau:.04,high:.02,maximum:1000,sun:norm([1,0,-.01])},
  ];
  const checks=[],backgroundChecks=[],qualityChecks=[];
  for(const c of cases){
    const uniforms={...medium,u_atmosphere:true,u_hasSkyIrradiance:true,u_base:1.5,u_thickness:3.8,u_highBase:9,u_highThickness:1.5,u_coverage:c.tau>0?1:0,u_density:1,u_highCoverage:c.high>0?1:0,
      u_highOpticalDepth:c.high,u_tau:c.tau,u_camera:c.camera,u_ray:c.ray,u_sun:c.sun,u_moon:[0,0,-1],u_moonFraction:0,u_moonGain:0,u_pixelAngle:0,u_debugView:0,u_maximum:c.maximum,u_boundary:[8,7,6],u_cloudSteps:64,u_lightSteps:5,u_cloudSubsteps:3,u_cloudIntervals:4,u_cloudRepresentations:2};
    const ref=(steps:number,mode:number)=>gpu.draw(constantQuality+reference,1,1,{...uniforms,u_steps:steps,u_output:mode},inputs,true);
    const low=ref(4096,0),high=ref(8192,0),background=ref(8192,2),referenceT=ref(8192,1),clearT=ref(8192,3);
    const cloud=gpu.draw(quality+production,1,1,uniforms,inputs,true),staticCloud=gpu.draw(constantQuality+production,1,1,uniforms,inputs,true);
    const actual=gpu.draw(linearResolve,1,1,{u_hasSkyRadiance:true,u_skyRadianceHdr:true,u_emptySceneDepth:true},{u_clouds:cloud.texture,u_skyRadiance:background.texture,colorTexture:background.texture,depthTexture:background.texture},true);
    const maxL=Math.max(...Array.from(actual.pixels.slice(0,3)).map((v,i)=>Math.abs(v-high.pixels[i]))),cloudT=1-cloud.pixels[3];
    const convergence=Math.max(...Array.from(low.pixels).map((v,i)=>Math.abs(v-high.pixels[i]))),Terror=Math.abs(cloudT-high.pixels[3]);
    const qualityError=Math.max(...Array.from(cloud.pixels).map((v,i)=>Math.abs(v-staticCloud.pixels[i])));
    // The six legacy controlled cases use a reference-generated clear backdrop.
    // This factorization check is NOT a measurement of production RGB T. Only
    // the independent terminal-basis images below measure that quantity.
    const referenceAirTimesMeasuredCloudT=Array.from(clearT.pixels.slice(0,3)).map(v=>v*cloudT),factorizationError=Math.max(...referenceAirTimesMeasuredCloudT.map((v,i)=>Math.abs(v-referenceT.pixels[i])));
    checks.push({name:c.name,pass:maxL<=.002&&Terror<=.002&&factorizationError<=.002&&convergence<=.0002&&qualityError<=.00001,linearRadiance:Array.from(actual.pixels.slice(0,3)),reference:Array.from(high.pixels),referenceAirTimesMeasuredCloudT,referenceRgbT:Array.from(referenceT.pixels.slice(0,3)),cloudT,maxRadianceError:maxL,cloudTransmissionError:Terror,factorizationError,referenceConvergence:convergence,staticDynamicQualityError:qualityError,conditions:c});
    if(backgroundChecks.length<4){
      const basis=[];
      for(const boundary of [[0,0,0],[1,1,1],[1,0,0],[0,1,0],[0,0,1]]){
        const terminal=gpu.draw('uniform vec3 u_boundary;void main(){out_FragColor=vec4(u_boundary,1);}',1,1,{u_boundary:boundary},{},true);
        const depth=gpu.draw('void main(){out_FragColor=vec4(.5);}',1,1,{},{}).texture;
        const backdrop=gpu.draw(productionBackground,1,1,{...uniforms,u_emptySceneDepth:false,u_exposure:8},{...inputs,colorTexture:terminal.texture,depthTexture:depth,u_skyView:sky,u_moonAlbedo:sky},true);
        const resolved=gpu.draw(linearResolve,1,1,{u_hasSkyRadiance:true,u_skyRadianceHdr:true,u_emptySceneDepth:true},{u_clouds:cloud.texture,u_skyRadiance:backdrop.texture,colorTexture:backdrop.texture,depthTexture:depth},true);
        basis.push(Array.from(resolved.pixels.slice(0,3)));
      }
      const L=basis[0],T=basis[1].map((v,i)=>v-L[i]);
      const referenceL=Array.from(gpu.draw(constantQuality+reference,1,1,{...uniforms,u_boundary:[0,0,0],u_steps:8192,u_output:0},inputs,true).pixels.slice(0,3));
      const referenceRgbT=Array.from(referenceT.pixels.slice(0,3));
      const maxLError=Math.max(...L.map((v,i)=>Math.abs(v-referenceL[i]))),maxTError=Math.max(...T.map((v,i)=>Math.abs(v-referenceRgbT[i])));
      const maxBasisResidual=Math.max(...basis.slice(2).flatMap((v,channel)=>v.map((x,i)=>Math.abs(x-L[i]-(i===channel?T[i]:0)))));
      backgroundChecks.push({name:c.name,pass:maxLError<=.002&&maxTError<=.002&&maxBasisResidual<=.00001,L,T,referenceL,referenceRgbT,maxLError,maxTError,maxBasisResidual,basis});
    }
    if(c.name==='inside partial column')for(const [name,steps,lights,substeps] of [['low',40,3,2],['medium',64,5,3],['high',96,7,4]] as const){
      const u={...uniforms,u_cloudSteps:steps,u_lightSteps:lights,u_cloudSubsteps:substeps};
      const dynamic=gpu.draw(quality+production,1,1,u,inputs,true).pixels;
      const fixed=gpu.draw(`#define CLOUD_STEPS ${steps}\n#define LIGHT_STEPS ${lights}\n#define CLOUD_SUBSTEPS ${substeps}\n`+production,1,1,u,inputs,true).pixels;
      const maxError=Math.max(...Array.from(dynamic).map((v,i)=>Math.abs(v-fixed[i])));
      qualityChecks.push({name,maxError,dynamic:Array.from(dynamic),fixed:Array.from(fixed),pass:maxError<=.00001});
    }
  }
  const passed=[...checks,...backgroundChecks,...qualityChecks].every(c=>c.pass);
  gpu.destroy();output.textContent=JSON.stringify({passed,checks,backgroundChecks,qualityChecks,reference:'4096/8192 midpoint full-ray integral; same source laws and real Hillaire LUTs, independent transport. Six controlled profiles preserved. Additional actual Hillaire composite/resolve L and RGB T are measured through five terminal basis images, without reference clearT. The terminal injection is linear; Cesium LDR highlight recovery and procedural weather variation are outside this controlled test.'},null,2);
  document.title=passed?'PASS · Cloud closure':'FAIL · Cloud closure';
}catch(e){output.textContent=String(e);document.title='ERROR · Cloud closure';}
