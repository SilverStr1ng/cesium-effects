import {mkdirSync,readFileSync,writeFileSync,readdirSync,copyFileSync,existsSync,statSync} from 'node:fs';
import {resolve,join,basename} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';

// Original screenshots and raw measurements remain ignored. Independent small
// ZIPs can be attached to the PR and extracted together without a split-zip tool.
const head=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
assert.equal(execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).trim(),'','Commit source and report before packaging.');
execFileSync(process.execPath,['scripts/summarize-pr1.mjs'],{stdio:'inherit'});
const root=resolve('artifacts/pr1'),input=join(root,'data'),folder=`pr1-evidence-${head.slice(0,8)}`,output=resolve('artifacts',folder);
assert.ok(!existsSync(output),'Evidence directory already exists; do not overwrite a published package.');
mkdirSync(output);mkdirSync(join(output,'data'));
for(const name of readdirSync(input).filter(n=>/\.(json|png|jpg)$/.test(n)))copyFileSync(join(input,name),join(output,'data',name));
const read=n=>JSON.parse(readFileSync(join(input,n+'.json'),'utf8'));
const summary={revision:head,...read('summary')},tour=read('tour-final').result;
assert.equal(tour.frames.length,640);assert.equal(tour.samples.length,81);
copyFileSync(join(root,'final-cpu','grazing-matrix.json'),join(output,'data','grazing-matrix.json'));
for(const name of ['grazing.log','npm-test.log','npm-test-final.log','npm-build-final.log','validation-build-final.log','path-blend-failed.glsl'])copyFileSync(join(root,name),join(output,name));
for(const scene of ['global','orbit','ground','altitude','above','inside','high-only']){
 copyFileSync(resolve('artifacts/stage7-correction/data',`release-captures-${scene}.png`),join(output,'data',`before2064-${scene}.png`));
}
for(const scene of ['global','orbit','ground'])copyFileSync(resolve('artifacts/stage7/data',`after-captures-${scene}.png`),join(output,'data',`before87b6-${scene}.png`));
copyFileSync('artifacts/stage7-correction/data/release-captures.json',join(output,'data','before2064-captures.json'));
copyFileSync('artifacts/stage7-correction/data/release-transition.json',join(output,'data','before2064-transition.json'));
const report=readFileSync('docs/stage7-pr1-validation.md','utf8');
writeFileSync(join(output,'stage7-pr1-validation.md'),report);
writeFileSync(join(output,'data','summary.json'),JSON.stringify(summary,null,2));
execFileSync('git',['archive','--format=zip',`--output=${join(output,'source-current.zip')}`,'HEAD']);
execFileSync('git',['archive','--format=zip',`--output=${join(output,'source-before2064.zip')}`,'2064f91162516f43e6a31aa4eb5aca254341dcf5']);
execFileSync('git',['archive','--format=zip',`--output=${join(output,'source-before87b6.zip')}`,'87b6ff032afe4229c9e42d9925b4ecc460867940']);
const images=readdirSync(join(output,'data')).filter(n=>n.endsWith('.png'));
for(const name of images){const b=readFileSync(join(output,'data',name));assert.ok(b.length>24&&b.readUInt32BE(0)===0x89504e47&&b.subarray(-8,-4).toString()==='IEND',`Incomplete PNG ${name}`);}
for(const sample of tour.samples)assert.ok(images.includes(`final-${sample.name}.png`),`Missing path frame ${sample.name}`);
assert.equal(images.filter(n=>/^final-quality-/.test(n)).length,7,'Missing quality/HDR captures');
const fmt=s=>s?[s.meanMs,s.medianMs,s.p95Ms].map(v=>v.toFixed(3)).join(' / '):'unmeasured';
const gpuRows=summary.gpu.map(g=>`<tr><td>${g.name}</td>${g.scenes.map(s=>`<td>${fmt(s.gpu['cloud-volume'])} (${s.gpu['cloud-volume'].count})</td>`).join('')}</tr>`).join('');
const jsonFiles=readdirSync(join(output,'data')).filter(n=>n.endsWith('.json'));
writeFileSync(join(output,'index.html'),`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>PR #1 · 修正与未解决门禁</title>
<style>body{max-width:1440px;margin:auto;padding:24px;background:#101923;color:#edf3fc;font:16px/1.6 system-ui}a{color:#a9d4ff}.red{border-left:5px solid #ff8c88;background:#35282b;padding:16px}.pair{display:flex;gap:12px}.pair figure{flex:1;min-width:0;margin:0}img{width:100%}table{width:100%;border-collapse:collapse;font-size:13px}td,th{padding:8px;border-bottom:1px solid #425568;text-align:left}pre{white-space:pre-wrap;font-size:12px}button,select{padding:8px;margin:5px}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}.grid figure{margin:0;font-size:12px}input[type=range]{width:70%}</style>
<h1>PR #1：阴影支撑修复，长路径与成本仍失败</h1><p>最终源码 ${head} · 审查2064f911 · 成本对照87b6ff03</p>
<div class="red"><b>RED / Draft / 不具备合并条件</b><p>保留已测得的阴影云洞修复。路径原型降低最小T误差，却未通过L与成本门禁，测试入口默认关闭。形态、曝光、分辨率及质量预算未改；没有以89项CPU测试代表渲染通过。</p><a href="data/summary.json">汇总JSON</a> · <a href="stage7-pr1-validation.md">完整报告</a> · <a href="data/pixel-91-comparison.json">91点逐点L/T</a> · <a href="manifest.json">SHA-256清单</a></div>
<p>固定1920×1080、fovy60°、medium/.65、HDR、曝光8、UTC2026-06-21T17Z、seed13、wind24且演化冻结。CPU与像素误差、GPU成本各按独立定义审查。</p>
<h2>同设备云pass（mean / median / P95 ms，括号为有效query数）</h2><table><tr><th>实测版本</th><th>global</th><th>orbit</th><th>ground</th></tr>${gpuRows}</table><p>本轮没有整帧重测；原型不是默认产品。各轮前台、固定状态、原始query与内容占据率见JSON。</p>
<h2>前后原图</h2><select id="scene">${['ground','orbit','global','inside','above','altitude','high-only'].map(n=>`<option>${n}</option>`).join('')}</select><div class="pair"><figure><figcaption>2064前次默认</figcaption><a id="before-link"><img id="before"></a></figure><figure><figcaption>本轮默认修复</figcaption><a id="after-link"><img id="after"></a></figure></div><p>点图打开原始1920×1080 PNG。大轮廓保持，未宣称本轮新增形态改善。</p>
<h2>同一世界下降与上升：81关键帧 / 640相机状态</h2><button id="play">播放 / 暂停</button><input id="path" type="range" min="0" max="80" value="0"><span id="number"></span><a id="path-link"><img id="path-image"></a><details><summary>当前相机、参数、实际uniform与占据统计</summary><pre id="state"></pre></details><p>500ms/关键帧的证据播放不是采集FPS或零闪烁声明。<a href="data/tour-final.json">全部状态JSON</a></p>
<h2>逐帧联系表</h2><nav>${Array.from({length:5},(_,i)=>`<button data-page="${i}">${i*18}–${Math.min(80,i*18+17)}</button>`).join('')}</nav><div id="frames" class="grid"></div>
<h2>原始资料</h2><p>${jsonFiles.map(n=>`<a href="data/${n}">${n}</a>`).join(' · ')}</p><p><a href="source-current.zip">最终源码</a> · <a href="source-before2064.zip">2064源码</a> · <a href="source-before87b6.zip">87b6源码</a> · <a href="REPRODUCE.md">重放与证据边界</a></p><details><summary>完整报告</summary><pre id="report"></pre></details>
<script>const samples=${JSON.stringify(tour.samples)},report=${JSON.stringify(report).replace(/</g,'\\u003c')};document.querySelector('#report').textContent=report;
function scene(){const n=document.querySelector('#scene').value;for(const [id,prefix] of [['before','before2064-'],['after','final-']]){const p='data/'+prefix+n+'.png';document.querySelector('#'+id).src=p;document.querySelector('#'+id+'-link').href=p;}}document.querySelector('#scene').onchange=scene;scene();
function path(){const i=Number(document.querySelector('#path').value),s=samples[i],p='data/final-'+s.name+'.png';document.querySelector('#number').textContent=i+' / 80 '+s.name;document.querySelector('#path-image').src=p;document.querySelector('#path-link').href=p;document.querySelector('#state').textContent=JSON.stringify(s,null,2);}document.querySelector('#path').oninput=path;path();let playing=false;document.querySelector('#play').onclick=()=>playing=!playing;setInterval(()=>{if(playing){const p=document.querySelector('#path');p.value=(Number(p.value)+1)%81;path();}},500);
function sheet(page){document.querySelector('#frames').innerHTML=samples.slice(page*18,page*18+18).map((s,i)=>'<figure><a href="data/final-'+s.name+'.png"><img loading="lazy" src="data/final-'+s.name+'.png"></a><figcaption>'+(page*18+i)+' '+s.name+' opacity='+s.content.meanOpacity.toFixed(4)+'</figcaption></figure>').join('');}document.querySelectorAll('[data-page]').forEach(b=>b.onclick=()=>sheet(Number(b.dataset.page)));sheet(0);</script></html>`);
writeFileSync(join(output,'REPRODUCE.md'),`# PR #1 evidence\n\nRevision ${head}. Overall RED / Draft.\n\nExtract EVERY independent part ZIP into the same parent directory. All files share ${folder}/. Open index.html, or serve that directory on localhost. The HTML uses relative PNGs and embedded state, with no JSON fetch. Localhost was browser-verified; file:// navigation is restricted in the automation environment, so a double-click offline run was not verified.\n\nOriginal PNGs are separate from the five downscaled contact sheets. Do not use contact sheets for pixel errors. Before2064 images come from the previous correction capture; before87b6 are the original candidate captures. Final images and path are new this round. No reference video media is included.\n\nUnzip source-current.zip separately, npm ci, npm test, npm run build; node scripts/build-validation.mjs . artifacts/replay; npx vite preview --outDir artifacts --host 127.0.0.1 --port 4180. Open /replay/tests/cloud-morphology.html?minimal for real-main fixed views and 2x200-query pass rounds. Run timing in foreground alone without build/CPU benchmarks. /replay/tests/satellite-lod.html?transition=split&extended gives all91 points. &minimal gives the two minimal pixel cases; &path-response explicitly enables the rejected test-only prototype. It is not a proposed production mode. /replay/tests/cloud-shadow-support.html?timing checks the exact zero-density counterexample and isolated old/new residual queries. /replay/tests/stage7-regressions.html runs separate browser regressions.\n\nCPU: npx tsx scripts/validate-pr1-minimal.ts and npx tsx scripts/validate-grazing.ts retain nonzero failure exits. Probe scripts are experiments, not passing gates. Summary combines the full browser round and the explicit repaired lighting rerun; firstAttemptError is retained. The loading-switch run reported startedWhileLoading=false.\n\nThe source snapshots of prior revisions do not include this round's later timing harness. To repeat the exact comparison, copy tests/cloud-morphology.browser.ts and its fixture-only dependencies from the final snapshot into a separate 87b6 snapshot, then build with the final build-validation script. Do not reset a working checkout. Density worlds differ across87b6 and2064; inspect opacity/occupancy alongside GPU cost.\n\nNo new GPU arrays for whole-frame/inside/night were captured this round. No hardware clock/power, other GPU, real DEM/3D Tiles or strict temporal claim. Cached link timings do not establish cold link performance.\n`);
const files=[...readdirSync(output).filter(n=>statSync(join(output,n)).isFile()),...readdirSync(join(output,'data')).map(n=>'data/'+n)];
const digest=path=>{const b=readFileSync(path);return {bytes:b.length,sha256:createHash('sha256').update(b).digest('hex')};};
writeFileSync(join(output,'manifest.json'),JSON.stringify({revision:head,files:files.map(name=>({name,...digest(join(output,name))}))},null,2));
files.unshift('manifest.json');
// Keep index/report/JSON early; never resize originals to meet attachment limits.
files.sort((a,b)=>Number(a.endsWith('.png'))-Number(b.endsWith('.png'))||a.localeCompare(b));
const batches=[];let current=[],bytes=0;
for(const name of files){const size=statSync(join(output,name)).size;assert.ok(size<18*1024**2,`Single file too large ${name}`);if(bytes+size>18*1024**2&&current.length){batches.push(current);current=[];bytes=0;}current.push(name);bytes+=size;}if(current.length)batches.push(current);
const parts=batches.map((names,i)=>{const zip=`${folder}-part${String(i+1).padStart(2,'0')}.zip`,path=resolve('artifacts',zip);execFileSync('tar',['-a','-cf',path,'-C',resolve('artifacts'),...names.map(n=>folder+'/'+n)]);const info=digest(path);assert.ok(info.bytes<20*1024**2,'Attachment exceeds bounded size');return {name:zip,...info,files:names};});
writeFileSync(resolve('artifacts',`${folder}-parts.json`),JSON.stringify({revision:head,folder,parts},null,2));
writeFileSync(resolve('artifacts/pr1-latest.html'),`<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=${folder}/index.html"><a href="${folder}/index.html">PR #1 evidence</a>`);
console.log(JSON.stringify({output,parts:parts.map(({name,bytes,sha256})=>({name,bytes,sha256}))},null,2));
