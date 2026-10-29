import {writeFileSync} from 'node:fs';

/** Offline visual review of every captured keyframe, without fetching JSON. */
export function writeSequencePage(path,samples){
 writeFileSync(path,`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>Cloud path contact sheets</title>
 <style>body{margin:16px;background:#101923;color:#eef3fa;font:14px system-ui;max-width:1200px}button{padding:8px;margin:5px}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}figure{margin:0}img{width:100%}figcaption{font:12px monospace}</style>
 <h1>下降与上升：全部81关键帧</h1><p>固定世界；缩略图用于检查大轮廓，点击原图检查细节。这不是零闪烁或FPS证据。</p><nav>${Array.from({length:5},(_,i)=>`<button data-page="${i}">帧 ${i*18}–${Math.min(samples.length-1,i*18+17)}</button>`).join('')}</nav><p id="range"></p><div class="grid" id="frames"></div>
 <script>const samples=${JSON.stringify(samples.map((s,i)=>({index:i,name:s.name,camera:s.state.camera,content:s.content})))};function show(page){let selected=samples.slice(page*18,page*18+18);document.querySelector('#range').textContent='当前：'+selected[0].index+'–'+selected.at(-1).index;document.querySelector('#frames').innerHTML=selected.map(s=>'<figure><a href="release-tour-'+s.name+'.png"><img src="release-tour-'+s.name+'.png"></a><figcaption>'+s.index+' · '+s.name+' · opacity '+s.content.meanOpacity.toFixed(4)+'</figcaption></figure>').join('');}document.querySelectorAll('button').forEach(b=>b.onclick=()=>show(Number(b.dataset.page)));show(0);</script></html>`);
}
