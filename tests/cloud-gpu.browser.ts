import density from '../src/effects/global-clouds/shaders/density.glsl?raw';
import radiometry from '../src/effects/global-clouds/shaders/radiometry.glsl?raw';
import display from '../src/scene/display.glsl?raw';
import {createCumulusNoise,CUMULUS_NOISE_SIZE as NOISE_SIZE} from '../src/effects/global-clouds/CumulusNoise';
import {createWeather,WEATHER_WIDTH,WEATHER_HEIGHT} from '../src/effects/global-clouds/WeatherField';
import common from '../src/effects/hillaire-atmosphere/shaders/common.glsl?raw';

const output=document.querySelector('#result')!;
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
  function run(source:string,main:string,parameters:Record<string,number>={}){
    const fragment=shader(gl.FRAGMENT_SHADER,'#version 300 es\nprecision highp float;\nout vec4 out_FragColor;\n'+source+main),program=gl.createProgram()!;
    gl.attachShader(program,vertex);gl.attachShader(program,fragment);gl.linkProgram(program);
    if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(program)!);
    gl.useProgram(program);gl.uniform1i(gl.getUniformLocation(program,'u_noise'),0);
    gl.uniform1i(gl.getUniformLocation(program,'u_weather'),1);gl.uniform1f(gl.getUniformLocation(program,'u_exposure'),1.25);gl.uniform1f(gl.getUniformLocation(program,'u_seed'),13);
    for(const [name,value] of Object.entries({u_base:1.5,u_thickness:3.8,u_coverage:.85,u_density:1.1,u_detail:.55,u_windAngle:0,u_windSpeed:24,u_evolution:0,...parameters}))gl.uniform1f(gl.getUniformLocation(program,name),value);
    gl.viewport(0,0,512,1);gl.drawArrays(gl.TRIANGLES,0,3);
    const bytes=new Uint8Array(512*4);gl.readPixels(0,0,512,1,gl.RGBA,gl.UNSIGNED_BYTE,bytes);
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
  const checks=[{name:'900 km displacement must not repeat the regional cloud field',pass:rms>.06,rms,threshold:.06},
    {name:'12 km displacement must not repeat local cloud lobes',pass:localRms>.035,rms:localRms},
    {name:'integrate heterogeneous radiance before the display transform',pass:error<.008,actual:light[0]/255,expected,error},
    {name:'zero cloud coverage preserves the preceding background',pass:backgroundError<.005,error:backgroundError},
    {name:'scaled atmosphere depth reaches the same surface from ground to orbit',pass:endpointError<.01,maxErrorKm:endpointError},
    {name:'erosion never adds density above the base field',pass:boundViolation<=1/255,error:boundViolation},
    {name:'water cloud fixture contains optically thick cores (200 m optical depth > 1)',pass:thickCores>16,count:thickCores},
    {name:'wind evolution deforms the field even with bulk advection frozen',pass:evolutionRms>.04,rms:evolutionRms},
    {name:'default ground view contains both open sky and thick clouds',pass:clearRays>25&&cloudyRays>25,clearRays,cloudyRays}];
  gl.deleteTexture(weather);gl.deleteTexture(noise);gl.deleteShader(vertex);
  output.textContent=JSON.stringify({passed:checks.every(x=>x.pass),checks},null,2);
  document.title=checks.every(x=>x.pass)?'PASS · Cloud GPU regressions':'FAIL · Cloud GPU regressions';
}catch(error){output.textContent=String(error);document.title='ERROR · Cloud GPU regressions';}
