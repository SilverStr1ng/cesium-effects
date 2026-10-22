import type { AtmosphereEffect } from '../effects/hillaire-atmosphere/AtmosphereEffect';
import type { AtmosphereParameters } from '../effects/hillaire-atmosphere/atmosphereMath';

export function mountEnvironmentPanel(sidebar:HTMLElement,atmosphere:AtmosphereEffect,onExperience:(tornado:boolean)=>void){
  const panel=document.createElement('section');panel.className='environment-panel';
  panel.innerHTML=`<label class="environment-label" for="experience">观察场景</label><select id="experience"><option value="sky">全球天空</option><option value="tornado">LBM 龙卷风</option></select>
    <div class="environment-heading"><div><small>FX — 002</small><h2>Hillaire LUT 大气</h2></div><label class="switch"><input id="atmosphere-enabled" type="checkbox" checked aria-label="启用 LUT 大气"><span></span></label></div>
    <p class="environment-description">从地平线到太空的行星散射</p>
    <div class="environment-presets"><button data-sun="28">晴昼</button><button data-sun="1">日落</button><button data-sun="-18">夜晚</button></div>
    <div id="atmosphere-controls"></div>
    <div class="environment-views"><button data-sky-view="ground">地面天空</button><button data-sky-view="orbit">轨道边缘</button><button data-sky-view="space">全球视图</button></div>
    <div id="environment-extra"></div>`;
  sidebar.querySelector('.library-heading')!.after(panel);
  const specs:{key:keyof AtmosphereParameters;name:string;min:number;max:number;step:number;unit:string}[]=[
    {key:'elevation',name:'太阳高度',min:-25,max:85,step:.5,unit:'°'},
    {key:'azimuth',name:'太阳方位',min:0,max:360,step:1,unit:'°'},
    {key:'rayleigh',name:'瑞利散射',min:.2,max:3,step:.05,unit:'×'},
    {key:'mie',name:'气溶胶',min:.1,max:4,step:.05,unit:'×'},
    {key:'ozone',name:'臭氧吸收',min:0,max:2,step:.05,unit:'×'},
    {key:'exposure',name:'天空曝光',min:1,max:16,step:.2,unit:'×'},
  ];
  const controls=panel.querySelector('#atmosphere-controls')!;
  for(const spec of specs){
    const row=document.createElement('div');row.className='control';
    row.innerHTML=`<div class="control-label"><label for="sky-${spec.key}">${spec.name}</label><span><output></output> ${spec.unit}</span></div><input id="sky-${spec.key}" type="range" min="${spec.min}" max="${spec.max}" step="${spec.step}">`;
    const input=row.querySelector('input')!,output=row.querySelector('output')!;
    const sync=()=>{input.value=String(atmosphere.parameters[spec.key]);output.value=input.value;input.style.setProperty('--fill',`${(Number(input.value)-spec.min)/(spec.max-spec.min)*100}%`);};
    input.oninput=()=>{atmosphere.updateParameters({[spec.key]:Number(input.value)});sync();};sync();controls.append(row);
  }
  panel.querySelector<HTMLInputElement>('#atmosphere-enabled')!.onchange=e=>atmosphere.setEnabled((e.target as HTMLInputElement).checked);
  panel.querySelector<HTMLSelectElement>('#experience')!.onchange=e=>onExperience((e.target as HTMLSelectElement).value==='tornado');
  panel.querySelectorAll<HTMLButtonElement>('[data-sun]').forEach(button=>button.onclick=()=>{
    const input=panel.querySelector<HTMLInputElement>('#sky-elevation')!;input.value=button.dataset.sun!;input.dispatchEvent(new Event('input'));});
  panel.querySelectorAll<HTMLButtonElement>('[data-sky-view]').forEach(button=>button.onclick=()=>atmosphere.view(button.dataset.skyView as 'ground'|'orbit'|'space'));
  return {element:panel,destroy:()=>panel.remove()};
}
