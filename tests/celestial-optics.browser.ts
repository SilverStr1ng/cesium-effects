import {Cartesian3,JulianDate} from 'cesium';
import {gpuProbe} from './gpuProbe';
import {celestialPositions,observerCelestials} from '../src/effects/hillaire-atmosphere/CelestialLighting';
import {celestialSizePresets} from '../src/effects/hillaire-atmosphere/celestialPresets';
import common from '../src/effects/hillaire-atmosphere/shaders/common.glsl?raw';
import parameters from '../src/effects/hillaire-atmosphere/shaders/sky-view-parameters.glsl?raw';
import transport from '../src/effects/hillaire-atmosphere/shaders/integrate.glsl?raw';
import composite from '../src/effects/hillaire-atmosphere/shaders/composite.glsl?raw';
import display from '../src/scene/display.glsl?raw';
import {prepareCelestialFrame} from './celestialFixture';

const result=document.querySelector('#result')!;
try{
  const probe=gpuProbe(document.querySelector<HTMLCanvasElement>('#probe')!),gl=probe.gl;
  const textures:WebGLTexture[]=[];
  const texture=(width:number,height:number,bytes:Uint8Array)=>{
    const t=gl.createTexture()!;textures.push(t);gl.bindTexture(gl.TEXTURE_2D,t);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA8,width,height,0,gl.RGBA,gl.UNSIGNED_BYTE,bytes);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR_MIPMAP_LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.REPEAT);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);gl.generateMipmap(gl.TEXTURE_2D);return t;
  };
  const solid=(v:number)=>texture(1,1,new Uint8Array([v,v,v,255]));
  const black=solid(0),white=solid(255),grey=solid(128),air=solid(44);
  const source=`#define SKY_HDR
    uniform vec2 u_testTan;uniform mat3 u_testView;
    #define czm_inverseProjection mat4(u_testTan.x,0,0,0,0,u_testTan.y,0,0,0,0,1,0,0,0,0,1)
    #define czm_inverseView mat4(u_testView)
    const vec4 czm_viewport=vec4(0,0,1920,1080);
    vec4 czm_windowToEyeCoordinates(vec2 uv,float depth){return vec4(0,0,1,1);}
    `+common+parameters+display+transport+composite;
  const identity=[1,0,0,0,1,0,0,0,1];
  const uniforms={u_testTan:[Math.tan(Math.PI/6)*1920/1080,Math.tan(Math.PI/6)],u_testView:identity,u_basis:identity,
    u_camera:[0,0,8378.137],u_medium:[0,0,0],u_sun:[0,0,1],u_sunDisc:[0,0,1],u_moonDisc:[1,0,0],u_moonSun:[0,0,-1],
    u_sunRadius:.00465,u_sunBrightness:1,u_sunHaloRadius:.014,u_sunHaloBrightness:0,u_moonRadius:.0045,
    u_moonBrightness:0,u_moonAlbedoMean:128/255,u_moonFixedFromEcef:identity,u_moonHaloRadius:.014,u_moonHaloBrightness:0,u_exposure:8};
  const inputs={colorTexture:black,depthTexture:black,u_skyView:black,u_multiple:black,u_transmittance:white,u_moonAlbedo:grey};
  const time='2026-10-26T04:12:00Z';
  await prepareCelestialFrame(JulianDate.fromIso8601(time));
  const bodies=celestialPositions(JulianDate.fromIso8601(time));
  const observer=Cartesian3.multiplyByScalar(Cartesian3.normalize(bodies.moon,new Cartesian3()),6378937,new Cartesian3());
  const state=observerCelestials(bodies,observer);
  const diameters:{body:string;preset:string;expected:number;measured:number}[]=[];
  // Half-height crossings, linearly interpolated from real shader readback.
  const diameter=(pixels:Float32Array|Uint8Array,body:string)=>{
    const row=540,values=Array.from({length:1920},(_,x)=>pixels[(x+row*1920)*4]);
    const background=values[0],mask=values.map(v=>body==='sun'?v/8:1-v/background);
    const edges:number[]=[];
    for(let x=0;x<1919;x++)if((mask[x]-.5)*(mask[x+1]-.5)<0)edges.push(x+(.5-mask[x])/(mask[x+1]-mask[x]));
    if(edges.length!==2)throw new Error(`Expected two ${body} disc edges, found ${edges.length}`);
    return edges[1]-edges[0];
  };
  for(const [name,preset] of Object.entries(celestialSizePresets))for(const body of ['sun','moon'] as const){
    const radius=(body==='sun'?state.sunRadius*preset.sunScale:state.moonRadius*preset.moonScale);
    const pixels=probe.draw(source,1920,1080,{...uniforms,u_sun:[0,0,-1],u_sunDisc:body==='sun'?[0,0,1]:[1,0,0],
      u_moonDisc:body==='moon'?[0,0,1]:[1,0,0],u_sunRadius:radius,u_moonRadius:radius},
      {...inputs,colorTexture:body==='moon'?grey:black},true).pixels;
    diameters.push({body,preset:name,expected:1080*Math.tan(radius)/Math.tan(Math.PI/6),measured:diameter(pixels,body)});
  }
  const sample=(p:Float32Array|Uint8Array,x:number,y:number,c=0)=>p[(x+y*256)*4+c];
  const moonUniforms={...uniforms,u_testTan:[1,1],u_camera:[0,6398.137,0],u_sun:[0,0,-1],u_sunDisc:[1,0,0],u_moonDisc:[0,0,1],u_moonRadius:.4,u_moonSun:[0,0,1]};
  const p=probe.draw(source,256,256,moonUniforms,{...inputs,u_skyView:air,colorTexture:grey},true).pixels;
  const encoded=44/255,expectedAir=encoded*encoded/(1-encoded*encoded);
  const terrain=probe.draw(source,256,256,{...uniforms,u_testTan:[1,1]}, {...inputs,depthTexture:grey,colorTexture:grey},true).pixels;
  const noDiscs=probe.draw(source,256,256,{...uniforms,u_testTan:[1,1],u_sunDisc:[1,0,0]}, {...inputs,depthTexture:grey,colorTexture:grey},true).pixels;
  // Color-coded lunar coordinates exercise the actual composite's UV convention.
  const quadrants=new Uint8Array(64*32*4);
  for(let y=0;y<32;y++)for(let x=0;x<64;x++)quadrants.set([x<32?255:25,x<32?25:255,y<16?255:25,255],(x+y*64)*4);
  const map=texture(64,32,quadrants);
  const mapped=probe.draw(source,256,256,{...moonUniforms,u_camera:[0,0,8378.137],u_moonSun:[0,0,-1],u_moonBrightness:1,u_moonAlbedoMean:1,
    u_moonFixedFromEcef:[0,1,0,0,0,1,-1,0,0]}, {...inputs,u_moonAlbedo:map},true).pixels;
  const checks=[
    {name:'physical / double / enhanced diameters agree with gnomonic projection within 0.35 px',pass:diameters.every(d=>Math.abs(d.expected-d.measured)<.35),diameters},
    {name:'dark Moon removes stars while retaining foreground air in-scattering',pass:Math.abs(sample(p,128,128)-expectedAir)<1e-5&&sample(p,5,240)>expectedAir+.001,expectedAir,inside:sample(p,128,128),outside:sample(p,5,240)},
    {name:'depth-covered pixels keep the surface and receive neither disc nor halo',pass:Math.abs(sample(terrain,128,128)-sample(noDiscs,128,128))<1e-7},
    {name:'east is screen-right and lunar north is screen-up, without flipped upload or mirror',pass:sample(mapped,106,150,0)>5*sample(mapped,106,150,1)&&sample(mapped,150,150,1)>5*sample(mapped,150,150,0)&&sample(mapped,150,150,2)>5*sample(mapped,150,106,2)},
  ];
  const debug=gl.getExtension('WEBGL_debug_renderer_info');
  result.textContent=JSON.stringify({passed:checks.every(c=>c.pass),utc:time,observer:Cartesian3.pack(observer,[]),fovy:60,drawingBuffer:[1920,1080],renderer:debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),checks},null,2);
  for(const t of textures)gl.deleteTexture(t);probe.destroy();document.title=checks.every(c=>c.pass)?'PASS · Celestial optics':'FAIL · Celestial optics';
}catch(error){result.textContent=String(error);document.title='ERROR · Celestial optics';}
