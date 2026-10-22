import type {CloudComparison,CloudMode} from '../effects/water-clouds/CloudComparison';
import type {CloudParameters,CloudQuality} from '../effects/global-clouds/config';

export function mountCloudPanel(parent:HTMLElement,cloud:CloudComparison,onLightingPreset:(night:boolean)=>void){
  const panel=document.createElement('section');panel.className='cloud-panel';
  panel.innerHTML=`<div class="environment-heading"><div><small>FX — 003</small><h2>全球体积云</h2></div><label class="switch"><input id="cloud-enabled" type="checkbox" checked aria-label="启用全球体积云"><span></span></label></div>
    <label class="environment-label" for="cloud-model">云层实现 · A/B 对比</label>
    <select id="cloud-model"><option value="water" selected>自然水云 · Sky Pro 方法参考</option><option value="cellular">原版 · 胞状体积云</option></select>
    <p id="cloud-model-note" class="environment-description">天气云顶 · 细节侵蚀 · 日月体积散射。切换保留视角、时间和参数。</p>
    <div class="environment-presets"><button id="cloud-day" title="恢复白昼默认天气和机位，暂停时间与风场">白昼对比</button><button id="cloud-night" title="加载满月、85% 云量和向月机位，暂停时间与风场">月夜对比</button></div>
    <div id="cloud-moon-control" class="control"><div class="control-label"><label for="cloud-moon-light">月光照云</label><span><output id="cloud-moon-value">1</output> ×</span></div><input id="cloud-moon-light" type="range" min="0" max="4" step="0.1" value="1"></div>
    <div class="environment-views"><button data-cloud-view="below">云下</button><button data-cloud-view="inside">云中</button><button data-cloud-view="above">云上</button><button data-cloud-view="global">全球云系</button></div>
    <div id="cloud-controls"></div>
    <label class="environment-label" for="cloud-quality">云渲染质量</label><select id="cloud-quality"><option value="low">流畅 · 节省性能</option><option value="medium" selected>均衡 · 推荐</option><option value="high">精细 · 更多细节</option></select>
    <label class="environment-label" for="cloud-seed">天气种子</label><input id="cloud-seed" type="number" min="0" max="9999" step="1" value="${cloud.parameters.seed}">
    <div class="environment-presets"><button id="cloud-pause">暂停风场</button><button id="cloud-reset">重置云层</button><button id="cloud-new-weather">更换天气</button></div>
    <p class="environment-description">风速驱动平流、云顶倾斜和形态演化；日月跟随 Cesium 时间。</p>`;
  parent.append(panel);
  for(const [id,night] of [['cloud-day',false],['cloud-night',true]] as const)
    panel.querySelector<HTMLButtonElement>(`#${id}`)!.onclick=()=>{
      cloud.reset();if(night)cloud.updateParameters({coverage:.85});cloud.setPaused(true);cloud.setEnabled(true);
      panel.querySelector<HTMLInputElement>('#cloud-enabled')!.checked=true;
      pause.textContent='继续风场';seed.value=String(cloud.parameters.seed);syncs.forEach(sync=>sync());
      onLightingPreset(night);
    };
  const model=panel.querySelector<HTMLSelectElement>('#cloud-model')!;
  model.value=cloud.mode;
  const syncModel=()=>{
    panel.querySelector('#cloud-moon-control')!.toggleAttribute('hidden',cloud.mode!=='water');
    panel.querySelector('#cloud-model-note')!.textContent=cloud.mode==='water'
      ?'天气云顶 · 细节侵蚀 · 日月体积散射。切换保留视角、时间和参数。'
      :'原版胞状云体，保留作对照。切换保留视角、时间和参数。';
    panel.querySelector('.environment-heading small')!.textContent=cloud.mode==='water'?'FX — 004':'FX — 003';
  };
  model.onchange=()=>{cloud.setMode(model.value as CloudMode);syncModel();};syncModel();
  const moon=panel.querySelector<HTMLInputElement>('#cloud-moon-light')!;
  moon.oninput=()=>{cloud.setMoonLight(Number(moon.value));panel.querySelector<HTMLOutputElement>('#cloud-moon-value')!.value=moon.value;};
  const specs:{key:keyof CloudParameters;label:string;min:number;max:number;step:number;unit:string}[]=[
    {key:'coverage',label:'云量',min:0,max:1,step:.01,unit:''},
    {key:'density',label:'云密度',min:0,max:3,step:.05,unit:'×'},
    {key:'base',label:'云底高度',min:.2,max:12,step:.1,unit:'km'},
    {key:'thickness',label:'云层厚度',min:.5,max:10,step:.1,unit:'km'},
    {key:'wind',label:'风速',min:0,max:150,step:1,unit:'m/s'},
    {key:'detail',label:'边缘细节',min:0,max:1,step:.01,unit:''},
  ];
  const syncs:(()=>void)[]=[];
  for(const spec of specs){
    const row=document.createElement('div');row.className='control';
    row.innerHTML=`<div class="control-label"><label for="cloud-${spec.key}">${spec.label}</label><span><output></output> ${spec.unit}</span></div><input id="cloud-${spec.key}" type="range" min="${spec.min}" max="${spec.max}" step="${spec.step}">`;
    const input=row.querySelector('input')!,output=row.querySelector('output')!;
    const sync=()=>{input.value=String(cloud.parameters[spec.key]);output.value=input.value;input.style.setProperty('--fill',`${(Number(input.value)-spec.min)/(spec.max-spec.min)*100}%`);};
    input.oninput=()=>{cloud.updateParameters({[spec.key]:Number(input.value)});sync();};sync();syncs.push(sync);
    panel.querySelector('#cloud-controls')!.append(row);
  }
  panel.querySelector<HTMLInputElement>('#cloud-enabled')!.onchange=e=>cloud.setEnabled((e.target as HTMLInputElement).checked);
  panel.querySelector<HTMLSelectElement>('#cloud-quality')!.onchange=e=>cloud.setQuality((e.target as HTMLSelectElement).value as CloudQuality);
  const pause=panel.querySelector<HTMLButtonElement>('#cloud-pause')!;
  pause.onclick=()=>{cloud.setPaused(!cloud.paused);pause.textContent=cloud.paused?'继续风场':'暂停风场';};
  const seed=panel.querySelector<HTMLInputElement>('#cloud-seed')!;
  seed.onchange=()=>{const value=Number(seed.value);if(Number.isFinite(value))cloud.updateParameters({seed:value});seed.value=String(cloud.parameters.seed);};
  panel.querySelector<HTMLButtonElement>('#cloud-new-weather')!.onclick=()=>{cloud.updateParameters({seed:(cloud.parameters.seed+137)%10000});seed.value=String(cloud.parameters.seed);};
  panel.querySelector<HTMLButtonElement>('#cloud-reset')!.onclick=()=>{cloud.reset();seed.value=String(cloud.parameters.seed);syncs.forEach(sync=>sync());};
  panel.querySelectorAll<HTMLButtonElement>('[data-cloud-view]').forEach(button=>button.onclick=()=>cloud.view(button.dataset.cloudView as 'below'|'inside'|'above'|'global'));
  return {destroy:()=>panel.remove()};
}
