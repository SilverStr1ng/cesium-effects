import density from '../src/effects/global-clouds/shaders/density.glsl?raw';
import voxel from '../src/effects/global-clouds/shaders/voxel.glsl?raw';
import lighting from '../src/effects/global-clouds/shaders/droplet-lighting.glsl?raw';
import type {CloudModel} from '../src/effects/global-clouds/GlobalCloudEffect';

// Deliberately incorrect, test-only source reductions isolate driver link cost.
// Never use these pictures or timings as same-quality rendering measurements.
function body(source:string,name:string,replacement:string){
  const signature=source.indexOf(name+'(');if(signature<0)throw new Error(`Missing ${name}`);
  const start=source.indexOf('{',signature);let depth=1,end=start+1;
  for(;depth&&end<source.length;end++){if(source[end]==='{')depth++;if(source[end]==='}')depth--;}
  return source.slice(0,start+1)+replacement+source.slice(end-1);
}
export function reducedCloudModel(kind:string):CloudModel{
  let field=density+voxel,light=lighting;
  if(kind==='no-statistics'){
    field=body(field,'prepareFarResponse',`farResponseCount=count;for(int i=0;i<=FAR_RESPONSE_LIMIT;i++)farResponse[i]=vec4(0);`);
    light=body(light,'farResponseIllumination','return vec3(0);');
  }else if(kind==='no-cone')light=body(light,'waterLightDepth','return rho*.01;');
  else if(kind==='no-ice'){
    field=body(field,'highCloudDensity','return 0.;');
    light=body(light,'iceIllumination','return vec3(0);');
  }else throw new Error(`Unknown shader reduction ${kind}`);
  return {id:'global-clouds',density:field,lighting:light,defines:'#define LAYERED_CLOUDS\n'};
}
