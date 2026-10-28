import {test} from 'node:test';
import assert from 'node:assert/strict';
import {cloudMaterialPosition,cloudMaterialStretch} from '../src/effects/global-clouds/CloudMorphology';
import {opticsMaterialKey} from '../src/effects/global-clouds/CloudOptics';

test('smooth material deformation respects the conservative global stretch bound',()=>{
 for(const wind of [0,24,80,120,200])for(const thickness of [.5,3.8,12])for(let i=0;i<512;i++){
  const z=1-2*(i+.5)/512,phi=i*2.39996323,n=[Math.sqrt(1-z*z)*Math.cos(phi),Math.sqrt(1-z*z)*Math.sin(phi),z],h=thickness*(i%17)/16;
  const p=n.map(v=>v*(6379.637+h)),d=[Math.sin(i*.37),Math.cos(i*.79),Math.sin(i*1.23)],norm=Math.hypot(...d),epsilon=.001;
  const a=cloudMaterialPosition(p,1.5,thickness,wind),b=cloudMaterialPosition(p.map((v,k)=>v+d[k]/norm*epsilon),1.5,thickness,wind);
  assert.ok(Math.hypot(...b.map((v,k)=>v-a[k]))/epsilon<=cloudMaterialStretch(wind));
 }
});
test('material position remains continuous at poles, dateline and zero wind',()=>{
 for(const center of [[0,0,6381],[-6381,0,0]])for(const wind of [0,.000001,120]){
  const a=cloudMaterialPosition(center.map((v,i)=>v+(i===1?-.00001:0)),1.5,3.8,wind),b=cloudMaterialPosition(center.map((v,i)=>v+(i===1?.00001:0)),1.5,3.8,wind);
  assert.ok(a.every(Number.isFinite));assert.ok(Math.hypot(...b.map((v,i)=>v-a[i]))<.00005);
 }
});
test('wind shear is adopted with its matching optical material; density stays a scale',()=>{
 const a={detail:.55,thickness:3.8};assert.equal(opticsMaterialKey(a),opticsMaterialKey({...a,wind:24}));assert.notEqual(opticsMaterialKey(a),opticsMaterialKey({...a,wind:120}));
 const p=[4200,-3200,Math.sqrt(6382**2-4200**2-3200**2)],a0=cloudMaterialPosition(p,1.5,3.8,0),a1=cloudMaterialPosition(p,1.5,3.8,120);
 assert.ok(Math.hypot(...a1.map((v,i)=>v-a0[i]))>.2);
});
