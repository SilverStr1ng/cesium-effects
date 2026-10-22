import {GlobalCloudEffect,type CloudLighting,type CloudDebugView} from '../global-clouds/GlobalCloudEffect';
import {WaterCloudEffect} from './WaterCloudEffect';
import type {CloudParameters,CloudQuality,CloudView} from '../global-clouds/config';
import type {EffectContext} from '../types';

export type CloudMode='cellular'|'water';
/** Keeps A/B settings and motion aligned. Only the selected stage renders. */
export class CloudComparison {
  private effects:Record<CloudMode,GlobalCloudEffect>;
  mode:CloudMode='cellular';
  enabled=true;
  constructor(light?:CloudLighting){this.effects={cellular:new GlobalCloudEffect(light),water:new WaterCloudEffect(light)};}
  private get active(){return this.effects[this.mode];}
  get parameters(){return this.active.parameters;}
  get quality(){return this.active.quality;}
  get paused(){return this.active.paused;}
  get moonLight(){return this.active.moonLight;}
  mount(context:EffectContext){
    for(const [mode,effect] of Object.entries(this.effects)){effect.setEnabled(this.enabled&&mode===this.mode);effect.mount(context);}
  }
  setMode(mode:CloudMode){
    if(mode===this.mode)return;
    this.effects[mode].setMotion(this.active.motion);
    this.active.setEnabled(false);this.mode=mode;this.active.setEnabled(this.enabled);
  }
  updateParameters(parameters:Partial<CloudParameters>){for(const effect of Object.values(this.effects))effect.updateParameters(parameters);}
  setQuality(quality:CloudQuality){for(const effect of Object.values(this.effects))effect.setQuality(quality);}
  setDebugView(value:CloudDebugView){this.effects.cellular.setDebugView(value);}
  setEnabled(value:boolean){this.enabled=value;for(const [mode,effect] of Object.entries(this.effects))effect.setEnabled(value&&mode===this.mode);}
  setPaused(value:boolean){for(const effect of Object.values(this.effects))effect.setPaused(value);}
  setMoonLight(value:number){for(const effect of Object.values(this.effects))effect.moonLight=Math.max(0,Math.min(4,value));}
  reset(){for(const effect of Object.values(this.effects))effect.reset();}
  view(mode:CloudView){this.active.view(mode);}
  destroy(){for(const effect of Object.values(this.effects))effect.destroy();}
}
