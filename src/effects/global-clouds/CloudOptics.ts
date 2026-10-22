import {sampleVolume,VOXEL_SIZE} from './VoxelCloudField';
import {CUMULUS_NOISE_SIZE} from './CumulusNoise';

export const CLOUD_OPTICS_SIZE=32;
const smooth=(a:number,b:number,x:number)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);};
const mix=(a:number,b:number,t:number)=>a+(b-a)*t;
/** Average transmission, not density: unresolved opaque columns still have gaps. */
export function meanColumnOpacity(depths:readonly number[],scale:number){
  return depths.reduce((sum,tau)=>sum+-Math.expm1(-tau*scale),0)/depths.length;
}
/** Nonabsorbing two-flux slab closure, conditioned on the visible cloudy area. */
export function meanColumnReflectance(depths:readonly number[],scale:number){
  let weight=0,reflected=0;
  for(const depth of depths){const tau=depth*scale,w=-Math.expm1(-tau),transport=tau*(1-.8);weight+=w;reflected+=w*transport/(2+transport);}
  return weight>0?reflected/weight:0;
}

/** Conditional optical statistics of the near voxel material. Axes are density cut,
 * cloud type and log2(thickness * density * slant / 3.8 km). The table contains
 * E[1-exp(-tau)] and the mean physical column depth. This is a statistical far
 * representation, not another threshold applied to an averaged noise mip.
 * The mesoscale cluster is NOT averaged here: runtime retains its world position.
 * R = mean opacity, G = mean unscaled tau/(1+tau), B = conditional interior,
 * A = probability(T < .9). Cut spans [0,.52]; type [0,1]; log2 scale [-5,7].
 * Defaults define the voxel ensemble; seed/motion change placement, not its law.
 */
export function createCloudOptics(voxels:Uint8Array,noise:Uint8Array){
  const size=CLOUD_OPTICS_SIZE,columns=256,heights=24,bytes=new Uint8Array(size**3*4);
  const noiseAt=(p:number[],scale:number,c:number)=>sampleVolume(noise,CUMULUS_NOISE_SIZE,...p.map(v=>v/scale*64-.5) as [number,number,number],c);
  const voxelAt=(p:number[],scale:number,c:number)=>sampleVolume(voxels,VOXEL_SIZE,...p.map(v=>v/scale*128-.5) as [number,number,number],c);
  const origins=Array.from({length:columns},(_,i)=>{
    const z=1-2*(i+.5)/columns,phi=i*2.39996323,n=[Math.sqrt(1-z*z)*Math.cos(phi),Math.sqrt(1-z*z)*Math.sin(phi),z];
    return {n};
  });
  for(let y=0;y<size;y++){
    const type=y/(size-1),top=mix(mix(.26,.58,smooth(0,.5,type)),1,smooth(.5,1,type));
    const depths=Array.from({length:size},()=>new Array<number>(columns).fill(0));
    const interiors=Array.from({length:size},()=>new Array<number>(columns).fill(0));
    for(let c=0;c<columns;c++){
      const {n}=origins[c];
      const samples=Array.from({length:heights},(_,j)=>{
        const h=(j+.5)/heights,p=n.map(v=>v*(6378.137+1.5+3.8*top*h));
        const rotated=[p[0]*.36+p[1]*.48-p[2]*.8,-p[0]*.8+p[1]*.6,p[0]*.48+p[1]*.64+p[2]*.6];
        const a=p.map(v=>v+13*.23),b=rotated.map(v=>v+13*.31);
        const ra=voxelAt(a,7.83,0),rb=voxelAt(b,13.57,0)*.8;
        const morphology=ra>rb?voxelAt(a,7.83,3):voxelAt(b,13.57,3);
        const bodyDepth=(ra>rb?voxelAt(a,7.83,2)*7.83:voxelAt(b,13.57,2)*13.57)*(16/128);
        const fine=[0,1,2,3].map(channel=>noiseAt(p.map(v=>v+13*.17),1.61,channel));
        const folded=Math.abs(2*Math.abs(2*fine[1]-1)-1);
        let detail=mix(1-Math.abs(2*fine[3]-1),fine[0]*.55+fine[1]*.3+fine[2]*.15,morphology);
        detail=mix(detail,mix(1-folded**3,folded**2,morphology),1-smooth(.015,.12,.02));
        return {field:Math.max(ra,rb)-(1-detail)*.55*.28-h**mix(4,2.8,type)*.4,
          interior:1-Math.exp(-3*Math.max(0,Math.min(bodyDepth,3.8*top*h,3.8-3.8*top*h))),
          weight:smooth(0,.045,h)*(1-smooth(.9,1,h))*9*3.8*top/heights};
      });
      for(let x=0;x<size;x++){
        const cut=x/(size-1)*.52;
        depths[x][c]=samples.reduce((tau,s)=>tau+smooth(0,.324,s.field-cut)*s.weight,0);
        interiors[x][c]=samples.reduce((sum,s)=>{const body=smooth(0,.324,s.field-cut);return sum+body*s.weight*s.interior*smooth(.1,3,body*9);},0)/Math.max(1e-8,depths[x][c]);
      }
    }
    for(let x=0;x<size;x++){
      const mean=depths[x].reduce((s,v)=>s+v,0)/columns;
      for(let z=0;z<size;z++){
        const index=(x+size*(y+size*z))*4,scale=2**(-5+12*z/(size-1));
        bytes[index]=Math.round(meanColumnOpacity(depths[x],scale)*255);
        bytes[index+1]=Math.round(mean/(1+mean)*255);
        let weight=0,interior=0;
        depths[x].forEach((tau,c)=>{const opacity=-Math.expm1(-tau*scale);weight+=opacity;interior+=opacity*interiors[x][c];});
        bytes[index+2]=Math.round(interior/Math.max(1e-8,weight)*255);
        bytes[index+3]=Math.round(depths[x].filter(tau=>tau*scale>-Math.log(.9)).length/columns*255);
      }
    }
  }
  return bytes;
}
