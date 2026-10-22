import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Cartesian3,JulianDate} from 'cesium';
import {celestialPositions,angularRadius,illuminatedFraction} from '../src/effects/hillaire-atmosphere/CelestialLighting.ts';
test('solar/lunar ephemerides are finite and rotate with Cesium time',()=>{
  const t=JulianDate.fromIso8601('2026-10-22T00:00:00Z');
  const a=celestialPositions(t),b=celestialPositions(JulianDate.addHours(t,12,new JulianDate()));
  assert.ok(Cartesian3.magnitude(a.sun)>1.4e11&&Cartesian3.magnitude(a.sun)<1.6e11);
  assert.ok(Cartesian3.magnitude(a.moon)>3.4e8&&Cartesian3.magnitude(a.moon)<4.2e8);
  assert.ok(Cartesian3.dot(Cartesian3.normalize(a.sun,new Cartesian3()),Cartesian3.normalize(b.sun,new Cartesian3()))<-.8);
  const diameter=angularRadius(695700000,Cartesian3.magnitude(a.sun))*360/Math.PI;
  assert.ok(diameter>.52&&diameter<.55);
});
test('lunar phase ranges from new Moon to full Moon',()=>{
  assert.equal(illuminatedFraction(new Cartesian3(1,0,0),new Cartesian3(1,0,0)),0);
  assert.equal(illuminatedFraction(new Cartesian3(1,0,0),new Cartesian3(-1,0,0)),1);
  assert.equal(illuminatedFraction(new Cartesian3(1,0,0),new Cartesian3(0,1,0)),.5);
});
