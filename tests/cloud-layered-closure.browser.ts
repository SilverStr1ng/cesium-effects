import {cloudProbe} from './cloudProbe';
import common from '../src/effects/hillaire-atmosphere/shaders/common.glsl?raw';
import atmosphere from '../src/effects/hillaire-atmosphere/shaders/integrate.glsl?raw';
import transmittance from '../src/effects/hillaire-atmosphere/shaders/transmittance.glsl?raw';
import multiple from '../src/effects/hillaire-atmosphere/shaders/multiple-scattering.glsl?raw';
import skyParameters from '../src/effects/hillaire-atmosphere/shaders/sky-view-parameters.glsl?raw';
import irradiance from '../src/effects/hillaire-atmosphere/shaders/sky-irradiance.glsl?raw';
import environment from '../src/effects/hillaire-atmosphere/shaders/sky-irradiance-sample.glsl?raw';
import composite from '../src/effects/hillaire-atmosphere/shaders/composite.glsl?raw';
import density from '../src/effects/global-clouds/shaders/density.glsl?raw';
import voxel from '../src/effects/global-clouds/shaders/voxel.glsl?raw';
import lighting from '../src/effects/global-clouds/shaders/droplet-lighting.glsl?raw';
import intervals from '../src/effects/global-clouds/shaders/intervals.glsl?raw';
import march from '../src/effects/global-clouds/shaders/march.glsl?raw';
import transport from '../src/effects/global-clouds/shaders/transport.glsl?raw';
import resolve from '../src/effects/global-clouds/shaders/resolve.glsl?raw';
import storage from '../src/effects/global-clouds/shaders/storage.glsl?raw';
import quality from '../src/effects/global-clouds/shaders/quality.glsl?raw';
const output=document.querySelector('#result')!;
try{
  const gpu=cloudProbe(document.querySelector('canvas')!),gl=gpu.gl,checks=[];
  const white=gl.createTexture()!;gl.bindTexture(gl.TEXTURE_3D,white);gl.texImage3D(gl.TEXTURE_3D,0,gl.RGBA8,1,1,1,0,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array([255,255,255,255]));
  for(const p of [gl.TEXTURE_MIN_FILTER,gl.TEXTURE_MAG_FILTER])gl.texParameteri(gl.TEXTURE_3D,p,gl.LINEAR);
  const weather=gl.createTexture()!;gl.bindTexture(gl.TEXTURE_2D,weather);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA8,1,1,0,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array([255,128,128,128]));
  for(const p of [gl.TEXTURE_MIN_FILTER,gl.TEXTURE_MAG_FILTER])gl.texParameteri(gl.TEXTURE_2D,p,gl.LINEAR);
  const medium={u_medium:[1,1,1]},trans=gpu.draw(common+transmittance,256,64,medium).texture;
  const multi=gpu.draw(common+multiple,32,32,medium,{u_transmittance:trans}).texture;
  const sky=gpu.draw(common+skyParameters+atmosphere+irradiance,64,64,medium,{u_transmittance:trans,u_multiple:multi}).texture;
  const inputs={...gpu.inputs,u_weather:weather,u_noise:{texture:white,target:gl.TEXTURE_3D},u_cirrus:{texture:white,target:gl.TEXTURE_3D},u_transmittance:trans,u_multiple:multi,u_skyIrradiance:sky};
  const globals=`uniform vec3 u_camera,u_ray,u_moon;uniform float u_maximum,u_pixelAngle,u_moonFraction,u_moonGain,u_debugView,u_steps,u_output;
    uniform bool u_atmosphere;struct CloudPhases{vec3 sun;vec3 moon;};
    float debugFootprint=0.,debugPathLength=0.,debugWeather=0.,debugWeatherLength=0.;vec3 cloudSource(vec3 x){return max(vec3(0),x);}`;
  const shared='#define LAYERED_CLOUDS\n'+quality+common+atmosphere+density+voxel+globals+environment+lighting;
  const production=shared+intervals+transport+march.slice(march.indexOf('CloudSegment integrateCloud'),march.indexOf('void main()'))+`
    void main(){cloudScreenRight=vec3(1,0,0);cloudScreenUp=vec3(0,1,0);vec2 parts[4];int layers[4];cloudIntervals(u_camera,u_ray,u_maximum,parts,layers);
      vec4 acc=vec4(0);vec3 airL=vec3(0),airT=vec3(1);float cursor=0.;
      for(int i=0;i<4;i++){cloudLayer=layers[i];integrateCloudInterval(u_ray,parts[i],acc,airL,airT,cursor);}out_FragColor=acc;}`;
  // One pixel per independent optical component, plus its exact empty weight.
  // Full-ray transport below never calls the tested cloud/air transport helpers.
  const reference=shared+`
    float lowProfile(vec3 p){float height=u_thickness*.94,h=(length(p)-Rg-u_base-u_thickness*.06)/height;return h<=0.||h>=1.?0.:12.*h*(1.-h)*(1.-h)/height;}
    float residualProfile(vec3 p){float h=(length(p)-Rg-u_base)/u_thickness;return h<=0.||h>=1.?0.:12.*h*(1.-h)*(1.-h)/u_thickness;}
    void main(){int k=int(gl_FragCoord.x);float weight=1.,tau=0.,voxelInterior=0.;
      if(k<8){vec4 c=texture(u_cloudComponents,vec3(.5/32.,31.5/32.,(float(k)+.5)/8.));weight=c.b*255./256.;tau=(exp((c.r*65280.+c.g*255.)/65535.*log(65.))-1.)*u_density*u_thickness/3.8*.12;voxelInterior=c.a;}
      else{for(int j=0;j<8;j++)weight-=texture(u_cloudComponents,vec3(.5/32.,31.5/32.,(float(j)+.5)/8.)).b*255./256.;}
      vec2 path=atmosphereInterval(u_camera,u_ray,u_maximum);float ds=max(0.,path.y-path.x)/u_steps;vec3 L=vec3(0),depth=vec3(0),error=vec3(0),sumError=vec3(0);
      CloudPhases phases=CloudPhases(waterPhases(dot(u_ray,u_sun)),vec3(0));
      for(float j=0.;j<u_steps;j++){
        vec3 p=u_camera+u_ray*(path.x+(j+.5)*ds),air,e;atmosphereSource(p,u_ray,u_sun,air,e);
        float bodyTau=2.7*u_thickness*u_density,bodyRho=bodyTau*lowProfile(p),rho=bodyRho+tau*residualProfile(p),hi=(length(p)-Rg-u_highBase)/u_highThickness;
        float ice=hi<=0.||hi>=1.?0.:u_highOpticalDepth*30.*hi*hi*(1.-hi)*(1.-hi)/u_highThickness;
        vec3 source=vec3(0);
        if(rho>0.){
          float shadow=0.;for(int z=0;z<32;z++){vec3 q=p+u_sun*((float(z)+.5)*1.5/32.);shadow+=(bodyTau*lowProfile(q)+tau*residualProfile(q))*1.5/32.;}
          float h=clamp((length(p)-Rg-u_base)/u_thickness,0.,1.);vec3 zenith,horizon;cloudEnvironment(p,zenith,horizon);
          // Independently state the resolved material's source law. The
          // per-component reference never calls farResponseIllumination.
          float bodyDepth=max(0.,min(length(p)-Rg-u_base-u_thickness*.06,Rg+u_base+u_thickness-length(p)));
          float bodyInterior=(1.-exp(-3.*bodyDepth))*smoothstep(.1,3.,bodyRho);
          float inside=mix(voxelInterior,bodyInterior,bodyRho/max(1e-8,rho));
          float probability=.18+.82*inside,forward=smoothstep(.35,.95,dot(u_ray,u_sun));
          vec3 orderDepth=vec3(1.,.55-.23*forward*inside,.28-.16*forward*inside);
          vec3 light=sunTransmission(u_transmittance,p,u_sun)*vec3(1.6,1.55,1.47)*dot(phases.sun*vec3(1.,.5*probability,.25*probability),exp(-shadow*orderDepth))*mix(.8,1.,smoothstep(0.,.15,h));
          light+=mix(mix(zenith,horizon,.35),zenith,sqrt(h))*.48*mix(1.,.55,inside);
          light+=vec3(.015,.017,.019)*max(0.,dot(normalize(p),u_sun))*(1.-h);source+=rho*light;
        }
        if(ice>0.){highLocalTau=u_highOpticalDepth;CloudPhases phase=CloudPhases(vec3(waterPhase(dot(u_ray,u_sun),u_highAnisotropy),0,0),vec3(0));source+=ice*iceIllumination(p,phase);}
        vec3 extinction=e+rho+ice,delta=extinction*ds,atten=exp(-delta),w=mix((1.-atten)/max(vec3(1e-10),extinction),ds*(1.-delta*.5+delta*delta/6.),lessThan(delta,vec3(.001)));
        vec3 value=exp(-depth)*(air+source)*w-sumError,next=L+value;sumError=(next-L)-value;L=next;
        value=delta-error;next=depth+value;error=(next-depth)-value;depth=next;
      }
      out_FragColor=vec4(weight*(u_output<.5?L:exp(-depth)),weight);
    }`;
  const background='#define SKY_HDR\n'+common+skyParameters+atmosphere+`
    uniform vec3 u_ray;uniform float u_maximum;mat4 czm_inverseProjection=mat4(1),czm_inverseView;vec4 czm_viewport=vec4(0,0,1,1);
    vec4 czm_windowToEyeCoordinates(vec2 pixel,float z){vec3 wc=normalize(u_ray/vec3(1,1,1.00336409));return vec4(0,0,u_maximum/(.001*length(wc*vec3(1,1,1.00336409))),1);}
    vec3 recoverRadiance(vec3 x,float exposure){return x;}
    #define main atmosphereMain
    `+composite+`
    #undef main
    void main(){vec3 wc=normalize(u_ray/vec3(1,1,1.00336409));czm_inverseView=mat4(vec4(1,0,0,0),vec4(0,1,0,0),vec4(wc,0),vec4(0,0,0,1));atmosphereMain();}`;
  const resolver='#define CLOUD_HDR\n'+common+storage+`vec4 czm_viewport=vec4(0,0,1,1);vec4 czm_windowToEyeCoordinates(vec2 p,float z){return vec4(0,0,1,1);}vec3 cloudBackground(vec3 x){return x;}vec3 cloudDisplay(vec3 x){return x;}`+resolve;
  for(const c of [{name:'zero',height:20,ray:-1,density:0,ice:0,maximum:20},{name:'bright background thin main cloud',height:20,ray:-1,density:.015,ice:0,maximum:20},{name:'two layers',height:20,ray:-1,density:.03,ice:.08,maximum:20},{name:'inside partial column',height:3.4,ray:1,density:.08,ice:.03,maximum:100}]){
    const u={...gpu.uniforms,...medium,u_camera:[0,0,6378.137+c.height],u_ray:[0,0,c.ray],u_sun:[.6,0,.8],u_moon:[0,0,-1],u_moonFraction:0,u_moonGain:0,u_atmosphere:true,u_hasSkyIrradiance:true,u_coverage:1,u_density:c.density,u_cloudType:3,u_highType:1,u_highCoverage:c.ice>0?1:0,u_highOpticalDepth:c.ice,u_maximum:c.maximum,u_pixelAngle:10,u_debugView:0,u_cloudSteps:64,u_lightSteps:5,u_cloudSubsteps:3,u_cloudIntervals:4,u_cloudRepresentations:2};
    const acc=gpu.draw(production,1,1,u,inputs,true),basis=[];
    for(const color of [[0,0,0],[1,1,1],[1,0,0],[0,1,0],[0,0,1]]){
      const terminal=gpu.draw('uniform vec3 u_color;void main(){out_FragColor=vec4(u_color,1);}',1,1,{u_color:color},{},true).texture;
      const depth=gpu.draw('void main(){out_FragColor=vec4(.5);}',1,1,{},{}).texture;
      const bg=gpu.draw(background,1,1,{...u,u_emptySceneDepth:false,u_exposure:8},{...inputs,colorTexture:terminal,depthTexture:depth,u_skyView:sky,u_moonAlbedo:sky},true).texture;
      basis.push(Array.from(gpu.draw(resolver,1,1,{u_hasSkyRadiance:true,u_skyRadianceHdr:true,u_emptySceneDepth:true},{u_clouds:acc.texture,u_skyRadiance:bg,colorTexture:bg,depthTexture:depth},true).pixels.slice(0,3)));
    }
    const ref=(steps:number,mode:number)=>{const p=gpu.draw(reference,9,1,{...u,u_steps:steps,u_output:mode},inputs,true).pixels;return [0,1,2].map(channel=>{let sum=0;for(let k=0;k<9;k++)sum+=p[k*4+channel];return sum;});};
    const L=basis[0],T=basis[1].map((v,i)=>v-L[i]),referenceL=ref(4096,0),referenceT=ref(4096,1),coarseL=ref(2048,0),coarseT=ref(2048,1);
    const max=(a:number[],b:number[])=>Math.max(...a.map((v,i)=>Math.abs(v-b[i]))),maxL=max(L,referenceL),maxT=max(T,referenceT),convergence=Math.max(max(referenceL,coarseL),max(referenceT,coarseT));
    checks.push({name:c.name,conditions:c,L,T,referenceL,referenceT,maxL,maxT,convergence,basis,pass:maxL<=.002&&maxT<=.002&&convergence<=.0002});
  }
  gl.deleteTexture(white);gl.deleteTexture(weather);gpu.destroy();output.textContent=JSON.stringify({passed:checks.every(c=>c.pass),checks,scope:'Actual layered integrateCloudInterval → appendCloudSegment → Hillaire composite → resolve. Constant weather/noise isolates statistical transport while retaining actual material components and ice laws. Reference integrates each positive/empty component independently over the whole air/cloud ray (2048/4096), then sums L/T; no tested transport helpers. Terminal injection is linear and five basis images independently extract production RGB T. This does not validate spatially varying weather or recover clipped Cesium LDR.'},null,2);document.title=checks.every(c=>c.pass)?'PASS · Layered closure':'FAIL · Layered closure';
}catch(error){output.textContent=String(error);document.title='ERROR · Layered closure';}
