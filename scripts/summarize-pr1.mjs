import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {auditRounds,sameConditions} from './summarize-cloud-rounds.mjs';
const root='artifacts/pr1',read=p=>JSON.parse(readFileSync(p,'utf8'));
const current=read(`${root}/data/pixel-final-91.json`),previous=read('artifacts/stage7-correction/data/release-transition.json');
const difference=(a,b)=>({T:a[3]-b[3],L:Math.hypot(...a.slice(0,3).map((v,i)=>v-b[i]))});
const rows=current.rows.map((r,i)=>{
 const old=previous.rows[i];
 if(['patch','footprint','height','mu'].some(k=>r[k]!==old[k]))throw new Error(`Different input at row ${i}`);
 return {...r,previous:{near:old.near,far:old.far,auto:old.auto,reference:old.reference,errors:old.errors},productionDelta:difference(r.auto.LT,old.auto.LT)};
});
const groups=[['original40',0,40],['additional48',40,88],['oblique3',88,91]].map(([name,begin,end])=>{
 const selected=rows.slice(begin,end);
 return {name,count:selected.length,cloudyReferenceCount:selected.filter(r=>r.reference.LT[3]<.999).length,
   maximumT:Math.max(...selected.map(r=>r.errors.auto.T)),maximumL:Math.max(...selected.map(r=>r.errors.auto.L)),
   failures:selected.filter(r=>r.errors.auto.T>.01||r.errors.auto.L>.002).map(r=>({patch:r.patch,footprint:r.footprint,height:r.height,T:r.errors.auto.T,L:r.errors.auto.L})),
   maximumProductionDeltaT:Math.max(...selected.map(r=>Math.abs(r.productionDelta.T))),maximumProductionDeltaL:Math.max(...selected.map(r=>r.productionDelta.L))};
});
const gpu=['gpu-baseline-minimal','gpu-before-minimal','gpu-support-minimal','gpu-final-minimal','gpu-path-prototype-minimal'].map(name=>{
 const data=read(`${root}/data/${name}.json`),audit=auditRounds(data);
 writeFileSync(`${root}/data/${name}-audit.json`,JSON.stringify(audit,null,2));
 return {name,accepted:audit.accepted,scenes:audit.scenes.map(({name,gpu,content})=>({name,gpu,content})),startup:{resourceMs:data.startup.resourceMs,readyMs:data.startup.readyMs,shader:data.startup.shader.filter(r=>r.label==='cloud-volume'),cache:data.startup.initialization.cache}};
});
const regression=read(`${root}/data/regressions-final.json`),lighting=read(`${root}/data/lighting-final.json`),shadow=read(`${root}/data/shadow-timing-final.json`);
// Preserve the first fixture compilation failure and its explicit repair result.
const checks=regression.results.map(r=>r.name==='lighting-gpu'?{name:r.name,...lighting,firstAttemptError:r.error}:r);
checks.push({name:'cloud-shadow-support',...shadow});
const spatial=read(`${root}/final-cpu/grazing-matrix.json`);
const testLog=readFileSync(`${root}/npm-test-final.log`,'utf8'),buildLog=readFileSync(`${root}/npm-build-final.log`,'utf8');
const testCount=Number(testLog.match(/tests (\d+)/)?.[1]),testPass=Number(testLog.match(/pass (\d+)/)?.[1]),testFail=Number(testLog.match(/fail (\d+)/)?.[1]);
if(!Number.isFinite(testCount)||!Number.isFinite(testPass)||!Number.isFinite(testFail))throw new Error('Missing CPU test totals');
const baselineTiming=read(`${root}/data/gpu-baseline-minimal.json`),finalTiming=read(`${root}/data/gpu-final-minimal.json`);
const matchingPerformanceConditions=finalTiming.result.every(r=>{
 const b=baselineTiming.result.find(b=>b.name===r.name&&b.round===r.round&&b.mode===r.mode);
 return b&&sameConditions(b.initial,r.initial);
});
if(!matchingPerformanceConditions)throw new Error('Performance comparison conditions differ');
const replay=read(`${root}/data/minimal-pixel-path-replay.json`),prototype=read(`${root}/data/minimal-pixel-path-prototype.json`);
const prototypeReplayMaxDelta=Math.max(...replay.rows.flatMap((r,i)=>r.far.LT.map((v,k)=>Math.abs(v-prototype.rows[i].far.LT[k]))));
const result={overall:'RED / Draft / not mergeable on rendering acceptance',review:'2064f91162516f43e6a31aa4eb5aca254341dcf5',performanceControl:'87b6ff032afe4229c9e42d9925b4ecc460867940',
 targets:{sameFarModelOpacity:.02,referenceConvergence:.002,newPixelT:.01,newPixelRgbVectorL:.002},
 production:'Local residual-shadow support fix and resolved-only light call path. World density, frozen-column Q, spatial rule and assets unchanged.',
 prototype:'Rejected correlated world-ray response: T improved on two minimal cases, L and orbit/ground cost failed. Test URL opt-in only.',
 cpu:{tests:testCount,passed:testPass,failed:testFail,build:buildLog.includes('built in')&&!/error TS\d|build failed/i.test(buildLog)},spatial:{count:spatial.accuracy.length,failures:spatial.failures,maxOpacity:Math.max(...spatial.accuracy.map(r=>Math.abs(r.opacityError))),maxReferenceConvergence:Math.max(...spatial.accuracy.map(r=>Math.abs(r.referenceConvergence)))},
 pixels:{groups,convergence:current.convergence.map(r=>({patch:r.patch,footprint:r.footprint,height:r.height,spatial:difference(r.spatial.LT,r.base.LT),longitudinal:difference(r.vertical.LT,r.base.LT)}))},
 gpu,matchingPerformanceConditions,prototypeReplayMaxDelta,regressions:checks.map(r=>({name:r.name,passed:r.passed,error:r.error,firstAttemptError:r.firstAttemptError})),
 limitations:['No isolated whole-pass attribution to the call-graph change; shadow-only microquery is separate. Whole-frame timing not rerun in this minimal round.','No hardware clock/power telemetry, other GPU, real DEM/3D Tiles or strict temporal error measurement.','The prototype first-entry tab was lost before export. Its later 20.2ms cached LINK_STATUS is not a cold-link result.','actual-entry loading-switch check reported startedWhileLoading=false; that particular overlap is not verified by this run.','No TAA or wrong voxel EDT enabled. No density, exposure, resolution or quality-budget changes.']};
if(existsSync(`${root}/data/switches-final.json`))result.switches=read(`${root}/data/switches-final.json`).result;
writeFileSync(`${root}/data/pixel-91-comparison.json`,JSON.stringify(rows,null,2));
writeFileSync(`${root}/data/summary.json`,JSON.stringify(result,null,2));
console.log(JSON.stringify({overall:result.overall,pixels:groups,spatialFailures:result.spatial.failures.length,gpuAccepted:gpu.every(r=>r.accepted),regressionFailures:result.regressions.filter(r=>!r.passed).map(r=>r.name)},null,2));
