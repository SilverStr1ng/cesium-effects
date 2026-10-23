import {JulianDate,TimeInterval,Transforms} from 'cesium';

/** Freeze a reproducible ECEF frame before choosing a fixed camera. Otherwise
 * a cold page can aim at TEME positions and render later ICRF positions. */
export async function prepareCelestialFrame(time:JulianDate){
  await Transforms.preloadIcrfFixed(new TimeInterval({start:time,stop:time}));
}
