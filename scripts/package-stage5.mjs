import {mkdirSync,readFileSync,writeFileSync,readdirSync,copyFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';

const root=resolve('artifacts/stage5'),head=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
// The source archive must contain the tests and report being delivered. Never
// label an uncommitted working tree as an immutable HEAD snapshot.
assert.equal(execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).trim(),'','Commit the reviewed changes before packaging evidence.');
const destination=resolve('artifacts',`stage5-evidence-${head.slice(0,8)}`);mkdirSync(destination,{recursive:true});
const read=name=>JSON.parse(readFileSync(join(root,name),'utf8'));
const gpu=read('gpu-summary.json'),tour=read('current-tour.json');
const probeNames=['grazing-gpu','startup-lifecycle-final','pipeline-gpu','closure-gpu','atmosphere-gpu','lighting-gpu','cloud-gpu','water-cloud-gpu','high-cloud-gpu','satellite-lod','celestial-state','celestial-scene','celestial-gpu','celestial-optics'];
const probes=probeNames.map(name=>({name,...read(name+'.json')}));
for(const p of probes)assert.ok(p.passed&&p.checks.every(c=>c.pass),`${p.name}: functional regression failed`);
assert.ok(tour.complete&&tour.samples.length===25,'Continuous-camera evidence is incomplete');
const measured={baseline:read('baseline-gpu.json'),current:read('current-gpu.json')};
const fixed=({visible,focused,...conditions})=>conditions;
const conditionChecks=[];
for(const version of ['baseline','current']){
  assert.ok(measured[version].complete,`${version}: incomplete GPU matrix`);
  assert.equal(measured[version].results.length,28,`${version}: expected 7 scenes × 2 modes × 2 rounds`);
  const keys=new Set();
  for(const r of measured[version].results){
    const key=`${r.name}/${r.mode}/${r.round}`;assert.ok(!keys.has(key),`${version}: duplicate ${key}`);keys.add(key);
    assert.deepEqual(fixed(r.initial),fixed(r.final),`${version}/${key}: state changed during timing`);
    assert.deepEqual(r.initial.buffer,[1920,1080],`${version}/${key}: buffer`);
    assert.ok(Math.abs(r.initial.camera.fovy-Math.PI/3)<1e-12,`${version}/${key}: vertical FOV`);
    assert.equal(r.initial.clouds.parameters.seed,13);assert.equal(r.initial.clouds.quality,'medium');
    assert.equal(r.initial.clouds.storage,'RGBA16F');assert.equal(r.initial.atmosphere.parameters.exposure,8);
    assert.deepEqual(r.initial.clouds.motion,{angle:0,highAngle:0,evolution:0});
    for(const pass of r.mode==='frame'?['frame']:['cloud-volume','cloud-resolve','atmosphere-composite']){
      const times=r.timing.rawGpu[pass];assert.ok(times?.length>=200&&times.every(t=>Number.isFinite(t)&&t>=0),`${version}/${key}/${pass}: insufficient valid query samples`);
    }
    if(version==='current'){
      const before=measured.baseline.results.find(b=>b.name===r.name&&b.mode===r.mode&&b.round===r.round);
      assert.ok(before,`Missing baseline ${key}`);assert.deepEqual(fixed(before.initial),fixed(r.initial),`${key}: mismatched before/after conditions`);
      conditionChecks.push({key,matched:true});
    }
  }
}
writeFileSync(join(root,'condition-validation.json'),JSON.stringify({passed:true,checks:conditionChecks},null,2));
const stats=(s)=>[s.meanMs,s.medianMs,s.p95Ms].map(n=>n.toFixed(3)).join(' / ');
const rows=gpu.current.map((c,i)=>`<tr><th>${c.name}</th><td>${stats(gpu.baseline[i].gpu.frame)}</td><td>${stats(c.gpu.frame)}</td><td>${stats(c.gpu['cloud-volume'])}</td><td>${c.gpu.frame.count} / ${c.gpu['cloud-volume'].count}</td></tr>`).join('');
const checks=probes.map(p=>`<li><a href="${p.name}.json">${p.name}</a>：${p.checks.filter(c=>c.pass).length}/${p.checks.length} ${p.passed?'通过':'失败'}</li>`).join('');
const html=`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>第五阶段验证证据</title>
<style>body{font:16px/1.6 system-ui;background:#111820;color:#e9eef4;margin:0 auto;padding:28px;max-width:1280px}h1{font-size:28px}h2{margin-top:32px}a{color:#9acbff}.notice{border-left:4px solid #ef9c68;background:#292120;padding:16px}table{border-collapse:collapse;width:100%;font-size:13px}th,td{border-bottom:1px solid #39404c;padding:9px;text-align:left}figure{margin:0;flex:1;min-width:0}figure img{width:100%;background:#080e13}.pair{display:flex;gap:14px}select,input{padding:6px;margin:12px 0}#tour-image{width:100%}pre{white-space:pre-wrap;font-size:12px}small{color:#a9b8c8}</style>
<h1>掠射、启动与端到端验收</h1><p>基线 f1c2d051 · 本轮 ${head.slice(0,8)} · RTX 5080 / Chrome ANGLE D3D11</p>
<div class="notice"><strong>验收尚未全部通过。</strong>四个指定反例、HG 和受控生产合成闭环通过；扩展空间扫描有 3 个点超出 0.02，部分柱最大误差约 0.337，已有射线缓存误差约 0.062。主云 GPU 成本增加，首次 low/high 编译仍约 45 秒。完整说明见 <a href="stage5-validation.md">报告</a>。</div>
<p>固定 1920×1080、垂直 FOV 60°、medium、HDR、曝光 8、seed 13、风和演化暂停；昼景 UTC 2026-06-21T17:00Z，夜景 UTC 2026-10-26T04:12Z。各截图状态及原始 query 位于相应 JSON。</p>
<h2>固定场景对照</h2><label>场景 <select id="scene">${gpu.current.map(c=>`<option>${c.name}</option>`).join('')}</select></label><div class="pair"><figure><a id="before-link"><img id="before"></a><figcaption>基线</figcaption></figure><figure><a id="after-link"><img id="after"></a><figcaption>本轮</figcaption></figure></div>
<h2>GPU 分布</h2><p><small>mean / median / P95，单位 ms；整帧和分 pass 分轮测量，各两轮 200 个有效查询。没有用帧间隔或 CPU submit 代替 GPU。</small></p><table><tr><th>场景</th><th>基线整帧</th><th>本轮整帧</th><th>本轮云积分</th><th>样本数</th></tr>${rows}</table><p><a href="gpu-summary.json">汇总与逐轮状态</a> · <a href="baseline-gpu.json">基线原始查询</a> · <a href="current-gpu.json">本轮原始查询</a></p>
<h2>连续镜头</h2><input id="tour" type="range" min="0" max="24" value="0" style="width:100%"><p id="tour-caption"></p><img id="tour-image"><details><summary>当前关键帧状态</summary><pre id="tour-state"></pre></details><p><a href="current-tour.json">783 帧状态与 25 个关键帧</a>。PNG 捕获本身会影响帧间隔；不据此宣称零闪烁或固定 FPS。</p>
<h2>浏览器回归</h2><ul>${checks}</ul><p>另行保留红色诊断：<a href="grazing-matrix.json">96 点空间扫描</a>、<a href="partial-gpu.json">部分柱</a>、<a href="cache-projected-gpu.json">缓存实验</a>、<a href="material-range.json">材质表范围</a>。</p>
<h2>启动与资源</h2><p><a href="current-assets-cold-startup.json">冷资产启动</a> · <a href="current-warm-startup.json">热启动</a> · <a href="current-switches.json">首次质量/格式切换</a> · <a href="baseline-switches.json">基线首次切换</a></p><p>固定资产与天气共 16,314,560 B；版本化缓存、worker 和 Transferable。资产冷启动未清空驱动 shader 缓存，不能当作完整冷驱动结果。真实 DEM/3D Tiles 和其它 GPU 未验证。</p>
<p>额外固定镜头：<a href="current-full-rgba8-cloud-scene.png">全链 RGBA8</a> · <a href="current-terrain-ridge-cloud-scene.png">程序化山脊</a> · <a href="current-terrain-flat-cloud-scene.png">椭球对照</a> · <a href="current-thin-sun-cloud-scene.png">薄幕云太阳</a> · <a href="current-clear-sun-cloud-scene.png">无云太阳</a>。窄视场薄幕云存在明显前向散射饱和，不能据此宣称画质目标已通过。</p>
<p><a href="source-current.zip">本轮源码快照</a> · <a href="baseline-src.zip">原始基线快照</a> · <a href="manifest.json">SHA-256 清单</a> · <a href="png-validation.json">PNG 完整性</a></p>
<script>const samples=${JSON.stringify(tour.samples)};const scene=document.querySelector('#scene');function showScene(){for(const [id,prefix] of [['before','baseline'],['after','current']]){const path=prefix+'-'+scene.value+'.png';document.getElementById(id).src=path;document.getElementById(id+'-link').href=path;}}scene.onchange=showScene;showScene();const slider=document.querySelector('#tour');function showTour(){const i=Number(slider.value);document.querySelector('#tour-image').src='current-tour-'+String(i).padStart(2,'0')+'.png';document.querySelector('#tour-caption').textContent='关键帧 '+i+'（约 '+i+' 秒）';document.querySelector('#tour-state').textContent=JSON.stringify(samples[i].state,null,2);}slider.oninput=showTour;showTour();</script></html>`;
writeFileSync(join(root,'index.html'),html);writeFileSync(join(root,'browser-summary.json'),JSON.stringify({probes:probes.map(p=>({name:p.name,passed:p.passed,checks:p.checks.length})),passedChecks:probes.reduce((n,p)=>n+p.checks.filter(c=>c.pass).length,0)},null,2));
copyFileSync('docs/stage5-validation.md',join(root,'stage5-validation.md'));
writeFileSync(join(root,'REPRODUCE.md'),`# 复核说明\n\n打开 index.html 查看对照、原始数据和失败范围。manifest.json 记录文件 SHA-256。\n\n源码快照 source-current.zip 是本轮提交，baseline-src.zip 是未经修改的审查基线；baseline-measured-src.zip 在基线上只加入测量夹具/启动埋点。数据与固定相机、参数、UTC 保存在 JSON 中。\n\n在单独目录解压源码，执行 npm ci、npm run build、node scripts/build-validation.mjs . artifacts/stage5/current，然后运行 npx vite preview --outDir artifacts --host 127.0.0.1 --port 4180。用前台 Chrome 打开 /stage5/current/tests/stage5-scene.html；各检查为 tests/*.html。页面提供 JSON 和原始 PNG。\n\nCPU 回归：npm test；空间扫描：npx tsx scripts/validate-grazing.ts（保留退出码 1）；材质范围：npx tsx scripts/validate-material-range.ts。GPU 两模式分别测量，不能嵌套查询；保持相同机器、前台、缓冲尺寸与固定参数。\n\n部分柱和缓存诊断故意保留失败：cloud-partial.html、cloud-cache.html。这些独立门槛不计入通过的 152 项功能回归。\n`);
execFileSync('git',['archive','--format=zip',`--output=${join(root,'source-current.zip')}`,'HEAD']);
const excluded=new Set(['manifest.json','current-cold-startup.json','principal-matrix.json','qmc-matrix.json']);
const files=readdirSync(root).filter(name=>!excluded.has(name)&&(/\.(json|log|txt|md|html|zip)$/.test(name)||/^(current|baseline)-.*\.png$/.test(name)));
for(const name of files)copyFileSync(join(root,name),join(destination,name));
const manifest={revision:head,baseline:'f1c2d051762608a7939d8871168ad1d0d11af9a3',createdAt:new Date().toISOString(),files:files.map(name=>{const bytes=readFileSync(join(destination,name));return {name,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};})};
writeFileSync(join(destination,'manifest.json'),JSON.stringify(manifest,null,2));copyFileSync(join(destination,'manifest.json'),join(root,'manifest.json'));
console.log(JSON.stringify({destination,revision:head,files:files.length,bytes:manifest.files.reduce((n,f)=>n+f.bytes,0)}));
