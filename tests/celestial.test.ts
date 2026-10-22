import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Cartesian3,JulianDate} from 'cesium';
import {celestialPositions,angularRadius,illuminatedFraction,observerCelestials} from '../src/effects/hillaire-atmosphere/CelestialLighting.ts';
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
test('manual solar geometry drives both the lunar terminator and reported fraction',()=>{
  const bodies={sun:new Cartesian3(1.5e11,0,0),moon:new Cartesian3(3.84e8,0,0)};
  for(const [sun,fraction] of [[new Cartesian3(1,0,0),0],[new Cartesian3(0,1,0),.5],[new Cartesian3(-1,0,0),1]] as const){
    const state=observerCelestials(bodies,Cartesian3.ZERO,sun);
    assert.equal(state.moonFraction,fraction);
    assert.deepEqual(state.sunDirection,state.moonSunDirection);
  }
});
test('observer movement changes lunar size, parallax and phase without changing UTC',()=>{
  const bodies=celestialPositions(JulianDate.fromIso8601('2026-06-21T17:00:00Z'));
  const a=observerCelestials(bodies,Cartesian3.fromDegrees(-97,35,800));
  const b=observerCelestials(bodies,Cartesian3.fromDegrees(70,-35,17000000));
  assert.ok(Cartesian3.distance(a.moonDirection,b.moonDirection)>.01);
  assert.notEqual(a.moonRadius,b.moonRadius);assert.notEqual(a.moonFraction,b.moonFraction);
  assert.ok(Math.abs(Cartesian3.magnitude(a.moonDirection)-1)<1e-12);
  assert.ok(Math.abs(a.moonFraction-illuminatedFraction(bodies.sun,bodies.moon))<.02);
});

// The A/B lunar preset must actually put a bright moon above the local horizon.
test('cloud night comparison frames a visible full moon on the night side',async()=>{
  const {cloudComparisonView,cloudComparisonTimes}=await import('../src/effects/water-clouds/comparisonView.ts');
  const time=JulianDate.fromIso8601(cloudComparisonTimes.night),sky=celestialPositions(time);
  const view=cloudComparisonView(time,true),up=Cartesian3.normalize(view.destination,new Cartesian3());
  assert.ok(illuminatedFraction(sky.sun,sky.moon)>.95);
  assert.ok(Cartesian3.dot(up,Cartesian3.normalize(sky.sun,new Cartesian3()))<-.1);
  assert.ok(Cartesian3.dot(up,Cartesian3.normalize(sky.moon,new Cartesian3()))>.2);
  assert.ok(view.orientation.pitch>0&&view.orientation.pitch<Math.PI/2);
});
