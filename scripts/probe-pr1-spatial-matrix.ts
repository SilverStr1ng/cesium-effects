import {readFileSync,writeFileSync} from 'node:fs';
import {farField,patchFrame,add,mul,norm,smooth,spatialMean} from '../tests/farColumnReference';
const field=farField(),input=JSON.parse(readFileSync(process.argv[2]??'artifacts/pr1/final-cpu/grazing-matrix.json','utf8'));
const fract=(v:number)=>v-Math.floor(v),rows=[];
for(const r of input.accuracy){
 const f=patchFrame(r.patch,r.mu,r.rotation),values=[];
 for(const count of [64,128,256]){
  let value=0;for(let i=0;i<count;i++){
   const x=fract(.5+(i+1)*.7548776662466927)-.5,y=fract(.5+(i+1)*.5698402909980532)-.5;
   const p=mul(norm(add(f.column,mul(add(mul(f.a,x),mul(f.b,y)),r.footprint))),6379.637);
   value+=field.point(p,f.slant)[0]/count;
  }
  values.push({count,value,error:value-r.reference[0]});
 }
 rows.push({...r,values});
}
writeFileSync('artifacts/pr1/data/spatial-r2-matrix-prototype.json',JSON.stringify(rows,null,2));
for(let i=0;i<3;i++)console.log(JSON.stringify({count:rows[0].values[i].count,max:Math.max(...rows.map(r=>Math.abs(r.values[i].error))),failures:rows.filter(r=>Math.abs(r.values[i].error)>.02).map(r=>({patch:r.patch,F:r.footprint,mu:r.mu,rotation:r.rotation,error:r.values[i].error}))}));
