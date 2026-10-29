import {test} from 'node:test';
import assert from 'node:assert/strict';
// @ts-expect-error The standalone Node evidence script intentionally has no TS runtime.
import {auditRounds,sameConditions} from '../scripts/summarize-cloud-rounds.mjs';

const state=()=>({utc:'2026-06-21T17:00Z',buffer:[1920,1080],camera:{position:[1e7,-2e7,3e7],direction:[1,0,0],up:[0,0,1],fovy:Math.PI/3},parameters:{seed:13},quality:'medium',storage:'RGBA16F',motion:{angle:0,evolution:0},force:0,mask:0,uniformBudget:{u_cloudSteps:64},voxelEnabled:true,voxelReady:true,skipVoxels:false,visible:true,focused:true});
test('round audit tolerates only camera normalization roundoff',()=>{
 const a=state(),b=state();b.camera.up[0]=1e-14;assert.ok(sameConditions(a,b));
 b.camera.up[0]=1e-5;assert.equal(sameConditions(a,b),false);
 b.camera.up[0]=0;b.parameters.seed=14;assert.equal(sameConditions(a,b),false);
 b.parameters.seed=13;b.uniformBudget.u_cloudSteps=96;assert.equal(sameConditions(a,b),false);
});
test('round audit retains incomplete, hidden and readback-failed batches as red',()=>{
 const row={name:'global',mode:'frame',round:0,initial:state(),final:state(),content:{readbackError:0},timing:{reason:'sample target reached',hiddenFrames:0,unfocusedFrames:0,disjoint:0,rawGpu:{frame:Array(200).fill(10)}}};
 assert.ok(auditRounds({complete:true,result:[row]}).accepted);
 const bad=structuredClone(row);bad.timing.rawGpu.frame.pop();bad.timing.hiddenFrames=1;bad.content.readbackError=1282;
 const result=auditRounds({complete:true,result:[row,bad]});assert.equal(result.accepted,false);assert.equal(result.rounds[1].errors.length,3);assert.equal(result.scenes[0].gpu.frame.count,200);
 const missing=auditRounds({complete:true,result:[{...row,timing:undefined}]});
 assert.equal(missing.accepted,false);assert.ok(missing.rounds[0].errors.includes('missing end reason'));
 assert.deepEqual(missing.scenes[0].gpu,{});
});

test('round audit never pools individually stable rounds with different budgets',()=>{
 const row={name:'orbit',mode:'frame',round:0,initial:state(),final:state(),content:{readbackError:0},timing:{reason:'sample target reached',hiddenFrames:0,unfocusedFrames:0,disjoint:0,rawGpu:{frame:Array(200).fill(10)}}};
 const changed=structuredClone(row);changed.round=1;changed.initial.uniformBudget.u_cloudSteps=96;changed.final.uniformBudget.u_cloudSteps=96;
 const result=auditRounds({complete:true,result:[row,changed]});assert.equal(result.accepted,false);
 assert.deepEqual(result.rounds[1].errors,['conditions differ across rounds of this scene']);assert.equal(result.scenes[0].gpu.frame.count,200);
});
