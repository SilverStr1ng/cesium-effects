import type {Scene} from 'cesium';

/** Cesium 1.146 clears depth inside its frustum render loop. Looking entirely
 * into space can produce ZERO frusta, leaving the last ground frame's depth in
 * the post-process input. Do not treat that stale buffer as current geometry.
 * This query runs at uniform binding time, after visibility bins are built.
 * An unavailable internal interface preserves the normal depth path. */
export function emptySceneDepth(scene:Scene){
  return (scene as unknown as {_view?:{frustumCommandsList?:unknown[]}})._view?.frustumCommandsList?.length===0;
}
