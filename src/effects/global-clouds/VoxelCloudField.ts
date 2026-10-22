import {createCumulusNoise,volumeMipChain} from './CumulusNoise';

export const VOXEL_SIZE=128;
export const DISTANCE_RANGE=16; // in voxels, encoded with downward quantization

/** Exact squared Euclidean distance transform, separable in three dimensions. */
export function distanceTransform(mask:Uint8Array,size:number,occupied=true){
  const data=Float32Array.from(mask,v=>(Boolean(v)===occupied?0:1e12));
  const f=new Float64Array(size),out=new Float64Array(size),sites=new Int32Array(size),cuts=new Float64Array(size+1);
  const line=()=>{
    let k=0;sites[0]=0;cuts[0]=-Infinity;cuts[1]=Infinity;
    for(let q=1;q<size;q++){
      let s=(f[q]+q*q-f[sites[k]]-sites[k]*sites[k])/(2*(q-sites[k]));
      while(s<=cuts[k]){k--;s=(f[q]+q*q-f[sites[k]]-sites[k]*sites[k])/(2*(q-sites[k]));}
      sites[++k]=q;cuts[k]=s;cuts[k+1]=Infinity;
    }
    k=0;for(let q=0;q<size;q++){while(cuts[k+1]<q)k++;out[q]=(q-sites[k])**2+f[sites[k]];}
  };
  for(let axis=0;axis<3;axis++)for(let b=0;b<size;b++)for(let a=0;a<size;a++){
    const index=(q:number)=>axis===0?q+size*(a+size*b):axis===1?a+size*(q+size*b):a+size*(b+size*q);
    for(let q=0;q<size;q++)f[q]=data[index(q)];line();
    for(let q=0;q<size;q++)data[index(q)]=out[q];
  }
  return data;
}

/** Trilinear periodic sampling used only by the independent CPU asset baker. */
export function sampleVolume(bytes:Uint8Array,size:number,x:number,y:number,z:number,channel:number){
  const ix=Math.floor(x),iy=Math.floor(y),iz=Math.floor(z),fx=x-ix,fy=y-iy,fz=z-iz;
  let value=0;
  for(let c=0;c<2;c++)for(let b=0;b<2;b++)for(let a=0;a<2;a++){
    const at=(((ix+a)%size+size)%size)+size*((((iy+b)%size+size)%size)+size*(((iz+c)%size+size)%size));
    value+=bytes[at*4+channel]*(a?fx:1-fx)*(b?fy:1-fy)*(c?fz:1-fz)/255;
  }
  return value;
}
const smooth=(a:number,b:number,x:number)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);};

/** Bake shape, conservative empty distance, interior depth and morphology.
 * The procedural sculpt is original; it is not a fluid-simulation asset.
 * An independent density field is retained, so holes/undercuts are truly 3D.
 */
export function createVoxelCloudField(size=VOXEL_SIZE){
  const sample=sampleVolume;
  const noise=createCumulusNoise().bytes,bytes=new Uint8Array(size**3*4),mask=new Uint8Array(size**3);
  for(let z=0;z<size;z++)for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const a=(x+.5)/size*64-.5,b=(y+.5)/size*64-.5,c=(z+.5)/size*64-.5;
    // Bake the nonlinear curl into the asset, before measuring distances.
    // Runtime domain warping would invalidate the conservative empty bound.
    const wx=(sample(noise,64,a+13,b+7,c-9,3)-.5)*7;
    const wy=(sample(noise,64,a-5,b+23,c+11,3)-.5)*7;
    const wz=(sample(noise,64,a+19,b-17,c+3,3)-.5)*7;
    const broad=sample(noise,64,a+wx,b+wy,c+wz,0),turbulence=sample(noise,64,b+c,c+a,a+b,3);
    const shoulder=sample(noise,64,a+wx+19,b+wy-11,c+wz+7,1);
    const field=broad*.68+turbulence*.1+shoulder*.22;
    const rho=smooth(.54,.70,field),i=x+size*(y+size*z);
    bytes[i*4]=Math.round(rho*255);mask[i]=bytes[i*4]>0?1:0;
    bytes[i*4+3]=Math.round(smooth(.38,.72,broad)*255);
  }
  const outside=distanceTransform(mask,size),inside=distanceTransform(mask,size,false);
  for(let z=0;z<size;z++)for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const i=x+size*(y+size*z),border=Math.min(x,y,z,size-1-x,size-1-y,size-1-z);
    // EDT is nonperiodic. Capping at the boundary prevents a jump into an
    // unexamined neighbouring tile. Two voxel diagonals cover interpolation
    // of both density support and the distance values at arbitrary positions.
    const empty=Math.max(0,Math.min(Math.sqrt(outside[i]),border)-2*Math.sqrt(3));
    bytes[i*4+1]=Math.floor(Math.min(1,empty/DISTANCE_RANGE)*255);
    bytes[i*4+2]=Math.round(Math.min(1,Math.sqrt(inside[i])/DISTANCE_RANGE)*255);
  }
  return {bytes,mips:volumeMipChain(bytes,size)};
}
