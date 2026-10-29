import {mkdirSync,writeFileSync} from 'node:fs';
import {filteredMean,spatialMean} from '../tests/farColumnReference';
const rows=[];
for(const patch of [7,0]){
 const F=4,mu=.04,rotation=Math.PI/4;
 const actual=filteredMean(patch,F,mu,rotation).moments[0];
 const reference192=spatialMean(patch,F,mu,192,192,rotation)[0];
 const reference384=spatialMean(patch,F,mu,384,384,rotation)[0];
 const error=actual-reference384,convergence=reference384-reference192;
 rows.push({patch,F,mu,rotation,actual,reference192,reference384,error,convergence,pass:Math.abs(error)<=.02&&Math.abs(convergence)<=.002});
}
const report={scope:'CPU same-far-model spatial quadrature; not final pixel L/T',targets:{opacity:.02,convergence:.002},rows,passed:rows.every(r=>r.pass)};
const suffix=process.argv.includes('--before')?'before':'current';
mkdirSync('artifacts/pr1/data',{recursive:true});
writeFileSync(`artifacts/pr1/data/minimal-spatial-${suffix}.json`,JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));if(!report.passed)process.exitCode=1;
