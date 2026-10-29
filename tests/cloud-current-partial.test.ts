import assert from 'node:assert/strict';
import {test} from 'node:test';
import {filteredMean,spatialMean} from './farColumnReference';
for(const patch of [0,3,5,7])for(const h0 of [0,.2,.5,.8])test(`current morphology partial patch ${patch}, F28, h0 ${h0}`,()=>{
 const fraction=1-h0*h0*(6-8*h0+3*h0*h0),response=(f:number)=>1-filteredMean(patch,28,1,0,1.1,3.8,f,true).moments[0];
 const opacity=1-response(fraction),ref=spatialMean(patch,28,1,192,192,0,1.1,3.8,fraction)[0],fine=spatialMean(patch,28,1,384,384,0,1.1,3.8,fraction)[0];
 assert.ok(Math.abs(opacity-fine)<=.02,JSON.stringify({opacity,fine,error:opacity-fine}));assert.ok(Math.abs(ref-fine)<=.002);
 let T=1,prior=1;for(let i=1;i<=16;i++){const Q=response(fraction*i/16);T*=Q/prior;prior=Q;}assert.ok(Math.abs(T-response(fraction))<1e-12);
});
