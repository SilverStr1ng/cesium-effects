import {readFileSync,writeFileSync} from 'node:fs';
import {farField,patchFrame,add,mul,norm,smooth,filteredMean} from '../tests/farColumnReference';
const field=farField(),input=JSON.parse(readFileSync(process.argv[2]??'artifacts/pr1/final-cpu/grazing-matrix.json','utf8'));
const fract=(v:number)=>v-Math.floor(v),rows=[];
for(const r of input.accuracy){
 const {east,north,column,slant}=patchFrame(r.patch,r.mu),c=Math.cos(r.rotation),s=Math.sin(r.rotation),a=[slant*c,s],b=[-slant*s,c];
 const support=[r.footprint*(Math.abs(a[0])+Math.abs(b[0])),r.footprint*(Math.abs(a[1])+Math.abs(b[1]))];
 const medium=support.map(v=>smooth(4,12,v)),fine=smooth(12,36,support[0]);
 const nx=fine>0?36:medium[0]>0?12:4,ny=medium[1]>0?12:4;
 const weight=(i:number,n:number,m:number,f:number)=>f/n+(n<=12||i%3===1?m*(1-f)/12:0)+(n===4||n===12&&i%3===1||n===36&&i%9===4?(1-m)/4:0);
 const rowA=[c/slant,s],rowB=[-s/slant,c],loMinor=.5*Math.min(Math.abs(a[1]),Math.abs(b[1])),hiMinor=.5*Math.max(Math.abs(a[1]),Math.abs(b[1]));
 let value=0;
 for(let y=0;y<ny;y++)for(let x=0;x<nx;x++){
  const phase=(fract((x+.5)/nx*36*.6180339887498949)-.5)/4;
  const u=fract((y+.5)/ny+phase),q=Math.min(u,1-u);
  const across=(loMinor>1e-6&&q<loMinor/(2*hiMinor)?-loMinor-hiMinor+Math.sqrt(8*loMinor*hiMinor*q):2*hiMinor*q-hiMinor)*(u<.5?1:-1);
  let lo=-1e6,hi=1e6;
  for(const row of [rowA,rowB])if(Math.abs(row[0])>=1e-6){const l=(-.5-row[1]*across)/row[0],h=(.5-row[1]*across)/row[0];lo=Math.max(lo,Math.min(l,h));hi=Math.min(hi,Math.max(l,h));}
  const along=lo+(hi-lo)*(x+.5)/nx,p=mul(norm(add(column,mul(add(mul(east,along),mul(north,across)),r.footprint))),6379.637);
  value+=field.point(p,slant)[0]*weight(x,nx,medium[0],fine)*weight(y,ny,medium[1],0);
 }
 const blend=smooth(1.05,1.25,slant),old=filteredMean(r.patch,r.footprint,r.mu,r.rotation).moments[0];value=old*(1-blend)+value*blend;
 rows.push({...r,value,error:value-r.reference[0]});
}
writeFileSync('artifacts/pr1/data/spatial-interleaved-prototype.json',JSON.stringify(rows,null,2));
console.log(JSON.stringify({max:Math.max(...rows.map(r=>Math.abs(r.error))),failures:rows.filter(r=>Math.abs(r.error)>.02).map(r=>({patch:r.patch,F:r.footprint,mu:r.mu,rotation:r.rotation,error:r.error}))},null,2));
