import {readFileSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const root='artifacts/stage7/data/',read=name=>JSON.parse(readFileSync(root+name+'.json','utf8'));
const summarize=a=>{a=[...a].sort((x,y)=>x-y);return {count:a.length,meanMs:a.reduce((x,y)=>x+y,0)/a.length,medianMs:a[Math.floor(a.length*.5)],p95Ms:a[Math.floor(a.length*.95)]};};
const aggregate=name=>{
 const d=read(name);assert.ok(d.complete);
 const scenes=[...new Set(d.result.map(r=>r.name))];
 return {startup:d.startup,scenes:scenes.map(scene=>{
  const rows=d.result.filter(r=>r.name===scene),gpu={};
  for(const row of rows)for(const [label,values]of Object.entries(row.timing.rawGpu))(gpu[label]??=[]).push(...values);
  return {name:scene,state:rows[0].initial,content:rows[0].content,gpu:Object.fromEntries(Object.entries(gpu).map(([k,v])=>[k,summarize(v)])),
   rounds:rows.map(r=>({mode:r.mode,round:r.round,hidden:r.timing.hiddenFrames,unfocused:r.timing.unfocusedFrames,disjoint:r.timing.disjoint,over100ms:r.timing.intervalsOver100ms,reason:r.timing.reason}))};})};
};
const before=aggregate('before-gpu-final'),after=aggregate('after-gpu-final');
const comparable=s=>({utc:s.utc,buffer:s.buffer,parameters:s.parameters,quality:s.quality,storage:s.storage,motion:s.motion,atmosphere:s.atmosphere,force:s.force,mask:s.mask});
const conditionChecks=before.scenes.map((b,i)=>{const a=after.scenes[i];assert.equal(a.name,b.name);assert.deepEqual(comparable(a.state),comparable(b.state));
 const cameraDelta=Math.max(...['position','direction','up'].flatMap(k=>a.state.camera[k].map((v,j)=>Math.abs(v-b.state.camera[k][j]))));
 assert.ok(cameraDelta<1e-7);assert.equal(a.state.camera.fovy,b.state.camera.fovy);return {name:a.name,cameraDelta,matched:true};});
const gpu={before,after,conditionChecks,boundary:'Same in-app browser, sequential rounds without parallel CPU workloads. Raw query data and foreground flags retained. Clock/power throttling is unmeasured. Morphology changes occupancy, so these are scene costs, not a fixed-density pipeline speedup.'};
writeFileSync(root+'gpu-summary.json',JSON.stringify(gpu,null,2));
const first=read('regressions-first'),lighting=read('lighting-gpu-final'),entry=read('actual-entry');
const checks=first.results.map(r=>r.name==='lighting-gpu'?{name:r.name,...lighting}:r);checks.push({name:'actual-entry?auto',...entry});
writeFileSync(root+'regressions-final.json',JSON.stringify({complete:true,passed:checks.every(c=>c.passed),results:checks},null,2));
const max=(rows,key)=>{
 assert.ok(rows.length>0,`Missing rows for ${key}`);
 const values=rows.map(r=>Math.abs(r[key]));assert.ok(values.every(Number.isFinite),`Missing numeric ${key}`);
 return Math.max(...values);
};
const spatial=read('grazing-matrix'),legacy=read('legacy-grazing-matrix'),material=read('material-range'),components=read('components-cpu');
const find=n=>checks.find(r=>r.name===n),finite=find('cloud-finite'),partial=find('cloud-partial'),layered=find('cloud-layered-closure'),satellite=find('satellite-lod');
const functionalNames=['cloud-grazing','cloud-startup','cloud-pipeline','cloud-closure','atmosphere-gpu','lighting-gpu','cloud-gpu','water-cloud-gpu','high-cloud-gpu','satellite-lod','celestial-state','celestial-scene','celestial-gpu','celestial-optics'];
const functional=checks.filter(c=>functionalNames.includes(c.name));
const quality=read('after-switches'),links=quality.result.flatMap(r=>r.shader.filter(s=>s.label==='cloud-volume'&&s.kind==='linkProgram CPU call'));
const recoveredQuality=read('after-switches-recovered'),recoveredLinks=recoveredQuality.result.flatMap(r=>r.shader.filter(s=>s.label==='cloud-volume'&&s.kind==='linkProgram CPU call'));
assert.ok(recoveredQuality.complete&&recoveredQuality.result.length===7);
const envelope=read('envelope-experiment'),envelopeExperiment=[0,.25,.5,.75,1].map(weight=>{const rows=envelope.rows.filter(r=>r.envelope===weight);return {weight,maxT:max(rows,'Terror'),maxL:max(rows,'Lerror'),maxConvergence:max(rows,'convergence')};});
const transition=Object.fromEntries(['before','after'].map(label=>{const d=read('transition-'+label);return [label,{count:d.rows.length,maxT:max(d.rows,'Terror'),maxL:max(d.rows,'Lerror'),maxReferenceChange:max(d.rows,'convergence')}];}));
const result={review:'f433c8e1ef4afd2a4d2f764e8d61d6b191cc4171',overallPassed:false,
 status:'Unaccepted morphology candidate on codex/stage7-cloud-morphology; not an overall Stage 7 completion',
 visual:{ground:'Some bases connect; repeated lobes and grain remain',satelliteToAltitude:'Larger connected patches; repeated small units remain prominent',complete:false},
 cpu:{passed:true,tests:81,log:'test-final.log'},build:{passed:true,log:'build-final.log'},
 functional:{passed:functional.every(c=>c.passed),passedChecks:functional.reduce((n,r)=>n+r.checks.filter(c=>c.pass).length,0),checks:functional.reduce((n,r)=>n+r.checks.length,0),failures:functional.flatMap(r=>r.checks.filter(c=>!c.pass).map(c=>({fixture:r.name,...c})))},
 spatial:{passed:spatial.failures.length===0&&spatial.referenceFailures.length===0,failures:spatial.failures,maxOpacity:max(spatial.accuracy,'opacityError'),maxConvergence:max(spatial.accuracy,'referenceConvergence')},
 legacySpatial:{passed:false,failures:legacy.failures},
 partial:{passed:partial.passed,count:partial.checks.length,maxError:max(partial.checks,'opacityError'),maxConvergence:max(partial.checks,'referenceConvergence')},
 finite:{passed:finite.passed,checks:finite.checks,maxError:max(finite.checks,'error'),maxConvergence:max(finite.checks,'convergence')},
 responseReuse:{passed:finite.responseChecks.every(c=>c.pass),maxL:max(finite.responseChecks,'Lerror'),maxT:max(finite.responseChecks,'Terror')},
 material:{passed:material.passed,count:material.rows.length,maxError:max(material.rows,'error'),maxConvergence:max(material.rows,'convergence')},
 components:{passed:components.passed,count:components.rows.length,maxError:components.maxError},
 closure:{controlled:find('cloud-closure').passed,layered:layered.passed,maxL:max(layered.checks,'maxL'),maxT:max(layered.checks,'maxT'),maxConvergence:max(layered.checks,'convergence')},
 satellite:satellite.checks.find(c=>c.qualityComparisons).qualityComparisons,
 changingWeatherTransition:{status:'regressed diagnostic; retained separately from existing gates',...transition,scope:'40 local pixel averages at .35/.75/1.25/2/4 km; independent resolved point rays. Not the frozen-far-model .02 opacity gate.'},
 legacyPointCache:{passed:find('cloud-cache').passed,production:false,maxT:max(find('cloud-cache').checks,'maxT')},
 actualEntry:{passed:entry.passed,count:entry.checks.length},
 quality:{sourceReusePassed:links.length===0&&recoveredLinks.length===0,newCloudLinks:links.length,switches:quality.result.map(r=>({quality:r.q,hdr:r.hdr,wallMs:r.wallMs})),retry:{complete:recoveredQuality.complete,newCloudLinks:recoveredLinks.length,switches:recoveredQuality.result.map(r=>({quality:r.q,hdr:r.hdr,wallMs:r.wallMs})),latencyStable:false,scope:'Screenshot replay only; 3 postRender wall times, no GPU timing conclusions'}},
 browserStability:{earlierErrors:['Zero width in Cesium GlobeDepth framebuffer update','Empty log on simple depth-pack shader compile'],contextLossConfirmed:false,recovered:true,evidence:'after-switches-retry-error.json and after-switches-recovered.json'},
 rejectedExperiments:{envelope:envelopeExperiment,quadrature:'transition-quadrature.json',connectedCore:'rejected-connected-core.json'},
 storage:{assetVersion:6,opticsVersion:6,fixedAndWeatherBytes:16347328,componentsBytes:32768,retainedCpuSourceBytes:9437184,materialCachePayloadLimitBytes:655360,addedTextureBytes:0},
 gpu:{source:'gpu-summary.json',comparisonTargetF1c2d05Passed:false},
 unverified:['Real DEM and 3D Tiles','Other GPUs/drivers','Hardware clocks and power throttling','Strict pixel temporal error','Independent full L for changing weather along long grazing paths'],
 remaining:['Current spatial matrix still has failures at the unchanged .02 threshold','High quality radiance exceeds .01','Changing-weather transition diagnostic regresses in local L/T accuracy','Original fixed-location thick-core count fails under the new morphology','First cloud program remains synchronously blocking','Prior f1c2d05 cost target remains unresolved','Finite segment frozen-weather and conditional lighting remain approximations']};
writeFileSync(root+'result.json',JSON.stringify(result,null,2));
console.log(JSON.stringify({functional:result.functional,partial:result.partial,finite:{passed:result.finite.passed,maxError:result.finite.maxError},quality:result.quality},null,2));
