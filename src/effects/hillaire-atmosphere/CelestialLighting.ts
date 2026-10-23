import * as Cesium from 'cesium';
import { Cartesian3, Transforms, JulianDate, Matrix3, Simon1994PlanetaryPositions } from 'cesium';

// Cesium 1.146 uses this same IAU 2000 orientation for its Moon. It is exported
// at runtime but private in its types; keep the version-sensitive seam here.
const {IauOrientationAxes}=Cesium as unknown as {IauOrientationAxes:new()=>{evaluate(time:JulianDate,result:Matrix3):Matrix3}};
const lunarAxes=new IauOrientationAxes();
// The central-body wrapper silently returns TEME when ICRF data is missing in
// Cesium 1.146. Query the Earth-specific function so readiness is observable.
const fixedRotation=(time:JulianDate)=>Transforms.computeIcrfToFixedMatrix(time,new Matrix3())
  ??Transforms.computeTemeToPseudoFixedMatrix(time,new Matrix3());
export const celestialIcrfReady=(time:JulianDate)=>Transforms.computeIcrfToFixedMatrix(time,new Matrix3())!==undefined;

/** ECEF -> lunar body-fixed. +X is 0° longitude, +Y is 90° east, +Z north.
 * IAU analytic libration, not the high-accuracy JPL DE440/441 lunar frame. */
export function lunarFixedFromEcef(time:JulianDate){
  return Matrix3.multiply(lunarAxes.evaluate(time,new Matrix3()),Matrix3.transpose(fixedRotation(time),new Matrix3()),new Matrix3());
}

/** Same public ephemeris model used by Cesium's renderer. Positions are ECEF metres. */
export function celestialPositions(time:JulianDate){
  const rotation=fixedRotation(time);
  return {
    frame:celestialIcrfReady(time)?'icrf' as const:'teme-fallback' as const,
    sun:Matrix3.multiplyByVector(rotation,Simon1994PlanetaryPositions.computeSunPositionInEarthInertialFrame(time),new Cartesian3()),
    moon:Matrix3.multiplyByVector(rotation,Simon1994PlanetaryPositions.computeMoonPositionInEarthInertialFrame(time),new Cartesian3()),
  };
}
export function angularRadius(radius:number,distance:number){return Math.asin(Math.min(1,radius/distance));}
export function illuminatedFraction(sun:Cartesian3,moon:Cartesian3,observer:Cartesian3=Cartesian3.ZERO){
  const moonToSun=Cartesian3.normalize(Cartesian3.subtract(sun,moon,new Cartesian3()),new Cartesian3());
  const moonToObserver=Cartesian3.normalize(Cartesian3.subtract(observer,moon,new Cartesian3()),new Cartesian3());
  return Math.max(0,Math.min(1,(1+Cartesian3.dot(moonToSun,moonToObserver))*.5));
}

/** Observer geometry stays in unscaled ECEF. Only atmospheric transport uses
 * the WGS84-to-sphere metric. Manual mode is one coherent synthetic sun: the
 * disc, terminator and cloud moonlight must all use it.
 */
export function observerCelestials(bodies:{sun:Cartesian3;moon:Cartesian3},observer:Cartesian3,manualSun?:Cartesian3){
  const toSun=Cartesian3.subtract(bodies.sun,observer,new Cartesian3());
  const toMoon=Cartesian3.subtract(bodies.moon,observer,new Cartesian3());
  const moonToSun=Cartesian3.subtract(bodies.sun,bodies.moon,new Cartesian3());
  const sunRadius=angularRadius(695700000,Cartesian3.magnitude(toSun));
  const moonRadius=angularRadius(1737400,Cartesian3.magnitude(toMoon));
  Cartesian3.normalize(toSun,toSun);Cartesian3.normalize(toMoon,toMoon);Cartesian3.normalize(moonToSun,moonToSun);
  if(manualSun){Cartesian3.normalize(manualSun,toSun);Cartesian3.clone(toSun,moonToSun);}
  return {sunDirection:toSun,moonDirection:toMoon,moonSunDirection:moonToSun,sunRadius,moonRadius,
    moonFraction:Math.max(0,Math.min(1,(1-Cartesian3.dot(toMoon,moonToSun))*.5))};
}

/** One mode and ephemeris, two explicit observing geometries. Cloud lighting is
 * a geocentric distant-source approximation: it must never depend on the camera.
 * The disc/UI retain topocentric parallax, apparent radius and phase. */
export function resolveCelestialState(bodies:{sun:Cartesian3;moon:Cartesian3},camera:Cartesian3,manualSun?:Cartesian3){
  return {mode:manualSun?'artistic' as const:'ephemeris' as const,
    observer:observerCelestials(bodies,camera,manualSun),
    lighting:observerCelestials(bodies,Cartesian3.ZERO,manualSun)};
}
export type CelestialState=ReturnType<typeof resolveCelestialState>;
