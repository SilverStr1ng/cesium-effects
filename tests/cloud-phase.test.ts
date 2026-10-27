import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {test} from 'node:test';

// Execute the scalar production expression, also tested as real GLSL by the
// grazing GPU fixture. No independent replacement formula under test.
const source=readFileSync(new URL('../src/effects/global-clouds/shaders/droplet-lighting.glsl',import.meta.url),'utf8');
const body=source.match(/float waterPhase\(float c,float g\)\{([^}]+)\}/)![1];
const phase=new Function('c','g','const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));'+body.replace(/\bPI\b/g,'Math.PI').replace(/\b(pow|max|min)\(/g,'Math.$1(')) as (c:number,g:number)=>number;
for(const g of [0,.72,.78,.88,.9])test(`production HG g=${g}: normalized, finite, correct forward peak`,()=>{
  const peak=(1+g)/(4*Math.PI*(1-g)**2);
  assert.ok(Math.abs(phase(1,g)-peak)<1e-8,`peak ${phase(1,g)}; expected ${peak}`);
  let sum=0;const count=262144;
  for(let i=0;i<count;i++){const p=phase(-1+2*(i+.5)/count,g);assert.ok(Number.isFinite(p)&&p>=0);sum+=p*4*Math.PI/count;}
  assert.ok(Math.abs(sum-1)<1e-6,`sphere integral ${sum}`);
});
