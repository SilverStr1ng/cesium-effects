import {createCumulusNoise,CUMULUS_NOISE_SIZE} from './CumulusNoise';
import {createWeather,WEATHER_WIDTH,WEATHER_HEIGHT} from './WeatherField';
import {createCirrusField} from './CirrusField';
import {createVoxelCloudField,VOXEL_SIZE} from './VoxelCloudField';
import {createCloudOpticsData,CLOUD_OPTICS_SIZE,CLOUD_COMPONENTS,CLOUD_OPTICS_VERSION} from './CloudOptics';
import {measureResource,type ResourceTiming} from './CloudInitialization';

// Increment when WeatherField, CloudNoise, CumulusNoise, VoxelCloudField,
// CirrusField or CloudOptics changes its data/layout/material law. Rendering
// quality, HDR and weather seed do not change the fixed-material record.
export const CLOUD_ASSET_VERSION=3;
export interface VolumeAsset {bytes:Uint8Array;mips:Uint8Array[];}
export interface FixedCloudAssets {version:number;opticsVersion:number;noise:VolumeAsset;ice:ReturnType<typeof createCirrusField>;voxel:VolumeAsset;optics:Uint8Array;components:Uint8Array;}
export interface CloudAssetPayload {seed:number;weather:Uint8Array;fixed?:FixedCloudAssets;}
export function generateFixedCloudAssets(timings:ResourceTiming[],thread:ResourceTiming['thread']='worker'):FixedCloudAssets{
  const noise=measureResource(timings,'noise',thread,createCumulusNoise);
  const ice=measureResource(timings,'cirrus',thread,createCirrusField);
  const voxel=measureResource(timings,'voxel',thread,createVoxelCloudField);
  const optical=measureResource(timings,'optics',thread,()=>createCloudOpticsData(voxel.bytes,noise.bytes));
  return {version:CLOUD_ASSET_VERSION,opticsVersion:CLOUD_OPTICS_VERSION,noise,ice,voxel,...optical};
}
export function generateWeatherAsset(seed:number,timings:ResourceTiming[],thread:ResourceTiming['thread']='worker'){
  return measureResource(timings,'weather',thread,()=>createWeather(seed));
}
const bytes=(v:unknown,size:number)=>v instanceof Uint8Array&&v.byteLength===size;
const volume=(v:VolumeAsset|undefined,size:number)=>Boolean(v&&bytes(v.bytes,size**3*4)&&Array.isArray(v.mips)&&v.mips.length===Math.log2(size)&&v.mips.every((m,i)=>bytes(m,(size/2**(i+1))**3*4)));
/** Reject stale, detached, truncated or incompatible cache records. */
export function validFixedCloudAssets(value:unknown):value is FixedCloudAssets{
  if(!value||typeof value!=='object')return false;const a=value as FixedCloudAssets;
  return a.version===CLOUD_ASSET_VERSION&&a.opticsVersion===CLOUD_OPTICS_VERSION&&volume(a.noise,CUMULUS_NOISE_SIZE)&&volume(a.ice,CUMULUS_NOISE_SIZE)&&volume(a.voxel,VOXEL_SIZE)&&
    bytes(a.optics,CLOUD_OPTICS_SIZE**3*4)&&bytes(a.components,CLOUD_OPTICS_SIZE**2*CLOUD_COMPONENTS*4)&&bytes(a.ice.ribbon,64*64*4)&&bytes(a.ice.anisotropic,127*64*64*4)&&
    Array.isArray(a.ice.ribbonMips)&&a.ice.ribbonMips.length===6&&a.ice.ribbonMips.every((m,i)=>bytes(m,(64/2**(i+1))**2*4));
}
export function validWeatherAsset(value:unknown,seed:number):value is {version:number;seed:number;weather:Uint8Array}{
  if(!value||typeof value!=='object')return false;const a=value as {version:number;seed:number;weather:Uint8Array};
  return a.version===CLOUD_ASSET_VERSION&&a.seed===seed&&bytes(a.weather,WEATHER_WIDTH*WEATHER_HEIGHT*4);
}
export function assetTransferables(data:CloudAssetPayload){
  const views:Uint8Array[]=[data.weather],f=data.fixed;
  if(f)views.push(f.noise.bytes,...f.noise.mips,f.ice.bytes,...f.ice.mips,f.ice.ribbon,...f.ice.ribbonMips,f.ice.anisotropic,f.voxel.bytes,...f.voxel.mips,f.optics,f.components);
  return [...new Set(views.map(v=>v.buffer as ArrayBuffer))];
}
