import {test} from 'node:test';
import assert from 'node:assert/strict';
import {cloudSegments,weatherAt,createWeather,WEATHER_WIDTH,WEATHER_HEIGHT} from '../src/effects/global-clouds/WeatherField.ts';
import {PLANET_RADIUS as R} from '../src/effects/hillaire-atmosphere/atmosphereMath.ts';
import {volumeMipChain} from '../src/effects/global-clouds/CumulusNoise.ts';

test('cloud shell clips against planet and scene depth at ground, inside and orbital scales',()=>{
  assert.deepEqual(cloudSegments([0,0,R+.8],[0,0,-1]),[]);
  const below=cloudSegments([0,0,R+.8],[0,0,1]);
  assert.equal(below.length,1);assert.ok(Math.abs(below[0][0]-.7)<1e-6);assert.ok(Math.abs(below[0][1]-4.5)<1e-6);
  const inside=cloudSegments([0,0,R+3],[0,0,-1]);
  assert.equal(inside.length,1);assert.equal(inside[0][0],0);assert.ok(Math.abs(inside[0][1]-1.5)<1e-6);
  const orbit=cloudSegments([0,0,R+17000],[0,0,-1]);
  assert.equal(orbit.length,1);assert.ok(Math.abs(orbit[0][1]-16998.5)<1e-5);
  assert.deepEqual(cloudSegments([0,0,R+.8],[0,0,1],1.5,3.8,.3),[]);
  assert.deepEqual(cloudSegments([0,0,R+17000],[1,0,0]),[]);
});
test('tangent paths can cross both sides of the shell without crossing the planet',()=>{
  const p=[-100,0,R+1],segments=cloudSegments(p,[1,0,0]);
  assert.equal(segments.length,2);assert.ok(segments[0][1]<segments[1][0]);
  for(const [a,b] of segments){const t=(a+b)/2;const h=Math.hypot(p[0]+t,p[1],p[2])-R;assert.ok(h>1.5&&h<5.3);}
});
test('weather is continuous across longitude seam and at both poles',()=>{
  for(const lat of [-1.4,-.3,0,.5,1.4]){
    const a=weatherAt(-Math.PI,lat),b=weatherAt(Math.PI,lat);
    a.forEach((v,i)=>assert.ok(Math.abs(v-b[i])<1e-12));
  }
  for(const lat of [-Math.PI/2,Math.PI/2]){
    const a=weatherAt(0,lat),b=weatherAt(2.1,lat);
    a.forEach((v,i)=>assert.ok(Math.abs(v-b[i])<1e-12));
  }
  const first=createWeather(),second=createWeather();assert.deepEqual(first,second);
  assert.equal(first.length,WEATHER_WIDTH*WEATHER_HEIGHT*4);
  for(const row of [0,WEATHER_HEIGHT-1])for(let x=1;x<WEATHER_WIDTH;x++)for(let c=0;c<4;c++)
    assert.equal(first[(row*WEATHER_WIDTH+x)*4+c],first[row*WEATHER_WIDTH*4+c],'pole texels must be independent of longitude');
});

test('weather seeds change the same planetary locations deterministically',()=>{
  let change=0;
  for(let i=0;i<128;i++){
    const lon=i*.137-3,lat=Math.sin(i*.71)*1.5;
    const a=weatherAt(lon,lat,13),b=weatherAt(lon,lat,144);
    assert.deepEqual(a,weatherAt(lon,lat,13));
    a.forEach((v,c)=>{assert.ok(v>=0&&v<=1);change+=(v-b[c])**2;});
  }
  assert.ok(Math.sqrt(change/(128*4))>.1,'a new seed must change cloud coverage and regional structure');
});

test('volume mip levels preserve a constant field and integrate alternating texels',()=>{
  const constant=new Uint8Array(8**3*4).fill(73),levels=volumeMipChain(constant,8);
  assert.deepEqual(levels.map(level=>level.length),[4**3*4,2**3*4,4]);
  for(const level of levels)assert.ok(level.every(value=>value===73));
  const alternating=Uint8Array.from({length:8**3*4},(_,i)=>Math.floor(i/4)%2?200:20);
  for(const level of volumeMipChain(alternating,8))assert.ok(level.every(value=>value===110));
  assert.throws(()=>volumeMipChain(new Uint8Array(3**3*4),3));
});
