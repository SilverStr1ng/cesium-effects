import {periodicNoise as noise} from '../../scene/CloudNoise';
import {PLANET_RADIUS as R,sphereInterval} from '../hillaire-atmosphere/atmosphereMath';

export const WEATHER_WIDTH=1024,WEATHER_HEIGHT=512;
const clamp=(v:number)=>Math.max(0,Math.min(1,v));
const smooth=(a:number,b:number,v:number)=>{const t=clamp((v-a)/(b-a));return t*t*(3-2*t);};
type System={center:number[];east:number[];north:number[];spin:number;kind:number;phase:number};
let cachedSeed=NaN,cachedSystems:System[]=[];
/** Tangent frames are attached to weather systems, never to the sample's
 * longitude. All support functions vanish before the opposite hemisphere. */
function systems(seed:number){
  if(seed===cachedSeed)return cachedSystems;
  let state=(seed*747796405+2891336453)>>>0;
  const random=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296;};
  cachedSeed=seed;
  cachedSystems=Array.from({length:18},(_,i)=>{
    const z=random()*1.8-.9,lon=random()*Math.PI*2,c=Math.sqrt(1-z*z);
    const center=[c*Math.cos(lon),c*Math.sin(lon),z],east=[-Math.sin(lon),Math.cos(lon),0];
    return {center,east,north:[-z*Math.cos(lon),-z*Math.sin(lon),c],spin:random()<.5?-1:1,kind:i%3,phase:random()*Math.PI*2};
  });return cachedSystems;
}
/** Deterministic synoptic masks, useful separately for continuity/regime tests. */
export function weatherSystemsAt(longitude:number,latitude:number,seed=7){
  const c=Math.cos(latitude),p=[c*Math.cos(longitude),c*Math.sin(longitude),Math.sin(latitude)];
  const dot=(v:number[])=>v[0]*p[0]+v[1]*p[1]+v[2]*p[2];
  let front=0,vortex=0,convection=0,stratus=0;
  for(const system of systems(seed)){
    const facing=dot(system.center);if(facing<.72)continue;
    const x=dot(system.east),y=dot(system.north),r=Math.hypot(x,y);
    const envelope=1-smooth(.25,.62,r);
    if(system.kind===0){
      // Bent, finite frontal ribbons joining a rotating low; no latitude lines.
      const bend=y-.10*Math.sin(x*8+system.phase)-system.spin*.6*x*x;
      front=Math.max(front,Math.exp(-((bend/.035)**2))*envelope);
      const spiral=.5+.5*Math.cos(2*Math.atan2(y,x)+system.spin*r*21+system.phase);
      vortex=Math.max(vortex,spiral**5*smooth(.025,.10,r)*(1-smooth(.28,.40,r)));
    }else if(system.kind===1)convection=Math.max(convection,envelope*envelope);
    else stratus=Math.max(stratus,envelope);
  }
  return {front,vortex,convection,stratus};
}
/** Sample a sphere, not a periodic latitude plane: both poles and the dateline agree. */
export function weatherAt(longitude:number,latitude:number,seed=7){
  const lon=longitude,c=Math.cos(latitude);
  const x=c*Math.cos(lon),y=c*Math.sin(lon),z=Math.sin(latitude);
  const a=noise(x*3.1+7,y*3.1+11,z*3.1+19,4096,219+seed*101);
  const b=noise(x*7.3+2,y*7.3+5,z*7.3+3,4096,671+seed*137);
  const d=noise(x*18.1,y*18.1,z*18.1,4096,313+seed*173);
  const {front,vortex,convection,stratus}=weatherSystemsAt(longitude,latitude,seed);
  // Latitude is only a broad statistical preference for frontal activity.
  // Every visible boundary is a continuous world-local system or noise field.
  const stormPrior=.75+.25*Math.exp(-(((Math.abs(z)-.55)/.3)**2));
  const clear=smooth(.53,.75,noise(x*2.7+31,y*2.7+17,z*2.7+9,4096,881+seed*59));
  // The wrap period is larger than the entire planet. These two regional fields
  // are baked once on the sphere instead of repeating a small 3D tile in ECEF.
  const broad=noise(x*R/410+17,y*R/410+31,z*R/410+47,4096,1213+seed*79);
  const cells=.65*noise(x*R/92+23,y*R/92+67,z*R/92+11,4096,2293+seed*163)
    +.35*noise(x*R/39+61,y*R/39+13,z*R/39+43,4096,4481+seed*97);
  const organized=(front*.42+vortex*.32)*stormPrior+convection*.24+stratus*.17;
  return [clamp(.42+(a-.5)*.95+(b-.5)*.50+(d-.5)*.22+organized-clear*.48),
    clamp(.43+(b-.5)*.35+convection*.45+front*.15-stratus*.28),broad,cells];
}
export function createWeather(seed=7){
  const data=new Uint8Array(WEATHER_WIDTH*WEATHER_HEIGHT*4);
  for(let y=0;y<WEATHER_HEIGHT;y++)for(let x=0;x<WEATHER_WIDTH;x++){
    const w=weatherAt(((x+.5)/WEATHER_WIDTH*2-1)*Math.PI,(y/(WEATHER_HEIGHT-1)-.5)*Math.PI,seed),i=(x+y*WEATHER_WIDTH)*4;
    for(let c=0;c<4;c++)data[i+c]=Math.round(w[c]*255);
  }
  return data;
}
/** CPU oracle for the shader's two shell segments, including solid planet/depth clipping. */
export function cloudSegments(p:readonly number[],d:readonly number[],base=1.5,thickness=3.8,maximum=1e8){
  const outer=sphereInterval(p,d,R+base+thickness);
  if(!outer)return [];
  const ground=sphereInterval(p,d,R);
  if(ground&&ground[0]>0)maximum=Math.min(maximum,ground[0]);
  const begin=Math.max(0,outer[0]),end=Math.min(maximum,outer[1]);
  if(end<=begin)return [];
  const inner=sphereInterval(p,d,R+base);
  if(!inner||inner[1]<=begin||inner[0]>=end)return [[begin,end]];
  return [[begin,Math.min(end,inner[0])],[Math.max(begin,inner[1]),end]].filter(([a,b])=>b>a);
}
