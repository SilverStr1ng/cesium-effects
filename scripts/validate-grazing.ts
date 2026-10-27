import {mkdirSync,writeFileSync} from 'node:fs';
import {filteredMean,spatialMean} from '../tests/farColumnReference';

// Diagnostic domain, not a universal bound. Failing suggested accuracy targets
// are retained in the report and make this command fail; do not loosen .02.
const rows=[];
for(const patch of [0,3,5,7])for(const footprint of [4,12,28])for(const mu of [.04,.1,.25,1])for(const rotation of [0,Math.PI/4]){
  const reference=spatialMean(patch,footprint,mu,192,192,rotation);
  const actual=filteredMean(patch,footprint,mu,rotation);
  rows.push({patch,footprint,mu,rotation,reference,actual:actual.moments,taps:actual.taps,support:actual.support,
    opacityError:actual.moments[0]-reference[0],coverageError:actual.moments[3]-reference[3]});
}
// Convergence is checked for every failing case as well as the four regression
// cases. These are two distinct gates: agreement cannot excuse a bad reference.
const unconverged=[];
for(const row of rows)if(Math.abs(row.opacityError)>.02||row.rotation===0&&[[5,28,.25],[3,4,.1],[5,4,.04],[0,4,.1]].some(c=>c[0]===row.patch&&c[1]===row.footprint&&c[2]===row.mu)){
  const doubled=spatialMean(row.patch,row.footprint,row.mu,384,384,row.rotation);
  unconverged.push({...row,reference384:doubled,convergence:doubled[0]-row.reference[0]});
}
const parameterChecks=[];
for(const [density,thickness] of [[.5,3.8],[2,3.8],[1.1,1],[1.1,8]])for(const [patch,mu] of [[3,.1],[5,.04]]){
  const reference=spatialMean(patch,4,mu,192,192,0,density,thickness),actual=filteredMean(patch,4,mu,0,density,thickness);
  parameterChecks.push({patch,mu,density,thickness,reference,actual:actual.moments,opacityError:actual.moments[0]-reference[0]});
}
const failures=rows.filter(row=>Math.abs(row.opacityError)>.02);
const report={kind:'CPU same-far-model local spatial average; NOT final GPU L/T',
  conditions:{seed:13,coverage:.62,density:1.1,baseKm:1.5,thicknessKm:3.8,detail:.55,type:0,windAngle:0,evolution:0},
  targets:{opacityAbsolute:.02,referenceConvergence:.002},rows,failures,convergence:unconverged,parameterChecks,
  limits:['Parameter checks isolate quadrature of the existing table. They do not validate the table against changed near voxels.',
    'The material table is baked for detail=.55; far-model detail sensitivity and partial-column correlation remain unvalidated.',
    'No GPU times, screenshots or temporal conclusions are produced by this CPU command.']};
mkdirSync('artifacts/stage5',{recursive:true});writeFileSync('artifacts/stage5/grazing-matrix.json',JSON.stringify(report,null,2));
console.log(JSON.stringify({cases:rows.length,failures:failures.map(r=>({patch:r.patch,footprint:r.footprint,mu:r.mu,rotation:r.rotation,error:r.opacityError})),
  maxOpacityError:Math.max(...rows.map(r=>Math.abs(r.opacityError))),maxReferenceDelta:Math.max(...unconverged.map(r=>Math.abs(r.convergence))),
  parameterMaxError:Math.max(...parameterChecks.map(r=>Math.abs(r.opacityError)))},null,2));
if(failures.length||unconverged.some(r=>Math.abs(r.convergence)>.002)||parameterChecks.some(r=>Math.abs(r.opacityError)>.02))process.exitCode=1;
