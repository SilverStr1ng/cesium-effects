import common from '../src/effects/hillaire-atmosphere/shaders/common.glsl?raw';
import skyParameters from '../src/effects/hillaire-atmosphere/shaders/sky-view-parameters.glsl?raw';
import transport from '../src/effects/hillaire-atmosphere/shaders/integrate.glsl?raw';
import composite from '../src/effects/hillaire-atmosphere/shaders/composite.glsl?raw';
import display from '../src/scene/display.glsl?raw';

const output=document.querySelector('#result')!;
try{
  const gl=document.querySelector<HTMLCanvasElement>('#probe')!.getContext('webgl2')!;
  if(!gl)throw new Error('WebGL2 unavailable');
  const shader=(type:number,source:string)=>{const s=gl.createShader(type)!;gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(s)!);return s;};
  const vertex=shader(gl.VERTEX_SHADER,`#version 300 es
    out vec2 v_textureCoordinates;void main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);v_textureCoordinates=p;gl_Position=vec4(p*2.-1.,0,1);}`);
  const fragment=shader(gl.FRAGMENT_SHADER,`#version 300 es
    precision highp float;out vec4 out_FragColor;
    const mat4 czm_inverseProjection=mat4(1),czm_inverseView=mat4(1);const vec4 czm_viewport=vec4(0,0,256,256);
    vec4 czm_windowToEyeCoordinates(vec2 uv,float depth){return vec4(0,0,1,1);}
    `+common+skyParameters+display+transport+composite);
  const program=gl.createProgram()!;gl.attachShader(program,vertex);gl.attachShader(program,fragment);gl.linkProgram(program);
  if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(program)!);gl.useProgram(program);
  const textures:WebGLTexture[]=[];
  for(const [unit,names,value] of [[0,['u_skyView','u_multiple','depthTexture'],0],[1,['u_transmittance'],255],[2,['colorTexture','u_moonAlbedo'],128]] as const){
    const texture=gl.createTexture()!;textures.push(texture);gl.activeTexture(gl.TEXTURE0+unit);gl.bindTexture(gl.TEXTURE_2D,texture);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA8,1,1,0,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array([value,value,value,255]));
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
    for(const name of names)gl.uniform1i(gl.getUniformLocation(program,name),unit);
  }
  const vector=(name:string,v:readonly number[])=>gl.uniform3f(gl.getUniformLocation(program,name),v[0],v[1],v[2]);
  const scalar=(name:string,v:number)=>gl.uniform1f(gl.getUniformLocation(program,name),v);
  vector('u_camera',[0,0,8378.137]);vector('u_medium',[0,0,0]);vector('u_sun',[0,0,-1]);vector('u_sunDisc',[1,0,0]);vector('u_moonDisc',[0,0,1]);
  scalar('u_sunRadius',.12);scalar('u_moonRadius',.2);scalar('u_moonBrightness',2.4);scalar('u_exposure',8);
  scalar('u_sunBrightness',1);scalar('u_sunHaloRadius',.12);scalar('u_sunHaloBrightness',1);scalar('u_moonAlbedoMean',128/255);
  gl.uniformMatrix3fv(gl.getUniformLocation(program,'u_moonFixedFromEcef'),false,[1,0,0,0,1,0,0,0,1]);
  const run=()=>{gl.drawArrays(gl.TRIANGLES,0,3);const pixels=new Uint8Array(256*256*4);gl.readPixels(0,0,256,256,gl.RGBA,gl.UNSIGNED_BYTE,pixels);if(gl.getError()!==gl.NO_ERROR)throw new Error('WebGL draw error');return pixels;};
  const phases=[[0,0,-1],[1,0,0],[-1,0,0],[0,0,1]].map(sun=>{vector('u_moonSun',sun);return run();});
  const stats=phases.map(pixels=>{
    let count=0,lit=0,left=0,right=0;
    for(let y=0;y<256;y++)for(let x=0;x<256;x++){
      const u=(x+.5)/128-1,v=(y+.5)/128-1;
      if(Math.hypot(u,v)>.19)continue;
      const value=pixels[(x+y*256)*4];count++;if(value>12)lit++;if(x<128)left+=value;else right+=value;
    }
    return {fraction:lit/count,left,right};
  });
  const center=(128+128*256)*4,space=(5+5*256)*4;
  const darkOccults=phases[3][center]<phases[3][space];
  vector('u_moonDisc',[1,0,0]);vector('u_sunDisc',[0,0,1]);vector('u_sun',[0,0,1]);
  gl.disable(gl.DITHER);
  const solarPixels=run(),solar=solarPixels[center]/255,solarRadiance=solar*solar/(1-solar*solar);
  // Smooth halo values fall between byte levels. The spatial mean must retain
  // that fractional signal rather than drawing a coherent quantization ring.
  const y=Math.pow(128/255,2.2),a=2.51-2.43*y,b=.59*y-.03;
  const background=(b+Math.sqrt(b*b+.56*y*a))/(2*a*8)*.005;
  const buckets=Array.from({length:4},()=>({count:0,error:0}));
  for(let py=0;py<256;py++)for(let px=0;px<256;px++){
    const angle=Math.atan(Math.hypot((px+.5)/128-1,(py+.5)/128-1));
    if(angle<.2||angle>.65)continue;
    const radiance=background+Math.exp(-angle/.12*.75)*.0384;
    const expected=255*Math.sqrt(radiance/(1+radiance));
    const bucket=buckets[Math.min(3,Math.floor((expected%1)*4))];
    bucket.count++;bucket.error+=solarPixels[(px+py*256)*4]-expected;
  }
  const haloBias=buckets.map(bucket=>bucket.error/bucket.count);
  vector('u_camera',[0,6378.937,0]);
  const horizon=run(),lower=(128+120*256)*4,upper=(128+136*256)*4;
  const checks=[
    {name:'full, opposite quarters and new Moon retain their geometric lit area',pass:stats[0].fraction>.98&&Math.abs(stats[1].fraction-.5)<.08&&Math.abs(stats[2].fraction-.5)<.08&&stats[3].fraction===0,stats},
    {name:'quarter terminator faces the active sun on either side',pass:stats[1].right>stats[1].left*5&&stats[2].left>stats[2].right*5},
    {name:'dark lunar hemisphere occults background stars',pass:darkOccults},
    {name:'RGBA8 sky output retains solar HDR for cloud transmission',pass:Math.abs(solarRadiance-8.0384)<.5,solarRadiance},
    {name:'solar halo preserves sub-byte gradients without coherent quantization rings',pass:buckets.every(bucket=>bucket.count>100)&&haloBias.every(bias=>Math.abs(bias)<.1),haloBias}
    ,{name:'solar disc uses each pixel ray: lower half blocked while upper half remains visible',pass:horizon[lower]<2&&horizon[upper]>200,lower:horizon[lower],upper:horizon[upper]}
  ];
  for(const t of textures)gl.deleteTexture(t);gl.deleteProgram(program);gl.deleteShader(vertex);gl.deleteShader(fragment);
  output.textContent=JSON.stringify({passed:checks.every(c=>c.pass),checks},null,2);document.title=checks.every(c=>c.pass)?'PASS · Celestial GPU':'FAIL · Celestial GPU';
}catch(error){output.textContent=String(error);document.title='ERROR · Celestial GPU';}
