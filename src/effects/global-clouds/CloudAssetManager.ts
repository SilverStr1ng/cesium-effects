import type {Scene} from 'cesium';
import {loadCloudAssets,destroyCloudTextures,type CloudTextures} from './CloudAssetLoader';
import type {CloudInitialization} from './CloudInitialization';
import {defaultOpticsMaterial,opticsMaterialKey,type CloudOpticsMaterial} from './CloudOptics';
import {loadCloudMaterial,type MaterialSource} from './CloudMaterialLoader';

/** One owner for a comparison's GPU assets. Models borrow these textures; only
 * this owner replaces/releases them. Standalone effects own their own manager. */
export class CloudAssetManager {
  readonly textures:Partial<CloudTextures>={};
  seed=13;
  cacheEnabled=true;
  private assetReady:Promise<void>=Promise.resolve();
  private materialReady:Promise<void>=Promise.resolve();
  get ready(){return Promise.all([this.assetReady,this.materialReady]).then(()=>{});}
  material={...defaultOpticsMaterial};
  materialMetrics:Record<string,unknown>={status:'default'};
  private desiredMaterial={...defaultOpticsMaterial};
  private materialSource?:MaterialSource;
  private materialLoad?:ReturnType<typeof loadCloudMaterial>;
  private materialEpoch=0;
  initialization:CloudInitialization={startedAt:0,generation:[],uploads:[],status:'loading'};
  private targetSeed?:number;
  private load?:ReturnType<typeof loadCloudAssets>;
  private epoch=0;
  private disposed=false;
  private listeners=new Set<()=>void>();
  constructor(private scene:Scene,private onStatus:(message:string)=>void){}
  subscribe(listener:()=>void){this.listeners.add(listener);return ()=>{this.listeners.delete(listener);};}
  request(seed:number,material:CloudOpticsMaterial=this.desiredMaterial){
    if(this.disposed)return;
    this.requestMaterial(material);
    if(seed===this.targetSeed&&(this.load||this.textures.weather))return;
    this.targetSeed=seed;this.load?.cancel();const epoch=++this.epoch;
    const metrics=this.initialization={startedAt:performance.now(),generation:[],uploads:[],status:'loading'} as CloudInitialization;
    const request=this.load=loadCloudAssets(this.scene,seed,{weatherOnly:Boolean(this.textures.noise),cache:this.cacheEnabled,metrics});
    this.assetReady=request.promise.then(async({textures,fellBack,materialSource})=>{
      if(this.disposed||epoch!==this.epoch){destroyCloudTextures(textures);return;}
      for(const [key,value] of Object.entries(textures)){
        const name=key as keyof CloudTextures,old=this.textures[name];this.textures[name]=value;
        if(old&&!old.isDestroyed())old.destroy();
      }
      this.seed=seed;metrics.status=fellBack?'fallback':'ready';
      if(materialSource){this.materialSource=materialSource;this.material={...defaultOpticsMaterial};this.requestMaterial(this.desiredMaterial);}
      for(const listener of this.listeners)listener();
      this.onStatus(fellBack?'Worker 不可用，使用程序化云':this.materialLoad?'云资源已就绪，正在更新材质':'云资源已就绪');
      await this.materialReady;
    }).catch(error=>{
      if(epoch!==this.epoch||this.disposed){metrics.status='cancelled';return;}
      metrics.status='failed';this.targetSeed=undefined;this.onStatus(`云资源上传失败：${String(error)}`);
    }).finally(()=>{metrics.readyWallMs=performance.now()-metrics.startedAt;if(epoch===this.epoch)this.load=undefined;});
  }
  private requestMaterial(material:CloudOpticsMaterial){
    material={detail:material.detail,thickness:material.thickness};
    const changed=opticsMaterialKey(material)!==opticsMaterialKey(this.desiredMaterial);
    this.desiredMaterial={...material};
    if(changed){this.materialEpoch++;this.materialLoad?.cancel();this.materialLoad=undefined;}
    if(opticsMaterialKey(material)===opticsMaterialKey(this.material)){
      if(changed){this.materialReady=Promise.resolve();this.materialMetrics={status:'ready',adopted:{...this.material},reused:true};}return;
    }
    if(!this.materialSource||this.materialLoad)return;
    const epoch=++this.materialEpoch,request=this.materialLoad=loadCloudMaterial(this.scene,this.materialSource,material,this.cacheEnabled);
    this.materialMetrics={status:'loading',requested:{...material}};
    this.onStatus('正在更新云材质');
    this.materialReady=request.promise.then(({texture,components,metrics})=>{
      if(this.disposed||epoch!==this.materialEpoch){texture.destroy();components.destroy();return;}
      const old=this.textures.optics,oldComponents=this.textures.components;this.textures.optics=texture;this.textures.components=components;this.material={...material};
      if(old&&!old.isDestroyed())old.destroy();if(oldComponents&&!oldComponents.isDestroyed())oldComponents.destroy();this.materialMetrics={...metrics,status:'ready',adopted:{...material}};
      for(const listener of this.listeners)listener();
      this.onStatus('云材质已就绪');
    }).catch(error=>{
      if(this.disposed||epoch!==this.materialEpoch)return;
      this.materialMetrics={status:'failed',error:String(error),retained:{...this.material}};
      this.onStatus(`云材质更新失败，保留已采用材质：${String(error)}`);
    }).finally(()=>{if(epoch===this.materialEpoch)this.materialLoad=undefined;});
  }
  destroy(){
    if(this.disposed)return;this.disposed=true;this.epoch++;this.load?.cancel();this.load=undefined;
    this.materialEpoch++;this.materialLoad?.cancel();this.materialLoad=undefined;this.materialSource=undefined;
    if(this.initialization.status==='loading')this.initialization.status='cancelled';
    this.listeners.clear();destroyCloudTextures(this.textures);
    for(const key of Object.keys(this.textures))delete this.textures[key as keyof CloudTextures];
  }
}
