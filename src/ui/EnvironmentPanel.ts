import type { AtmosphereEffect } from '../effects/hillaire-atmosphere/AtmosphereEffect';
import type { AtmosphereParameters } from '../effects/hillaire-atmosphere/atmosphereMath';
import {JulianDate,type Viewer} from 'cesium';
import {celestialSizePresets,lunarPhasePresets} from '../effects/hillaire-atmosphere/celestialPresets';

export function mountEnvironmentPanel(sidebar:HTMLElement,atmosphere:AtmosphereEffect,onExperience:(tornado:boolean)=>void,viewer:Viewer){
  const panel=document.createElement('section');panel.className='environment-panel';
  panel.innerHTML=`<label class="environment-label" for="experience">观察场景</label><select id="experience"><option value="sky">全球天空</option><option value="tornado">LBM 龙卷风</option></select>
    <div class="environment-heading"><div><small>FX — 002</small><h2>Hillaire LUT 大气</h2></div><label class="switch"><input id="atmosphere-enabled" type="checkbox" checked aria-label="启用 LUT 大气"><span></span></label></div>
    <p class="environment-description">从地平线到太空的行星散射</p>
    <label class="clock-link"><input id="clock-linked" type="checkbox" checked> 跟随 Cesium 时间</label>
    <label class="environment-label" for="sky-time">Cesium 时间 · UTC</label><input id="sky-time" type="datetime-local" step="60">
    <div class="environment-presets"><button id="clock-play">播放时间</button><select id="clock-speed" aria-label="时间倍率"><option value="60">60×</option><option value="600" selected>600×</option><option value="3600">3600×</option></select><button id="sun-view">观察太阳</button><button id="moon-view">观察月亮</button></div>
    <p id="clock-state" class="environment-description" role="status"></p>
    <div class="environment-presets"><button data-date-step="-24">−1 天</button><button data-date-step="-1">−1 小时</button><button data-date-step="1">+1 小时</button><button data-date-step="24">+1 天</button></div>
    <div class="environment-presets" aria-label="2026 年四相 · UTC 星历预设">${Object.entries(lunarPhasePresets).map(([key,p])=>`<button data-moon-phase="${key}" title="${p.utc} · 切换星历并暂停">${p.label}</button>`).join('')}</div>
    <p id="lunar-phase" class="environment-description"></p>
    <label class="environment-label" for="celestial-size">日月盘径</label><select id="celestial-size">${Object.entries(celestialSizePresets).map(([key,p])=>`<option value="${key}">${p.label}</option>`).join('')}<option value="custom">自定义盘径</option></select>
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
    {key:'sunBrightness',name:'日盘亮度',min:0,max:3,step:.1,unit:'×'},
    {key:'moonBrightness',name:'月面亮度',min:.2,max:6,step:.1,unit:'×'},
    {key:'sunHaloScale',name:'日晕范围',min:.5,max:8,step:.1,unit:'×'},
    {key:'sunHaloBrightness',name:'日晕亮度',min:0,max:3,step:.1,unit:'×'},
    {key:'moonHaloScale',name:'艺术月晕范围',min:.5,max:8,step:.1,unit:'×'},
    {key:'moonHaloBrightness',name:'艺术月晕亮度',min:0,max:3,step:.1,unit:'×'},
  ];
  const controls=panel.querySelector('#atmosphere-controls')!;
  const syncControls:(()=>void)[]=[];
  for(const spec of specs){
    const row=document.createElement('div');row.className='control';
    row.innerHTML=`<div class="control-label"><label for="sky-${spec.key}">${spec.name}</label><span><output></output> ${spec.unit}</span></div><input id="sky-${spec.key}" type="range" min="${spec.min}" max="${spec.max}" step="${spec.step}">`;
    const input=row.querySelector('input')!,output=row.querySelector('output')!;
    const sync=()=>{input.value=String(atmosphere.parameters[spec.key]);output.value=input.value;input.style.setProperty('--fill',`${(Number(input.value)-spec.min)/(spec.max-spec.min)*100}%`);};
    input.oninput=()=>{atmosphere.updateParameters({[spec.key]:Number(input.value)});syncAll();};sync();syncControls.push(sync);controls.append(row);
  }
  panel.querySelector<HTMLInputElement>('#atmosphere-enabled')!.onchange=e=>atmosphere.setEnabled((e.target as HTMLInputElement).checked);
  panel.querySelector<HTMLSelectElement>('#experience')!.onchange=e=>onExperience((e.target as HTMLSelectElement).value==='tornado');
  const linked=panel.querySelector<HTMLInputElement>('#clock-linked')!;
  const date=panel.querySelector<HTMLInputElement>('#sky-time')!;
  const clockButton=panel.querySelector<HTMLButtonElement>('#clock-play')!;
  const size=panel.querySelector<HTMLSelectElement>('#celestial-size')!;
  viewer.clock.multiplier=600;
  const syncAll=()=>{
    linked.checked=atmosphere.clockLinked;
    for(const key of ['elevation','azimuth'])panel.querySelector<HTMLInputElement>(`#sky-${key}`)!.disabled=linked.checked;
    if(document.activeElement!==date)date.value=JulianDate.toIso8601(viewer.clock.currentTime).slice(0,16);
    const playing=viewer.clock.shouldAnimate;
    clockButton.textContent=playing?'暂停时间':'播放时间';clockButton.setAttribute('aria-pressed',String(playing));
    panel.querySelector('#clock-state')!.textContent=`${playing?'播放中':'已暂停'} · ${viewer.clock.multiplier}× · ${linked.checked?'星历模式':'手动太阳，月球位置仍随 UTC'}`;
    panel.querySelector('#lunar-phase')!.textContent=`${linked.checked?'当前观察点月相':'手动太阳下的模拟月相'} · 月面照明 ${(atmosphere.moonFraction*100).toFixed(1)}% · 1× 为真实视直径`;
    size.value=Object.entries(celestialSizePresets).find(([,p])=>p.sunScale===atmosphere.parameters.sunScale&&p.moonScale===atmosphere.parameters.moonScale)?.[0]??'custom';
    for(const sync of syncControls)sync();
  };
  const setTime=(iso:string,link=true)=>{
    viewer.clock.currentTime=JulianDate.fromIso8601(iso);viewer.clock.shouldAnimate=false;
    atmosphere.setClockLinked(link?true:atmosphere.clockLinked);date.value=iso.slice(0,16);syncAll();
  };
  linked.onchange=()=>{atmosphere.setClockLinked(linked.checked);syncAll();};
  date.onchange=()=>{if(date.value&&date.validity.valid)setTime(`${date.value.length===16?date.value+':00':date.value}Z`,false);};
  clockButton.onclick=()=>{viewer.clock.shouldAnimate=!viewer.clock.shouldAnimate;syncAll();};
  panel.querySelector<HTMLSelectElement>('#clock-speed')!.onchange=e=>{viewer.clock.multiplier=Number((e.target as HTMLSelectElement).value);syncAll();};
  panel.querySelectorAll<HTMLButtonElement>('[data-date-step]').forEach(button=>button.onclick=()=>{
    setTime(JulianDate.toIso8601(JulianDate.addHours(viewer.clock.currentTime,Number(button.dataset.dateStep),new JulianDate())),false);
  });
  panel.querySelectorAll<HTMLButtonElement>('[data-moon-phase]').forEach(button=>button.onclick=()=>setTime(lunarPhasePresets[button.dataset.moonPhase as keyof typeof lunarPhasePresets].utc));
  size.onchange=()=>{const preset=celestialSizePresets[size.value as keyof typeof celestialSizePresets];if(preset)atmosphere.updateParameters({sunScale:preset.sunScale,moonScale:preset.moonScale});syncAll();};
  panel.querySelector<HTMLButtonElement>('#moon-view')!.onclick=()=>atmosphere.focusMoon();
  panel.querySelector<HTMLButtonElement>('#sun-view')!.onclick=()=>atmosphere.focusSun();
  let last=0;
  const removeTick=viewer.scene.postRender.addEventListener(()=>{
    const now=performance.now();if(now-last<500)return;last=now;
    syncAll();
  });
  panel.querySelectorAll<HTMLButtonElement>('[data-sun]').forEach(button=>button.onclick=()=>{
    atmosphere.setClockLinked(false);atmosphere.updateParameters({elevation:Number(button.dataset.sun)});syncAll();});
  panel.querySelectorAll<HTMLButtonElement>('[data-sky-view]').forEach(button=>button.onclick=()=>atmosphere.view(button.dataset.skyView as 'ground'|'orbit'|'space'));
  syncAll();
  return {element:panel,setTime,destroy:()=>{removeTick();panel.remove();}};
}
