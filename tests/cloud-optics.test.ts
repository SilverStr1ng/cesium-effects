import {test} from 'node:test';
import assert from 'node:assert/strict';
import {meanColumnOpacity,meanColumnReflectance} from '../src/effects/global-clouds/CloudOptics.ts';
import {createCirrusField} from '../src/effects/global-clouds/CirrusField.ts';

test('unresolved columns preserve clear area instead of exponentiating average density',()=>{
  const columns=[0,0,0,40];
  assert.ok(Math.abs(meanColumnOpacity(columns,1)-.25)<1e-10);
  assert.equal(meanColumnOpacity(columns,0),0);
  assert.ok(meanColumnOpacity(columns,.01)<meanColumnOpacity(columns,.1));
  assert.ok(1-Math.exp(-10)>.99,'averaging density would incorrectly produce an opaque sheet');
});
test('conditional slab reflectance is bounded and vanishes in vacuum',()=>{
  assert.equal(meanColumnReflectance([0,0],4),0);
  assert.ok(meanColumnReflectance([0,0,40],1)>.7);
  for(const scale of [.01,.1,1,10,100]){
    const r=meanColumnReflectance([0,.1,3,40],scale);assert.ok(r>=0&&r<1);
  }
});
test('cirrus mip chain preserves already-shaped extinction',()=>{
  const {bytes,mips}=createCirrusField();
  const mean=(data:Uint8Array,c:number)=>{let sum=0;for(let i=c;i<data.length;i+=4)sum+=data[i];return sum/(data.length/4);};
  for(const channel of [0,1,2])for(const mip of mips)
    assert.ok(Math.abs(mean(bytes,channel)-mean(mip,channel))<1.5,'optical mass must survive every mip');
});
test('ice transverse mip atlas preserves longitudinal structure and optical statistics',()=>{
  const {bytes,anisotropic,ribbon,ribbonMips}=createCirrusField();
  assert.equal(anisotropic.length,127*64*64*4);
  assert.equal(ribbonMips.at(-1)!.length,4);
  for(const y of [0,13,31,63])for(const z of [0,19,45,63])for(let c=0;c<4;c++){
    let sum=0;for(let x=0;x<64;x++)sum+=bytes[(x+64*(y+64*z))*4+c];
    assert.ok(Math.abs(anisotropic[(126+127*(y+64*z))*4+c]-sum/64)<2);
    assert.ok(Math.abs(ribbon[(y+64*z)*4+c]-sum/64)<=.5);
  }
  const values=Array.from(ribbon).filter((_,i)=>i%4===0);
  assert.ok(Math.max(...values)-Math.min(...values)>32,'collapsing the transverse axis must not collapse the whole cloud band');
});
