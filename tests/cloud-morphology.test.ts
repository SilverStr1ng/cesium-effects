import {test} from 'node:test';
import assert from 'node:assert/strict';
import {cloudMaterialPosition,cloudMaterialStretch,cloudBodyColumn,cloudResidualGate} from '../src/effects/global-clouds/CloudMorphology';
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

test('connected columns have true holes, variable tops and normalized optical mass',()=>{
 for(const type of [0,.5,1])for(const thickness of [1,3.8,8])for(const shape of [.2,.45,.6,.9])for(const cluster of [0,.3,1]){
  const body=cloudBodyColumn(shape,.7,type,cluster,thickness),height=thickness*(body.top-body.bottom);
  let integral=0;for(let i=0;i<4096;i++){const h=(i+.5)/4096;integral+=body.tau*12*h*(1-h)**2/4096;}
  assert.ok(body.bottom>=0&&body.top<=1&&height>0);
  assert.ok(Math.abs(integral-body.tau)<1e-6);
  if(shape===.2||cluster===0)assert.equal(body.tau,0,'zero support is a real column hole');
 }
 const sheet=cloudBodyColumn(.6,.7,0,.8,3.8),tower=cloudBodyColumn(.9,.7,1,.8,3.8);
 assert.ok(tower.top>sheet.top*2,'cumulus keeps vertical development');
});
test('predefined dense connected column at default density 1.1 supports a 200 metre thick core',()=>{
 // An explicit capability test, separate from the old geographical sample
 // whose count became zero at 87b6ff03. No search for a lucky world location.
 const body=cloudBodyColumn(.9,.7,1,1,3.8),height=3.8*(body.top-body.bottom),center=height/3;
 let tau=0;for(let i=0;i<1024;i++){const h=(center-.1+(i+.5)*.2/1024)/height;tau+=1.1*body.tau*12*h*(1-h)**2/height*.2/1024;}
 assert.ok(tau>1,`tau_200m=${tau}`);
});

test('voxel caps cannot populate an explicitly empty world column',()=>{
 assert.equal(cloudResidualGate(0),0);assert.equal(cloudResidualGate(.5),1);
 for(let i=0;i<=100;i++){const a=cloudResidualGate(i/200),b=cloudResidualGate((i+1)/200);assert.ok(a>=0&&a<=1&&b>=a);}
});
