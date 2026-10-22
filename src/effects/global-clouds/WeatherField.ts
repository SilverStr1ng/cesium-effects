import {periodicNoise as noise} from '../../scene/CloudNoise';
import {PLANET_RADIUS as R,sphereInterval} from '../hillaire-atmosphere/atmosphereMath';

export const WEATHER_WIDTH=512,WEATHER_HEIGHT=256;
const clamp=(v:number)=>Math.max(0,Math.min(1,v));
/** Sample a sphere, not a periodic latitude plane: both poles and the dateline agree. */
export function weatherAt(longitude:number,latitude:number){
  const lon=longitude+.28*Math.sin(latitude*5),c=Math.cos(latitude);
  const x=c*Math.cos(lon),y=c*Math.sin(lon),z=Math.sin(latitude);
  const a=noise(x*3.1+7,y*3.1+11,z*3.1+19,32,219);
  const b=noise(x*7.3+2,y*7.3+5,z*7.3+3,32,671);
  const d=noise(x*18.1,y*18.1,z*18.1,64,313);
  const bands=Math.sin(latitude*11+Math.sin(lon*3)*c*1.5)*c;
  return [clamp(.48+(a-.5)*1.25+(b-.5)*.65+(d-.5)*.3+bands*.12),clamp(.3+a*.5+(b-.5)*.4)];
}
export function createWeather(){
  const data=new Uint8Array(WEATHER_WIDTH*WEATHER_HEIGHT*4);
  for(let y=0;y<WEATHER_HEIGHT;y++)for(let x=0;x<WEATHER_WIDTH;x++){
    const w=weatherAt(((x+.5)/WEATHER_WIDTH*2-1)*Math.PI,((y+.5)/WEATHER_HEIGHT-.5)*Math.PI),i=(x+y*WEATHER_WIDTH)*4;
    data[i]=Math.round(w[0]*255);data[i+1]=Math.round(w[1]*255);data[i+3]=255;
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
