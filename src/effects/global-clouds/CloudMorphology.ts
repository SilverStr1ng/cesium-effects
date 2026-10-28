/** CPU counterpart of the resolved material domain, used by the worker baker.
 * Coordinates are kilometres in the advected atmosphere sphere. There are no
 * per-cell frames or normalizations of a possibly zero wind vector. */
export function cloudMaterialPosition(p:readonly number[],base:number,thickness:number,wind=24){
  const r=Math.hypot(...p),n=p.map(v=>v/r),height=r-6378.137-base;
  const flow=[-.37*n[2]-.90*n[1],.90*n[0]-.23*n[2],.23*n[1]+.37*n[0]];
  const shear=.22*Math.max(0,Math.min(1.5,wind/80))*height*height/thickness;
  return p.map((v,i)=>v+flow[i]*shear);
}
/** Conservative spectral-norm bound on the material Jacobian for the cloud
 * shell. The height derivative is a rank-one tangent shear (a <= .44*w).
 * Its largest singular value is sqrt(1+a*a/4)+a/2. The .01 margin bounds
 * the spherical-flow derivative even at the maximum 12 km thickness. */
export const cloudMaterialStretch=(wind=24)=>{const w=Math.max(0,Math.min(1.5,wind/80));return Math.sqrt(1+.0484*w*w)+.22*w+.01;};
