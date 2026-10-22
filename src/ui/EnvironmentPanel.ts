import type { AtmosphereEffect } from '../effects/hillaire-atmosphere/AtmosphereEffect';
import type { AtmosphereParameters } from '../effects/hillaire-atmosphere/atmosphereMath';
import {JulianDate,type Viewer} from 'cesium';

export function mountEnvironmentPanel(sidebar:HTMLElement,atmosphere:AtmosphereEffect,onExperience:(tornado:boolean)=>void,viewer:Viewer){
  const panel=document.createElement('section');panel.className='environment-panel';
  panel.innerHTML=`<label class="environment-label" for="experience">观察场景</label><select id="experience"><option value="sky">全球天空</option><option value="tornado">LBM 龙卷风</option></select>
    <div class="environment-heading"><div><small>FX — 002</small><h2>Hillaire LUT 大气</h2></div><label class="switch"><input id="atmosphere-enabled" type="checkbox" checked aria-label="启用 LUT 大气"><span></span></label></div>
    <p class="environment-description">从地平线到太空的行星散射</p>
    <label class="clock-link"><input id="clock-linked" type="checkbox" checked> 跟随 Cesium 时间</label>
    <label class="environment-label" for="sky-time">Cesium 时间 · UTC</label><input id="sky-time" type="datetime-local" step="60">
    <div class="environment-presets"><button id="clock-play">播放时间</button><select id="clock-speed" aria-label="时间倍率"><option value="60">60×</option><option value="600" selected>600×</option><option value="3600">3600×</option></select><button id="moon-view">观察月亮</button></div>
    <p id="lunar-phase" class="environment-description"></p>
    <div class="environment-presets"><button data-sun="28">晴昼</button><button data-sun="1">日落</button><button data-sun="-18">夜晚</button></div>
    <details class="environment-details"><summary>散射与日月参数</summary><div id="atmosphere-controls"></div></details>
    <div class="environment-views"><button data-sky-view="ground">地面天空</button><button data-sky-view="orbit">轨道边缘</button><button data-sky-view="space">全球视图</button></div>
    <div id="environment-extra"></div>`;
  sidebar.querySelector('.library-heading')!.after(panel);
  const specs:{key:keyof AtmosphereParameters;name:string;min:number;max:number;step:number;unit:string}[]=[
    {key:'elevation',name:'太阳高度',min:-90,max:90,step:.5,unit:'°'},
    {key:'azimuth',name:'太阳方位',min:0,max:360,step:1,unit:'°'},
    {key:'rayleigh',name:'瑞利散射',min:.2,max:3,step:.05,unit:'×'},
    {key:'mie',name:'气溶胶',min:.1,max:4,step:.05,unit:'×'},
    {key:'ozone',name:'臭氧吸收',min:0,max:2,step:.05,unit:'×'},
    {key:'exposure',name:'天空曝光',min:1,max:16,step:.2,unit:'×'},
    {key:'sunScale',name:'太阳视大小',min:1,max:4,step:.1,unit:'×'},
    {key:'moonScale',name:'月亮视大小',min:1,max:4,step:.1,unit:'×'},
    {key:'moonBrightness',name:'月面亮度',min:.2,max:6,step:.1,unit:'×'},
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
  const linked=panel.querySelector<HTMLInputElement>('#clock-linked')!;
  const syncMode=()=>{atmosphere.setClockLinked(linked.checked);for(const key of ['elevation','azimuth'])panel.querySelector<HTMLInputElement>(`#sky-${key}`)!.disabled=linked.checked;};
  linked.onchange=syncMode;syncMode();
  const date=panel.querySelector<HTMLInputElement>('#sky-time')!;
  date.value=JulianDate.toIso8601(viewer.clock.currentTime).slice(0,16);
  date.onchange=()=>{if(date.value){viewer.clock.currentTime=JulianDate.fromIso8601(`${date.value}:00Z`);linked.checked=true;syncMode();}};
  date.oninput=date.onchange;
  const clockButton=panel.querySelector<HTMLButtonElement>('#clock-play')!;
  viewer.clock.multiplier=600;
  clockButton.onclick=()=>{viewer.clock.shouldAnimate=!viewer.clock.shouldAnimate;clockButton.textContent=viewer.clock.shouldAnimate?'暂停时间':'播放时间';};
  panel.querySelector<HTMLSelectElement>('#clock-speed')!.onchange=e=>{viewer.clock.multiplier=Number((e.target as HTMLSelectElement).value);};
  panel.querySelector<HTMLButtonElement>('#moon-view')!.onclick=()=>atmosphere.focusMoon();
  let last=0;
  const removeTick=viewer.scene.postRender.addEventListener(()=>{
    const now=performance.now();if(now-last<500)return;last=now;
    if(document.activeElement!==date)date.value=JulianDate.toIso8601(viewer.clock.currentTime).slice(0,16);
    panel.querySelector('#lunar-phase')!.textContent=`月面照明 ${(atmosphere.moonFraction*100).toFixed(0)}% · 日月大小 1× 为真实视直径`;
    if(linked.checked)for(const key of ['elevation','azimuth'] as const){const input=panel.querySelector<HTMLInputElement>(`#sky-${key}`)!;input.value=String(atmosphere.parameters[key]);input.previousElementSibling!.querySelector('output')!.value=atmosphere.parameters[key].toFixed(1);}
    clockButton.textContent=viewer.clock.shouldAnimate?'暂停时间':'播放时间';
  });
  panel.querySelectorAll<HTMLButtonElement>('[data-sun]').forEach(button=>button.onclick=()=>{
    linked.checked=false;syncMode();
    const input=panel.querySelector<HTMLInputElement>('#sky-elevation')!;input.value=button.dataset.sun!;input.dispatchEvent(new Event('input'));});
  panel.querySelectorAll<HTMLButtonElement>('[data-sky-view]').forEach(button=>button.onclick=()=>atmosphere.view(button.dataset.skyView as 'ground'|'orbit'|'space'));
  return {element:panel,setTime:(iso:string)=>{
    viewer.clock.currentTime=JulianDate.fromIso8601(iso);viewer.clock.shouldAnimate=false;
    date.value=iso.slice(0,16);linked.checked=true;syncMode();
  },destroy:()=>{removeTick();panel.remove();}};
}
