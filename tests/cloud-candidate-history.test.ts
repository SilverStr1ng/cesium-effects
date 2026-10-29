import {test} from 'node:test';
import assert from 'node:assert/strict';
import {filteredMean,spatialMean} from './fixtures/stage7-candidate/farColumnReference';

for(const c of [{patch:0,F:4,rotation:Math.PI/4,error:.026382229},{patch:3,F:12,rotation:0,error:-.029950729}]){
 test(`87b6ff03 historical red input remains frozen: patch ${c.patch}/F${c.F}`,()=>{
  const actual=filteredMean(c.patch,c.F,.04,c.rotation).moments[0];
  const reference=spatialMean(c.patch,c.F,.04,384,384,c.rotation)[0];
  assert.ok(Math.abs(actual-reference-c.error)<1e-7);
  assert.ok(Math.abs(actual-reference)>.02,'historical failure must not disappear by changing the current world');
 });
}
