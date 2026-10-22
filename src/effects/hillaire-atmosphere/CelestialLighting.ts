import { Cartesian3, Transforms, JulianDate, Matrix3, Simon1994PlanetaryPositions } from 'cesium';

/** Same public ephemeris model used by Cesium's renderer. Positions are ECEF metres. */
export function celestialPositions(time:JulianDate){
  const rotation=Transforms.computeIcrfToCentralBodyFixedMatrix(time,new Matrix3())
    ??Transforms.computeTemeToPseudoFixedMatrix(time,new Matrix3());
  return {
    sun:Matrix3.multiplyByVector(rotation,Simon1994PlanetaryPositions.computeSunPositionInEarthInertialFrame(time),new Cartesian3()),
    moon:Matrix3.multiplyByVector(rotation,Simon1994PlanetaryPositions.computeMoonPositionInEarthInertialFrame(time),new Cartesian3()),
  };
}
export function angularRadius(radius:number,distance:number){return Math.asin(Math.min(1,radius/distance));}
export function illuminatedFraction(sun:Cartesian3,moon:Cartesian3){
  const s=Cartesian3.normalize(sun,new Cartesian3()),m=Cartesian3.normalize(moon,new Cartesian3());
  return (1-Cartesian3.dot(s,m))*.5;
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
