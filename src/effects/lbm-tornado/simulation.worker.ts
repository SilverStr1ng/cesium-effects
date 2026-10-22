/// <reference lib="webworker" />
import { LbmSolver } from './LbmSolver';
import { qualities, type WorkerRequest, type SimulationFrame } from './config';

const worker = self as unknown as DedicatedWorkerGlobalScope;
let solver: LbmSolver | undefined;
worker.onmessage = ({ data }: MessageEvent<WorkerRequest>) => {
  try {
    const start = performance.now();
    if (data.type === 'init') {
      const { nx, ny, nz } = qualities[data.quality];
      solver = new LbmSolver(nx, ny, nz, data.parameters);
    } else if (data.type === 'parameters') {
      if (solver) solver.parameters = { ...data.parameters };
      return;
    } else if (solver) {
      for (let i = 0; i < Math.min(4, Math.max(1, data.steps)); i++) solver.step();
    }
    if (!solver) return;
    const density = solver.toAtlas();
    const frame: SimulationFrame = {
      type: 'frame', density, nx: solver.nx, ny: solver.ny, nz: solver.nz,
      iteration: solver.iteration, milliseconds: performance.now()-start, maxSpeed: solver.maxSpeed,
    };
    worker.postMessage(frame, [density.buffer]);
  } catch (error) {
    worker.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) });
  }
};
