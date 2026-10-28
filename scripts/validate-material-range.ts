import {writeFileSync,mkdirSync} from 'node:fs';
import {createCumulusNoise} from '../src/effects/global-clouds/CumulusNoise';
import {createVoxelCloudField,sampleVolume} from '../src/effects/global-clouds/VoxelCloudField';
import {createCloudOptics} from '../src/effects/global-clouds/CloudOptics';
import {smooth} from '../tests/farColumnReference';

// Scope check of the fixed ensemble/table, not local-world filtering. Independent
// higher-resolution vertical quadrature changes the actual near-material inputs.
const noise=createCumulusNoise().bytes,voxels=createVoxelCloudField().bytes,table=createCloudOptics(voxels,noise);
const mix=(a:number,b:number,t:number)=>a+(b-a)*t,clamp=(v:number)=>Math.max(0,Math.min(1,v));
const sample=(data:Uint8Array,size:number,p:number[],scale:number,c:number)=>sampleVolume(data,size,...p.map(v=>v/scale*size-.5) as [number,number,number],c);
function reference(detail:number,thickness:number,density:number,slant:number,heights:number){
  const type=.75,cut=.1,top=mix(mix(.26,.58,smooth(0,.5,type)),1,smooth(.5,1,type));let opacity=0,coverage=0;
  for(let i=0;i<256;i++){
    const z=1-2*(i+.5)/256,phi=i*2.39996323,n=[Math.sqrt(1-z*z)*Math.cos(phi),Math.sqrt(1-z*z)*Math.sin(phi),z];let tau=0;
    for(let j=0;j<heights;j++){
      const h=(j+.5)/heights,p=n.map(v=>v*(6378.137+1.5+thickness*top*h));
      const q=[p[0]*.36+p[1]*.48-p[2]*.8,-p[0]*.8+p[1]*.6,p[0]*.48+p[1]*.64+p[2]*.6],a=p.map(v=>v+13*.23),b=q.map(v=>v+13*.31);
      const va=sample(voxels,128,a,7.83,0),vb=sample(voxels,128,b,13.57,0)*.8;
      const morphology=va>vb?sample(voxels,128,a,7.83,3):sample(voxels,128,b,13.57,3);
      const fine=[0,1,2,3].map(c=>sample(noise,64,p.map(v=>v+13*.17),1.61,c)),folded=Math.abs(2*Math.abs(2*fine[1]-1)-1);
      let erosion=mix(1-Math.abs(2*fine[3]-1),fine[0]*.55+fine[1]*.3+fine[2]*.15,morphology);
      erosion=mix(erosion,mix(1-folded**3,folded*folded,morphology),1-smooth(.015,.12,.02));
      const field=Math.max(va,vb)-(1-erosion)*detail*.28-h**mix(4,2.8,type)*.4-cut;
      tau+=smooth(0,.324,field)*smooth(0,.045,h)*(1-smooth(.9,1,h))*9*density*thickness*top/heights;
    }
    opacity+=-Math.expm1(-tau*slant)/256;coverage+=Number(tau*slant>-Math.log(.9))/256;
  }
  return {opacity,coverage};
}
const rows=[];
const materialTables=new Map<string,Uint8Array>();
for(const [detail,thickness,density] of [[.55,3.8,1.1],[0,3.8,1.1],[1,3.8,1.1],[.55,1,1.1],[.55,8,1.1],[.55,3.8,.5],[.55,3.8,2]])for(const slant of [1,10]){
  const scale=density*thickness/3.8*slant,uv=[.1/.52*31,.75*31,clamp((Math.log2(scale)+5)/12)*31] as [number,number,number];
  const actual=sampleVolume(table,32,...uv,0),a=reference(detail,thickness,density,slant,96),b=reference(detail,thickness,density,slant,192);
  const key=`${detail}/${thickness}`;if(!materialTables.has(key))materialTables.set(key,createCloudOptics(voxels,noise,{detail,thickness}));
  const updated=sampleVolume(materialTables.get(key)!,32,...uv,0);
  rows.push({detail,thickness,density,slant,oldTableOpacity:actual,tableOpacity:updated,reference:a,reference192:b,oldError:actual-b.opacity,error:updated-b.opacity,convergence:b.opacity-a.opacity,pass:Math.abs(updated-b.opacity)<=.02&&Math.abs(b.opacity-a.opacity)<=.002});
}
mkdirSync('artifacts/stage6',{recursive:true});writeFileSync('artifacts/stage6/material-range.json',JSON.stringify({passed:rows.every(r=>r.pass),targets:{opacity:.02,convergence:.002},kind:'Parameterized conditional material table; type=.75, cut=.1, 256 same-seed columns. Not a spatial/local image bound.',rows},null,2));
console.log(JSON.stringify(rows.map(r=>({detail:r.detail,thickness:r.thickness,density:r.density,slant:r.slant,error:r.error,convergence:r.convergence})),null,2));
if(rows.some(r=>!r.pass))process.exitCode=1;
