import {readFileSync,writeFileSync} from 'node:fs';
import {isDeepStrictEqual} from 'node:util';
import {pathToFileURL} from 'node:url';
const summary=values=>{const a=[...values].sort((x,y)=>x-y);return {count:a.length,meanMs:a.reduce((s,v)=>s+v,0)/a.length,medianMs:a[Math.floor(a.length*.5)],p95Ms:a[Math.min(a.length-1,Math.floor(a.length*.95))]};};
const fixed=s=>Object.fromEntries(['utc','buffer','camera','parameters','quality','storage','motion','atmosphere','force','mask','uniformBudget','voxelEnabled','voxelReady','skipVoxels'].map(k=>[k,s?.[k]]));
// Cesium renormalizes its camera frame on render. Permit only sub-micrometre
// position and 1e-10 direction/FOV roundoff; every non-camera field stays exact.
export function sameConditions(a,b){
 const x=fixed(a),y=fixed(b),ca=x.camera,cb=y.camera;delete x.camera;delete y.camera;
 if(!isDeepStrictEqual(x,y)||!ca||!cb)return false;
 const vector=(key,tolerance)=>Array.isArray(ca[key])&&Array.isArray(cb[key])&&ca[key].length===3&&cb[key].length===3&&ca[key].every((v,i)=>Number.isFinite(v)&&Number.isFinite(cb[key][i])&&Math.abs(v-cb[key][i])<=tolerance);
 return vector('position',1e-6)&&vector('direction',1e-10)&&vector('up',1e-10)&&Number.isFinite(ca.fovy)&&Number.isFinite(cb.fovy)&&Math.abs(ca.fovy-cb.fovy)<=1e-10;
}
/** Check EVERY round, not just the first scene. Keep rejected evidence and
 * reasons visible; do not silently pool incomplete/background query batches. */
export function auditRounds(data){
 const rounds=(data.result??[]).map(row=>{
  const timing=row.timing??{},errors=[],labels=row.mode==='frame'?['frame']:['cloud-volume','cloud-resolve','atmosphere-composite'];
  if(!['frame','passes'].includes(row.mode))errors.push('unknown timing mode');
  if(['utc','buffer','camera','parameters','quality','storage','motion'].some(k=>row.initial?.[k]===undefined||row.final?.[k]===undefined))errors.push('fixed conditions absent');
  if(!sameConditions(row.initial,row.final))errors.push('initial/final conditions differ');
  const first=data.result.find(r=>r.name===row.name);
  if(first!==row&&!sameConditions(first.initial,row.initial))errors.push('conditions differ across rounds of this scene');
  if(!row.initial?.uniformBudget||row.initial.voxelEnabled===undefined)errors.push('actual uniform/voxel state absent');
  if(!row.initial?.visible||!row.initial?.focused||!row.final?.visible||!row.final?.focused)errors.push('endpoint not foreground');
  if(timing.hiddenFrames||timing.unfocusedFrames||timing.disjoint)errors.push('hidden/unfocused/disjoint samples');
  if(row.content?.readbackError!==0)errors.push('readback failed or absent');
  if(timing.reason!=='sample target reached')errors.push(timing.reason??'missing end reason');
  for(const label of labels){const values=timing.rawGpu?.[label]??[];if(values.length<200||values.some(v=>!Number.isFinite(v)||v<0))errors.push(`${label}: invalid/insufficient queries (${values.length})`);}
  return {...row,timing,accepted:errors.length===0,errors};
 });
 const scenes=[...new Set(rounds.map(r=>r.name))].map(name=>{
  const selected=rounds.filter(r=>r.name===name&&r.accepted),raw={};
  for(const row of selected)for(const [label,values]of Object.entries(row.timing.rawGpu))(raw[label]??=[]).push(...values);
  return {name,gpu:Object.fromEntries(Object.entries(raw).map(([k,v])=>[k,summary(v)])),content:selected[0]?.content,conditions:selected[0]?.initial};
 });
 return {complete:data.complete===true,accepted:data.complete===true&&rounds.length>0&&rounds.every(r=>r.accepted),renderer:data.startup?.renderer,scenes,rounds:rounds.map(({name,mode,round,accepted,errors,timing})=>({name,mode,round,accepted,errors,reason:timing.reason,requested:timing.requested,counts:Object.fromEntries(Object.entries(timing.rawGpu??{}).map(([k,v])=>[k,v.length])),hidden:timing.hiddenFrames,unfocused:timing.unfocusedFrames,disjoint:timing.disjoint,over100ms:timing.intervalsOver100ms}))};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href&&process.argv[2]){
 const result=auditRounds(JSON.parse(readFileSync(process.argv[2],'utf8')));
 if(process.argv[3])writeFileSync(process.argv[3],JSON.stringify(result,null,2));
 console.log(JSON.stringify(result,null,2));if(!result.accepted)process.exitCode=1;
}
