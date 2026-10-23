import type {Scene} from 'cesium';
import {createMippedAlbedoTexture,type GpuTexture} from '../../scene/DynamicTexture';
import {linearLunarAlbedo} from './lunarAlbedoMath';
import moonUrl from './assets/lroc_color_2k.jpg?url';

/** Owned by one atmosphere. Abort/close pending work on unmount; a neutral
 * relative-albedo texel keeps the sky usable if the bundled asset cannot load. */
export class LunarAlbedo {
  texture:GpuTexture;
  mean=128/255;
  info={loaded:false,width:1,height:1,gpuBytes:4,loadMs:0,error:''};
  readonly ready:Promise<void>;
  private disposed=false;
  private abort=new AbortController();
  constructor(private scene:Scene){
    this.texture=createMippedAlbedoTexture(scene,1,1,new Uint8Array([128,128,128,255]));
    this.ready=this.load();
  }
  private async load(){
    const start=performance.now();let image:ImageBitmap|undefined;
    try{
      const response=await fetch(moonUrl,{signal:this.abort.signal});
      if(!response.ok)throw new Error(`Moon albedo HTTP ${response.status}`);
      image=await createImageBitmap(await response.blob(),{colorSpaceConversion:'none',premultiplyAlpha:'none'});
      if(this.disposed)return;
      const {width,height}=image,canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
      const ctx=canvas.getContext('2d',{willReadFrequently:true})!;ctx.drawImage(image,0,0);
      const {bytes,mean}=linearLunarAlbedo(ctx.getImageData(0,0,width,height).data,width,height);
      const texture=createMippedAlbedoTexture(this.scene,width,height,bytes);
      this.texture.destroy();this.texture=texture;this.mean=mean;
      let gpuBytes=0;
      for(let w=width,h=height;;w=Math.max(1,w>>1),h=Math.max(1,h>>1)){gpuBytes+=w*h*4;if(w===1&&h===1)break;}
      this.info={loaded:true,width,height,gpuBytes,loadMs:performance.now()-start,error:''};
    }catch(error){if(!this.disposed)this.info.error=String(error);}
    finally{image?.close();}
  }
  destroy(){if(this.disposed)return;this.disposed=true;this.abort.abort();this.texture.destroy();}
}
