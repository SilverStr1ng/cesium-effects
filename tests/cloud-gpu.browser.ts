import density from '../src/effects/global-clouds/shaders/density.glsl?raw';
import radiometry from '../src/effects/global-clouds/shaders/radiometry.glsl?raw';
import {createNoiseVolume,NOISE_SIZE} from '../src/scene/CloudNoise';
import {createWeather,WEATHER_WIDTH,WEATHER_HEIGHT} from '../src/effects/global-clouds/WeatherField';
import common from '../src/effects/hillaire-atmosphere/shaders/common.glsl?raw';

const output=document.querySelector('#result')!;
try{
  const gl=document.querySelector<HTMLCanvasElement>('#probe')!.getContext('webgl2')!;
  if(!gl)throw new Error('WebGL2 unavailable');
  function shader(type:number,source:string){const s=gl.createShader(type)!;gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(s)!);return s;}
  const vertex=shader(gl.VERTEX_SHADER,'#version 300 es\nvoid main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);gl_Position=vec4(p*2.-1.,0,1);}');
  const noise=gl.createTexture();gl.bindTexture(gl.TEXTURE_3D,noise);
  gl.texImage3D(gl.TEXTURE_3D,0,gl.RGBA8,NOISE_SIZE,NOISE_SIZE,NOISE_SIZE,0,gl.RGBA,gl.UNSIGNED_BYTE,createNoiseVolume());
  for(const p of [gl.TEXTURE_WRAP_S,gl.TEXTURE_WRAP_T,gl.TEXTURE_WRAP_R])gl.texParameteri(gl.TEXTURE_3D,p,gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_3D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_3D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
  const weather=gl.createTexture();gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,weather);
  gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA8,WEATHER_WIDTH,WEATHER_HEIGHT,0,gl.RGBA,gl.UNSIGNED_BYTE,createWeather());
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.REPEAT);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
  function run(source:string,main:string){
    const fragment=shader(gl.FRAGMENT_SHADER,'#version 300 es\nprecision highp float;\nout vec4 out_FragColor;\n'+source+main),program=gl.createProgram()!;
    gl.attachShader(program,vertex);gl.attachShader(program,fragment);gl.linkProgram(program);
    if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(program)!);
    gl.useProgram(program);gl.uniform1i(gl.getUniformLocation(program,'u_noise'),0);
    gl.uniform1i(gl.getUniformLocation(program,'u_weather'),1);gl.uniform1f(gl.getUniformLocation(program,'u_exposure'),1.25);gl.uniform1f(gl.getUniformLocation(program,'u_seed'),7);
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
  const light=run(radiometry,`void main(){vec3 mixed=.5*cloudSource(vec3(0))+.5*cloudSource(vec3(2));out_FragColor=vec4(cloudDisplay(mixed),1);}`);
  const expected=1-Math.exp(-1.25),error=Math.abs(light[0]/255-expected);
  const vacuum=run(radiometry,`void main(){float v=(gl_FragCoord.x-.5)/511.;out_FragColor=vec4(cloudDisplay(cloudBackground(vec3(v))),1);}`);
  let backgroundError=0;for(let i=0;i<512;i++)backgroundError=Math.max(backgroundError,Math.abs(vacuum[i*4]/255-i/511));
  const checks=[{name:'900 km displacement must not repeat the regional cloud field',pass:rms>.06,rms,threshold:.06},
    {name:'12 km displacement must not repeat local cloud lobes',pass:localRms>.035,rms:localRms},
    {name:'integrate heterogeneous radiance before the display transform',pass:error<.008,actual:light[0]/255,expected,error},
    {name:'zero cloud coverage preserves the preceding background',pass:backgroundError<.005,error:backgroundError}];
  gl.deleteTexture(weather);gl.deleteTexture(noise);gl.deleteShader(vertex);
  output.textContent=JSON.stringify({passed:checks.every(x=>x.pass),checks},null,2);
  document.title=checks.every(x=>x.pass)?'PASS · Cloud GPU regressions':'FAIL · Cloud GPU regressions';
}catch(error){output.textContent=String(error);document.title='ERROR · Cloud GPU regressions';}
