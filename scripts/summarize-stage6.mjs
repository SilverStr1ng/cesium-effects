import {readFileSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const root='artifacts/stage6/',read=name=>JSON.parse(readFileSync(root+name+'.json','utf8'));
const stats=a=>{const s=[...a].sort((a,b)=>a-b);return {count:s.length,meanMs:s.reduce((a,b)=>a+b,0)/s.length,medianMs:s[Math.floor(s.length*.5)],p95Ms:s[Math.floor(s.length*.95)]};};
const fixed=({visible,focused,camera:{up,...camera},...state})=>({...state,camera});
const measured={comparison:read('comparison-gpu'),current:read('final-gpu')},gpu={},conditions=[];
let maxUpDelta=0;
function match(a,b,key){assert.deepEqual(fixed(a),fixed(b),key);for(let i=0;i<3;i++){const d=Math.abs(a.camera.up[i]-b.camera.up[i]);maxUpDelta=Math.max(maxUpDelta,d);assert.ok(d<=128*Number.EPSILON,key);}}
for(const [version,matrix] of Object.entries(measured)){
  assert.ok(matrix.complete);assert.equal(matrix.results.length,28);
  for(const r of matrix.results){
    const key=`${r.name}/${r.mode}/${r.round}`;match(r.initial,r.final,version+'/'+key);
    assert.deepEqual(r.initial.buffer,[1920,1080]);assert.equal(r.initial.clouds.quality,'medium');assert.equal(r.initial.clouds.parameters.seed,13);
    assert.equal(r.initial.clouds.storage,'RGBA16F');assert.equal(r.initial.atmosphere.parameters.exposure,8);
    assert.deepEqual(r.initial.clouds.motion,{angle:0,highAngle:0,evolution:0});assert.ok(Math.abs(r.initial.camera.fovy-Math.PI/3)<1e-12);
    for(const times of Object.values(r.timing.rawGpu))assert.ok(times.length>=200&&times.every(v=>Number.isFinite(v)&&v>=0));
    if(version==='current'){const b=measured.comparison.results.find(x=>x.name===r.name&&x.mode===r.mode&&x.round===r.round);assert.ok(b);match(b.initial,r.initial,key);conditions.push({key,matched:true});}
  }
  gpu[version]=[...new Set(matrix.results.map(r=>r.name))].map(name=>{
    const rounds=matrix.results.filter(r=>r.name===name),raw={};
    for(const r of rounds)for(const [pass,times] of Object.entries(r.timing.rawGpu))(raw[pass]??=[]).push(...times);
    return {name,gpu:Object.fromEntries(Object.entries(raw).map(([k,a])=>[k,stats(a)])),hiddenFrames:rounds.reduce((s,r)=>s+r.timing.hiddenFrames,0),unfocusedFrames:rounds.reduce((s,r)=>s+r.timing.unfocusedFrames,0),disjoint:rounds.reduce((s,r)=>s+r.timing.disjoint,0),intervalsOver100ms:rounds.reduce((s,r)=>s+r.timing.intervalsOver100ms,0)};
  });
}
const captures=read('comparison-captures');assert.ok(captures.complete);assert.equal(captures.samples.length,7);
const captureChecks=captures.samples.map(c=>{const r=measured.current.results.find(r=>r.name===c.name);assert.ok(r);match(c.state,r.evidence.state,'capture/'+c.name);return {name:c.name,matched:true};});
writeFileSync(root+'condition-validation.json',JSON.stringify({passed:true,conditions,captureChecks,maxUpDelta,upTolerance:128*Number.EPSILON,otherFields:'exact equality'},null,2));
writeFileSync(root+'gpu-summary.json',JSON.stringify(gpu,null,2));
const format=s=>[s.meanMs,s.medianMs,s.p95Ms].map(n=>n.toFixed(3)).join(' / ');
const table=['| 场景 | f1c2d05 整帧 mean / median / P95 ms | 本轮整帧 | 本轮 cloud-volume | 有效样本（整帧 / volume） |','| --- | ---: | ---: | ---: | ---: |',...gpu.current.map((c,i)=>`| ${c.name} | ${format(gpu.comparison[i].gpu.frame)} | ${format(c.gpu.frame)} | ${format(c.gpu['cloud-volume'])} | ${c.gpu.frame.count} / ${c.gpu['cloud-volume'].count} |`)];
writeFileSync(root+'gpu-table.md',table.join('\n')+'\n');console.log(table.join('\n'));
