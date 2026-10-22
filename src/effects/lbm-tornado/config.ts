export interface TornadoParameters {
  swirl: number;
  updraft: number;
  turbulence: number;
  density: number;
  radius: number;
  height: number;
  speed: number;
}

export const defaults: TornadoParameters = {
  swirl: 1.15, updraft: 1, turbulence: 0.55,
  density: 1.25, radius: 1, height: 3000, speed: 1,
};

export type Quality = 'low' | 'medium' | 'high';
export const qualities = {
  low: { nx: 24, ny: 24, nz: 40, steps: 64, scale: 0.65, label: '流畅' },
  medium: { nx: 32, ny: 32, nz: 52, steps: 96, scale: 0.8, label: '均衡' },
  high: { nx: 40, ny: 40, nz: 64, steps: 144, scale: 1, label: '精细' },
} as const;

export const location = { longitude: -97.52, latitude: 35.46 };

export type WorkerRequest =
  | { type: 'init'; quality: Quality; parameters: TornadoParameters }
  | { type: 'step'; steps: number }
  | { type: 'parameters'; parameters: TornadoParameters };

export interface SimulationFrame {
  type: 'frame';
  density: Uint8Array;
  nx: number; ny: number; nz: number;
  iteration: number;
  milliseconds: number;
  maxSpeed: number;
}
