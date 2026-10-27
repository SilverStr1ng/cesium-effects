import {readFileSync,writeFileSync} from 'node:fs';
const root='artifacts/stage5/';
const stats=a=>{const s=[...a].sort((a,b)=>a-b);return {count:s.length,meanMs:s.reduce((a,b)=>a+b,0)/s.length,medianMs:s[Math.floor(s.length*.5)],p95Ms:s[Math.floor(s.length*.95)]};};
const result={};
for(const version of ['baseline','current']){
 const report=JSON.parse(readFileSync(root+version+'-gpu.json','utf8'));
 if(!report.complete)throw Error(version+' matrix incomplete');
 result[version]=['global','orbit','inside','ground','night','high-only','two-layers'].map(name=>{
  const rounds=report.results.filter(r=>r.name===name),values={};
  for(const r of rounds)for(const [pass,times] of Object.entries(r.timing.rawGpu))(values[pass]??=[]).push(...times);
  return {name,gpu:Object.fromEntries(Object.entries(values).map(([k,v])=>[k,stats(v)])),rounds:rounds.map(r=>({mode:r.mode,round:r.round,reason:r.timing.reason,gpu:r.timing.gpu,hiddenFrames:r.timing.hiddenFrames,unfocusedFrames:r.timing.unfocusedFrames,disjoint:r.timing.disjoint,intervalsOver100ms:r.timing.intervalsOver100ms})),
   hiddenFrames:rounds.reduce((n,r)=>n+r.timing.hiddenFrames,0),unfocusedFrames:rounds.reduce((n,r)=>n+r.timing.unfocusedFrames,0),disjoint:rounds.reduce((n,r)=>n+r.timing.disjoint,0),intervalsOver100ms:rounds.reduce((n,r)=>n+r.timing.intervalsOver100ms,0)};
 });
}
writeFileSync(root+'gpu-summary.json',JSON.stringify(result,null,2));
const f=s=>[s.meanMs,s.medianMs,s.p95Ms].map(n=>n.toFixed(3)).join(' / ');
const lines=['| 场景 | 基线整帧 mean / median / P95 ms | 本轮整帧 mean / median / P95 ms | 本轮 cloud-volume mean / median / P95 ms | 每列样本数 |','| --- | ---: | ---: | ---: | ---: |'];
for(let i=0;i<result.current.length;i++){const b=result.baseline[i],c=result.current[i];lines.push(`| ${c.name} | ${f(b.gpu.frame)} | ${f(c.gpu.frame)} | ${f(c.gpu['cloud-volume'])} | ${c.gpu.frame.count} / ${c.gpu['cloud-volume'].count} |`);}
writeFileSync(root+'gpu-table.md',lines.join('\n'));
console.log(lines.join('\n'));console.log(JSON.stringify(result.current.map(r=>({name:r.name,hidden:r.hiddenFrames,unfocused:r.unfocusedFrames,disjoint:r.disjoint,over100:r.intervalsOver100ms})),null,2));
