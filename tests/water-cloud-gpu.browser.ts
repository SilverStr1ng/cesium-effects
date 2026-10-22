import {Cartesian3} from 'cesium';
import {POLAR_SCALE} from '../src/effects/hillaire-atmosphere/atmosphereMath';
import density from '../src/effects/water-clouds/shaders/density.glsl?raw';
import lighting from '../src/effects/global-clouds/shaders/droplet-lighting.glsl?raw';
import transport from '../src/effects/hillaire-atmosphere/shaders/integrate.glsl?raw';
import {createCumulusNoise,CUMULUS_NOISE_SIZE as NOISE_SIZE} from '../src/effects/global-clouds/CumulusNoise';
import {createWeather,WEATHER_WIDTH,WEATHER_HEIGHT} from '../src/effects/global-clouds/WeatherField';
import common from '../src/effects/hillaire-atmosphere/shaders/common.glsl?raw';

const output=document.querySelector('#result')!;
const anchor=Cartesian3.fromDegrees(-97.52,35.46,0);anchor.z*=POLAR_SCALE;Cartesian3.normalize(anchor,anchor);
const anchorGLSL=`vec3(${anchor.x},${anchor.y},${anchor.z})`;
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
  const weather=gl.createTexture();gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,weather);
  gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA8,WEATHER_WIDTH,WEATHER_HEIGHT,0,gl.RGBA,gl.UNSIGNED_BYTE,createWeather(13));
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.REPEAT);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
  function run(source:string,main:string,parameters:Record<string,number>={},vectors:Record<string,number[]>={}){
    const fragment=shader(gl.FRAGMENT_SHADER,'#version 300 es\nprecision highp float;\nout vec4 out_FragColor;\n'+source+main),program=gl.createProgram()!;
    gl.attachShader(program,vertex);gl.attachShader(program,fragment);gl.linkProgram(program);
    if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(program)!);
    gl.useProgram(program);gl.uniform1i(gl.getUniformLocation(program,'u_noise'),0);
    gl.uniform1i(gl.getUniformLocation(program,'u_weather'),1);
    for(const name of ['u_transmittance','u_multiple'])gl.uniform1i(gl.getUniformLocation(program,name),1);gl.uniform1f(gl.getUniformLocation(program,'u_exposure'),1.25);gl.uniform1f(gl.getUniformLocation(program,'u_seed'),13);
    for(const [name,value] of Object.entries({u_base:1.5,u_thickness:3.8,u_coverage:.85,u_density:1.1,u_detail:.55,u_windAngle:0,u_windSpeed:24,u_evolution:0,u_moonFraction:1,u_moonGain:1,...parameters}))gl.uniform1f(gl.getUniformLocation(program,name),value);
    for(const [name,v] of Object.entries(vectors))gl.uniform3f(gl.getUniformLocation(program,name),v[0],v[1],v[2]);
    gl.viewport(0,0,512,1);gl.drawArrays(gl.TRIANGLES,0,3);
    const bytes=new Uint8Array(512*4);gl.readPixels(0,0,512,1,gl.RGBA,gl.UNSIGNED_BYTE,bytes);
    const error=gl.getError();if(error!==gl.NO_ERROR)throw new Error(`WebGL draw failed: ${error}`);
    gl.deleteProgram(program);gl.deleteShader(fragment);return bytes;
  }
  const densityFixture=`void main(){float i=floor(gl_FragCoord.x);vec3 n=normalize(${anchorGLSL});vec3 east=normalize(cross(vec3(0,0,1),n));vec3 p=n*(Rg+1.8+mod(i,16.)*.12)+east*(floor(i/16.)*.9);float rho=cloudDensity(p,.01,false),bound=cloudDensity(p,.01,true);out_FragColor=vec4(rho/32.,bound/32.,0,1);}`;
  const body=run(common+density,densityFixture);
  const evolved=run(common+density,densityFixture,{u_evolution:6});
  let evolutionDiff=0;for(let i=0;i<512;i++)evolutionDiff+=((body[i*4]-evolved[i*4])/255)**2;
  const evolutionRms=Math.sqrt(evolutionDiff/512);
  const groundSky=run(common+density,`void main(){
    // Include the actual 12-degree ground camera's horizon-facing sky.
    float i=floor(gl_FragCoord.x),az=radians(245.+(mod(i,32.)-16.)*2.75),elevation=radians(5.+floor(i/32.)*2.3);
    vec3 up=normalize(${anchorGLSL}),east=normalize(cross(vec3(0,0,1),up)),north=cross(up,east);
    vec3 origin=up*(Rg+.8),ray=(north*cos(az)+east*sin(az))*cos(elevation)+up*sin(elevation);
    float start=sphere(origin,ray,Rg+u_base).y,end=sphere(origin,ray,Rg+u_base+u_thickness).y,ds=(end-start)/160.,tau=0.;
    for(int j=0;j<160;j++){tau+=cloudDensity(origin+ray*(start+(float(j)+.5)*ds),.01,false)*ds;if(tau>8.)break;}
    out_FragColor=vec4(exp(-tau),0,0,1);
  }`,{u_coverage:.62});
  let clearRays=0,cloudyRays=0;for(let i=0;i<512;i++){if(groundSky[i*4]>128)clearRays++;if(groundSky[i*4]<26)cloudyRays++;}
  let boundViolation=0,thickCores=0,thinEdges=0;
  for(let i=0;i<512;i++){
    boundViolation=Math.max(boundViolation,(body[i*4]-body[i*4+1])/255);
    const rho=body[i*4]/255*32;
    if(rho>5)thickCores++;
    if(rho>.125&&rho<4)thinEdges++;
  }
  const noCloud=run(common+density,densityFixture,{u_coverage:0});
  const lightSource=common+transport+density+`
#define LIGHT_STEPS 7
    uniform bool u_atmosphere;uniform vec3 u_camera,u_moon;
    uniform float u_moonFraction,u_moonGain;
    struct CloudPhases {vec3 sun;vec3 moon;vec3 sky;vec3 horizon;};`+lighting;
  const up=[anchor.x,anchor.y,anchor.z];const len=Math.hypot(...up);for(let i=0;i<3;i++)up[i]/=len;
  const vectors={u_sun:up.map(v=>-v),u_moon:up,u_camera:up.map(v=>v*6378.937)};
  const nightFixture=`void main(){float i=floor(gl_FragCoord.x);vec3 up=normalize(${anchorGLSL}),east=normalize(cross(vec3(0,0,1),up));
    vec3 p=up*(Rg+2.+mod(i,16.)*.08)+east*(floor(i/16.)*.35);
    float rho=cloudDensity(p,.02,false);CloudPhases phases=scatteringPhases(normalize(up+east*1.3));
    out_FragColor=vec4(illumination(p,rho,.02,phases)*8.,1);}`;
  const lit=run(lightSource,nightFixture,{},vectors);
  const dark=run(lightSource,nightFixture,{u_moonGain:0},vectors);
  const newMoon=run(lightSource,nightFixture,{u_moonFraction:0},vectors);
  const below=run(lightSource,nightFixture,{}, {...vectors,u_moon:up.map(v=>-v)});
  const average=(bytes:Uint8Array)=>{let sum=0;for(let i=0;i<512;i++)sum+=bytes[i*4]+bytes[i*4+1]+bytes[i*4+2];return sum/(512*3*255);};
  const delta=average(lit)-average(dark);
  // Exercise the actual light integrator with an analytic uniform cloud medium:
  // adding optical depth must attenuate both solar and lunar transport.
  const analytic=common+transport+`
#define LIGHT_STEPS 7
    uniform bool u_atmosphere;uniform vec3 u_camera,u_moon;uniform float u_base,u_thickness,u_density,u_moonFraction,u_moonGain;
    struct CloudPhases {vec3 sun;vec3 moon;vec3 sky;vec3 horizon;};
    float cloudDensity(vec3 p,float footprint,bool coarse){return u_density;}`+lighting;
  const shadowFixture=`void main(){vec3 p=vec3(0,0,Rg+2.);float e=waterScatter(waterPhases(.3),waterLightDepth(p,vec3(0,0,1),u_density,.01));out_FragColor=vec4(vec3(e*5.),1);}`;
  const thin=average(run(analytic,shadowFixture,{u_density:.05})),thick=average(run(analytic,shadowFixture,{u_density:2}));
  // A uniform medium has an exact optical depth. Changing quality must change
  // quadrature precision, never the length or strength of the light shadow.
  const coneErrors=[3,5,7].map(steps=>{
    const source=analytic.replace('#define LIGHT_STEPS 7',`#define LIGHT_STEPS ${steps}`);
    const measured=average(run(source,`void main(){float tau=waterLightDepth(vec3(0,0,Rg+2.),vec3(0,0,1),.5,.01);out_FragColor=vec4(vec3(tau),1);}`,{u_density:.5}));
    return Math.abs(measured-.5*.6);
  });
  const repeatRms=(distance:number)=>{
    const bytes=run(common+density,`void main(){float i=mod(floor(gl_FragCoord.x),256.);vec3 up=normalize(${anchorGLSL}),east=normalize(cross(vec3(0,0,1),up));
      float offset=i*1.37-160.+(gl_FragCoord.x>256.?${distance.toFixed(1)}:0.);
      vec3 p=normalize(up*Rg+east*offset)*(Rg+2.2);out_FragColor=vec4(vec3(cloudDensity(p,.02,false)/32.),1);}`);
    let sum=0;for(let i=0;i<256;i++)sum+=((bytes[i*4]-bytes[(i+256)*4])/255)**2;
    return Math.sqrt(sum/256);
  };
  const repeatLocal=repeatRms(12),repeatRegional=repeatRms(900);
  const orbital=run(common+density,`void main(){float i=mod(floor(gl_FragCoord.x),256.);vec3 up=normalize(${anchorGLSL}),east=normalize(cross(vec3(0,0,1),up));
    vec3 p=normalize(up*Rg+east*(i*7.1-900.))*(Rg+2.2);
    out_FragColor=vec4(vec3(cloudDensity(p,gl_FragCoord.x>256.?16.:4.,false)),1);}`);
  let orbitError=0;for(let i=0;i<256;i++)orbitError=Math.max(orbitError,Math.abs(orbital[i*4]-orbital[(i+256)*4])/255);
  const checks=[
    {name:'subpixel cloud field stays stable across orbital pixel footprints',pass:orbitError<=1/255,error:orbitError},
    {name:'local water field does not repeat after 12 km',pass:repeatLocal>.03,rms:repeatLocal},
    {name:'regional water field does not repeat after 900 km',pass:repeatRegional>.03,rms:repeatRegional},
    {name:'zero coverage gives zero density',pass:average(noCloud)===0},
    {name:'erosion remains bounded by the un-eroded medium',pass:boundViolation<=1/255,error:boundViolation},
    {name:'water medium contains opaque cores',pass:thickCores>16,count:thickCores},
    {name:'water medium preserves optically thin transition samples',pass:thinEdges>16,count:thinEdges},
    {name:'wind changes internal shape independently of advection',pass:evolutionRms>.025,rms:evolutionRms},
    {name:'ground fixture has both open sky and opaque clouds',pass:clearRays>25&&cloudyRays>25,clearRays,cloudyRays},
    {name:'full moon adds directional cloud radiance',pass:delta>.01,delta},
    {name:'new moon removes direct lunar lighting',pass:Math.abs(average(newMoon)-average(dark))<.002},
    {name:'moon below horizon cannot light the cloud fixture',pass:Math.abs(average(below)-average(dark))<.002},
    {name:'cloud optical depth attenuates directional light',pass:thick<thin*.5,thin,thick},
    {name:'local cone integrates the same physical shadow at all qualities',pass:coneErrors.every(x=>x<.005),errors:coneErrors}
  ];
  gl.deleteTexture(weather);gl.deleteTexture(noise);gl.deleteShader(vertex);
  output.textContent=JSON.stringify({passed:checks.every(x=>x.pass),checks},null,2);
  document.title=checks.every(x=>x.pass)?'PASS · Water-cloud GPU regressions':'FAIL · Water-cloud GPU regressions';
}catch(error){output.textContent=String(error);document.title='ERROR · Water-cloud GPU regressions';}
