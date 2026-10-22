import {test} from 'node:test';
import assert from 'node:assert/strict';
import {cloudSegments,weatherAt,createWeather,WEATHER_WIDTH,WEATHER_HEIGHT} from '../src/effects/global-clouds/WeatherField.ts';
import {PLANET_RADIUS as R} from '../src/effects/hillaire-atmosphere/atmosphereMath.ts';

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
});
