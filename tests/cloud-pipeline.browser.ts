import 'cesium/Build/Cesium/Widgets/widgets.css';
import {Cartesian3,PixelDatatype,PostProcessStage,PostProcessStageComposite} from 'cesium';
import {createScene} from '../src/scene/createScene';
import {GlobalCloudEffect} from '../src/effects/global-clouds/GlobalCloudEffect';
import common from '../src/effects/hillaire-atmosphere/shaders/common.glsl?raw';
import display from '../src/scene/display.glsl?raw';

const output=document.querySelector('#result')!;
const {viewer}=await createScene(document.querySelector<HTMLElement>('#scene')!,()=>{});
const gl=(viewer.scene as unknown as {context:{_gl:WebGL2RenderingContext}}).context._gl;
viewer.resolutionScale=1;viewer.clock.shouldAnimate=false;
const frames=()=>new Promise<void>((resolve,reject)=>{
  let count=0;const removeError=viewer.scene.renderError.addEventListener((_scene:unknown,error:unknown)=>{remove();removeError();reject(error);});
  const remove=viewer.scene.postRender.addEventListener(()=>{if(++count===10){remove();removeError();resolve();}});
});
const pixels=()=>new Promise<Uint8Array>(resolve=>{const remove=viewer.scene.postRender.addEventListener(()=>{
  const data=new Uint8Array(gl.drawingBufferWidth*gl.drawingBufferHeight*4);gl.readPixels(0,0,gl.drawingBufferWidth,gl.drawingBufferHeight,gl.RGBA,gl.UNSIGNED_BYTE,data);remove();resolve(data);
});});
const checks:{name:string;pass:boolean;maximumByteError:number;distinctAttachments:boolean}[]=[];
let clouds:GlobalCloudEffect|undefined,background:PostProcessStageComposite|undefined;
try{
  for(const hdr of [true,false]){
    const radiance=new PostProcessStage({name:'probe-radiance',pixelDatatype:hdr?PixelDatatype.HALF_FLOAT:PixelDatatype.UNSIGNED_BYTE,
      fragmentShader:common+'void main(){vec3 L=vec3(.2,.4,.7);out_FragColor=vec4('+(hdr?'L':'encodeL(L)')+',1);}'});
    const shown=new PostProcessStage({name:'probe-display',fragmentShader:common+display+
      'uniform sampler2D colorTexture;in vec2 v_textureCoordinates;void main(){vec3 L=texture(colorTexture,v_textureCoordinates).rgb;out_FragColor=vec4(displayRadiance('+(hdr?'L':'decodeL(L)')+',8.),1);}'});
    background=new PostProcessStageComposite({name:'probe-background',stages:[radiance,shown]});viewer.scene.postProcessStages.add(background);
    await frames();const reference=await pixels();
    // Empty medium isolates composition/allocation, while using the actual
    // GlobalCloudEffect stage construction and resolve shader at every scale.
    clouds=new GlobalCloudEffect({sunDirection:()=>Cartesian3.UNIT_Z,moonDirection:()=>Cartesian3.UNIT_Z,moonFraction:()=>0,
      transmittance:()=>undefined,atmosphereEnabled:()=>true,backgroundStage:radiance.name,backgroundIsHdr:()=>hdr},
      {id:'pipeline-clouds',density:'uniform float u_base,u_thickness;float cloudDensity(vec3 p,float f,bool coarse){return 0.;}',
        lighting:'CloudPhases scatteringPhases(vec3 d){return CloudPhases(vec3(0),vec3(0));}vec3 illumination(vec3 p,float rho,float f,CloudPhases phases){return vec3(0);}'});
    clouds.mount({viewer,onStatus:()=>{}});clouds.setPaused(true);clouds.setHdrEnabled(hdr);await clouds.ready;
    for(const quality of ['low','medium','high','medium'] as const){
      clouds.setQuality(quality);await frames();const actual=await pixels();
      let maximumByteError=0;for(let i=0;i<actual.length;i++)maximumByteError=Math.max(maximumByteError,Math.abs(actual[i]-reference[i]));
      // Test-only adapter to the pinned Cesium 1.146 texture-cache interface.
      const stages=viewer.scene.postProcessStages as unknown as {getStageByName(name:string):{outputTexture:unknown}};
      const distinctAttachments=stages.getStageByName('pipeline-clouds-volume').outputTexture!==stages.getStageByName(radiance.name).outputTexture;
      checks.push({name:`${hdr?'RGBA16F':'RGBA8'} ${quality}: empty clouds preserve the HDR producer through resolve`,pass:maximumByteError<=1&&distinctAttachments,maximumByteError,distinctAttachments});
    }
    clouds.destroy();clouds=undefined;viewer.scene.postProcessStages.remove(background);background=undefined;
  }
  output.textContent=JSON.stringify({passed:checks.every(c=>c.pass),checks},null,2);document.title=checks.every(c=>c.pass)?'PASS · Cloud pipeline':'FAIL · Cloud pipeline';
}catch(error){output.textContent=String(error);document.title='ERROR · Cloud pipeline';}
finally{clouds?.destroy();if(background)viewer.scene.postProcessStages.remove(background);viewer.destroy();}
