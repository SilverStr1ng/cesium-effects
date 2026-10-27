import {createWeather,WEATHER_WIDTH as W,WEATHER_HEIGHT as H} from '../src/effects/global-clouds/WeatherField';
import {createCumulusNoise} from '../src/effects/global-clouds/CumulusNoise';
import {createVoxelCloudField,sampleVolume} from '../src/effects/global-clouds/VoxelCloudField';
import {createCloudOptics} from '../src/effects/global-clouds/CloudOptics';

export type V3=[number,number,number];
export const add=(a:V3,b:V3):V3=>a.map((v,i)=>v+b[i]) as V3;
export const mul=(a:V3,s:number):V3=>a.map(v=>v*s) as V3;
export const dot=(a:V3,b:V3)=>a.reduce((s,v,i)=>s+v*b[i],0);
export const norm=(a:V3)=>mul(a,1/Math.hypot(...a));
export const cross=(a:V3,b:V3):V3=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
export const smooth=(a:number,b:number,x:number)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);};
const mix=(a:number,b:number,t:number)=>a+(b-a)*t;
const clamp=(v:number)=>Math.max(0,Math.min(1,v));
let assets:ReturnType<typeof generate>|undefined;
function generate(){const noise=createCumulusNoise(),voxels=createVoxelCloudField();return {noise:noise.bytes,weather:createWeather(13),optics:createCloudOptics(voxels.bytes,noise.bytes)};}
/** Independent double-precision mirror of the same far-model point samples.
 * This measures spatial quadrature, not a full near-volume or ray reference. */
export function farField(){
  const {noise,weather,optics}=assets??=generate();
  const volume=(data:Uint8Array,size:number,p:V3,c:number)=>sampleVolume(data,size,...p,c);
  const noiseAt=(p:V3,scale:number,c:number)=>volume(noise,64,p.map(v=>v/scale*64-.5) as V3,c);
  const weatherAt=(p:V3,c:number)=>{
    const n=norm(p),x=(Math.atan2(n[1],n[0])/(2*Math.PI)+.5)*W-.5,y=(Math.asin(n[2])/Math.PI+.5)*(H-1);
    const a=Math.floor(x),b=Math.floor(y),fx=x-a,fy=y-b;
    const at=(xx:number,yy:number)=>weather[(((xx%W+W)%W)+W*Math.max(0,Math.min(H-1,yy)))*4+c]/255;
    return mix(mix(at(a,b),at(a+1,b),fx),mix(at(a,b+1),at(a+1,b+1),fx),fy);
  };
  function point(p:V3,slant:number,density=1.1,thickness=3.8){
    let cover=clamp((weatherAt(p,0)+.62-1)/.62);
    const type=mix(.45,1,smooth(.25,.75,weatherAt(p,1))),top=mix(mix(.26,.58,smooth(0,.5,type)),1,smooth(.5,1,type));
    if(cover<=0)return [0,0,0,0,top];
    cover=clamp(cover+(weatherAt(p,2)-.5)*.7+(weatherAt(p,3)-.5)*1.3);
    if(cover<=0)return [0,0,0,0,top];
    const q=p.map((v,i)=>v+(noiseAt(p,71.3,[0,1,3][i])-.5)*3.4+13*.43) as V3;
    const cell=noiseAt(q,29.713,0),threshold=mix(.76,.38,cover),cluster=smooth(threshold-.035,threshold+.085,cell);
    const scale=density*thickness/3.8*slant*cluster*smooth(0,.2,cover);
    const uv:V3=[clamp(((1-cover)*.22+(1-cluster)*.3)/.52)*31,type*31,clamp((Math.log2(Math.max(.03125,scale))+5)/12)*31];
    const raw=[0,1,2,3].map(c=>volume(optics,32,uv,c)),thin=Math.min(1,scale/.03125);
    const opacity=raw[0]*thin;
    return [opacity,raw[1]/Math.max(1/255,1-raw[1])*scale,raw[2]*thin*opacity,raw[3]*thin,top];
  }
  return {point};
}
export function patchFrame(patch:number,mu:number,rotation=0){
  const lon=-1.7+patch*.37,lat=.45+Math.sin(patch*1.7)*.6;
  const n:V3=[Math.cos(lat)*Math.cos(lon),Math.cos(lat)*Math.sin(lon),Math.sin(lat)],east:V3=[-Math.sin(lon),Math.cos(lon),0],north=cross(n,east);
  const d=add(mul(n,-mu),mul(east,Math.sqrt(1-mu*mu)));
  const r=add(mul(east,mu),mul(n,Math.sqrt(1-mu*mu)));
  const right=add(mul(r,Math.cos(rotation)),mul(north,Math.sin(rotation))),up=add(mul(r,-Math.sin(rotation)),mul(north,Math.cos(rotation)));
  const slant=1/Math.max(.04,mu);
  const a=add(mul(east,slant*Math.cos(rotation)),mul(north,Math.sin(rotation))),b=add(mul(east,-slant*Math.sin(rotation)),mul(north,Math.cos(rotation)));
  return {n,east,north,d,right,up,a,b,slant,column:mul(n,6378.137+1.5)};
}
export function spatialMean(patch:number,footprint:number,mu:number,nx:number,ny=nx,rotation=0,density=1.1,thickness=3.8){
  const {a,b,slant,column}=patchFrame(patch,mu,rotation),field=farField(),sum=[0,0,0,0,0];
  for(let y=0;y<ny;y++)for(let x=0;x<nx;x++){
    const p=mul(norm(add(column,mul(add(mul(a,(x+.5)/nx-.5),mul(b,(y+.5)/ny-.5)),footprint))),6378.137+1.5);
    field.point(p,slant,density,thickness).forEach((v,c)=>sum[c]+=v/(nx*ny));
  }
  return sum;
}

/** CPU quadrature mirror. The GPU fixture checks the actual production GLSL;
 * the 192/384 grid above remains independent of this principal-axis rule. */
export function filteredMean(patch:number,footprint:number,mu:number,rotation=0,density=1.1,thickness=3.8){
  const {east,north,slant,column}=patchFrame(patch,mu),field=farField();
  const c=Math.cos(rotation),s=Math.sin(rotation),a=[slant*c,s],b=[-slant*s,c];
  const support=[footprint*(Math.abs(a[0])+Math.abs(b[0])),footprint*(Math.abs(a[1])+Math.abs(b[1]))];
  const medium=support.map(v=>smooth(4,12,v)),fine=smooth(12,36,support[0]);
  const nx=fine>0?36:medium[0]>0?12:4,ny=medium[1]>0?12:4;
  const weight=(i:number,n:number,m:number,f:number)=>f/n+(n<=12||i%3===1?m*(1-f)/12:0)+(n===4||n===12&&i%3===1||n===36&&i%9===4?(1-m)/4:0);
  const rowA=[c/slant,s],rowB=[-s/slant,c],sum=[0,0,0,0,0];
  const lower=.5*Math.min(Math.abs(a[1]),Math.abs(b[1])),upper=.5*Math.max(Math.abs(a[1]),Math.abs(b[1]));
  for(let y=0;y<ny;y++){
    const u=(y+.5)/ny,q=Math.min(u,1-u);
    const across=(lower>1e-6&&q<lower/(2*upper)?-lower-upper+Math.sqrt(8*lower*upper*q):2*upper*q-upper)*(u<.5?1:-1);
    let lo=-1e6,hi=1e6;
    for(const row of [rowA,rowB])if(Math.abs(row[0])>=1e-6){const l=(-.5-row[1]*across)/row[0],h=(.5-row[1]*across)/row[0];lo=Math.max(lo,Math.min(l,h));hi=Math.min(hi,Math.max(l,h));}
    for(let x=0;x<nx;x++){
      const along=lo+(hi-lo)*(x+.5)/nx,p=mul(norm(add(column,mul(add(mul(east,along),mul(north,across)),footprint))),6379.637);
      const w=weight(x,nx,medium[0],fine)*weight(y,ny,medium[1],0);
      field.point(p,slant,density,thickness).forEach((v,i)=>sum[i]+=v*w);
    }
  }
  const anisotropic=smooth(1.05,1.25,slant);
  if(anisotropic<1){
    const f=smooth(4,12,footprint),coarse=spatialMean(patch,footprint,mu,4,4,rotation,density,thickness);
    const detailed=f>0?spatialMean(patch,footprint,mu,12,12,rotation,density,thickness):coarse;
    sum.forEach((v,i)=>sum[i]=mix(mix(coarse[i],detailed[i],f),v,anisotropic));
  }
  return {moments:sum,taps:nx*ny+(anisotropic>0&&anisotropic<1?(footprint>4?144:16):0),support};
}
