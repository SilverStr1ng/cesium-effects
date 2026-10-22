import * as Cesium from 'cesium';
import type { GpuTexture } from './DynamicTexture';

interface Program { destroy(): void }
interface Command { shaderProgram: Program }
export interface ComputeFrame { commandList: Command[]; passes: { render: boolean } }
type Uniforms = Record<string, () => unknown>;

/** Fixed-size RGBA8 render targets, with all private Cesium APIs kept at this boundary.
 * Radiance LUTs use a reversible HDR encoding; no float framebuffer extension required. */
export class GpuLut {
  readonly texture: GpuTexture;
  private program: Program;
  private command: Command;
  private disposed = false;
  constructor(scene: Cesium.Scene, width: number, height: number, shader: string, uniforms: Uniforms) {
    const api = Cesium as unknown as {
      Texture: new(options: object) => GpuTexture;
      ShaderProgram: { fromCache(options: object): Program };
      ComputeCommand: new(options: object) => Command;
    };
    const context = (scene as unknown as {context: unknown}).context;
    this.texture = new api.Texture({context,width,height,flipY:false});
    this.program = api.ShaderProgram.fromCache({context,
      vertexShaderSource:'in vec4 position; in vec2 textureCoordinates; out vec2 v_textureCoordinates; void main(){gl_Position=position;v_textureCoordinates=textureCoordinates;}',
      fragmentShaderSource:shader,attributeLocations:{position:0,textureCoordinates:1},
    });
    this.command = new api.ComputeCommand({shaderProgram:this.program,outputTexture:this.texture,
      uniformMap:uniforms,persists:true,owner:this});
  }
  enqueue(frame: ComputeFrame) { if(!this.disposed) frame.commandList.push(this.command); }
  destroy() {
    if(this.disposed)return;
    this.disposed=true;
    this.program.destroy();
    if(!this.texture.isDestroyed())this.texture.destroy();
  }
}
