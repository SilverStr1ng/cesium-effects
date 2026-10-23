import 'cesium/Build/Cesium/Widgets/widgets.css';
import {Cartesian3,Cartographic,Color,JulianDate,PerspectiveFrustum} from 'cesium';
import {createScene} from '../src/scene/createScene';
import {AtmosphereEffect} from '../src/effects/hillaire-atmosphere/AtmosphereEffect';
import {celestialPositions} from '../src/effects/hillaire-atmosphere/CelestialLighting';
import {prepareCelestialFrame} from './celestialFixture';

const result=document.querySelector('#result')!;
const {viewer}=await createScene(document.querySelector<HTMLElement>('#scene')!,()=>{});
const gl=(viewer.scene as unknown as {context:{_gl:WebGL2RenderingContext}}).context._gl;
viewer.resolutionScale=1;viewer.useBrowserRecommendedResolution=true;viewer.clock.shouldAnimate=false;
viewer.clock.currentTime=JulianDate.fromIso8601('2026-10-26T04:12:00Z');
const frame=()=>new Promise<void>((resolve,reject)=>{
  const removeError=viewer.scene.renderError.addEventListener((_scene,error)=>{remove();removeError();reject(error);});
  const remove=viewer.scene.postRender.addEventListener(()=>{remove();removeError();resolve();});
});
const frusta=()=> (viewer.scene as unknown as {_view:{frustumCommandsList:unknown[]}})._view.frustumCommandsList.length;
const pixel=()=>new Promise<number[]>(resolve=>{
  const remove=viewer.scene.postRender.addEventListener(()=>{const p=new Uint8Array(4);gl.readPixels(256,256,1,1,gl.RGBA,gl.UNSIGNED_BYTE,p);remove();resolve(Array.from(p));});
});
const checks:{name:string;pass:boolean;pixels?:number[];frusta?:number}[]=[];
let sky:AtmosphereEffect|undefined;
try{
  await prepareCelestialFrame(viewer.clock.currentTime);
  const formatPixels:number[]=[];
  for(const hdr of [true,false]){
    sky=new AtmosphereEffect({hdr});sky.mount({viewer,onStatus:()=>{}});await sky.ready;
    viewer.camera.setView({destination:Cartesian3.fromDegrees(-97,35,10000),orientation:{heading:0,pitch:-Math.PI/2,roll:0}});
    (viewer.camera.frustum as PerspectiveFrustum).fov=Math.PI/4;
    for(let i=0;i<120;i++){await frame();if(i>3&&viewer.scene.globe.tilesLoaded)break;}
    const groundFrusta=frusta();
    const bodies=celestialPositions(viewer.clock.currentTime),subpoint=Cartographic.fromCartesian(bodies.moon);
    const position=Cartesian3.fromRadians(subpoint.longitude,subpoint.latitude,1000000);
    viewer.camera.setView({destination:position});
    const direction=Cartesian3.normalize(Cartesian3.subtract(bodies.moon,position,new Cartesian3()),new Cartesian3());
    const right=Cartesian3.normalize(Cartesian3.cross(direction,Cartesian3.UNIT_Z,new Cartesian3()),new Cartesian3());
    Cartesian3.clone(direction,viewer.camera.direction);Cartesian3.clone(right,viewer.camera.right);Cartesian3.cross(right,direction,viewer.camera.up);
    (viewer.camera.frustum as PerspectiveFrustum).fov=Math.PI/30;
    for(let i=0;i<4;i++)await frame();
    const emptyFrusta=frusta(),moon=await pixel();
    formatPixels.push(moon[0]);
    checks.push({name:`${hdr?'RGBA16F':'RGBA8'}: ground -> empty sky disc survives stale ground depth`,pass:groundFrusta>0&&emptyFrusta===0&&moon[0]>100,pixels:moon,frusta:emptyFrusta});
    const foreground=viewer.entities.add({position:Cartesian3.add(position,Cartesian3.multiplyByScalar(direction,1000,new Cartesian3()),new Cartesian3()),
      box:{dimensions:new Cartesian3(200,200,200),material:Color.fromBytes(10,10,10)}});
    for(let i=0;i<5;i++)await frame();const occluded=await pixel();
    checks.push({name:`${hdr?'RGBA16F':'RGBA8'}: real foreground depth still occludes the Moon`,pass:frusta()>0&&occluded[0]<moon[0]*.5,pixels:occluded,frusta:frusta()});
    viewer.entities.remove(foreground);for(let i=0;i<3;i++)await frame();const restored=await pixel();
    checks.push({name:`${hdr?'RGBA16F':'RGBA8'}: removal of last opaque object restores sky visibility`,pass:frusta()===0&&Math.abs(restored[0]-moon[0])<3,pixels:restored});
    sky.destroy();sky=undefined;
  }
  checks.push({name:'same ECEF camera and texture agree across HDR / RGBA8 within 5 display levels',pass:Math.abs(formatPixels[0]-formatPixels[1])<=5,pixels:formatPixels});
  result.textContent=JSON.stringify({passed:checks.every(c=>c.pass),checks},null,2);document.title=checks.every(c=>c.pass)?'PASS · Celestial scene':'FAIL · Celestial scene';
}catch(error){result.textContent=String(error);document.title='ERROR · Celestial scene';}
finally{sky?.destroy();viewer.destroy();}
