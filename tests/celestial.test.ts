import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Cartesian3,JulianDate,Matrix3} from 'cesium';
import {celestialPositions,angularRadius,illuminatedFraction,observerCelestials,resolveCelestialState,lunarFixedFromEcef} from '../src/effects/hillaire-atmosphere/CelestialLighting.ts';
import {lunarMapUV,linearLunarAlbedo,srgbToLinear} from '../src/effects/hillaire-atmosphere/lunarAlbedoMath.ts';
import {lunarPhasePresets,celestialSizePresets} from '../src/effects/hillaire-atmosphere/celestialPresets.ts';
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
  assert.equal(illuminatedFraction(new Cartesian3(1000,0,0),new Cartesian3(1,0,0)),0);
  assert.equal(illuminatedFraction(new Cartesian3(1000,0,0),new Cartesian3(-1,0,0)),1);
  assert.equal(illuminatedFraction(new Cartesian3(1000,1,0),new Cartesian3(0,1,0)),.5);
});

test('one celestial mode supplies exact observer phase and camera-independent cloud illumination',()=>{
  const bodies=celestialPositions(JulianDate.fromIso8601('2026-10-18T16:12:00Z'));
  const cameras=[Cartesian3.ZERO,Cartesian3.fromDegrees(-97,35,800),Cartesian3.fromDegrees(70,-35,17000000)];
  for(const manualSun of [undefined,new Cartesian3(0,0,1)]){
    const states=cameras.map(c=>resolveCelestialState(bodies,c,manualSun));
    for(let i=0;i<states.length;i++){
      assert.deepEqual(states[i].lighting,states[0].lighting);
      const ms=Cartesian3.normalize(manualSun??Cartesian3.subtract(bodies.sun,bodies.moon,new Cartesian3()),new Cartesian3());
      const mo=Cartesian3.normalize(Cartesian3.subtract(cameras[i],bodies.moon,new Cartesian3()),new Cartesian3());
      assert.ok(Math.abs(states[i].observer.moonFraction-(1+Cartesian3.dot(ms,mo))/2)<1e-14);
    }
    assert.ok(Cartesian3.distance(states[1].observer.moonDirection,states[2].observer.moonDirection)>.01);
  }
});

test('USNO four-phase UTC presets reproduce the phases in the Cesium ephemeris',()=>{
  for(const preset of Object.values(lunarPhasePresets)){
    const bodies=celestialPositions(JulianDate.fromIso8601(preset.utc));
    assert.ok(Math.abs(illuminatedFraction(bodies.sun,bodies.moon)-preset.fraction)<.006,preset.label);
  }
  // Keep genuinely physical size available; no lighting fields in these presets.
  assert.equal(celestialSizePresets.physical.sunScale,1);assert.equal(celestialSizePresets.physical.moonScale,1);
});

test('IAU lunar frame is right handed, near side stays near longitude zero and observer-independent',()=>{
  for(const preset of Object.values(lunarPhasePresets)){
    const time=JulianDate.fromIso8601(preset.utc),matrix=lunarFixedFromEcef(time),bodies=celestialPositions(time);
    assert.ok(Math.abs(Matrix3.determinant(matrix)-1)<1e-12);
    const normal=Cartesian3.normalize(Cartesian3.negate(bodies.moon,new Cartesian3()),new Cartesian3());
    const local=Matrix3.multiplyByVector(matrix,normal,new Cartesian3()),uv=lunarMapUV([local.x,local.y,local.z]);
    assert.ok(Math.abs(uv[0]-.5)<.035&&Math.abs(uv[1]-.5)<.05,`${preset.label}: ${uv}`);
  }
  assert.deepEqual(lunarMapUV([1,0,0]),[.5,.5]);assert.deepEqual(lunarMapUV([0,1,0]),[.75,.5]);
  assert.deepEqual(lunarMapUV([0,0,1]),[.5,0]);assert.deepEqual(lunarMapUV([0,0,-1]),[.5,1]);
});

test('albedo filtering receives linear reflectance and uses a spherical-area mean',()=>{
  const input=new Uint8ClampedArray([128,128,128,255,255,255,255,255]);
  const {bytes,mean}=linearLunarAlbedo(input,2,1);
  assert.ok(Math.abs(bytes[0]/255-srgbToLinear(128/255))<1/255);
  assert.ok(Math.abs(mean-(bytes[0]/255+1)/2)<1e-12);
  assert.ok(mean<.62); // A gamma-space mean would be approximately .75.
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
