import type { Viewer } from 'cesium';

export interface EffectContext {
  viewer: Viewer;
  onStatus: (message: string, error?: boolean) => void;
}

/** Each effect owns and disposes its workers, events, primitives and stages. */
export interface SceneEffect {
  readonly id: string;
  mount(context: EffectContext): void;
  setEnabled(enabled: boolean): void;
  setPaused(paused: boolean): void;
  reset(): void;
  focus(): void;
  destroy(): void;
}

export interface EffectDefinition {
  id: string;
  name: string;
  category: string;
  description: string;
  create: () => SceneEffect;
}
