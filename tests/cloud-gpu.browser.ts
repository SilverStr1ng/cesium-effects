import densitySource from '../src/effects/global-clouds/shaders/density.glsl?raw';
import voxelSource from '../src/effects/global-clouds/shaders/voxel.glsl?raw';
import {createVoxelCloudField,VOXEL_SIZE} from '../src/effects/global-clouds/VoxelCloudField';
import {createCloudOptics,CLOUD_OPTICS_SIZE} from '../src/effects/global-clouds/CloudOptics';
import {createCirrusField} from '../src/effects/global-clouds/CirrusField';
import radiometry from '../src/effects/global-clouds/shaders/radiometry.glsl?raw';
import display from '../src/scene/display.glsl?raw';
import {createCumulusNoise,CUMULUS_NOISE_SIZE as NOISE_SIZE} from '../src/effects/global-clouds/CumulusNoise';
import {createWeather,WEATHER_WIDTH,WEATHER_HEIGHT} from '../src/effects/global-clouds/WeatherField';
import common from '../src/effects/hillaire-atmosphere/shaders/common.glsl?raw';
import intervals from '../src/effects/global-clouds/shaders/intervals.glsl?raw';
import lighting from '../src/effects/global-clouds/shaders/droplet-lighting.glsl?raw';
import transport from '../src/effects/hillaire-atmosphere/shaders/integrate.glsl?raw';
import irradianceSample from '../src/effects/hillaire-atmosphere/shaders/sky-irradiance-sample.glsl?raw';

const output=document.querySelector('#result')!;
const density=densitySource+voxelSource;
try{
  const gl=document.querySelector<HTMLCanvasElement>('#probe')!.getContext('webgl2')!;
  if(!gl)throw new Error('WebGL2 unavailable');
  function shader(type:number,source:string){const s=gl.createShader(type)!;gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(s)!);return s;}
  const vertex=shader(gl.VERTEX_SHADER,'#version 300 es\nvoid main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);gl_Position=vec4(p*2.-1.,0,1);}');
  const noise=gl.createTexture();gl.bindTexture(gl.TEXTURE_3D,noise);
  const cellular=createCumulusNoise();
  gl.texImage3D(gl.TEXTURE_3D,0,gl.RGBA8,NOISE_SIZE,NOISE_SIZE,NOISE_SIZE,0,gl.RGBA,gl.UNSIGNED_BYTE,cellular.bytes);
  cellular.mips.forEach((bytes,i)=>{const size=NOISE_SIZE/2**(i+1);gl.texImage3D(gl.TEXTURE_3D,i+1,gl.RGBA8,size,size,size,0,gl.RGBA,gl.UNSIGNED_BYTE,bytes);});
  for(const p of [gl.TEXTURE_WRAP_S,gl.TEXTURE_WRAP_T,gl.TEXTURE_WRAP_R])gl.texParameteri(gl.TEXTURE_3D,p,gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_3D,gl.TEXTURE_MIN_FILTER,gl.LINEAR_MIPMAP_LINEAR);gl.texParameteri(gl.TEXTURE_3D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
  const iceAsset=createCirrusField(),cirrus=gl.createTexture();gl.activeTexture(gl.TEXTURE3);gl.bindTexture(gl.TEXTURE_3D,cirrus);
  gl.texImage3D(gl.TEXTURE_3D,0,gl.RGBA8,NOISE_SIZE,NOISE_SIZE,NOISE_SIZE,0,gl.RGBA,gl.UNSIGNED_BYTE,iceAsset.bytes);
  iceAsset.mips.forEach((bytes,i)=>{const size=NOISE_SIZE/2**(i+1);gl.texImage3D(gl.TEXTURE_3D,i+1,gl.RGBA8,size,size,size,0,gl.RGBA,gl.UNSIGNED_BYTE,bytes);});
  for(const p of [gl.TEXTURE_WRAP_S,gl.TEXTURE_WRAP_T,gl.TEXTURE_WRAP_R])gl.texParameteri(gl.TEXTURE_3D,p,gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_3D,gl.TEXTURE_MIN_FILTER,gl.LINEAR_MIPMAP_LINEAR);gl.texParameteri(gl.TEXTURE_3D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
  gl.activeTexture(gl.TEXTURE0);
  const weather=gl.createTexture();gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,weather);
  gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA8,WEATHER_WIDTH,WEATHER_HEIGHT,0,gl.RGBA,gl.UNSIGNED_BYTE,createWeather(13));
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.REPEAT);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
  const voxels=gl.createTexture();gl.activeTexture(gl.TEXTURE2);gl.bindTexture(gl.TEXTURE_3D,voxels);
  const sculpt=createVoxelCloudField();gl.texImage3D(gl.TEXTURE_3D,0,gl.RGBA8,VOXEL_SIZE,VOXEL_SIZE,VOXEL_SIZE,0,gl.RGBA,gl.UNSIGNED_BYTE,sculpt.bytes);
  sculpt.mips.forEach((bytes,i)=>{const size=VOXEL_SIZE/2**(i+1);gl.texImage3D(gl.TEXTURE_3D,i+1,gl.RGBA8,size,size,size,0,gl.RGBA,gl.UNSIGNED_BYTE,bytes);});
  for(const p of [gl.TEXTURE_WRAP_S,gl.TEXTURE_WRAP_T,gl.TEXTURE_WRAP_R])gl.texParameteri(gl.TEXTURE_3D,p,gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_3D,gl.TEXTURE_MIN_FILTER,gl.LINEAR_MIPMAP_LINEAR);gl.texParameteri(gl.TEXTURE_3D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
  const optics=gl.createTexture();gl.activeTexture(gl.TEXTURE4);gl.bindTexture(gl.TEXTURE_3D,optics);
  gl.texImage3D(gl.TEXTURE_3D,0,gl.RGBA8,CLOUD_OPTICS_SIZE,CLOUD_OPTICS_SIZE,CLOUD_OPTICS_SIZE,0,gl.RGBA,gl.UNSIGNED_BYTE,createCloudOptics(sculpt.bytes,cellular.bytes));
  gl.texParameteri(gl.TEXTURE_3D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_3D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
  function run(source:string,main:string,parameters:Record<string,number>={},vectors:Record<string,number[]>={}){
    const fragment=shader(gl.FRAGMENT_SHADER,'#version 300 es\nprecision highp float;\nout vec4 out_FragColor;\n'+source+main),program=gl.createProgram()!;
    gl.attachShader(program,vertex);gl.attachShader(program,fragment);gl.linkProgram(program);
    if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(program)!);
    gl.useProgram(program);gl.uniform1i(gl.getUniformLocation(program,'u_noise'),0);
    gl.uniform1i(gl.getUniformLocation(program,'u_voxels'),2);gl.uniform1i(gl.getUniformLocation(program,'u_voxelReady'),1);gl.uniform1i(gl.getUniformLocation(program,'u_skipVoxels'),1);
    gl.uniform1i(gl.getUniformLocation(program,'u_cirrus'),3);gl.uniform1i(gl.getUniformLocation(program,'u_cloudOptics'),4);gl.uniform1i(gl.getUniformLocation(program,'u_opticsReady'),1);
    gl.uniform1i(gl.getUniformLocation(program,'u_weather'),1);gl.uniform1f(gl.getUniformLocation(program,'u_exposure'),1.25);gl.uniform1f(gl.getUniformLocation(program,'u_seed'),13);
    for(const name of ['u_transmittance','u_multiple','u_skyIrradiance'])gl.uniform1i(gl.getUniformLocation(program,name),1);
    for(const [name,value] of Object.entries({u_columnGrid:12,u_base:1.5,u_thickness:3.8,u_coverage:.85,u_density:1.1,u_detail:.55,u_windAngle:0,u_windSpeed:24,u_evolution:0,u_cloudType:0,u_highBase:9,u_highThickness:1.5,u_highCoverage:.35,u_highAngle:0,u_moonFraction:1,u_moonGain:1,...parameters}))gl.uniform1f(gl.getUniformLocation(program,name),value);
    for(const [name,v] of Object.entries(vectors))gl.uniform3f(gl.getUniformLocation(program,name),v[0],v[1],v[2]);
    gl.viewport(0,0,512,1);gl.drawArrays(gl.TRIANGLES,0,3);
    const bytes=new Uint8Array(512*4);gl.readPixels(0,0,512,1,gl.RGBA,gl.UNSIGNED_BYTE,bytes);
    if(gl.getError()!==gl.NO_ERROR)throw new Error('WebGL draw failed');
    gl.deleteProgram(program);gl.deleteShader(fragment);return bytes;
  }
  const field=run(common+density,`void main(){float i=mod(floor(gl_FragCoord.x),256.);vec3 p=vec3(i*13.17-4000.,sin(i*2.1)*5000.,cos(i*.7)*4000.);if(gl_FragCoord.x>256.)p.x+=900.;out_FragColor=vec4(regionalNoise(p,5.),0,1);}`);
  let diff=0;for(let i=0;i<256;i++)for(let c=0;c<2;c++)diff+=((field[i*4+c]-field[(i+256)*4+c])/255)**2;
  const rms=Math.sqrt(diff/512);
  const local=run(common+density,`void main(){float i=mod(floor(gl_FragCoord.x),256.);vec3 p=vec3(i*.13-6000.,sin(i*2.1)*70.,cos(i*.7)*50.);if(gl_FragCoord.x>256.)p.x+=12.;out_FragColor=vec4(vec3(shapeNoise(p)*.5+.5),1);}`);
  let localDiff=0;for(let i=0;i<256;i++)localDiff+=((local[i*4]-local[(i+256)*4])/255)**2;
  const localRms=Math.sqrt(localDiff/256);
  const light=run(display+radiometry,`void main(){vec3 mixed=.5*cloudSource(vec3(0))+.5*cloudSource(vec3(2));out_FragColor=vec4(cloudDisplay(mixed),1);}`);
  const x=1.25,expected=((x*(2.51*x+.03))/(x*(2.43*x+.59)+.14))**(1/2.2),error=Math.abs(light[0]/255-expected);
  const vacuum=run(display+radiometry,`void main(){float v=(gl_FragCoord.x-.5)/511.;out_FragColor=vec4(cloudDisplay(cloudBackground(vec3(v))),1);}`);
  let backgroundError=0;for(let i=0;i<512;i++)backgroundError=Math.max(backgroundError,Math.abs(vacuum[i*4]/255-i/511));
  // Ground endpoints must survive world -> scaled atmosphere conversion, even
  // from orbit. The old unscaled distance was off by tens of kilometres.
  const endpoints=run(common,`void main(){
    float i=floor(gl_FragCoord.x),latitude=mix(-1.55,1.55,i/511.);
    vec3 scale=vec3(1,1,1.00336409),up=vec3(cos(latitude)*.8,cos(latitude)*.6,sin(latitude));
    vec3 target=up*Rg/scale,origin=target+normalize(up+vec3(.2,-.1,.04))*mix(.8,17000.,mod(i,32.)/31.);
    vec3 worldRay=normalize(target-origin),delta=target-origin;
    vec3 endpoint=origin*scale+normalize(worldRay*scale)*atmosphereRayDistance(worldRay,length(delta)*1000.);
    out_FragColor=vec4(length(endpoint-target*scale)/.02,0,0,1);
  }`);
  let endpointError=0;for(let i=0;i<512;i++)endpointError=Math.max(endpointError,endpoints[i*4]/255*.02);
  const densityFixture=`void main(){float i=floor(gl_FragCoord.x);vec3 n=normalize(vec3(-.106,-.808,.580));vec3 east=normalize(cross(vec3(0,0,1),n));vec3 p=n*(Rg+1.8+mod(i,16.)*.12)+east*(floor(i/16.)*.28);float rho=cloudDensity(p,.01,false),bound=cloudDensity(p,.01,true);out_FragColor=vec4(rho/8.,bound/8.,0,1);}`;
  const body=run(common+density,densityFixture);
  const evolved=run(common+density,densityFixture,{u_evolution:6});
  let evolutionDiff=0;for(let i=0;i<512;i++)evolutionDiff+=((body[i*4]-evolved[i*4])/255)**2;
  const evolutionRms=Math.sqrt(evolutionDiff/512);
  const groundSky=run(common+density,`void main(){
    float i=floor(gl_FragCoord.x),az=radians(245.+(mod(i,32.)-16.)*2.75),elevation=radians(20.+floor(i/32.)*2.3);
    vec3 up=normalize(vec3(-.106,-.808,.580)),east=normalize(cross(vec3(0,0,1),up)),north=cross(up,east);
    vec3 origin=up*(Rg+.8),ray=(north*cos(az)+east*sin(az))*cos(elevation)+up*sin(elevation);
    float start=sphere(origin,ray,Rg+u_base).y,end=sphere(origin,ray,Rg+u_base+u_thickness).y,ds=(end-start)/160.,tau=0.;
    for(int j=0;j<160;j++){tau+=cloudDensity(origin+ray*(start+(float(j)+.5)*ds),.01,false)*ds;if(tau>8.)break;}
    out_FragColor=vec4(exp(-tau),0,0,1);
  }`,{u_coverage:.62});
  let clearRays=0,cloudyRays=0;for(let i=0;i<512;i++){if(groundSky[i*4]>128)clearRays++;if(groundSky[i*4]<26)cloudyRays++;}
  let boundViolation=0,thickCores=0;
  for(let i=0;i<512;i++){boundViolation=Math.max(boundViolation,(body[i*4]-body[i*4+1])/255);if(body[i*4]/255*8>5)thickCores++;}
  const ordered=run(common+density+intervals,`void main(){
    int mode=int(mod(floor(gl_FragCoord.x),8.));vec3 p=vec3(0,0,Rg+.8),d=vec3(0,0,1);float maximum=1e8;
    if(mode==1)p.z=Rg+7.;
    if(mode==2){p.z=Rg+7.;d.z=-1.;}
    if(mode==3){p.z=Rg+9.7;d.z=-1.;}
    if(mode==4){p.z=Rg+17000.;d.z=-1.;}
    if(mode==5){p=vec3(-400,0,Rg+1.);d=vec3(1,0,0);}
    if(mode==6)maximum=2.;
    if(mode==7){p.z=Rg+17000.;d=vec3(1,0,0);}
    vec2 parts[4];int layers[4];cloudIntervals(p,d,maximum,parts,layers);
    float count=0.,bits=0.,last=0.,valid=1.;
    for(int j=0;j<4;j++)if(parts[j].y>parts[j].x){
      float base=layers[j]==0?u_base:u_highBase,thickness=layers[j]==0?u_thickness:u_highThickness;
      float altitude=length(p+d*(parts[j].x+parts[j].y)*.5)-Rg;
      if(parts[j].x<last-.01||parts[j].x<0.||parts[j].y>maximum||altitude<base-.02||altitude>base+thickness+.02)valid=0.;
      last=parts[j].y;bits+=float(layers[j])*pow(2.,count);count+=1.;
    }
    out_FragColor=vec4(count/4.,bits/15.,valid,1);
  }`);
  const expectedCounts=[2,1,1,2,2,4,1,0],expectedBits=[2,1,0,1,1,9,0,0];let orderFailures=0;
  for(let i=0;i<512;i++)if(Math.round(ordered[i*4]/255*4)!==expectedCounts[i%8]||Math.round(ordered[i*4+1]/255*15)!==expectedBits[i%8]||ordered[i*4+2]!==255)orderFailures++;
  const profileFixture=`void main(){float i=floor(gl_FragCoord.x),h=(mod(i,32.)+.5)/32.;
    vec3 n=normalize(vec3(-.106,-.808,.580)),east=normalize(cross(vec3(0,0,1),n));
    vec3 p=normalize(n*(Rg+u_base)+east*floor(i/32.)*.7)*(Rg+u_base+h*u_thickness);
    out_FragColor=vec4(cloudDensity(p,.01,false)/8.,0,0,1);}`;
  const profiles=[1,2,3].map(type=>run(common+density,profileFixture,{u_cloudType:type}));
  const profileStats=profiles.map(bytes=>{let mass=0,moment=0,top=0;for(let i=0;i<512;i++){const h=(i%32+.5)/32.;mass+=bytes[i*4];moment+=bytes[i*4]*h;if(bytes[i*4]>0)top=Math.max(top,h);}return {mass,centroid:moment/Math.max(1,mass),top};});
  const highFixture=`void main(){cloudLayer=1;float i=floor(gl_FragCoord.x);vec3 n=normalize(vec3(sin(i*.71),cos(i*.37),sin(i*.19)));
    out_FragColor=vec4(cloudDensity(n*(Rg+u_highBase+u_highThickness*.45),.02,false),0,0,1);}`;
  const ice=run(common+density,highFixture),noIce=run(common+density,highFixture,{u_highCoverage:0}),movedIce=run(common+density,highFixture,{u_highAngle:.004});
  let iceCount=0,iceMax=0,iceMotion=0;for(let i=0;i<512;i++){if(ice[i*4]>2)iceCount++;iceMax=Math.max(iceMax,ice[i*4]/255);iceMotion+=((ice[i*4]-movedIce[i*4])/255)**2;}
  const lightSource='#define LAYERED_CLOUDS\n#define LIGHT_STEPS 5\n'+common+transport+density+`
    uniform bool u_atmosphere;uniform vec3 u_camera,u_moon;uniform float u_moonFraction,u_moonGain;
    struct CloudPhases {vec3 sun;vec3 moon;};`+irradianceSample+lighting;
  const moonFixture=`void main(){cloudLayer=int(mod(floor(gl_FragCoord.x),2.));vec3 p=vec3(0,0,Rg+layerBase()+layerThickness()*.5);
    CloudPhases phases=scatteringPhases(vec3(.6,0,.8));out_FragColor=vec4(illumination(p,cloudLayer==0?3.:.12,.02,phases)*8.,1);}`;
  const vectors={u_camera:[0,0,6378.937],u_sun:[0,0,-1],u_moon:[0,0,1]};
  const moonOn=run(lightSource,moonFixture,{},vectors),moonOff=run(lightSource,moonFixture,{u_moonGain:0},vectors),moonNew=run(lightSource,moonFixture,{u_moonFraction:0},vectors);
  const moonDelta=[0,0];for(let i=0;i<512;i++)moonDelta[i%2]+=(moonOn[i*4]-moonOff[i*4])/255/256;
  // Paired integration uses identical quadrature. Only wholly empty intervals
  // may be skipped, at several mip footprints, seed offsets and wind states.
  const skipFixture=`void main(){float i=floor(gl_FragCoord.x);vec3 n=normalize(vec3(sin(i*.71),cos(i*.37),sin(i*.19)));
    vec3 p=n*(Rg+2.8),d=normalize(cross(n,vec3(.3,.7,.1)));float ds=.025,fp=mix(.002,.22,mod(i,8.)/7.);
    float full=0.,fast=0.,until=0.,skipped=0.;
    for(int j=0;j<96;j++){float t0=float(j)*ds,t1=t0+ds,sampleFootprint=fp+float(j)*.0005;float rho=cloudDensity(p+d*(t0+ds*.5),sampleFootprint,false);
      full+=rho*ds;until=t0+voxelEmptyDistance(p+d*t0,sampleFootprint);
      if(t1<=until)skipped+=1.;else fast+=rho*ds;}
    out_FragColor=vec4(abs(exp(-full)-exp(-fast))*100.,skipped/96.,0,1);}`;
  const skipParameters:Record<string,number>[]=[{}, {u_seed:971,u_windAngle:.013,u_evolution:7}];
  const skipRuns=skipParameters.map(p=>run(common+density,skipFixture,p));
  let skipError=0,skipped=0;for(const bytes of skipRuns)for(let i=0;i<512;i++){skipError=Math.max(skipError,bytes[i*4]/255/100);skipped+=bytes[i*4+1]/255*96;}
  const voxelRepeat=run(common+density,`void main(){float i=mod(floor(gl_FragCoord.x),256.);vec3 p=vec3(i*.19-6000.,sin(i*.3)*20.,cos(i*.7)*35.);
    if(gl_FragCoord.x>256.)p.x+=12.;out_FragColor=vec4(voxelShape(p,.01).rrr,1);}`);
  let voxelRms=0;for(let i=0;i<256;i++)voxelRms+=((voxelRepeat[i*4]-voxelRepeat[(i+256)*4])/255)**2;voxelRms=Math.sqrt(voxelRms/256);
  // Integrate the actual medium over fixed planetary columns. Filtering noise
  // before thresholding used to erase thin ice and change the low-cloud cover.
  const columnStatistics=[0,1].map(layer=>[.02,.25,.5,1,2,4,16,64].map(footprint=>{
    const bytes=run(common+density,`void main(){cloudLayer=${layer};float i=floor(gl_FragCoord.x);
      float z=1.-2.*(i+.5)/512.,phi=i*2.39996323;vec3 n=vec3(sqrt(1.-z*z)*cos(phi),sqrt(1.-z*z)*sin(phi),z);
      cloudRay=-n;cloudScreenRight=normalize(cross(vec3(0,0,1),n));cloudScreenUp=cross(n,cloudScreenRight);
      float nearTau=0.,farTau=0.,ds=layerThickness()/32.;float blend=cloudLayer==0?farCloudWeight(${footprint.toFixed(3)}):0.;
      for(int j=0;j<32;j++){vec3 p=n*(Rg+layerBase()+(float(j)+.5)*ds);
        if(blend<1.)nearTau+=(cloudLayer==0?lowCloudDensity(p,${footprint.toFixed(3)},false):highCloudDensity(p,${footprint.toFixed(3)}))*ds;
        if(blend>0.)farTau+=farCloudDensity(p,${footprint.toFixed(3)})*ds;}
      float T=mix(exp(-nearTau),exp(-farTau),blend);
      out_FragColor=vec4(1.-T,min(1.,-log(max(1e-7,T))/16.),0,1);}`,{u_coverage:.62});
    let opacity=0,mass=0;for(let i=0;i<512;i++){opacity+=bytes[i*4]/255/512;mass+=bytes[i*4+1]/255/512*16;}
    return {footprint,opacity,mass};
  }));
  const farVacuumMain=`void main(){float i=floor(gl_FragCoord.x);vec3 p=normalize(vec3(sin(i*.7),cos(i*.3),sin(i*.11)))*(Rg+2.5);out_FragColor=vec4(vec3(cloudDensity(p,32.,false)),1);}`;
  const vacuumParameters:Record<string,number>[]=[{u_coverage:0},{u_density:0}];
  const farVacuum=vacuumParameters.map(p=>run(common+density,farVacuumMain,p));
  // Compare each blend endpoint to its own filtered representation at the SAME
  // footprint: hardware trilinear interpolation itself has finite precision.
  const transition=run(common+density,`void main(){float i=floor(gl_FragCoord.x);vec3 p=normalize(vec3(sin(i*.7),cos(i*.3),sin(i*.11)))*(Rg+2.5);
    float a=abs(cloudDensity(p,.3499,false)-lowCloudDensity(p,.3499,false));
    float b=abs(cloudDensity(p,2.0001,false)-farCloudDensity(p,2.0001));out_FragColor=vec4(max(a,b),0,0,1);}`);
  const nightSide=run(lightSource,`void main(){vec3 p=vec3(0,0,-Rg-3.);CloudPhases phases=scatteringPhases(vec3(0,0,-1));
    out_FragColor=vec4(illumination(p,.2,32.,phases),1);}`,
    {u_moonFraction:0},{u_camera:[0,0,23000],u_sun:[0,0,1],u_moon:[0,0,1]});
  const checks=[{name:'900 km displacement must not repeat the regional cloud field',pass:rms>.06,rms,threshold:.06},
    {name:'12 km displacement must not repeat local cloud lobes',pass:localRms>.035,rms:localRms},
    {name:'integrate heterogeneous radiance before the display transform',pass:error<.008,actual:light[0]/255,expected,error},
    {name:'zero cloud coverage preserves the preceding background',pass:backgroundError<.005,error:backgroundError},
    {name:'scaled atmosphere depth reaches the same surface from ground to orbit',pass:endpointError<.01,maxErrorKm:endpointError},
    {name:'erosion never adds density above the base field',pass:boundViolation<=1/255,error:boundViolation},
    {name:'main cloud fixture contains optically thick cores (200 m optical depth > 1)',pass:thickCores>16,count:thickCores},
    {name:'wind evolution deforms the field even with bulk advection frozen',pass:evolutionRms>.04,rms:evolutionRms},
    {name:'default ground view contains both open sky and thick clouds',pass:clearRays>25&&cloudyRays>25,clearRays,cloudyRays},
    {name:'shell ordering is correct below, between, inside, above, tangent and depth-clipped',pass:orderFailures===0,failures:orderFailures},
    {name:'stratus, stratocumulus and cumulus have distinct bounded vertical profiles',pass:profileStats.every(p=>p.mass>0)&&profileStats[0].top<.26&&profileStats[1].top<.58&&profileStats[0].centroid<profileStats[1].centroid&&profileStats[1].centroid<profileStats[2].centroid,profiles:profileStats},
    {name:'high cloud is sparse, optically thin and independently disableable',pass:iceCount>10&&iceCount<400&&iceMax<.66&&noIce.every((v,i)=>i%4===3||v===0),iceCount,iceMax},
    {name:'high wind moves its own cloud field',pass:iceMotion/512>.0001,rms:Math.sqrt(iceMotion/512)},
    {name:'both cloud layers receive phase-dependent moonlight',pass:moonDelta.every(v=>v>.005)&&moonNew.every((v,i)=>v===moonOff[i]),moonDelta},
    {name:'conservative voxel skips preserve optical depth across mips and motion',pass:skipError<.0001&&skipped>0,maxTransmissionError:skipError,skippedIntervals:Math.round(skipped)},
    {name:'combined voxel morphology does not repeat at 12 km',pass:voxelRms>.08,rms:voxelRms},
    {name:'statistical far volume vanishes for zero coverage and zero density',pass:farVacuum.every(b=>b.every((v,i)=>i%4===3||v===0))},
    {name:'segment blend endpoints dispatch to the matching density representation',pass:transition.every((v,i)=>i%4===3||v<=1),maxDensityDelta:Math.max(...transition.filter((_,i)=>i%4===0))/255},
    {name:'night-side clouds receive no camera-side daylight',pass:nightSide.every((v,i)=>i%4===3||v===0)},
    ...columnStatistics.map((samples,layer)=>({name:layer===0?'main cloud column coverage survives satellite filtering':'ice optical depth survives unresolved fibres',
      pass:samples.every(s=>s.opacity>samples[0].opacity*.8&&s.opacity<samples[0].opacity*1.25),samples}))];
  gl.deleteTexture(weather);gl.deleteTexture(noise);gl.deleteTexture(voxels);gl.deleteTexture(cirrus);gl.deleteTexture(optics);gl.deleteShader(vertex);
  output.textContent=JSON.stringify({passed:checks.every(x=>x.pass),checks},null,2);
  document.title=checks.every(x=>x.pass)?'PASS · Cloud GPU regressions':'FAIL · Cloud GPU regressions';
}catch(error){output.textContent=String(error);document.title='ERROR · Cloud GPU regressions';}
