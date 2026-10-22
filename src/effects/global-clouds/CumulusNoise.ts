import {periodicNoise, worley} from '../../scene/CloudNoise';

export const CUMULUS_NOISE_SIZE=64;
let cached:{bytes:Uint8Array;mips:Uint8Array[]}|undefined;

/** Box-filter a periodic RGBA volume. Explicit levels also allocate Cesium's immutable storage. */
export function volumeMipChain(bytes:Uint8Array,size:number){
  if(size<2||(size&(size-1))!==0||bytes.length!==size**3*4)throw new Error('Expected a power-of-two RGBA volume');
  const levels:Uint8Array[]=[];
  let input=bytes;
  while(size>1){
    const next=size/2,output=new Uint8Array(next**3*4);
    for(let z=0;z<next;z++)for(let y=0;y<next;y++)for(let x=0;x<next;x++)for(let c=0;c<4;c++){
      let sum=0;
      for(let dz=0;dz<2;dz++)for(let dy=0;dy<2;dy++)for(let dx=0;dx<2;dx++)
        sum+=input[((x*2+dx)+size*((y*2+dy)+size*(z*2+dz)))*4+c];
      output[(x+next*(y+next*z))*4+c]=Math.round(sum/8);
    }
    levels.push(output);input=output;size=next;
  }
  return levels;
}

/** Independently baked cellular octaves; the tornado keeps its existing noise asset. */
export function createCumulusNoise(){
  if(cached)return cached;
  const size=CUMULUS_NOISE_SIZE,bytes=new Uint8Array(size**3*4);
  for(let z=0;z<size;z++)for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const a=(x+.5)/size,b=(y+.5)/size,c=(z+.5)/size,i=(x+size*(y+size*z))*4;
    const w3=worley(a*3,b*3,c*3,3),w7=worley(a*7,b*7,c*7,7);
    const w13=worley(a*13,b*13,c*13,13),w23=worley(a*23,b*23,c*23,23);
    bytes[i]=Math.round(255*(w3*.72+w7*.28));
    bytes[i+1]=Math.round(255*(w7*.68+w13*.32));
    bytes[i+2]=Math.round(255*(w13*.7+w23*.3));
    bytes[i+3]=Math.round(255*periodicNoise(a*5,b*5,c*5,5,157));
  }
  cached={bytes,mips:volumeMipChain(bytes,size)};return cached;
}
