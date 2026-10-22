import {test} from 'node:test';
import assert from 'node:assert/strict';
import {distanceTransform,createVoxelCloudField,DISTANCE_RANGE} from '../src/effects/global-clouds/VoxelCloudField';

test('3D Euclidean transform agrees with brute force for both signs',()=>{
  const size=7,mask=Uint8Array.from({length:size**3},(_,i)=>((i*17+i*i*3)%23)<4?1:0);
  for(const occupied of [true,false]){
    const result=distanceTransform(mask,size,occupied);
    for(let i=0;i<mask.length;i++){
      const x=i%size,y=Math.floor(i/size)%size,z=Math.floor(i/size**2);let expected=Infinity;
      for(let j=0;j<mask.length;j++)if(Boolean(mask[j])===occupied)
        expected=Math.min(expected,(x-j%size)**2+(y-Math.floor(j/size)%size)**2+(z-Math.floor(j/size**2))**2);
      assert.equal(result[i],expected);
    }
  }
});
test('uniform volumes have finite empty and full distance transforms',()=>{
  for(const value of [0,1]){
    const mask=new Uint8Array(64).fill(value);
    assert.ok(distanceTransform(mask,4,Boolean(value)).every(v=>v===0));
    assert.ok(distanceTransform(mask,4,!Boolean(value)).every(v=>Number.isFinite(v)&&v>=1e11));
  }
});
test('baked distance never crosses density support or a periodic tile boundary',()=>{
  const size=32,{bytes,mips}=createVoxelCloudField(size);
  const mask=Uint8Array.from({length:size**3},(_,i)=>bytes[i*4]>0?1:0),exact=distanceTransform(mask,size);
  let empty=0,solid=0;
  for(let i=0;i<mask.length;i++){
    const x=i%size,y=Math.floor(i/size)%size,z=Math.floor(i/size**2),d=bytes[i*4+1]/255*DISTANCE_RANGE;
    assert.ok(d<=Math.max(0,Math.min(Math.sqrt(exact[i]),x,y,z,size-1-x,size-1-y,size-1-z)-2*Math.sqrt(3))+1e-6);
    if(mask[i]){solid++;assert.equal(d,0);}else empty++;
  }
  assert.ok(solid>100&&empty>100);assert.equal(mips.at(-1)?.length,4);
});
