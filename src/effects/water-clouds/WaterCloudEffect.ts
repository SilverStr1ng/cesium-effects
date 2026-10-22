import {GlobalCloudEffect,type CloudLighting} from '../global-clouds/GlobalCloudEffect';
import density from './shaders/density.glsl?raw';
import lighting from './shaders/lighting.glsl?raw';

/** Height-field water clouds with separate solar and lunar volume transport. */
export class WaterCloudEffect extends GlobalCloudEffect {
  constructor(light?:CloudLighting){super(light,{id:'water-clouds',density,lighting,defines:'#define WATER_CLOUDS\n'});}
}
