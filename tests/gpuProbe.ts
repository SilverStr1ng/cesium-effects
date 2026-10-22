/** Small real-WebGL harness. Production GLSL is passed in without translation. */
export function gpuProbe(canvas:HTMLCanvasElement){
  const gl=canvas.getContext('webgl2');if(!gl)throw new Error('WebGL2 unavailable');
  if(!gl.getExtension('EXT_color_buffer_float'))throw new Error('Float readback required for numerical reference probes');
  gl.disable(gl.DITHER);
  const resources:{textures:WebGLTexture[];programs:WebGLProgram[];shaders:WebGLShader[];frames:WebGLFramebuffer[]}={textures:[],programs:[],shaders:[],frames:[]};
  const shader=(type:number,source:string)=>{const s=gl.createShader(type)!;resources.shaders.push(s);gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw new Error(gl.getShaderInfoLog(s)!);return s;};
  const vertex=shader(gl.VERTEX_SHADER,'#version 300 es\nout vec2 v_textureCoordinates;void main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);v_textureCoordinates=p;gl_Position=vec4(p*2.-1.,0,1);}');
  function draw(source:string,width:number,height:number,uniforms:Record<string,number|boolean|number[]>={},inputs:Record<string,WebGLTexture|{texture:WebGLTexture;target:number}>={},float=false,timer?:{target:number;query:WebGLQuery}){
    const texture=gl!.createTexture()!;resources.textures.push(texture);gl!.activeTexture(gl!.TEXTURE0);gl!.bindTexture(gl!.TEXTURE_2D,texture);
    gl!.texImage2D(gl!.TEXTURE_2D,0,float?gl!.RGBA32F:gl!.RGBA8,width,height,0,gl!.RGBA,float?gl!.FLOAT:gl!.UNSIGNED_BYTE,null);
    for(const p of [gl!.TEXTURE_WRAP_S,gl!.TEXTURE_WRAP_T])gl!.texParameteri(gl!.TEXTURE_2D,p,gl!.CLAMP_TO_EDGE);
    for(const p of [gl!.TEXTURE_MIN_FILTER,gl!.TEXTURE_MAG_FILTER])gl!.texParameteri(gl!.TEXTURE_2D,p,float?gl!.NEAREST:gl!.LINEAR);
    const frame=gl!.createFramebuffer()!;resources.frames.push(frame);gl!.bindFramebuffer(gl!.FRAMEBUFFER,frame);gl!.framebufferTexture2D(gl!.FRAMEBUFFER,gl!.COLOR_ATTACHMENT0,gl!.TEXTURE_2D,texture,0);
    if(gl!.checkFramebufferStatus(gl!.FRAMEBUFFER)!==gl!.FRAMEBUFFER_COMPLETE)throw new Error('Incomplete probe framebuffer');
    const program=gl!.createProgram()!;resources.programs.push(program);gl!.attachShader(program,vertex);gl!.attachShader(program,shader(gl!.FRAGMENT_SHADER,'#version 300 es\nprecision highp float;precision highp sampler3D;out vec4 out_FragColor;\n'+source));gl!.linkProgram(program);
    if(!gl!.getProgramParameter(program,gl!.LINK_STATUS))throw new Error(gl!.getProgramInfoLog(program)!);gl!.useProgram(program);
    for(const [name,v] of Object.entries(uniforms)){const location=gl!.getUniformLocation(program,name);if(typeof v==='boolean')gl!.uniform1i(location,Number(v));else if(typeof v==='number')gl!.uniform1f(location,v);else if(v.length===9)gl!.uniformMatrix3fv(location,false,v);else if(v.length===3)gl!.uniform3fv(location,v);else gl!.uniform2fv(location,v);}
    Object.entries(inputs).forEach(([name,t],unit)=>{gl!.activeTexture(gl!.TEXTURE0+unit);gl!.bindTexture('target' in t?t.target:gl!.TEXTURE_2D,'texture' in t?t.texture:t);gl!.uniform1i(gl!.getUniformLocation(program,name),unit);});
    gl!.viewport(0,0,width,height);
    // Time the draw itself, excluding shader setup and synchronous readback.
    if(timer)gl!.beginQuery(timer.target,timer.query);
    gl!.drawArrays(gl!.TRIANGLES,0,3);
    if(timer)gl!.endQuery(timer.target);
    const pixels=float?new Float32Array(width*height*4):new Uint8Array(width*height*4);
    gl!.readPixels(0,0,width,height,gl!.RGBA,float?gl!.FLOAT:gl!.UNSIGNED_BYTE,pixels);
    if(gl!.getError()!==gl!.NO_ERROR)throw new Error('WebGL probe draw failed');
    return {texture,pixels};
  }
  return {gl,draw,destroy(){for(const p of resources.programs)gl.deleteProgram(p);for(const s of resources.shaders)gl.deleteShader(s);for(const f of resources.frames)gl.deleteFramebuffer(f);for(const t of resources.textures)gl.deleteTexture(t);}};
}
