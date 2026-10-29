import {readFileSync,writeFileSync} from 'node:fs';
import {auditRounds,sameConditions} from './summarize-cloud-rounds.mjs';
const root='artifacts/stage7-correction/data/';
const read=n=>JSON.parse(readFileSync(root+n+'.json','utf8'));
const write=(n,d)=>writeFileSync(root+n+'.json',JSON.stringify(d,null,2));
const max=(a,f)=>Math.max(...a.map(f));
const testLog=readFileSync('artifacts/stage7-correction/test-release.log','utf8'),buildLog=readFileSync('artifacts/stage7-correction/build-production.log','utf8');
const testCount=Number(testLog.match(/\btests (\d+)/)?.[1]),testPass=Number(testLog.match(/\bpass (\d+)/)?.[1]),testFail=Number(testLog.match(/\bfail (\d+)/)?.[1]);
const current=read('release-transition'),review=read('review-split');
const stage6=JSON.parse(readFileSync('artifacts/stage7/data/transition-before.json','utf8'));
const radial=current.rows.slice(0,40),points=radial.map((r,i)=>{
 const b=stage6.rows[i],old=review.rows[i];
 if(r.patch!==old.patch||r.footprint!==old.footprint)throw Error('40-point ordering changed');
 return {patch:r.patch,footprint:r.footprint,stage6:{T:b.Terror,L:b.Lerror},review:old.errors,current:r.errors,
   stage6Delta:{T:r.errors.auto.T-b.Terror,L:r.errors.auto.L-b.Lerror},
   blend:r.metadata.fields[3],metadata:r.metadata,reference:r.reference,near:r.near,far:r.far,auto:r.auto};
});
write('transition-40-comparison',points);
const maxima=rows=>({T:max(rows,r=>r.errors.auto.T),L:max(rows,r=>r.errors.auto.L),referenceT:max(rows,r=>r.convergence.T),referenceL:max(rows,r=>r.convergence.L)});
const refine=current.convergence.map(r=>({patch:r.patch,footprint:r.footprint,height:r.height,
 spatial:r.spatial.LT.map((v,i)=>v-r.base.LT[i]),vertical:r.vertical.LT.map((v,i)=>v-r.base.LT[i])}));
const regressions=read('release-regressions'),find=n=>regressions.results.find(r=>r.name===n);
const spatial=read('grazing-matrix'),partial=find('cloud-partial'),finite=find('cloud-finite'),layered=find('cloud-layered-closure'),satellite=find('satellite-lod');
const gpu=auditRounds(read('release-gpu-matrix')),baselineGpu=auditRounds(read('baseline-gpu-matrix'));
for(const result of [gpu,baselineGpu])for(const scene of ['global','orbit','ground','inside','high-only'])for(const mode of ['frame','passes'])for(const round of [0,1]){
 if(result.rounds.filter(r=>r.name===scene&&r.mode===mode&&r.round===round).length!==1)throw Error(`Missing/duplicate timing round ${scene}/${mode}/${round}`);
}
write('release-gpu-audit',gpu);write('baseline-gpu-audit',baselineGpu);
const comparison=gpu.scenes.map(r=>{const b=baselineGpu.scenes.find(s=>s.name===r.name);return {scene:r.name,conditionsMatch:sameConditions(r.conditions,b?.conditions),baseline:b?.gpu,current:r.gpu,baselineContent:b?.content,currentContent:r.content};});
write('gpu-comparison',comparison);
const switches=read('release-switches'),startup=read('release-first-entry').startup,hot=read('release-hot-entry').startup;
const loading=read('release-entry-loading'),work=read('release-work');
const summary={overallPassed:false,status:'Unaccepted Stage 7 correction candidate; do not merge on test count',review:'87b6ff032afe4229c9e42d9925b4ecc460867940',stage6:'f433c8e1ef4afd2a4d2f764e8d61d6b191cc4171',
 cpu:{tests:testCount,passing:testPass,failures:testFail,passed:testCount>0&&testCount===testPass&&testFail===0,log:'test-release.log'},build:{passed:/built in/.test(buildLog)&&!/error TS\d+/.test(buildLog),log:'build-production.log'},
 pixelModel:{scope:'Independent fine rays sharing the near material and approximate source; not physical truth; separate from same-far-model spatial tests',
  stage6:{T:max(stage6.rows,r=>r.Terror),L:max(stage6.rows,r=>r.Lerror)},review:maxima(review.rows.slice(0,40)),current:maxima(radial),
  endpoints:Object.fromEntries(['near','far','auto'].map(name=>[name,{review:{T:max(review.rows.slice(0,40),r=>r.errors[name].T),L:max(review.rows.slice(0,40),r=>r.errors[name].L)},current:{T:max(radial,r=>r.errors[name].T),L:max(radial,r=>r.errors[name].L)}}])),
  nonClearOriginal40:{criterion:'reference mean T < .999',review:review.rows.slice(0,40).filter(r=>r.reference.LT[3]<.999).length,current:radial.filter(r=>r.reference.LT[3]<.999).length},
  perPoint:'transition-40-comparison.json',regressedPoints:points.filter(p=>p.stage6Delta.T>0||p.stage6Delta.L>0).map(p=>({patch:p.patch,footprint:p.footprint,...p.stage6Delta})),
  extended:maxima(current.rows.slice(40).filter(r=>r.height===0)),oblique:current.rows.filter(r=>r.height>0).map(r=>({patch:r.patch,footprint:r.footprint,height:r.height,mu:r.mu,error:r.errors.auto})),refinement:refine},
 spatial:{passed:spatial.failures.length===0&&spatial.referenceFailures.length===0,count:spatial.accuracy.length,failures:spatial.failures.map(r=>({patch:r.patch,F:r.footprint,mu:r.mu,rotation:r.rotation,error:r.opacityError})),maxError:max(spatial.accuracy,r=>Math.abs(r.opacityError)),maxConvergence:max(spatial.accuracy,r=>Math.abs(r.referenceConvergence)),cpuParityCorrection:'Envelope warp 3.4 -> 11.4 km; previous CPU-only run is retained, not claimed as production evidence'},
 partial:{passed:partial.passed,count:partial.checks.length,maxError:max(partial.checks,r=>Math.abs(r.opacityError)),maxConvergence:max(partial.checks,r=>Math.abs(r.referenceConvergence))},
 finite:{passed:finite.passed,maxError:max(finite.checks,r=>Math.abs(r.error)),maxConvergence:max(finite.checks,r=>Math.abs(r.convergence))},
 reuse:{passed:finite.responseChecks.every(r=>r.pass),maxL:max(finite.responseChecks,r=>r.Lerror),maxT:max(finite.responseChecks,r=>r.Terror)},
 closure:{controlled:find('cloud-closure').passed,layered:layered.passed,maxL:max(layered.checks,r=>r.maxL),maxT:max(layered.checks,r=>r.maxT),maxConvergence:max(layered.checks,r=>r.convergence)},
 material:{passed:read('material-range').passed,maxError:max(read('material-range').rows,r=>Math.abs(r.error))},components:{passed:read('components-cpu').passed,maxError:read('components-cpu').maxError},
 satellite:satellite.checks.find(c=>c.qualityComparisons).qualityComparisons,
 browser:{passed:regressions.passed,checks:regressions.results.flatMap(r=>r.checks??[]).length,failures:regressions.results.flatMap(r=>(r.checks??[]).filter(c=>!c.pass).map(c=>({fixture:r.name,name:c.name??`${c.heightKm}km`,count:c.count,rms:c.rms,clearRays:c.clearRays,cloudyRays:c.cloudyRays,maxT:c.maxT,opacityError:c.opacityError}))),fixtureErrors:regressions.results.filter(r=>r.error).map(r=>({name:r.name,error:r.error}))},
 entry:{afterReady:find('actual-entry?auto').passed,duringLoad:loading.passed,loadingWasExercised:loading.checks.some(c=>c.startedWhileLoading===true),duringLoadChecks:loading.checks.length,source:'release-entry-loading.json'},
 work:{scope:work.scope,passed:work.passed,rows:work.rows.map(s=>({scene:s.name,rays:s.rays.length,mean:Object.fromEntries(['densityCalls','bodyQueries','opaqueExits','builds','taps','tableQueries','legacyHits','resolvedSegments','statisticalSegments'].map(k=>[k,s.rays.reduce((v,r)=>v+r[k],0)/s.rays.length])),maxTaps:max(s.rays,r=>r.taps)}))},
 startup:{first:startup,hot},quality:{switches:switches.result.map(r=>({q:r.q,hdr:r.hdr,submitWallMs:r.wallMs,gpuCompleteWallMs:r.gpuCompleteWallMs,captureMs:r.captureMs,timingBoundary:r.timingBoundary,newCloudLinks:r.shader.filter(s=>s.label==='cloud-volume'&&s.kind==='linkProgram CPU call').length}))},
 gpu:{audited:gpu.accepted&&baselineGpu.accepted&&comparison.every(r=>r.conditionsMatch),comparison:'gpu-comparison.json',historicalF1CostTargetPassed:false,scope:'Same machine/browser, separate frame/pass rounds. Occupancy changed. Hardware clocks/power unmeasured; not fixed-density acceleration.'},
 visual:{passed:false,reviewed:{tourKeyframes:81,windKeyframes:21,qualityHdrCaptures:7},ground:'More connected outlines; smooth roof/flat base remain',altitude:'Irregular connected patches replace many isolated units; planar appearance remains',temporal:'Keyframe inspection only, not strict flicker or frame-time validation'},
 storage:{assetVersion:10,opticsVersion:10,newTextureBytes:0,fixedAndWeatherBytes:16347328,retainedCpuBytes:9437184,materialCacheLimitBytes:655360},
 history:{reviewSpatialErrors:[.026382229,-.029950729],reviewHighL:.011578119,reviewFixedThickCoreCount:0,stage6RedGatesRetained:true},
 remaining:['Current world spatial quadrature exceeds .02 at listed points','Additional local pixel samples and a long oblique path remain inaccurate','Residual distribution omits local voxel phase','Near pixel-center material filtering is not exact E[L/T]','First LINK_STATUS still blocks','Cloud cost remains above prior targets','Fixed old geographical core/ground tests remain red under changed world'],
 unverified:['Real DEM/3D Tiles','Other GPU/drivers','Hardware clocks/power throttling','Strict per-pixel temporal error']};
write('summary',summary);
console.log(JSON.stringify({pixelModel:summary.pixelModel.current,spatial:summary.spatial,overallPassed:false,gpuAudited:summary.gpu.audited},null,2));
