import { BoundingSphere, Cartesian3, HeadingPitchRange, Math as CesiumMath, Matrix4 } from 'cesium';
import type { EffectContext, SceneEffect } from '../types';
import { defaults, location, type Quality, type SimulationFrame, type TornadoParameters, type WorkerRequest } from './config';
import { VolumeRenderer } from './VolumeRenderer';

export class TornadoEffect implements SceneEffect {
  readonly id = 'lbm-tornado';
  parameters = { ...defaults };
  quality: Quality = 'medium';
  enabled = true;
  paused = false;
  orbit = false;
  statistics = { iteration: 0, milliseconds: 0, maxSpeed: 0 };
  private context?: EffectContext;
  private renderer?: VolumeRenderer;
  private worker?: Worker;
  private busy = false;
  private removeTick?: () => void;
  private last = 0;
  private sinceStep = 0;

  mount(context: EffectContext) {
    this.context = context;
    this.startSimulation();
    this.last = performance.now();
    this.removeTick = context.viewer.scene.preUpdate.addEventListener(() => {
      const now = performance.now(), dt = Math.min((now-this.last)/1000,.1);
      this.last = now;
      if (!this.enabled || this.paused || document.hidden) return;
      if (this.renderer) this.renderer.time += dt * this.parameters.speed;
      this.sinceStep += dt * this.parameters.speed;
      if (!this.busy && this.sinceStep >= 1/24) {
        this.busy = true;
        this.send({ type: 'step', steps: Math.min(3, Math.max(1, Math.floor(this.sinceStep*24))) });
        this.sinceStep = 0;
      }
      if (this.orbit) context.viewer.camera.rotateRight(dt*.045);
    });
  }
  private send(message: WorkerRequest) { this.worker?.postMessage(message); }
  private startSimulation() {
    if (!this.context) return;
    this.worker?.terminate();
    this.renderer?.destroy();
    this.renderer = new VolumeRenderer(this.context.viewer, this.quality, this.parameters);
    this.renderer.stage.enabled = this.enabled;
    this.busy = true;
    this.statistics = { iteration: 0, milliseconds: 0, maxSpeed: 0 };
    this.context.onStatus('正在初始化三维流场…');
    this.worker = new Worker(new URL('./simulation.worker.ts', import.meta.url), { type: 'module' });
    this.worker.onerror = () => this.fail('流体计算线程异常，请重置模拟。');
    this.worker.onmessage = ({ data }: MessageEvent<SimulationFrame | { type: 'error'; message: string }>) => {
      this.busy = false;
      if (data.type === 'error') { this.fail(data.message); return; }
      this.renderer?.upload(data);
      this.statistics = { iteration: data.iteration, milliseconds: data.milliseconds, maxSpeed: data.maxSpeed };
      if (data.iteration === 0) this.context?.onStatus(this.paused ? '模拟已暂停' : '三维流场已就绪');
    };
    this.send({ type: 'init', quality: this.quality, parameters: this.parameters });
  }
  private fail(message: string) {
    this.paused = true;
    this.context?.onStatus(message, true);
  }
  updateParameters(values: Partial<TornadoParameters>) {
    Object.assign(this.parameters, values);
    this.send({ type: 'parameters', parameters: this.parameters });
  }
  setQuality(quality: Quality) {
    if (quality === this.quality) return;
    this.quality = quality;
    this.startSimulation();
  }
  setEnabled(enabled: boolean) {
    this.enabled = enabled;
    if (this.renderer) this.renderer.stage.enabled = enabled;
  }
  setPaused(paused: boolean) { this.paused = paused; }
  reset() { this.sinceStep = 0; this.startSimulation(); }
  focus() {
    if (!this.context) return;
    this.orbit = false;
    const target = Cartesian3.fromDegrees(location.longitude, location.latitude, this.parameters.height*.44);
    this.context.viewer.camera.lookAtTransform(Matrix4.IDENTITY);
    this.context.viewer.camera.flyToBoundingSphere(new BoundingSphere(target, this.parameters.height*.55), {
      duration: 1.3,
      offset: new HeadingPitchRange(CesiumMath.toRadians(8), CesiumMath.toRadians(-12), this.parameters.height*2.2),
    });
  }
  setOrbit(enabled: boolean) {
    this.orbit = enabled;
    if (!this.context) return;
    const camera = this.context.viewer.camera;
    if (enabled) {
      camera.lookAt(Cartesian3.fromDegrees(location.longitude, location.latitude, this.parameters.height*.44),
        new HeadingPitchRange(camera.heading, CesiumMath.toRadians(-12), this.parameters.height*2.2));
    } else camera.lookAtTransform(Matrix4.IDENTITY);
  }
  destroy() {
    this.removeTick?.(); this.worker?.terminate(); this.renderer?.destroy();
    this.context = undefined; this.worker = undefined; this.renderer = undefined;
  }
}
