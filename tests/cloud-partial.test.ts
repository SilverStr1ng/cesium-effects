import assert from 'node:assert/strict';
import {test} from 'node:test';
// Freeze the original diagnostic inputs: stage 7 morphology must not erase
// the historical Jensen counterexample by changing its density field.
import {filteredMean,spatialMean} from './fixtures/stage6/farColumnReference';
const remaining=(h:number)=>1-h*h*(6-8*h+3*h*h);
for(const patch of [0,3,5,7])for(const h0 of [0,.2,.5,.8])test(`finite common-profile response patch ${patch}, F28, h0 ${h0}`,()=>{
  const fraction=remaining(h0),response=(f:number)=>1-filteredMean(patch,28,1,0,1.1,3.8,f).moments[0];
  const opacity=1-response(fraction),ref=spatialMean(patch,28,1,192,192,0,1.1,3.8,fraction)[0],fine=spatialMean(patch,28,1,384,384,0,1.1,3.8,fraction)[0];
  assert.ok(Math.abs(opacity-fine)<=.02,JSON.stringify({opacity,fine}));assert.ok(Math.abs(ref-fine)<=.002);
  const components=filteredMean(patch,28,1,0,1.1,3.8,fraction,true).moments[0];
  assert.ok(Math.abs(components-fine)<=.02,JSON.stringify({components,fine}));
  // Same correlated distribution, with Q(0)=1 at the actual observation point.
  let T=1,prior=1;for(let i=1;i<=16;i++){const Q=response(fraction*i/16);T*=Q/prior;prior=Q;}
  assert.ok(Math.abs(T-response(fraction))<1e-12);
  if(patch===7&&h0===.5){
    const old=1-response(1)**fraction;
    assert.ok(Math.abs(old-.370206001)<1e-6);assert.ok(Math.abs(fine-.707817710)<1e-6);
    assert.ok(Math.abs(old-fine)>.3,'retain the original Jensen counterexample');
  }
});
