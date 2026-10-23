import {createCumulusNoise,volumeMipChain,CUMULUS_NOISE_SIZE} from './CumulusNoise';

const smooth=(a:number,b:number,x:number)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);};
/** Final ice material moments, shaped BEFORE mip generation.
 * R = extinction multiplier m; G = 1-exp(-4m); B = occupied probability;
 * A = smooth cirrostratus multiplier. All channels are linear averages.
 * Conditional mean + transmission fit a bounded unresolved distribution.
 * Reuses the original procedural noise; no photographic/reference assets.
 */
export function createCirrusField(){
  const source=createCumulusNoise().bytes,bytes=new Uint8Array(source.length);
  for(let i=0;i<bytes.length;i+=4){
    const n=source[i+3]/255;
    const m=smooth(.48,.69,n);
    bytes[i]=Math.round(m*255);
    bytes[i+1]=Math.round(-Math.expm1(-4*m)*255);
    bytes[i+2]=m>0?255:0;
    bytes[i+3]=Math.round((.55+.45*source[i]/255)*255);
  }
  // Collapse only the transverse coordinate. Satellite filtering must retain
  // the two slowly varying along-flow coordinates, not jump to the 1^3 mip.
  const size=CUMULUS_NOISE_SIZE,ribbon=new Uint8Array(size*size*4);
  for(let z=0;z<size;z++)for(let y=0;y<size;y++)for(let c=0;c<4;c++){
    let sum=0;for(let x=0;x<size;x++)sum+=bytes[(x+size*(y+size*z))*4+c];
    ribbon[(y+size*z)*4+c]=Math.round(sum/size);
  }
  const ribbonMips:Uint8Array[]=[];let previous=ribbon;
  for(let n=size;n>1;n/=2){const next=new Uint8Array(n*n);
    for(let y=0;y<n/2;y++)for(let x=0;x<n/2;x++)for(let c=0;c<4;c++)next[(x+y*n/2)*4+c]=Math.round((previous[(2*x+2*y*n)*4+c]+previous[(2*x+1+2*y*n)*4+c]+previous[(2*x+(2*y+1)*n)*4+c]+previous[(2*x+1+(2*y+1)*n)*4+c])/4);
    ribbonMips.push(next);previous=next;
  }
  // A one-axis mip atlas: 64+32+...+1 = 127 transverse samples, while
  // longitudinal resolution stays 64x64. The shader interpolates adjacent
  // levels and wraps inside each level, so no atlas-border texels are needed.
  const anisotropic=new Uint8Array(127*size*size*4);
  for(let z=0;z<size;z++)for(let y=0;y<size;y++){
    let row=bytes.slice((size*(y+size*z))*4,(size*(y+size*z)+size)*4),offset=0;
    for(let n=size;n>=1;n/=2){
      anisotropic.set(row,(offset+127*(y+size*z))*4);offset+=n;
      if(n>1){const next=new Uint8Array(n*2);for(let x=0;x<n/2;x++)for(let c=0;c<4;c++)next[x*4+c]=Math.round((row[x*8+c]+row[x*8+4+c])/2);row=next;}
    }
  }
  return {bytes,mips:volumeMipChain(bytes,size),ribbon,ribbonMips,anisotropic};
}
