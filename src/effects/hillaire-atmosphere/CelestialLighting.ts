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
