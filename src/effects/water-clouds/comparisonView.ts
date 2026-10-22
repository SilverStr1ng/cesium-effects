import {Cartesian3,JulianDate,Math as CesiumMath,Matrix4,Transforms} from 'cesium';
import {celestialPositions} from '../hillaire-atmosphere/CelestialLighting';

export const cloudComparisonTimes={day:'2026-06-21T17:00:00Z',night:'2026-10-26T03:00:00Z'};
/** Reproducible local views; the lunar view uses the actual ephemeris direction. */
export function cloudComparisonView(time:JulianDate,night:boolean){
  const destination=Cartesian3.fromDegrees(-97.52,35.46,800);
  let heading=CesiumMath.toRadians(245),pitch=CesiumMath.toRadians(12);
  if(night){
    const local=Matrix4.inverseTransformation(Transforms.eastNorthUpToFixedFrame(destination),new Matrix4());
    const direction=Cartesian3.subtract(celestialPositions(time).moon,destination,new Cartesian3());
    Matrix4.multiplyByPointAsVector(local,direction,direction);Cartesian3.normalize(direction,direction);
    heading=Math.atan2(direction.x,direction.y);pitch=Math.asin(direction.z)-.12;
  }
  return {destination,orientation:{heading,pitch,roll:0}};
}
