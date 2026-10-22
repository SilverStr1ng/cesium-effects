import 'cesium/Build/Cesium/Widgets/widgets.css';
import './style.css';
import { Cartesian3, Math as CesiumMath } from 'cesium';
import { dependencies } from '../package.json';
import { createScene } from './scene/createScene';
import { effectRegistry } from './effects/registry';
import { TornadoEffect } from './effects/lbm-tornado/TornadoEffect';
import { defaults, qualities, type TornadoParameters, type Quality } from './effects/lbm-tornado/config';
import { icon } from './ui/icons';
import { attachFrameProfiler } from './scene/FrameProfiler';
import { AtmosphereEffect } from './effects/hillaire-atmosphere/AtmosphereEffect';
import { mountEnvironmentPanel } from './ui/EnvironmentPanel';
import { CloudComparison } from './effects/water-clouds/CloudComparison';
import {cloudComparisonView,cloudComparisonTimes} from './effects/water-clouds/comparisonView';
import { mountCloudPanel } from './ui/CloudPanel';

const root = document.querySelector<HTMLDivElement>('#app')!;
const controls: {key: keyof TornadoParameters; label: string; min: number; max: number; step: number; unit: string}[] = [
  {key:'swirl',label:'旋转强度',min:0,max:2,step:.05,unit:'×'},
  {key:'updraft',label:'上升气流',min:0,max:2,step:.05,unit:'×'},
  {key:'turbulence',label:'湍流扰动',min:0,max:1,step:.01,unit:''},
  {key:'density',label:'烟雾浓度',min:.2,max:2.5,step:.05,unit:'×'},
  {key:'radius',label:'漏斗宽度',min:.6,max:1.6,step:.05,unit:'×'},
  {key:'height',label:'风暴高度',min:1500,max:5000,step:100,unit:'m'},
];
const format = (key: keyof TornadoParameters, value: number) => key === 'height' ? value.toLocaleString() : value.toFixed(2);

root.innerHTML = `
  <header class="topbar">
    <a href="./" class="brand" aria-label="Cesium Effects 首页"><span class="brand-icon">${icon('vortex',26)}</span><span>CESIUM<span class="brand-light"> / EFFECTS</span></span><span class="lab-tag">LAB</span></a>
    <div class="breadcrumb">工作空间 <span>/</span> 大气与流体 <span>/</span> <strong>LBM 龙卷风</strong></div>
    <div class="engine"><span class="status-dot"></span>Cesium ${dependencies.cesium}<span class="engine-separator"></span>WebGL 2</div>
  </header>
  <aside class="sidebar">
    <div class="library-heading"><span>${icon('layers',16)} 特效库</span><span class="count">${String(effectRegistry.length).padStart(2,'0')}</span></div>
    <div class="effect-card">
      <div class="effect-art"><svg viewBox="0 0 250 100" fill="none" aria-hidden="true"><g stroke="currentColor"><ellipse cx="123" cy="23" rx="70" ry="16"/><ellipse cx="121" cy="30" rx="59" ry="15"/><ellipse cx="117" cy="39" rx="47" ry="13"/><ellipse cx="112" cy="48" rx="35" ry="11"/><ellipse cx="109" cy="57" rx="25" ry="8"/><ellipse cx="111" cy="65" rx="17" ry="6"/><ellipse cx="116" cy="72" rx="10" ry="4"/><ellipse cx="120" cy="79" rx="6" ry="3"/></g></svg><span class="effect-number">FX — 001</span><span class="art-label">VOLUMETRIC</span></div>
      <div class="effect-card-bottom"><div><h2>LBM 龙卷风</h2><p>大气模拟 <span>·</span> 体积渲染</p></div><label class="switch"><input type="checkbox" id="enabled" checked aria-label="启用龙卷风特效"><span></span></label></div>
    </div>
    <div class="section-heading"><span>特效参数</span><button id="restore" class="text-button" title="恢复默认参数">恢复默认 ${icon('reset',12)}</button></div>
    <div class="presets" aria-label="龙卷风预设"><button data-preset="classic" class="active">经典漏斗</button><button data-preset="storm">强风暴</button><button data-preset="wisp">轻烟涡流</button></div>
    <div class="sliders">${controls.map(c=>`<div class="control"><div class="control-label"><label for="${c.key}">${c.label}</label><span><output id="${c.key}-value" for="${c.key}">${format(c.key,defaults[c.key])}</output> <small>${c.unit}</small></span></div><input id="${c.key}" type="range" min="${c.min}" max="${c.max}" step="${c.step}" value="${defaults[c.key]}"></div>`).join('')}</div>
    <div class="quality-section"><div class="section-heading"><label for="quality">渲染质量</label><span class="subtle">QUALITY</span></div><select id="quality"><option value="low">流畅 · 24 × 24 × 40</option><option value="medium" selected>均衡 · 32 × 32 × 52</option><option value="high">精细 · 40 × 40 × 64</option></select><p>独立线程计算 · 实时体积光照</p></div>
    <div class="sidebar-bottom"><div class="token-note" id="token-note">${icon('info',16)}<span>未配置 Token · 本地底图可用<small>在 .env 中填写 Cesium ion Token</small></span></div><a class="reference-link" href="https://www.bilibili.com/video/BV13WMB6SEEf/" target="_blank" rel="noreferrer">观看效果参考 ${icon('arrow',13)}</a></div>
  </aside>
  <main class="viewport">
    <div id="cesium-container" aria-label="Cesium 三维场景"></div>
    <div class="scene-vignette"></div>
    <div class="scene-heading"><span class="eyebrow">EXPERIMENT 001 <span> / </span> ATMOSPHERE</span><h1>风暴，有迹可循<span>。</span></h1><p>LBM 龙卷风 <span>—</span> 三维流体实验</p></div>
    <div class="map-control"><span>${icon('globe',15)}</span><select id="map" aria-label="场景底图"><option value="lab">实验网格</option><option value="satellite">卫星影像 · ion</option></select></div>
    <div class="view-tools"><button id="focus" aria-label="定位龙卷风" title="定位龙卷风">${icon('target')}</button><button id="orbit" aria-label="环绕观察" title="环绕观察" aria-pressed="false">${icon('orbit')}</button><span></span><button id="zoom-in" aria-label="放大" title="放大">${icon('plus')}</button><button id="zoom-out" aria-label="缩小" title="缩小">${icon('minus')}</button><span></span><button id="guides" aria-label="显示距离参考圈" title="距离参考圈" aria-pressed="true" class="active">${icon('grid')}</button><button id="overview" aria-label="地球总览" title="地球总览">${icon('globe')}</button></div>
    <div class="orientation" id="orientation"><span>N</span><svg viewBox="0 0 36 48" aria-hidden="true"><path d="M18 4 27 34 18 29 9 34Z" fill="none" stroke="currentColor"/><path d="M18 4v25l-9 5Z" fill="currentColor" opacity=".7"/></svg></div>
    <div class="coordinates"><span class="location-dot"></span> OKLAHOMA, US <small>35.4600° N &nbsp; 97.5200° W</small></div>
    <div class="simulation-info"><div><span id="sim-dot" class="status-dot"></span><span id="sim-state">初始化中</span></div><p><strong id="fps">—</strong> FPS <span>/</span> <strong id="solver-ms">—</strong> ms 求解</p><p class="iteration">D3Q19 <span>·</span> STEP <span id="iteration">000000</span></p></div>
    <div class="transport"><button id="pause" class="play-button" aria-label="暂停模拟" title="空格：暂停 / 继续">${icon('pause',18)}</button><button id="restart" class="restart-button" aria-label="重置模拟" title="重新初始化流场">${icon('reset',17)}</button><span class="transport-divider"></span><span class="transport-time" id="elapsed">00:00</span><span class="live-label">SIMULATION</span><div class="speed-control"><label for="speed">速率</label><select id="speed"><option value="0.5">0.5×</option><option value="1" selected>1.0×</option><option value="1.5">1.5×</option><option value="2">2.0×</option></select></div></div>
    <div class="interaction-hint">左键拖动 <span>平移</span><i></i> 滚轮 <span>缩放</span><i></i> Ctrl + 拖动 <span>环视</span></div>
    <div id="notice" class="notice" role="status" aria-live="polite">正在加载 Cesium 场景…</div>
    <div id="loading" class="loading"><span class="loading-spinner"></span><p>正在构建风场</p><small>INITIALIZING THE ATMOSPHERE</small></div>
  </main>`;

const element = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
let noticeTimer: ReturnType<typeof setTimeout>;
let failed = false;
function notify(message: string, error = false) {
  const notice = element('notice');
  notice.textContent = message;
  notice.classList.toggle('error',error);
  notice.classList.add('visible');
  clearTimeout(noticeTimer);
  if (!error) noticeTimer = setTimeout(()=>notice.classList.remove('visible'), 5000);
  if (error) failed = true;
}

async function boot() {
  const scene = await createScene(element('cesium-container'), notify);
  const {viewer,hasToken} = scene;
  const atmosphere=new AtmosphereEffect();
  atmosphere.mount({viewer,onStatus:notify});
  const clouds=new CloudComparison({sunDirection:()=>atmosphere.sunDirection,moonDirection:()=>atmosphere.moonDirection,
    moonFraction:()=>atmosphere.moonFraction,transmittance:()=>atmosphere.transmissionTexture,atmosphereEnabled:()=>atmosphere.enabled,
    multipleScattering:()=>atmosphere.multipleScatteringTexture,medium:()=>atmosphere.mediumParameters,exposure:()=>atmosphere.parameters.exposure});
  clouds.mount({viewer,onStatus:notify});
  if (hasToken) element('token-note').innerHTML = `${icon('info',16)}<span>Cesium ion Token 已配置<small>可切换卫星影像底图</small></span>`;
  const initialEffect = effectRegistry[0].create();
  if (!(initialEffect instanceof TornadoEffect)) throw new Error('Invalid initial effect');
  const effect = initialEffect;
  const startTornado=new URLSearchParams(location.search).get('effect')==='tornado';
  clouds.setEnabled(!startTornado);
  effect.enabled=startTornado;
  effect.mount({viewer,onStatus:notify});
  if(startTornado)effect.focusReference();else clouds.view('above');
  const sidebar=document.querySelector<HTMLElement>('.sidebar')!;
  const tornadoPanel=document.createElement('section');tornadoPanel.className='tornado-panel';
  const bottom=sidebar.querySelector('.sidebar-bottom')!;
  let next=sidebar.querySelector('.effect-card');
  while(next&&next!==bottom){const following=next.nextElementSibling;tornadoPanel.append(next);next=following;}
  bottom.before(tornadoPanel);
  const environmentPanel=mountEnvironmentPanel(sidebar,atmosphere,tornado=>{
    effect.setEnabled(tornado);element<HTMLInputElement>('enabled').checked=tornado;
    clouds.setEnabled(!tornado);element<HTMLInputElement>('cloud-enabled').checked=!tornado;
    tornadoPanel.hidden=!tornado;root.classList.toggle('sky-mode',!tornado);
    referenceView.hidden=!tornado;
    updateSceneLabels(tornado);
    if(tornado)effect.focusReference();else clouds.view('above');
  },viewer);
  environmentPanel.element.querySelector<HTMLSelectElement>('#experience')!.value=startTornado?'tornado':'sky';
  const cloudPanel=mountCloudPanel(environmentPanel.element.querySelector<HTMLElement>('#environment-extra')!,clouds,night=>{
    environmentPanel.setTime(night?cloudComparisonTimes.night:cloudComparisonTimes.day);
    viewer.camera.flyTo({...cloudComparisonView(viewer.clock.currentTime,night),duration:1.2});
  });
  element<HTMLInputElement>('cloud-enabled').checked=!startTornado;
  tornadoPanel.hidden=!startTornado;root.classList.toggle('sky-mode',!startTornado);
  function updateSceneLabels(tornado:boolean){
    document.querySelector('.scene-heading h1')!.textContent=tornado?'风暴，有迹可循。':'天空，层层可见。';
    document.querySelector('.scene-heading p')!.textContent=tornado?'LBM 龙卷风 — 三维流体实验':'行星大气与体积云 — 从地面到太空';
    document.querySelector('.scene-heading .eyebrow')!.textContent=tornado?'EXPERIMENT 001 / ATMOSPHERE':'PLANETARY / ATMOSPHERE';
    document.querySelector('.breadcrumb strong')!.textContent=tornado?'LBM 龙卷风':'全球天空';
    element('focus').setAttribute('aria-label',tornado?'定位龙卷风':'定位天空');
    element('focus').title=tornado?'定位龙卷风':'定位天空';
  }
  updateSceneLabels(startTornado);
  element<HTMLInputElement>('enabled').checked=startTornado;
  const natural=document.createElement('option');natural.value='natural';natural.textContent='自然地球 · 本地';
  element<HTMLSelectElement>('map').prepend(natural);element<HTMLSelectElement>('map').value='natural';
  await scene.setMap('natural');
  const removeProfiler=attachFrameProfiler(viewer,()=>({quality:effect.quality,parameters:{...effect.parameters},paused:effect.paused,iteration:effect.statistics.iteration,
    tornadoEnabled:effect.enabled,atmosphere:{enabled:atmosphere.enabled,clockLinked:atmosphere.clockLinked,parameters:{...atmosphere.parameters}},
    clouds:{model:clouds.mode,moonLight:clouds.moonLight,enabled:clouds.enabled,quality:clouds.quality,paused:clouds.paused,parameters:{...clouds.parameters}},
    camera:{position:Cartesian3.pack(viewer.camera.positionWC,[]),direction:Cartesian3.pack(viewer.camera.directionWC,[]),up:Cartesian3.pack(viewer.camera.upWC,[])}}));
  element('loading').classList.add('hidden');

  function paintRange(input: HTMLInputElement) {
    const percent=(Number(input.value)-Number(input.min))/(Number(input.max)-Number(input.min))*100;
    input.style.setProperty('--fill',`${percent}%`);
  }
  function syncParameters() {
    controls.forEach(({key})=>{
      const input=element<HTMLInputElement>(key);
      input.value=String(effect.parameters[key]);
      element(`${key}-value`).textContent=format(key,effect.parameters[key]);
      paintRange(input);
    });
    element<HTMLSelectElement>('speed').value=String(effect.parameters.speed);
  }
  function presetActive(name: string) {
    document.querySelectorAll<HTMLButtonElement>('[data-preset]').forEach(button=>button.classList.toggle('active',button.dataset.preset===name));
  }
  controls.forEach(({key})=>{
    const input=element<HTMLInputElement>(key);
    input.addEventListener('input',()=>{
      effect.updateParameters({[key]:Number(input.value)});
      element(`${key}-value`).textContent=format(key,Number(input.value));
      paintRange(input); presetActive('');
    });
  });
  const presets: Record<string, Partial<TornadoParameters>> = {
    classic: defaults,
    storm: { ...defaults, swirl:1.75,updraft:1.6,turbulence:.85,density:1.8,radius:1.35,height:3600 },
    wisp: { ...defaults, swirl:.8,updraft:.7,turbulence:.35,density:.65,radius:.7,height:2600 },
  };
  document.querySelectorAll<HTMLButtonElement>('[data-preset]').forEach(button=>button.addEventListener('click',()=>{
    effect.updateParameters(presets[button.dataset.preset!]);
    effect.reset(); syncParameters(); presetActive(button.dataset.preset!);
    notify(`已应用「${button.textContent}」预设`);
  }));
  element('restore').addEventListener('click',()=>{ effect.updateParameters(defaults); effect.reset(); syncParameters(); presetActive('classic'); });
  element<HTMLSelectElement>('quality').addEventListener('change',event=>{
    effect.setQuality((event.target as HTMLSelectElement).value as Quality);
  });
  element<HTMLInputElement>('enabled').addEventListener('change',event=>effect.setEnabled((event.target as HTMLInputElement).checked));
  element('pause').addEventListener('click',()=>effect.setPaused(!effect.paused));
  let elapsed = 0;
  element('restart').addEventListener('click',()=>{ failed=false; elapsed=0; effect.reset(); });
  element<HTMLSelectElement>('speed').addEventListener('change',event=>effect.updateParameters({speed:Number((event.target as HTMLSelectElement).value)}));
  element('focus').addEventListener('click',()=>{ if(root.classList.contains('sky-mode'))atmosphere.focus();else effect.focus(); setOrbitButton(false); });
  const referenceView=document.createElement('button');
  referenceView.id='reference-view';
  referenceView.hidden=!startTornado;
  referenceView.className='reference-view';
  referenceView.textContent='3:42 · 云冠近景';
  referenceView.title='以视频 3:42 为参考的云冠观察机位';
  document.querySelector('.scene-heading')!.append(referenceView);
  referenceView.addEventListener('click',()=>{effect.focusReference();setOrbitButton(false);});
  function setOrbitButton(active: boolean) { element('orbit').classList.toggle('active',active); element('orbit').setAttribute('aria-pressed',String(active)); }
  element('orbit').addEventListener('click',()=>{ effect.setOrbit(!effect.orbit); setOrbitButton(effect.orbit); });
  element('zoom-in').addEventListener('click',()=>viewer.camera.zoomIn(Math.max(100,viewer.camera.positionCartographic.height*.2)));
  element('zoom-out').addEventListener('click',()=>viewer.camera.zoomOut(Math.max(100,viewer.camera.positionCartographic.height*.2)));
  element('overview').addEventListener('click',()=>{
    effect.setOrbit(false); setOrbitButton(false);
    viewer.camera.flyTo({destination:Cartesian3.fromDegrees(-97.52,35.46,16_000_000),duration:1.8,orientation:{heading:0,pitch:CesiumMath.toRadians(-90),roll:0}});
  });
  let guides = true;
  element('guides').addEventListener('click',()=>{
    guides=!guides; scene.setGuides(guides); element('guides').classList.toggle('active',guides); element('guides').setAttribute('aria-pressed',String(guides));
  });
  element<HTMLSelectElement>('map').addEventListener('change',async event=>{
    const select=event.target as HTMLSelectElement;
    select.disabled=true;
    try { if (!await scene.setMap(select.value)) select.value='lab'; else scene.setGuides(guides); }
    finally { select.disabled=false; }
  });
  const keyHandler = (event: KeyboardEvent) => {
    if (event.code === 'Space' && !(event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement || event.target instanceof HTMLButtonElement)) {
      event.preventDefault();
      if(root.classList.contains('sky-mode'))element('cloud-pause').click();else effect.setPaused(!effect.paused);
    }
  };
  window.addEventListener('keydown',keyHandler);
  syncParameters();
  let frames=0,lastFps=performance.now(),lastTime=lastFps,lastUpdate=0;
  const removeStats=viewer.scene.postRender.addEventListener(()=>{
    const now=performance.now(),dt=Math.min((now-lastTime)/1000,.1); lastTime=now;
    frames++;
    if (effect.enabled&&!effect.paused&&!document.hidden) elapsed+=dt*effect.parameters.speed;
    if (now-lastFps>1000) { element('fps').textContent=String(Math.round(frames*1000/(now-lastFps))); frames=0;lastFps=now; }
    if (now-lastUpdate<200) return;
    lastUpdate=now;
    element('solver-ms').textContent=effect.statistics.milliseconds.toFixed(1);
    element('iteration').textContent=String(effect.statistics.iteration).padStart(6,'0');
    element('sim-state').textContent=failed ? '请检查提示' : !effect.enabled ? '特效已关闭' : effect.paused ? '模拟已暂停' : '实时模拟中';
    element('sim-dot').classList.toggle('stopped',effect.paused||!effect.enabled||failed);
    const pause=element('pause');
    const label=effect.paused?'继续模拟':'暂停模拟';
    if (pause.getAttribute('aria-label')!==label) { pause.setAttribute('aria-label',label); pause.innerHTML=icon(effect.paused?'play':'pause',18); }
    element('elapsed').textContent=`${String(Math.floor(elapsed/60)).padStart(2,'0')}:${String(Math.floor(elapsed%60)).padStart(2,'0')}`;
    element('orientation').style?.setProperty('--heading',`${-viewer.camera.heading}rad`);
  });
  const dispose=()=>{ clearTimeout(noticeTimer); window.removeEventListener('keydown',keyHandler); removeProfiler(); removeStats(); cloudPanel.destroy(); environmentPanel.destroy(); effect.destroy(); clouds.destroy(); atmosphere.destroy(); if (!viewer.isDestroyed()) viewer.destroy(); };
  window.addEventListener('pagehide',dispose,{once:true});
  import.meta.hot?.dispose(()=>{window.removeEventListener('pagehide',dispose);dispose();});
}

boot().catch(error=>{
  console.error(error);
  element('loading').classList.add('hidden');
  notify(`场景初始化失败：${error instanceof Error ? error.message : String(error)}`,true);
});
