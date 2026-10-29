import assert from 'node:assert/strict';
import {test} from 'node:test';
import {filteredMean,spatialMean} from './fixtures/stage6/farColumnReference';

const counterexamples=[
  {patch:5,footprint:28,mu:.25,grid:12,old:.432947019,reference:.377614323},
  {patch:3,footprint:4,mu:.1,grid:4,old:.444025717,reference:.512165883},
  {patch:5,footprint:4,mu:.04,grid:4,old:.624345483,reference:.411100718},
  {patch:0,footprint:4,mu:.1,grid:4,old:0,reference:.062043154},
];
for(const c of counterexamples)test(`same far-model spatial opacity patch ${c.patch}, ${c.footprint} km, mu ${c.mu}`,()=>{
  const old=spatialMean(c.patch,c.footprint,c.mu,c.grid)[0];
  const reference=spatialMean(c.patch,c.footprint,c.mu,192)[0],converged=spatialMean(c.patch,c.footprint,c.mu,384)[0];
  assert.ok(Math.abs(old-c.old)<1e-8);assert.ok(Math.abs(reference-c.reference)<1e-8);
  assert.ok(Math.abs(old-reference)>.02,'the regression must reproduce the old defect');
  assert.ok(Math.abs(reference-converged)<=.002,'reference self convergence');
  const actual=filteredMean(c.patch,c.footprint,c.mu);
  assert.ok(Math.abs(actual.moments[0]-reference)<=.02,`opacity ${actual.moments[0]}, reference ${reference}`);
  assert.ok(actual.taps<=432);
});
test('projected-support quadrature is continuous at grid and anisotropy transitions',()=>{
  // Continuity is not an accuracy test: finite rules can agree on a biased value.
  for(const mu of [.04,.1,.25,1/1.05,1/1.25,1])for(const rotation of [0,.37,Math.PI/4]){
    for(const footprint of [.35,1,2,4,8,12,36*mu]){
      const a=filteredMean(5,footprint-1e-5,mu,rotation),b=filteredMean(5,footprint+1e-5,mu,rotation);
      assert.ok(Math.abs(a.moments[0]-b.moments[0])<.001,JSON.stringify({footprint,mu,rotation,a:a.moments[0],b:b.moments[0]}));
      assert.ok(Math.abs(a.moments[4]-b.moments[4])<.001);
      assert.ok(a.taps<=576&&b.taps<=576);
    }
  }
});
test('rotated grazing footprints preserve the parallelogram measure and local holes',()=>{
  for(const c of counterexamples)for(const rotation of [.37,Math.PI/4,1.2]){
    const reference=spatialMean(c.patch,c.footprint,c.mu,192,192,rotation);
    const actual=filteredMean(c.patch,c.footprint,c.mu,rotation);
    assert.ok(Math.abs(actual.moments[0]-reference[0])<=.02,JSON.stringify({c,rotation,actual:actual.moments[0],reference:reference[0]}));
    assert.ok(Math.abs(actual.moments[4]-reference[4])<.002,'strip weights must conserve constant/smooth fields');
  }
});
