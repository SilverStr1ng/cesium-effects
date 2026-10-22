import { TornadoEffect } from './lbm-tornado/TornadoEffect';
import { AtmosphereEffect } from './hillaire-atmosphere/AtmosphereEffect';
import { GlobalCloudEffect } from './global-clouds/GlobalCloudEffect';
import { WaterCloudEffect } from './water-clouds/WaterCloudEffect';
import type { EffectDefinition } from './types';

/** Add a folder under effects/ and register one definition here. */
export const effectRegistry: readonly EffectDefinition[] = [
  {
    id: 'lbm-tornado', name: 'LBM 龙卷风', category: '大气 / 流体',
    description: '格子玻尔兹曼流场驱动的三维体积龙卷风',
    create: () => new TornadoEffect(),
  },
  {id:'hillaire-atmosphere',name:'Hillaire LUT 大气',category:'行星 / 大气',description:'透射率、多重散射与天空视图 LUT',create:()=>new AtmosphereEffect()},
  {id:'water-clouds',name:'自然水云',category:'行星 / 天气',description:'天气高度场、边缘侵蚀与日月双光源体积散射',create:()=>new WaterCloudEffect()},
  {id:'global-clouds',name:'Nubis 主线体素云',category:'行星 / 天气',description:'三维体素主云、内部散射、云型剖面与独立高层卷云',create:()=>new GlobalCloudEffect()},
];
