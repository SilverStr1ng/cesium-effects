import {mkdirSync,writeFileSync} from 'node:fs';
import {farField,patchFrame,add,mul,norm} from '../tests/farColumnReference';
const field=farField(),cases=[{patch:7,reference:.8064463580116037},{patch:0,reference:.3262552583837594}];
const fract=(x:number)=>x-Math.floor(x),rows=[];
for(const c of cases)for(const count of [64,128,256]){
 const frame=patchFrame(c.patch,.04,Math.PI/4);let opacity=0;
 for(let i=0;i<count;i++){
  const x=fract(.5+(i+1)*.7548776662466927)-.5,y=fract(.5+(i+1)*.5698402909980532)-.5;
  const p=mul(norm(add(frame.column,mul(add(mul(frame.a,x),mul(frame.b,y)),4))),6379.637);
  opacity+=field.point(p,frame.slant)[0]/count;
 }
 rows.push({...c,count,opacity,error:opacity-c.reference});
}
mkdirSync('artifacts/pr1/data',{recursive:true});writeFileSync('artifacts/pr1/data/spatial-r2-prototype.json',JSON.stringify(rows,null,2));console.log(rows);
