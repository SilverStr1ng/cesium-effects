import {cloudProbe} from './cloudProbe';
import common from '../src/effects/hillaire-atmosphere/shaders/common.glsl?raw';
import density from '../src/effects/global-clouds/shaders/density.glsl?raw';
import voxel from '../src/effects/global-clouds/shaders/voxel.glsl?raw';
const gpu=cloudProbe(document.querySelector<HTMLCanvasElement>('#probe')!);
try{
 const instrumented=density.replace('if(cluster<=.001)return 0.;','if(u_fieldMode==1.)return cover;if(u_fieldMode==2.)return cluster;if(cluster<=.001)return 0.;');
 const source='uniform float u_fieldMode,u_extent;'+common+instrumented+voxel+`void main(){
   float lon=radians(-97.52),lat=radians(35.46);vec3 n=vec3(cos(lat)*cos(lon),cos(lat)*sin(lon),sin(lat)),east=vec3(-sin(lon),cos(lon),0),north=cross(n,east);
   vec2 uv=(gl_FragCoord.xy/384.-.5)*u_extent;vec3 point=normalize(n*Rg+east*uv.x+north*uv.y)*(Rg+u_base+.5);
   float v=0.;if(u_fieldMode==0.)v=textureLod(u_weather,weatherUV(point),0.).r;
   else if(u_fieldMode<3.)v=lowCloudDensity(point,.02,false);
   else{float tau=0.;for(int j=0;j<64;j++){vec3 p=normalize(point)*(Rg+u_base+(float(j)+.5)/64.*u_thickness);tau+=lowCloudDensity(p,.02,u_fieldMode==3.)*u_thickness/64.;}v=1.-exp(-tau);}
   out_FragColor=vec4(vec3(v),1);
 }`;
 const rows=[];
 for(const extent of [80,400])for(let mode=0;mode<5;mode++){
   const pixels=gpu.draw(source,384,384,{...gpu.uniforms,u_fieldMode:mode,u_extent:extent},gpu.inputs,true).pixels;
   const canvas=document.createElement('canvas');canvas.width=384;canvas.height=384;const ctx=canvas.getContext('2d')!,im=ctx.createImageData(384,384);let sum=0;
   for(let y=0;y<384;y++)for(let x=0;x<384;x++){const i=(x+y*384)*4,o=(x+(383-y)*384)*4;sum+=pixels[i];for(let c=0;c<3;c++)im.data[o+c]=pixels[i]*255;im.data[o+3]=255;}ctx.putImageData(im,0,0);
   const name=`${extent}km-${['weather','cover','cluster','body','final-opacity'][mode]}`,fig=document.createElement('figure'),img=new Image();img.src=canvas.toDataURL();img.dataset.name=name;img.alt=name;fig.append(img,document.createTextNode(name));document.querySelector('#evidence')!.append(fig);rows.push({name,mean:sum/(384*384)});
 }
 document.querySelector('#result')!.textContent=JSON.stringify({complete:true,rows,definition:'World tangent maps at -97.52/35.46 degrees; production density, 64 height samples at .02 km footprint. Body disables detail only; final-opacity = 1-exp(-tau). Not a far reference.'});
}catch(e){document.querySelector('#result')!.textContent=String(e);}finally{gpu.destroy();}
