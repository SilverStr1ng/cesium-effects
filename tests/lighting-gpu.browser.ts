import {gpuProbe} from './gpuProbe';
import common from '../src/effects/hillaire-atmosphere/shaders/common.glsl?raw';
import transport from '../src/effects/hillaire-atmosphere/shaders/integrate.glsl?raw';
import transmission from '../src/effects/hillaire-atmosphere/shaders/transmittance.glsl?raw';
import multiple from '../src/effects/hillaire-atmosphere/shaders/multiple-scattering.glsl?raw';
import skyParameters from '../src/effects/hillaire-atmosphere/shaders/sky-view-parameters.glsl?raw';
import irradianceSource from '../src/effects/hillaire-atmosphere/shaders/sky-irradiance.glsl?raw';
import irradianceSample from '../src/effects/hillaire-atmosphere/shaders/sky-irradiance-sample.glsl?raw';
import composite from '../src/effects/hillaire-atmosphere/shaders/composite.glsl?raw';
import lighting from '../src/effects/global-clouds/shaders/droplet-lighting.glsl?raw';
import voxel from '../src/effects/global-clouds/shaders/voxel.glsl?raw';
import resolve from '../src/effects/global-clouds/shaders/resolve.glsl?raw';
import storage from '../src/effects/global-clouds/shaders/storage.glsl?raw';
import radiometry from '../src/effects/global-clouds/shaders/radiometry.glsl?raw';
import display from '../src/scene/display.glsl?raw';
import march from '../src/effects/global-clouds/shaders/march.glsl?raw';
import cloudTransport from '../src/effects/global-clouds/shaders/transport.glsl?raw';
import intervals from '../src/effects/global-clouds/shaders/intervals.glsl?raw';

const output=document.querySelector('#result')!;
const gpu=gpuProbe(document.querySelector<HTMLCanvasElement>('#probe')!);
try{
  const checks:{name:string;pass:boolean;[key:string]:unknown}[]=[];
  const medium={u_medium:[1,1,1]};
  const lut=gpu.draw(common+transmission,256,64,medium).texture;
  const multi=gpu.draw(common+multiple,32,32,medium,{u_transmittance:lut}).texture;
  const irradiance=gpu.draw(common+skyParameters+transport+irradianceSource,64,64,medium,{u_transmittance:lut,u_multiple:multi}).texture;
  const globals=`uniform bool u_atmosphere;uniform vec3 u_camera,u_moon;
    uniform float u_base,u_thickness,u_moonFraction,u_moonGain;
    struct CloudPhases {vec3 sun;vec3 moon;};
    float cloudDensity(vec3 p,float footprint,bool coarse){return 0.;}`;
  const source='#define LIGHT_STEPS 5\n'+common+transport+irradianceSample+globals+lighting;
  const inputs={u_transmittance:lut,u_multiple:multi,u_skyIrradiance:irradiance};
  const uniforms={...medium,u_atmosphere:true,u_hasSkyIrradiance:true,u_sun:[1,0,0],u_moon:[0,0,-1],u_moonFraction:0,u_moonGain:1,u_base:1.5,u_thickness:3.8};
  const worldFixture=`void main(){float mu=mix(-.2,.8,(gl_FragCoord.x-.5)/63.);vec3 p=vec3(mu,0,sqrt(1.-mu*mu))*(Rg+3.);
    vec3 sky,horizon;cloudEnvironment(p,sky,horizon);out_FragColor=vec4(sky+horizon,1);}`;
  const cameras=[[0,0,6378.937],[0,0,23378.137],[-17000,14000,-9000]];
  const environments=cameras.map(camera=>gpu.draw(source+worldFixture,64,1,{...uniforms,u_camera:camera},inputs,true).pixels);
  let environmentDelta=0;for(const values of environments)for(let i=0;i<values.length;i++)environmentDelta=Math.max(environmentDelta,Math.abs(values[i]-environments[0][i]));
  const day=environments[0][63*4],night=environments[0][0];
  checks.push({name:'fixed world points keep identical sky irradiance under three ground/space cameras',pass:environmentDelta===0&&day>night*20,maximumDelta:environmentDelta,day,night});
  const zeniths=[-.12,-.04,.5].map(mu=>{
    const sun=[Math.sqrt(1-mu*mu),0,mu];
    const first=gpu.draw(source+`void main(){vec3 s,h;cloudEnvironment(vec3(0,0,Rg+10.),s,h);out_FragColor=vec4(s+h,1);}`,1,1,{...uniforms,u_sun:sun},inputs,true).pixels;
    // Rotate the entire atmosphere/light pair 90 degrees about Y.
    const second=gpu.draw(source+`void main(){vec3 s,h;cloudEnvironment(vec3(Rg+10.,0,0),s,h);out_FragColor=vec4(s+h,1);}`,1,1,{...uniforms,u_sun:[mu,0,-sun[0]]},inputs,true).pixels;
    return Math.max(...Array.from(first).map((v,i)=>Math.abs(v-second[i])));
  });
  checks.push({name:'local normal and solar zenith are rotationally invariant',pass:zeniths.every(e=>e<1e-7),errors:zeniths});
  const visibilityFixture=`uniform float u_height;void main(){vec3 p=vec3(0,0,Rg+u_height);CloudPhases phases=scatteringPhases(vec3(1,0,0));out_FragColor=vec4(illumination(p,.2,.01,phases),1);}`;
  const response=(height:number,sun:number[],moon:number[],moonGain:number)=>Array.from(gpu.draw(source+visibilityFixture,1,1,
    {...uniforms,u_atmosphere:false,u_hasSkyIrradiance:false,u_height:height,u_base:height-1,u_thickness:2,u_sun:sun,u_moon:moon,u_moonFraction:1,u_moonGain:moonGain,u_camera:[0,0,6378.937]},inputs,true).pixels).slice(0,3);
  const direction=(mu:number)=>[Math.sqrt(1-mu*mu),0,mu];
  const sunHigh=response(32,direction(-.09),[0,0,-1],0),sunBlocked=response(1,direction(-.09),[0,0,-1],0);
  const moonHigh=response(10,[0,0,-1],direction(-.04),1),moonBlocked=response(1,[0,0,-1],direction(-.04),1),moonOff=response(10,[0,0,-1],direction(-.04),0);
  checks.push({name:'high-altitude sunlight and moonlight survive negative local elevation until Earth occludes them',pass:sunHigh[0]>sunBlocked[0]+.01&&moonHigh[0]>moonOff[0]+.001&&moonBlocked.every(v=>v===0),sunHigh,sunBlocked,moonHigh,moonBlocked,moonOff});

  const gl=gpu.gl,voxels=gl.createTexture()!;gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_3D,voxels);
  const bytes=new Uint8Array(2*2*2*4);for(let i=0;i<8;i++)bytes.set([i%2===0?64:255,0,128,255],i*4);
  gl.texImage3D(gl.TEXTURE_3D,0,gl.RGBA8,2,2,2,0,gl.RGBA,gl.UNSIGNED_BYTE,bytes);
  for(const p of [gl.TEXTURE_WRAP_S,gl.TEXTURE_WRAP_T,gl.TEXTURE_WRAP_R])gl.texParameteri(gl.TEXTURE_3D,p,gl.REPEAT);
  for(const p of [gl.TEXTURE_MIN_FILTER,gl.TEXTURE_MAG_FILTER])gl.texParameteri(gl.TEXTURE_3D,p,gl.NEAREST);
  const voxelFixture=common+`uniform sampler3D u_voxels;uniform bool u_voxelReady,u_skipVoxels;uniform float u_seed,u_evolution,u_base,u_thickness;
    int cloudLayer=0;vec3 advect(vec3 p){return p;}float farCloudWeight(float footprint){return 0.;}`+voxel+`
    void main(){vec3 p=vec3(gl_FragCoord.x*.017,0,Rg+u_base+10.);vec3 q=voxelPosition(p);
      float a=voxelAt(q+u_seed*.23,7.83,.01).r,b=voxelAt(voxelRotate(q)+u_seed*.31,13.57,.01).r;
      out_FragColor=vec4(voxelBodyDepth(p,.01),a>b*.8?0.:1.,0,1);}`;
  const depths=gpu.draw(voxelFixture,512,1,{u_voxelReady:true,u_base:20,u_thickness:40,u_seed:13,u_evolution:0},{u_voxels:{texture:voxels,target:gl.TEXTURE_3D}},true).pixels;
  let depthError=0,countA=0,countB=0;for(let i=0;i<512;i++){const b=depths[i*4+1]>.5;b?countB++:countA++;depthError=Math.max(depthError,Math.abs(depths[i*4]-(128/255)*(16/128)*(b?13.57:7.83)));}
  gl.deleteTexture(voxels);
  checks.push({name:'both voxel domains convert internal depth to their own kilometre scale',pass:depthError<1e-5&&countA>0&&countB>0,depthError,countA,countB});

  const black=gpu.draw('void main(){out_FragColor=vec4(0,0,0,1);}',1,1).texture;
  const white=gpu.draw('void main(){out_FragColor=vec4(1);}',1,1).texture;
  // A small angular pixel fully inside the solar disc; a 90-degree 1x1 probe
  // would correctly integrate the subpixel disc AA instead of its peak radiance.
  const cesium=`const mat4 czm_inverseProjection=mat4(.001,0,0,0,0,.001,0,0,0,0,1,0,0,0,0,1),czm_inverseView=mat4(1);const vec4 czm_viewport=vec4(0,0,1,1);
    vec4 czm_windowToEyeCoordinates(vec2 uv,float depth){return vec4(0,0,1,1);}`;
  const solarUniforms={u_camera:[0,0,23378.137],u_medium:[0,0,0],u_sun:[0,0,1],u_sunDisc:[0,0,1],u_sunRadius:.01302,
    u_sunBrightness:1,u_sunHaloRadius:.01302,u_sunHaloBrightness:1,
    u_moonDisc:[1,0,0],u_moonSun:[0,0,1],u_moonRadius:.01,u_moonBrightness:2.4,u_exposure:8};
  const hdrCases=[true,false].map(hdr=>{
    const sky=gpu.draw((hdr?'#define SKY_HDR\n':'')+cesium+common+skyParameters+display+transport+composite,1,1,solarUniforms,
      {colorTexture:black,depthTexture:black,u_skyView:black,u_transmittance:white,u_multiple:black},hdr);
    const stored=Number(sky.pixels[0])/(hdr?1:255),linear=hdr?stored:stored*stored/(1-stored*stored);
    const errors=[.1,.5,.95,.995].map(alpha=>{
      const cloud=gpu.draw(`void main(){out_FragColor=vec4(0,0,0,${alpha});}`,1,1,{}, {},hdr);
      const actualAlpha=Number(cloud.pixels[3])/(hdr?1:255);
      const result=gpu.draw((hdr?'#define CLOUD_HDR\n':'')+cesium+common+display+storage+radiometry+resolve,1,1,
        {u_exposure:8,u_hasSkyRadiance:true,u_skyRadianceHdr:hdr},{colorTexture:white,depthTexture:black,u_skyRadiance:sky.texture,u_clouds:cloud.texture},true).pixels;
      const expected=gpu.draw(common+display+`void main(){out_FragColor=vec4(displayRadiance(vec3(8.0384,8.0384*.94,8.0384*.83)*${1-actualAlpha},8.),1);}`,1,1,{}, {},true).pixels;
      return {alpha:actualAlpha,error:Math.max(...Array.from(result).slice(0,3).map((v,c)=>Math.abs(v-expected[c])))};
    });return {hdr,solarRadiance:linear,errors};
  });
  checks.push({name:'thin-cloud resolve attenuates the untruncated solar HDR before one display mapping, including RGBA8',pass:hdrCases.every(c=>Math.abs(c.solarRadiance-8.0384)<.5&&c.errors.every(e=>e.error<.025)),cases:hdrCases});
  // Count preparation at the actual march call site, with a vacuum cloud field.
  // A ray missing both shells must never call scatteringPhases at all.
  const instrumented=lighting.replace('CloudPhases scatteringPhases(vec3 d){','CloudPhases scatteringPhases(vec3 d){phaseCalls+=1.;');
  const marchStub=`uniform sampler2D depthTexture;uniform float u_pixelAngle,u_highBase,u_highThickness,u_highCoverage,u_highType,u_highAnisotropy,u_highAlbedo,u_highMultiple,u_coverage,u_density,u_highOpticalDepth;
    uniform bool u_voxelReady,u_skipVoxels,u_opticsReady;int cloudLayer=0,cloudRepresentation=0;float cloudSlant=1.,cloudStep=0.,phaseCalls=0.,farShape=64.;vec3 cloudRay,farAnchor,cloudScreenRight,cloudScreenUp;vec4 farMoments=vec4(0);float debugMipA=-1.,debugMipB=-1.;
    // This call-count seam intentionally has no cloud material. Supply the
    // finite-response interface too; it must remain unreachable when optics
    // are unavailable, just like the existing empty density stubs.
    const int FAR_RESPONSE_LIMIT=8;vec4 farResponse[9];vec3 farSunResponse[8],farMoonResponse[8];
    void prepareFarResponse(vec3 o,vec3 d,vec2 p,float f,int count,vec3 sun,vec3 moon,bool moonActive){}
    float lowCloudDensity(vec3 p,float f,bool coarse){return 0.;}float highCloudDensity(vec3 p,float f){return 0.;}
    float layerBase(){return cloudLayer==0?u_base:u_highBase;}float layerThickness(){return cloudLayer==0?u_thickness:u_highThickness;}
    float voxelEmptyDistance(vec3 p,float f){return 0.;}float voxelBodyDepth(vec3 p,float f){return 0.;}
    float farCloudWeight(float f){return 0.;}float farCloudLightDepth(vec3 p,vec3 l,float f){return 0.;}
    float highPathScale=1.,highLocalTau=0.;float highProfilePath(vec3 p,vec3 d,vec2 path){return 1.;}float highFarWeight(float f){return 1.;}
    vec3 columnOptics(vec2 w,float s){return vec3(0);}vec2 cloudWeather(vec3 p,float f){return vec2(0);}
    vec3 cloudSource(vec3 light){return light;}vec3 storeCloudRadiance(vec3 light){return vec3(phaseCalls,0,0);}`;
  const calls=[1,-1].map(sign=>Number(gpu.draw('#define LAYERED_CLOUDS\n#define CLOUD_STEPS 4\n#define CLOUD_SUBSTEPS 1\n#define LIGHT_STEPS 3\n'+
    cesium.replace('czm_inverseView=mat4(1)',`czm_inverseView=mat4(1,0,0,0,0,1,0,0,0,0,${sign},0,0,0,0,1)`)+common+transport+irradianceSample+globals+marchStub+instrumented+intervals+cloudTransport+march,1,1,
    {...uniforms,u_atmosphere:false,u_camera:[0,0,23378.137],u_coverage:1,u_density:1,u_highOpticalDepth:.35,u_highCoverage:1,u_highBase:9,u_highThickness:1.5,u_pixelAngle:.001},
    {...inputs,depthTexture:black},true).pixels[0]));
  checks.push({name:'actual cloud march prepares phases only after a valid interval (space miss / two shell hits)',pass:calls[0]===0&&calls[1]===2,calls});
  output.textContent=JSON.stringify({passed:checks.every(c=>c.pass),checks},null,2);document.title=checks.every(c=>c.pass)?'PASS · Lighting GPU':'FAIL · Lighting GPU';
}catch(error){output.textContent=String(error);document.title='ERROR · Lighting GPU';}finally{gpu.destroy();}
