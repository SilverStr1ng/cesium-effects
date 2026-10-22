/** Deterministic, periodic cloud noise. Generated once, shared across quality rebuilds. */
const hash = (x:number,y:number,z:number,seed:number) => {
  let n=Math.imul(x,374761393)^Math.imul(y,668265263)^Math.imul(z,2147483647)^seed;
  n=Math.imul(n^(n>>>13),1274126177);
  return ((n^(n>>>16))>>>0)/4294967295;
};
const wrap=(n:number,period:number)=>((n%period)+period)%period;
export function periodicNoise(x:number,y:number,z:number,period:number,seed=17) {
  const ix=Math.floor(x),iy=Math.floor(y),iz=Math.floor(z);
  let fx=x-ix,fy=y-iy,fz=z-iz;
  fx=fx*fx*(3-2*fx);fy=fy*fy*(3-2*fy);fz=fz*fz*(3-2*fz);
  let sum=0;
  for(let k=0;k<2;k++)for(let j=0;j<2;j++)for(let i=0;i<2;i++)
    sum+=hash(wrap(ix+i,period),wrap(iy+j,period),wrap(iz+k,period),seed)*(i?fx:1-fx)*(j?fy:1-fy)*(k?fz:1-fz);
  return sum;
}
function worley(x:number,y:number,z:number,period:number) {
  const ix=Math.floor(x),iy=Math.floor(y),iz=Math.floor(z);
  let distance=3;
  for(let k=-1;k<=1;k++)for(let j=-1;j<=1;j++)for(let i=-1;i<=1;i++){
    const a=ix+i,b=iy+j,c=iz+k,wx=wrap(a,period),wy=wrap(b,period),wz=wrap(c,period);
    const dx=a+hash(wx,wy,wz,31)-x,dy=b+hash(wx,wy,wz,67)-y,dz=c+hash(wx,wy,wz,101)-z;
    distance=Math.min(distance,dx*dx+dy*dy+dz*dz);
  }
  return Math.max(0,1-Math.sqrt(distance)*.85);
}
let cached:Uint8Array|undefined;
export const NOISE_SIZE=48;
export function createNoiseVolume(size=NOISE_SIZE):Uint8Array {
  if(size===NOISE_SIZE&&cached)return cached;
  const data=new Uint8Array(size*size*size*4);
  for(let z=0;z<size;z++)for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const a=(x+.5)/size,b=(y+.5)/size,c=(z+.5)/size,i=(x+size*(y+size*z))*4;
    data[i]=Math.round(255*(worley(a*4,b*4,c*4,4)*.6+periodicNoise(a*4,b*4,c*4,4)*.4));
    data[i+1]=Math.round(255*periodicNoise(a*8,b*8,c*8,8,53));
    data[i+2]=Math.round(255*periodicNoise(a*16,b*16,c*16,16,97));
    data[i+3]=Math.round(255*periodicNoise(a*24,b*24,c*24,24,131));
  }
  if(size===NOISE_SIZE)cached=data;
  return data;
}
