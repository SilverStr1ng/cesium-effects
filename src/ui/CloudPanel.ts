import type {GlobalCloudEffect} from '../effects/global-clouds/GlobalCloudEffect';
import type {CloudParameters,CloudQuality} from '../effects/global-clouds/config';

export function mountCloudPanel(parent:HTMLElement,cloud:GlobalCloudEffect){
  const panel=document.createElement('section');panel.className='cloud-panel';
  panel.innerHTML=`<div class="environment-heading"><div><small>FX — 003</small><h2>全球体积云</h2></div><label class="switch"><input id="cloud-enabled" type="checkbox" checked aria-label="启用全球体积云"><span></span></label></div>
    <p class="environment-description">球壳天气 · 三维细节 · 可穿行云层</p>
    <div class="environment-views"><button data-cloud-view="below">云下</button><button data-cloud-view="inside">云中</button><button data-cloud-view="above">云上</button><button data-cloud-view="global">全球云系</button></div>
    <div id="cloud-controls"></div>
    <label class="environment-label" for="cloud-quality">云渲染质量</label><select id="cloud-quality"><option value="low">流畅 · 40 步 / 50%</option><option value="medium" selected>均衡 · 64 步 / 65%</option><option value="high">精细 · 96 步 / 100%</option></select>
    <div class="environment-presets"><button id="cloud-pause">暂停风场</button><button id="cloud-reset">重置云层</button></div>
    <p class="environment-description">风速按真实秒推进；太阳与月亮跟随 Cesium 时间。</p>`;
  parent.append(panel);
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
  panel.querySelector<HTMLButtonElement>('#cloud-reset')!.onclick=()=>{cloud.reset();syncs.forEach(sync=>sync());};
  panel.querySelectorAll<HTMLButtonElement>('[data-cloud-view]').forEach(button=>button.onclick=()=>cloud.view(button.dataset.cloudView as 'below'|'inside'|'above'|'global'));
  return {destroy:()=>panel.remove()};
}
