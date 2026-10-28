import {gpuProbe} from './gpuProbe';
import {createCirrusField} from '../src/effects/global-clouds/CirrusField';
import {createCumulusNoise,CUMULUS_NOISE_SIZE} from '../src/effects/global-clouds/CumulusNoise';
import {createVoxelCloudField,VOXEL_SIZE} from '../src/effects/global-clouds/VoxelCloudField';
import {createCloudOpticsData,CLOUD_OPTICS_SIZE} from '../src/effects/global-clouds/CloudOptics';
import {createWeather,WEATHER_WIDTH,WEATHER_HEIGHT} from '../src/effects/global-clouds/WeatherField';

/** Real production assets shared by the spatial filtering probes. */
export function cloudProbe(canvas:HTMLCanvasElement){
  const gpu=gpuProbe(canvas),gl=gpu.gl,textures:WebGLTexture[]=[];
  const volume=(size:number,bytes:Uint8Array,mips:Uint8Array[]=[],width=size)=>{
    const texture=gl.createTexture()!;textures.push(texture);gl.bindTexture(gl.TEXTURE_3D,texture);
    [bytes,...mips].forEach((data,lod)=>{const n=size/2**lod;gl.texImage3D(gl.TEXTURE_3D,lod,gl.RGBA8,width/2**lod,n,n,0,gl.RGBA,gl.UNSIGNED_BYTE,data);});
    for(const p of [gl.TEXTURE_WRAP_S,gl.TEXTURE_WRAP_T,gl.TEXTURE_WRAP_R])gl.texParameteri(gl.TEXTURE_3D,p,gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_3D,gl.TEXTURE_MIN_FILTER,mips.length?gl.LINEAR_MIPMAP_LINEAR:gl.LINEAR);gl.texParameteri(gl.TEXTURE_3D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    return {texture,target:gl.TEXTURE_3D};
  };
  const start=performance.now(),noise=createCumulusNoise(),voxel=createVoxelCloudField();
  const {optics,components}=createCloudOpticsData(voxel.bytes,noise.bytes);
  const weather=gl.createTexture()!;textures.push(weather);gl.bindTexture(gl.TEXTURE_2D,weather);
  gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA8,WEATHER_WIDTH,WEATHER_HEIGHT,0,gl.RGBA,gl.UNSIGNED_BYTE,createWeather(13));
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.REPEAT);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
  const ice=createCirrusField();
  const ribbon=gl.createTexture()!;textures.push(ribbon);gl.bindTexture(gl.TEXTURE_2D,ribbon);
  [ice.ribbon,...ice.ribbonMips].forEach((bytes,lod)=>{const size=CUMULUS_NOISE_SIZE/2**lod;gl.texImage2D(gl.TEXTURE_2D,lod,gl.RGBA8,size,size,0,gl.RGBA,gl.UNSIGNED_BYTE,bytes);});
  for(const p of [gl.TEXTURE_WRAP_S,gl.TEXTURE_WRAP_T])gl.texParameteri(gl.TEXTURE_2D,p,gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR_MIPMAP_LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
  const componentTexture=gl.createTexture()!;textures.push(componentTexture);gl.bindTexture(gl.TEXTURE_3D,componentTexture);
  gl.texImage3D(gl.TEXTURE_3D,0,gl.RGBA8,32,32,8,0,gl.RGBA,gl.UNSIGNED_BYTE,components);
  for(const p of [gl.TEXTURE_MIN_FILTER,gl.TEXTURE_MAG_FILTER])gl.texParameteri(gl.TEXTURE_3D,p,gl.LINEAR);
  const inputs={u_weather:weather,u_noise:volume(CUMULUS_NOISE_SIZE,noise.bytes,noise.mips),u_voxels:volume(VOXEL_SIZE,voxel.bytes,voxel.mips),u_cloudOptics:volume(CLOUD_OPTICS_SIZE,optics),u_cloudComponents:{texture:componentTexture,target:gl.TEXTURE_3D},u_cirrus:volume(CUMULUS_NOISE_SIZE,ice.bytes,ice.mips),u_iceRibbon:ribbon,u_iceAnisotropic:volume(64,ice.anisotropic,[],127)};
  const uniforms={u_columnGrid:Number(new URLSearchParams(location.search).get('columns')??12),u_columnSections:2,u_columnQuadrature:4,u_columnOrders:3,u_columnComponents:8,u_base:1.5,u_thickness:3.8,u_coverage:.62,u_density:1.1,u_detail:.55,u_seed:13,u_windAngle:0,u_evolution:0,u_windSpeed:24,u_cloudType:0,
    u_highBase:9,u_highThickness:1.5,u_highCoverage:0,u_highAngle:0,u_highType:0,u_highOpticalDepth:.35,u_highAnisotropy:.78,u_highAlbedo:.98,u_highMultiple:.12,u_highFilterGrid:4,u_opticsReady:true,u_voxelReady:true,u_skipVoxels:false};
  return {...gpu,inputs,uniforms,initializationMs:performance.now()-start,destroy(){gpu.destroy();for(const t of textures)gl.deleteTexture(t);}};
}
