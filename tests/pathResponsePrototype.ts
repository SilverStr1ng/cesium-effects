import prototype from './fixtures/pr1-path-response.glsl?raw';

/** Rejected cost experiment. Never imported by src/ or enabled by default.
 * It follows world fields with correlated density rays, sharing illumination
 * only within response bins. Minimal T improved, but L and orbit cost failed. */
export function pathResponseLighting(lighting:string){
  return lighting.replace('vec3 farResponseIllumination(vec3 p,int node,CloudPhases phases){',
    'bool worldResponseActive=false;vec3 worldRadiance[FAR_RESPONSE_LIMIT];\nvec3 farResponseIllumination(vec3 p,int node,CloudPhases phases){')
    .replace('float absorbed=max(1e-7,farResponse[node+1].r-farResponse[node].r);',
      'float absorbed=max(1e-7,farResponse[node+1].r-farResponse[node].r);if(worldResponseActive)return worldRadiance[node]/absorbed;')+prototype;
}
