import {createCumulusNoise,volumeMipChain,CUMULUS_NOISE_SIZE} from './CumulusNoise';

const smooth=(a:number,b:number,x:number)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);};
/** Ice extinction, envelope and breakup are shaped BEFORE mip generation.
 * Averaging raw noise then applying a fibre threshold loses optical mass.
 * Reuses the original procedural noise; no photographic/reference assets.
 */
export function createCirrusField(){
  const source=createCumulusNoise().bytes,bytes=new Uint8Array(source.length);
  for(let i=0;i<bytes.length;i+=4){
    const n=source[i+3]/255;
    bytes[i]=Math.round((smooth(.53,.7,n)+.12*smooth(.38,.6,n))/1.12*255);
    bytes[i+1]=Math.round(smooth(.44,.64,n)*255);
    bytes[i+2]=Math.round(smooth(.28,.65,n)*255);
    bytes[i+3]=255;
  }
  return {bytes,mips:volumeMipChain(bytes,CUMULUS_NOISE_SIZE)};
}
