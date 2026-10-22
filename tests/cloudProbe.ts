import {gpuProbe} from './gpuProbe';
import {createCumulusNoise,CUMULUS_NOISE_SIZE} from '../src/effects/global-clouds/CumulusNoise';
import {createVoxelCloudField,VOXEL_SIZE} from '../src/effects/global-clouds/VoxelCloudField';
import {createCloudOptics,CLOUD_OPTICS_SIZE} from '../src/effects/global-clouds/CloudOptics';
import {createWeather,WEATHER_WIDTH,WEATHER_HEIGHT} from '../src/effects/global-clouds/WeatherField';

/** Real production assets shared by the spatial filtering probes. */
export function cloudProbe(canvas:HTMLCanvasElement){
  const gpu=gpuProbe(canvas),gl=gpu.gl,textures:WebGLTexture[]=[];
  const volume=(size:number,bytes:Uint8Array,mips:Uint8Array[]=[])=>{
    const texture=gl.createTexture()!;textures.push(texture);gl.bindTexture(gl.TEXTURE_3D,texture);
    [bytes,...mips].forEach((data,lod)=>{const n=size/2**lod;gl.texImage3D(gl.TEXTURE_3D,lod,gl.RGBA8,n,n,n,0,gl.RGBA,gl.UNSIGNED_BYTE,data);});
    for(const p of [gl.TEXTURE_WRAP_S,gl.TEXTURE_WRAP_T,gl.TEXTURE_WRAP_R])gl.texParameteri(gl.TEXTURE_3D,p,gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_3D,gl.TEXTURE_MIN_FILTER,mips.length?gl.LINEAR_MIPMAP_LINEAR:gl.LINEAR);gl.texParameteri(gl.TEXTURE_3D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    return {texture,target:gl.TEXTURE_3D};
  };
  const start=performance.now(),noise=createCumulusNoise(),voxel=createVoxelCloudField();
  const optics=createCloudOptics(voxel.bytes,noise.bytes);
  const weather=gl.createTexture()!;textures.push(weather);gl.bindTexture(gl.TEXTURE_2D,weather);
  gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA8,WEATHER_WIDTH,WEATHER_HEIGHT,0,gl.RGBA,gl.UNSIGNED_BYTE,createWeather(13));
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.REPEAT);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
  const inputs={u_weather:weather,u_noise:volume(CUMULUS_NOISE_SIZE,noise.bytes,noise.mips),u_voxels:volume(VOXEL_SIZE,voxel.bytes,voxel.mips),u_cloudOptics:volume(CLOUD_OPTICS_SIZE,optics)};
  const uniforms={u_columnGrid:Number(new URLSearchParams(location.search).get('columns')??12),u_base:1.5,u_thickness:3.8,u_coverage:.62,u_density:1.1,u_detail:.55,u_seed:13,u_windAngle:0,u_evolution:0,u_windSpeed:24,u_cloudType:0,
    u_highBase:9,u_highThickness:1.5,u_highCoverage:0,u_highAngle:0,u_opticsReady:true,u_voxelReady:true,u_skipVoxels:false};
  return {...gpu,inputs,uniforms,initializationMs:performance.now()-start,destroy(){gpu.destroy();for(const t of textures)gl.deleteTexture(t);}};
}
