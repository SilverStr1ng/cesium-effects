import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LbmSolver, W, CX, CY, CZ } from '../src/effects/lbm-tornado/LbmSolver.ts';
import { defaults } from '../src/effects/lbm-tornado/config.ts';

test('D3Q19 conserves zeroth and second equilibrium moments', () => {
  assert.ok(Math.abs(W.reduce((a,b)=>a+b,0)-1)<1e-12);
  for (const axis of [CX,CY,CZ]) {
    let first=0,second=0;
    for(let q=0;q<19;q++){first+=W[q]*axis[q];second+=W[q]*axis[q]*axis[q];}
    assert.ok(Math.abs(first)<1e-12);
    assert.ok(Math.abs(second-1/3)<1e-12);
  }
});

test('unforced fluid stays at rest and preserves unit density', () => {
  const solver=new LbmSolver(10,10,16,{...defaults,swirl:0,updraft:0,turbulence:0});
  for(let n=0;n<60;n++)solver.step();
  const metrics=solver.diagnostics();
  assert.ok(Math.abs(metrics.meanDensity-1)<1e-5);
  assert.ok(metrics.maxSpeed<1e-7);
});

test('forced vortex evolves density and produces circulation + updraft', () => {
  const solver=new LbmSolver(16,16,24);
  const before=solver.density.slice();
  for(let n=0;n<80;n++)solver.step();
  let circulation=0,updraft=0,change=0;
  for(let z=2;z<22;z++) for(let y=2;y<14;y++)for(let x=2;x<14;x++){
    const i=x+16*(y+16*z);
    circulation+=(x-7.5)*solver.velocity[i*3+1]-(y-7.5)*solver.velocity[i*3];
    updraft+=solver.velocity[i*3+2];
    change+=Math.abs(before[i]-solver.density[i]);
  }
  assert.ok(circulation>1,'positive circulation');
  assert.ok(updraft>1,'vertical transport');
  assert.ok(change>1,'density must evolve, not a static funnel');
});

test('parameter extrema remain finite and subsonic over 300 steps', () => {
  for(const radius of [.6,1.6]){
    const solver=new LbmSolver(12,12,20,{...defaults,swirl:2,updraft:2,turbulence:1,radius});
    for(let n=0;n<300;n++)solver.step();
    const metrics=solver.diagnostics();
    assert.ok(metrics.minDensity>.7,JSON.stringify(metrics));
    assert.ok(metrics.maxDensity<1.3,JSON.stringify(metrics));
    assert.ok(metrics.maxSpeed<.3,JSON.stringify(metrics));
    assert.ok(solver.density.every(v=>Number.isFinite(v)&&v>=0&&v<=1));
  }
});

test('density atlas preserves every voxel and pads unused slices',()=>{
  const solver=new LbmSolver(6,7,11);
  for(let i=0;i<solver.size;i++)solver.density[i]=(i%255)/255;
  const atlas=solver.toAtlas(),columns=4,width=columns*6;
  assert.equal(atlas.length,24*21*4);
  for(let z=0;z<11;z++)for(let y=0;y<7;y++)for(let x=0;x<6;x++){
    const dst=((z%columns)*6+x+width*(Math.floor(z/columns)*7+y))*4;
    assert.equal(atlas[dst],(x+6*(y+7*z))%255);
    assert.equal(atlas[dst+3],255);
  }
  assert.equal(atlas[atlas.length-1],0);
});

test('reset is deterministic and changing parameters changes the field',()=>{
  const a=new LbmSolver(10,10,16),b=new LbmSolver(10,10,16);
  assert.deepEqual(a.toAtlas(),b.toAtlas());
  b.parameters={...defaults,swirl:0,updraft:0,turbulence:0};
  for(let n=0;n<20;n++){a.step();b.step();}
  assert.notDeepEqual(a.velocity,b.velocity);
});
