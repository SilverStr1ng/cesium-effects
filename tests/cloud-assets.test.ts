import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createHash} from 'node:crypto';
import {assetTransferables,CLOUD_ASSET_VERSION,generateFixedCloudAssets,generateWeatherAsset,validFixedCloudAssets,validWeatherAsset} from '../src/effects/global-clouds/CloudAssets';

test('versioned cloud cache validates layouts and transfer keeps every byte without cloning twice',()=>{
  const fixed=generateFixedCloudAssets([]),weather=generateWeatherAsset(13,[]),payload={seed:13,weather,fixed};
  assert.ok(validFixedCloudAssets(fixed));assert.ok(validWeatherAsset({version:CLOUD_ASSET_VERSION,seed:13,weather},13));
  assert.equal(validFixedCloudAssets({...fixed,version:CLOUD_ASSET_VERSION-1}),false);
  assert.equal(validFixedCloudAssets({...fixed,noise:{...fixed.noise,bytes:new Uint8Array(1)}}),false);
  assert.equal(validWeatherAsset({version:CLOUD_ASSET_VERSION,seed:12,weather},13),false);
  const buffers=assetTransferables(payload),hash=(data:ArrayBuffer[])=>{const h=createHash('sha256');data.forEach(b=>h.update(new Uint8Array(b)));return h.digest('hex');};
  const before=hash(buffers),byteLength=buffers.reduce((n,b)=>n+b.byteLength,0);
  assert.equal(byteLength,16_314_560);assert.equal(new Set(buffers).size,buffers.length);
  const received=structuredClone(payload,{transfer:buffers});
  assert.ok(buffers.every(b=>b.byteLength===0));assert.equal(validFixedCloudAssets(fixed),false);
  assert.ok(validFixedCloudAssets(received.fixed));assert.equal(hash(assetTransferables(received)),before);
});
