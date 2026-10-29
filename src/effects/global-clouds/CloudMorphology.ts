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

export const CLOUD_RESIDUAL_WEIGHT=.12;
const smooth=(a:number,b:number,x:number)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);};
/** Shared body's explicit column contract. shape is the local smooth 4.78 km
 * lobe value, NOT an averaged optical depth. tau is vertical, at density=1.
 * The voxel table describes the gated residual and cannot supply these bounds. */
export function cloudBodyColumn(shape:number,cover:number,type:number,cluster:number,thickness:number,lobes:readonly number[]=[shape,shape,shape],roof:readonly number[]=[.5,.5],bankShape=shape){
 const typeTop=(.26+(.58-.26)*smooth(0,.5,type))*(1-smooth(.5,1,type))+smooth(.5,1,type);
 const support=bankShape+(shape-bankShape)*(.25+.20*type);
 const strength=smooth(.36+.06*type,.63+.07*type,support+.1*(cluster-.5));
 const cap=roof.map(x=>Math.sqrt(Math.max(0,1-Math.min(1,Math.max(0,(1-x)/.85))**2)));
 const billow=(lobes[0]-shape)*.35+(lobes[1]-shape)*.2+(lobes[2]-shape)*.1+(cap[0]-.75)*.35+(cap[1]-.75)*.15;
 const bottom=.015+.045*shape,rise=Math.max(.15,Math.min(1.12,.38+.34*type+(.20+.08*type)*shape+billow));
 const top=Math.min(1,Math.max(bottom+.001,bottom+typeTop*rise*Math.sqrt(Math.max(0,cluster*strength))));
 const tau=9*thickness*(.16+.14*type)*cluster**1.6*strength*smooth(0,.2,cover)*(.65+.35*shape);
 return {tau,bottom,top};
}
/** Gate on the explicit body's support, not the old voxel's support. */
export const cloudResidualGate=(bodyTau:number)=>smooth(0,.5,bodyTau);
