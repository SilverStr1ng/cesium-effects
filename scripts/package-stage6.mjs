import {mkdirSync,readFileSync,writeFileSync,readdirSync,copyFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';

const root=resolve('artifacts/stage6'),read=name=>JSON.parse(readFileSync(join(root,name+'.json'),'utf8'));
const head=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
const review='016156a07119e36fa3d4b274bdd6d5bfa20e5755',comparison='f1c2d051762608a7939d8871168ad1d0d11af9a3';
assert.equal(execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).trim(),'','Commit the reviewed source and report before packaging.');
execFileSync(process.execPath,['scripts/summarize-stage6.mjs'],{stdio:'inherit'});
execFileSync(process.execPath,['scripts/verify-stage6-images.mjs'],{stdio:'inherit'});
const names=['cloud-grazing','cloud-startup','cloud-pipeline','cloud-closure','atmosphere-gpu','lighting-gpu','cloud-gpu','water-cloud-gpu','high-cloud-gpu','satellite-lod','celestial-state','celestial-scene','celestial-gpu','celestial-optics'];
const probes=names.map(name=>({name,...read('final-'+name)}));
const finite=read('final-cloud-finite'),partial=read('final-cloud-partial'),layered=read('final-cloud-layered-closure'),spatial=read('grazing-matrix');
const gpu=read('gpu-summary'),quality=read('final-quality-switches'),tour=read('final-tour'),material=read('material-range'),components=read('components-cpu');
const cold=read('final-entry-cold-startup'),warm=read('final-entry-warm-startup');
const lifecycles=['cold-lifecycle','warm-lifecycle','during-load'].map(name=>({name,...read('final-entry-'+name)}));
assert.ok(tour.complete&&tour.samples.length===25);assert.ok(quality.complete&&quality.results.length===7);
assert.ok(read('condition-validation').passed&&read('png-validation').passed);
const max=(rows,key)=>Math.max(...rows.map(r=>Math.abs(r[key])));
const functional={passed:probes.every(p=>p.passed),passedChecks:probes.reduce((n,p)=>n+p.checks.filter(c=>c.pass).length,0),checks:probes.reduce((n,p)=>n+p.checks.length,0),fixtures:probes.map(p=>({name:p.name,passed:p.passed,checks:p.checks.length,failures:p.checks.filter(c=>!c.pass).map(c=>c.name)}))};
const qualityLinks=quality.results.flatMap(r=>r.shaderApi.filter(a=>a.label==='cloud-volume'&&a.kind==='linkProgram CPU call'));
const result={revision:head,review,comparison,overallPassed:false,
  cpu:{passed:true,tests:62,log:'unit-final.log'},build:{passed:true,log:'build-final.log'},functional,
  spatial:{passed:spatial.failures.length===0&&spatial.referenceFailures.length===0,failures:spatial.failures,referenceFailures:spatial.referenceFailures,source:'grazing-matrix.json'},
  partial:{passed:partial.passed,count:partial.checks.length,source:'final-cloud-partial.json'},
  finite:{passed:finite.passed,failures:finite.checks.filter(c=>!c.pass),source:'final-cloud-finite.json'},
  responseReuse:{passed:finite.responseChecks.every(c=>c.pass),count:finite.responseChecks.length,maxL:max(finite.responseChecks,'Lerror'),maxT:max(finite.responseChecks,'Terror'),threshold:.002},
  material:{passed:material.passed,count:material.rows.length,maxOpacity:max(material.rows,'error'),maxConvergence:max(material.rows,'convergence')},
  components:{passed:components.passed,count:components.rows.length,maxOpacity:components.maxError},
  layeredClosure:{passed:layered.passed,count:layered.checks.length,maxL:max(layered.checks,'maxL'),maxT:max(layered.checks,'maxT'),maxConvergence:max(layered.checks,'convergence')},
  actualEntry:{passed:lifecycles.every(c=>c.passed),cold:{mountMs:cold.mountWallMs,resourceReadyMs:cold.resourcesReadyMs,fullFrameMs:cold.fullFrameMs},warm:{mountMs:warm.mountWallMs,resourceReadyMs:warm.resourcesReadyMs,fullFrameMs:warm.fullFrameMs},lifecycles:lifecycles.map(c=>({name:c.name,passed:c.passed,count:c.checks.length})),coldShaderResolved:false},
  quality:{sourceReusePassed:qualityLinks.length===0,newCloudLinksDuringSwitches:qualityLinks.length,switches:quality.results.map(r=>({quality:r.quality,hdr:r.hdr,wallMs:r.wallMs,frame:r.timing.frame.gpu.frame,volume:r.timing.passes.gpu['cloud-volume']}))},
  gpu:{passed:false,renderer:read('final-scene-startup').renderer,table:'gpu-summary.json',raw:'final-gpu.json',boundary:'Same in-app browser, foreground flags in each round. Hardware clock/power throttling not measured.'},
  storage:{fixedAndWeatherBytes:16347328,componentsBytes:32768,retainedCpuSourceBytes:9437184,materialCachePayloadLimitBytes:655360,assetVersion:3,opticsVersion:3},
  unverified:['Real DEM and 3D Tiles','Other GPU/driver combinations','Hardware frequency throttling','Strict temporal pixel-error bounds','Independent full L reference for spatially changing weather along long grazing rays'],
  remaining:['Three spatial opacity points exceed .02','One finite grazing opacity case exceeds .02','High quality satellite radiance exceeds the retained .01 gate','Global/orbit/two-layer GPU cost target is not met','First cold source still blocks synchronously in Cesium LINK_STATUS','Frozen weather per interval and no cross-interval column identity']};
// The report intentionally remains red. Functional counts are never an overall gate.
writeFileSync(join(root,'result.json'),JSON.stringify(result,null,2));
const format=s=>[s.meanMs,s.medianMs,s.p95Ms].map(v=>v.toFixed(3)).join(' / ');
const rows=gpu.current.map((c,i)=>`<tr><th>${c.name}</th><td>${format(gpu.comparison[i].gpu.frame)}</td><td>${format(c.gpu.frame)}</td><td>${format(c.gpu['cloud-volume'])}</td><td>${c.gpu.frame.count} / ${c.gpu['cloud-volume'].count}</td></tr>`).join('');
const report=readFileSync('docs/stage6-validation.md','utf8');assert.ok(!report.includes('<!-- '),'Replace all measurement placeholders first.');
copyFileSync('docs/stage6-validation.md',join(root,'stage6-validation.md'));
writeFileSync(join(root,'index.html'),`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>第六阶段验证证据</title>
<style>body{font:16px/1.65 system-ui;background:#101923;color:#e9eff8;margin:0 auto;max-width:1280px;padding:28px}a{color:#9dceff}.red{padding:18px;background:#332321;border-left:5px solid #ed9479}h1{font-size:28px}h2{margin-top:30px}table{border-collapse:collapse;width:100%;font-size:13px}th,td{border-bottom:1px solid #394654;text-align:left;padding:8px}pre{white-space:pre-wrap;font:13px/1.6 ui-monospace,monospace}.pair{display:flex;gap:14px}figure{margin:0;min-width:0;flex:1}img{width:100%;background:#071017}select{padding:6px;margin:12px}small{color:#b5c1cf}</style>
<h1>正式入口、有限段统计、主云成本与 quality</h1><p>本轮 ${head.slice(0,8)} · 审查 016156a0 · 比较 f1c2d051 · RTX 5080 / 内置浏览器 / ANGLE D3D11</p>
<div class="red"><strong>整体验收仍未通过。</strong><ul>${result.remaining.map(s=>`<li>${s}</li>`).join('')}</ul><p>功能 ${functional.passedChecks}/${functional.checks} 不是总体通过结论。<a href="result.json">小型结果 JSON</a> · <a href="stage6-validation.md">完整报告</a></p></div>
<p>1920×1080、垂直 FOV 60°、medium/.65、HDR、曝光8、seed13、风和演化固定。昼侧 UTC 2026-06-21T17:00Z；夜景 2026-10-26T04:12Z。参数、相机和帧状态随 JSON 保存。</p>
<h2>固定镜头</h2><label>场景<select id="scene">${gpu.current.map(c=>`<option>${c.name}</option>`).join('')}</select></label><div class="pair"><figure><a id="before-link"><img id="before" alt="比较基线"></a><figcaption>f1c2d05 · 同一内置浏览器重新渲染</figcaption></figure><figure><a id="after-link"><img id="after" alt="本轮"></a><figcaption>${head.slice(0,8)} · 最终版本</figcaption></figure></div>
<h2>GPU 分布</h2><p><small>mean / median / P95 ms；整帧与分 pass 独立轮次，每类两轮各至少200有效query。不是CPU submit或帧间隔。</small></p><table><tr><th>场景</th><th>f1c2d05 整帧</th><th>本轮整帧</th><th>本轮云积分</th><th>样本数</th></tr>${rows}</table><p><a href="gpu-summary.json">GPU 汇总</a> · <a href="final-gpu.json">本轮原始 query</a> · <a href="comparison-gpu.json">比较原始 query</a> · <a href="condition-validation.json">固定条件校验</a></p>
<h2>连续镜头</h2><input id="tour" type="range" min="0" max="24" value="0" style="width:100%"><p id="tour-caption"></p><img id="tour-image" alt="连续镜头关键帧"><details><summary>关键帧状态</summary><pre id="tour-state"></pre></details><p><a href="final-tour.json">${tour.frames.length}帧状态与25个关键帧</a>。捕获本身影响间隔；不能据此宣称零闪烁。</p>
<h2>独立门槛与启动</h2><ul>${['final-cloud-partial','final-cloud-finite','material-range','components-cpu','grazing-matrix','final-cloud-work','final-cloud-cache','final-cloud-layered-closure','final-entry-cold-startup','final-entry-warm-startup','final-entry-cold-lifecycle','final-entry-warm-lifecycle','final-entry-during-load','final-quality-switches','reduction-summary'].map(s=>`<li><a href="${s}.json">${s}</a></li>`).join('')}</ul>
<h2>功能回归</h2><ul>${probes.map(p=>`<li><a href="final-${p.name}.json">${p.name}</a>：${p.checks.filter(c=>c.pass).length}/${p.checks.length} ${p.passed?'通过':'仍有失败'}</li>`).join('')}</ul>
<h2>复核与范围</h2><p><a href="REPRODUCE.md">复核步骤</a> · <a href="source-current.zip">本轮源码</a> · <a href="source-review.zip">审查基线源码</a> · <a href="source-comparison.zip">比较基线源码</a> · <a href="source-comparison-measured.zip">实际比较夹具快照</a> · <a href="manifest.json">SHA-256清单</a> · <a href="png-validation.json">PNG验证</a></p><p>真实DEM/3D Tiles、其它GPU驱动、硬件频率节流、严格时域误差未验证。完整报告保留模型边界和全部红色项。</p><details><summary>报告全文</summary><pre id="report"></pre></details>
<script>const samples=${JSON.stringify(tour.samples)},report=${JSON.stringify(report)};document.querySelector('#report').textContent=report;const scene=document.querySelector('#scene');function showScene(){for(const[id,prefix]of[['before','comparison'],['after','current']]){const path=prefix+'-'+scene.value+'.png';document.getElementById(id).src=path;document.getElementById(id+'-link').href=path;}}scene.onchange=showScene;showScene();const slider=document.querySelector('#tour');function showTour(){const i=Number(slider.value);document.querySelector('#tour-image').src='current-tour-'+String(i).padStart(2,'0')+'.png';document.querySelector('#tour-caption').textContent='关键帧 '+i;document.querySelector('#tour-state').textContent=JSON.stringify(samples[i].state,null,2);}slider.oninput=showTour;showTour();</script></html>`);
writeFileSync(join(root,'REPRODUCE.md'),`# 复核说明\n\n本轮 ${head}，审查 ${review}，比较 ${comparison}。打开 index.html；总体状态保留红色。\n\n解压 source-current.zip 到单独目录，npm ci、npm test、npm run build。执行 node scripts/build-validation.mjs . artifacts/stage6/acceptance，然后 npx vite preview --outDir artifacts --host 127.0.0.1 --port 4180。用前台浏览器打开 /stage6/acceptance/tests/stage5-scene.html。不要把不同浏览器/GPU结果拼作同机速度对照。\n\n真实入口：tests/actual-entry.html?cache=off；热资产：?auto；加载中切换：?during-load&cache=off。所有URL都在上述acceptance目录下。quality成本：stage5-scene.html?quality-gpu，点击quality按钮。缩减编译实验：?reduce=no-statistics、no-cone、no-ice；它们故意改变效果，仅定位链接复杂度，不能用于同画质速度。\n\nCPU空间：npx tsx scripts/validate-grazing.ts，保留失败退出码；材质：validate-material-range.ts；分量：validate-components.ts。独立浏览器门槛为 cloud-partial、cloud-finite、cloud-layered-closure、satellite-lod、cloud-cache。旧cache helper已不在生产有限段路径。\n\n包内final-*为最终验收；pre-scatter、scalar、vector、scatter-weight文件为明确标识的中间实验，不能替代最终数字。程序化前景回归不能视为真实DEM/3D Tiles覆盖。manifest.json逐项记录SHA-256。\n`);
for(const [name,ref] of [['current','HEAD'],['review',review],['comparison',comparison]])execFileSync('git',['archive','--format=zip',`--output=${join(root,'source-'+name+'.zip')}`,ref]);
execFileSync('tar',['-a','-cf',join(root,'source-comparison-measured.zip'),'-C',join(root,'comparison-src'),'.']);
const destination=resolve('artifacts',`stage6-evidence-${head.slice(0,8)}`);mkdirSync(destination,{recursive:true});
const select=/^(final-|comparison-(gpu|captures)|source-|pre-scatter-|scatter-weight-|density-before-scatter|vector-|scalar-startup|review-entry-|grazing-matrix|material-range|components-cpu|reduction-|gpu-summary|gpu-table|quality-table|condition-validation|png-validation|unit-final|build-final|validation-build-final|lighting-first-failure|result|index|REPRODUCE|stage6-validation)/;
const superseded=new Set(['final-null.json','final-closure.json','final-finite.json','final-partial.json','final-startup-asset-cold.json']);
const files=readdirSync(root).filter(name=>!superseded.has(name)&&(select.test(name)||/^(current|comparison)-.*\.png$/.test(name))&&/\.(json|log|txt|md|html|zip|png)$/.test(name));
for(const name of files)copyFileSync(join(root,name),join(destination,name));
const manifest={revision:head,review,comparison,createdAt:new Date().toISOString(),files:files.map(name=>{const bytes=readFileSync(join(destination,name));return {name,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};})};
writeFileSync(join(destination,'manifest.json'),JSON.stringify(manifest,null,2));
execFileSync('tar',['-a','-cf',resolve('artifacts','stage6-evidence.zip'),'-C',destination,'.']);
console.log(JSON.stringify({destination,revision:head,files:files.length,bytes:manifest.files.reduce((n,f)=>n+f.bytes,0)}));
