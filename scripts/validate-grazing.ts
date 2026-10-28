import {mkdirSync,writeFileSync} from 'node:fs';
import * as current from '../tests/farColumnReference';
import * as frozen from '../tests/fixtures/stage6/farColumnReference';
const legacy=process.argv.includes('--legacy'),{filteredMean,spatialMean}=legacy?frozen:current;

// Diagnostic domain, not a universal bound. Failing suggested accuracy targets
// are retained in the report and make this command fail; do not loosen .02.
const rows=[];
for(const patch of [0,3,5,7])for(const footprint of [4,12,28])for(const mu of [.04,.1,.25,1])for(const rotation of [0,Math.PI/4]){
  const reference=spatialMean(patch,footprint,mu,192,192,rotation);
  const actual=filteredMean(patch,footprint,mu,rotation);
  rows.push({patch,footprint,mu,rotation,reference,actual:actual.moments,taps:actual.taps,support:actual.support,
    opacityError:actual.moments[0]-reference[0],coverageError:actual.moments[3]-reference[3]});
}
// Check convergence at every point, including apparently passing candidates.
// Agreement cannot excuse an under-resolved reference.
const unconverged=[];
for(const row of rows){
  const doubled=spatialMean(row.patch,row.footprint,row.mu,384,384,row.rotation);
  unconverged.push({...row,reference384:doubled,convergence:doubled[0]-row.reference[0]});
}
const refinements=[];
for(const row of unconverged)if(Math.abs(row.convergence)>.002){
  const fine=spatialMean(row.patch,row.footprint,row.mu,768,768,row.rotation);
  refinements.push({...row,reference768:fine,convergence384to768:fine[0]-row.reference384[0],opacityError768:row.actual[0]-fine[0]});
}
const parameterChecks=[];
for(const [density,thickness] of [[.5,3.8],[2,3.8],[1.1,1],[1.1,8]])for(const [patch,mu] of [[3,.1],[5,.04]]){
  const reference=spatialMean(patch,4,mu,192,192,0,density,thickness),actual=filteredMean(patch,4,mu,0,density,thickness);
  parameterChecks.push({patch,mu,density,thickness,reference,actual:actual.moments,opacityError:actual.moments[0]-reference[0]});
}
// Judge accuracy against the finest checked reference, not the initial 192²
// estimate. Preserve both in the evidence so refinement cannot hide a failure.
const accuracy=unconverged.map(row=>{
  const fine=refinements.find(r=>r.patch===row.patch&&r.footprint===row.footprint&&r.mu===row.mu&&r.rotation===row.rotation);
  const reference=fine?.reference768??row.reference384;
  return {patch:row.patch,footprint:row.footprint,mu:row.mu,rotation:row.rotation,
    referenceGrid:fine?768:384,reference,actual:row.actual,
    referenceConvergence:fine?.convergence384to768??row.convergence,
    opacityError:row.actual[0]-reference[0],coverageError:row.actual[3]-reference[3]};
});
const failures=accuracy.filter(row=>Math.abs(row.opacityError)>.02);
const referenceFailures=accuracy.filter(row=>Math.abs(row.referenceConvergence)>.002);
const report={kind:'CPU same-far-model local spatial average; NOT final GPU L/T',morphology:legacy?'f433c8e frozen':'stage7',
  conditions:{seed:13,coverage:.62,density:1.1,baseKm:1.5,thicknessKm:3.8,detail:.55,type:0,windAngle:0,evolution:0},
  targets:{opacityAbsolute:.02,referenceConvergence:.002},rows,accuracy,failures,referenceFailures,convergence:unconverged,referenceRefinements:refinements,parameterChecks,
  limits:['Parameter checks isolate quadrature of the existing table. They do not validate the table against changed near voxels.',
    'This matrix uses the default conditional table; separate material and partial checks retain their own definitions.',
    'No GPU times, screenshots or temporal conclusions are produced by this CPU command.']};
mkdirSync('artifacts/stage7/data',{recursive:true});writeFileSync(`artifacts/stage7/data/${legacy?'legacy-':''}grazing-matrix.json`,JSON.stringify(report,null,2));
console.log(JSON.stringify({cases:rows.length,failures:failures.map(r=>({patch:r.patch,footprint:r.footprint,mu:r.mu,rotation:r.rotation,error:r.opacityError})),
  maxOpacityError:Math.max(...accuracy.map(r=>Math.abs(r.opacityError))),maxInitialReferenceDelta:Math.max(...unconverged.map(r=>Math.abs(r.convergence))),
  maxFinalReferenceDelta:Math.max(...accuracy.map(r=>Math.abs(r.referenceConvergence))),
  referenceRefinements:refinements.map(r=>({patch:r.patch,footprint:r.footprint,mu:r.mu,rotation:r.rotation,convergence384to768:r.convergence384to768,opacityError768:r.opacityError768})),
  parameterMaxError:Math.max(...parameterChecks.map(r=>Math.abs(r.opacityError)))},null,2));
if(failures.length||referenceFailures.length||parameterChecks.some(r=>Math.abs(r.opacityError)>.02))process.exitCode=1;
