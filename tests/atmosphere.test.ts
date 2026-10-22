import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PLANET_RADIUS,mediumAt,sphereInterval,transmittance,atmosphereDefaults} from '../src/effects/hillaire-atmosphere/atmosphereMath.ts';

test('planet intersections distinguish ground, horizon, orbit and empty space',()=>{
  const R=PLANET_RADIUS;
  assert.equal(sphereInterval([0,0,R+1],[1,0,0],R),null);
  const ground=sphereInterval([0,0,R+1],[0,0,-1],R)!;
  assert.ok(Math.abs(ground[0]-1)<1e-6);
  assert.ok(sphereInterval([0,0,R+1],[0,0,1],R)![1]<0);
  assert.ok(sphereInterval([0,0,R+17000],[0,0,-1],R+100)![0]>0);
});
test('medium extinction is nonnegative and includes absorption',()=>{
  for(const h of [0,1,8,25,40,100]){
    const m=mediumAt(h);
    m.extinction.forEach((e,i)=>assert.ok(e>=m.scattering[i]&&Number.isFinite(e)));
  }
  assert.ok(mediumAt(0).extinction[2]>mediumAt(20).extinction[2]);
});
test('transmission obeys vacuum, ground occlusion and spectral extinction',()=>{
  assert.deepEqual(transmittance(1,-1),[0,0,0]);
  assert.deepEqual(transmittance(1,1,{...atmosphereDefaults,rayleigh:0,mie:0,ozone:0}),[1,1,1]);
  const zenith=transmittance(.1,1),horizon=transmittance(.1,0),space=transmittance(80,1);
  assert.ok(zenith[0]>zenith[2]);
  for(let c=0;c<3;c++){assert.ok(horizon[c]<zenith[c]);assert.ok(space[c]>zenith[c]);assert.ok(space[c]<=1);}
  const fine=transmittance(.1,.2,atmosphereDefaults,512),coarse=transmittance(.1,.2,atmosphereDefaults,64);
  for(let c=0;c<3;c++)assert.ok(Math.abs(fine[c]-coarse[c])<.015);
});
