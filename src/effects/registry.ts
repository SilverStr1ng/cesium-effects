import { TornadoEffect } from './lbm-tornado/TornadoEffect';
import { AtmosphereEffect } from './hillaire-atmosphere/AtmosphereEffect';
import type { EffectDefinition } from './types';

/** Add a folder under effects/ and register one definition here. */
export const effectRegistry: readonly EffectDefinition[] = [
  {
    id: 'lbm-tornado', name: 'LBM 龙卷风', category: '大气 / 流体',
    description: '格子玻尔兹曼流场驱动的三维体积龙卷风',
    create: () => new TornadoEffect(),
  },
  {id:'hillaire-atmosphere',name:'Hillaire LUT 大气',category:'行星 / 大气',description:'透射率、多重散射与天空视图 LUT',create:()=>new AtmosphereEffect()},
];
