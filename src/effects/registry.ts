import { TornadoEffect } from './lbm-tornado/TornadoEffect';
import type { EffectDefinition } from './types';

/** Add a folder under effects/ and register one definition here. */
export const effectRegistry: readonly EffectDefinition[] = [
  {
    id: 'lbm-tornado', name: 'LBM 龙卷风', category: '大气 / 流体',
    description: '格子玻尔兹曼流场驱动的三维体积龙卷风',
    create: () => new TornadoEffect(),
  },
];
