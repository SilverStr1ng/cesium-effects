import {periodicNoise as noise} from '../../scene/CloudNoise';
import {PLANET_RADIUS as R,sphereInterval} from '../hillaire-atmosphere/atmosphereMath';

export const WEATHER_WIDTH=1024,WEATHER_HEIGHT=512;
const clamp=(v:number)=>Math.max(0,Math.min(1,v));
/** Sample a sphere, not a periodic latitude plane: both poles and the dateline agree. */
export function weatherAt(longitude:number,latitude:number,seed=7){
  const lon=longitude+.28*Math.sin(latitude*5),c=Math.cos(latitude);
  const x=c*Math.cos(lon),y=c*Math.sin(lon),z=Math.sin(latitude);
  const a=noise(x*3.1+7,y*3.1+11,z*3.1+19,4096,219+seed*101);
  const b=noise(x*7.3+2,y*7.3+5,z*7.3+3,4096,671+seed*137);
  const d=noise(x*18.1,y*18.1,z*18.1,4096,313+seed*173);
  const bands=Math.sin(latitude*11+Math.sin(lon*3)*c*1.5)*c;
  // The wrap period is larger than the entire planet. These two regional fields
  // are baked once on the sphere instead of repeating a small 3D tile in ECEF.
  const broad=noise(x*R/410+17,y*R/410+31,z*R/410+47,4096,1213+seed*79);
  const cells=.65*noise(x*R/92+23,y*R/92+67,z*R/92+11,4096,2293+seed*163)
    +.35*noise(x*R/39+61,y*R/39+13,z*R/39+43,4096,4481+seed*97);
  return [clamp(.48+(a-.5)*1.25+(b-.5)*.65+(d-.5)*.3+bands*.12),clamp(.3+a*.5+(b-.5)*.4),broad,cells];
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
