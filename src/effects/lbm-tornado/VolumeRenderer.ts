import { Cartesian2, Cartesian3, Matrix4, PostProcessStage, PostProcessStageSampleMode, Transforms, type Viewer } from 'cesium';
import { DynamicTexture } from '../../scene/DynamicTexture';
import { location, qualities, type Quality, type SimulationFrame, type TornadoParameters } from './config';
import fragmentShader from './shaders/volume.frag.glsl?raw';

export class VolumeRenderer {
  readonly stage: PostProcessStage;
  private texture: DynamicTexture;
  private viewToLocal = new Matrix4();
  private inverseModel: Matrix4;
  private dimensions = new Cartesian3(2400, 2400, 3000);
  private removePreRender: () => void;
  private pending?: Uint8Array;
  time = 0;

  constructor(private viewer: Viewer, quality: Quality, public parameters: TornadoParameters) {
    const { nx, ny, nz, steps, scale } = qualities[quality];
    const columns = Math.ceil(Math.sqrt(nz)), rows = Math.ceil(nz/columns);
    this.texture = new DynamicTexture(viewer.scene, nx*columns, ny*rows);
    const origin = Cartesian3.fromDegrees(location.longitude, location.latitude, 8);
    this.inverseModel = Matrix4.inverseTransformation(Transforms.eastNorthUpToFixedFrame(origin), new Matrix4());
    this.stage = new PostProcessStage({
      name: 'lbm-tornado-volume', fragmentShader, textureScale: scale,
      sampleMode: PostProcessStageSampleMode.LINEAR,
      uniforms: {
        u_density: () => this.texture.texture,
        u_viewToLocal: () => this.viewToLocal,
        u_dimensions: () => this.dimensions,
        u_grid: new Cartesian3(nx,ny,nz), u_tiles: new Cartesian2(columns,rows),
        u_time: () => this.time, u_opacity: () => this.parameters.density,
        u_swirl: () => this.parameters.swirl, u_updraft: () => this.parameters.updraft,
        u_turbulence: () => this.parameters.turbulence,
        u_steps: steps,
      },
    });
    viewer.scene.postProcessStages.add(this.stage);
    this.removePreRender = viewer.scene.preRender.addEventListener(() => {
      Matrix4.multiply(this.inverseModel, viewer.camera.inverseViewMatrix, this.viewToLocal);
      this.dimensions.z = this.parameters.height;
      if (this.pending) { this.texture.update(this.pending); this.pending = undefined; }
    });
  }
  upload(frame: SimulationFrame) { this.pending = frame.density; }
  destroy() {
    this.removePreRender();
    this.viewer.scene.postProcessStages.remove(this.stage);
    this.texture.destroy();
  }
}
