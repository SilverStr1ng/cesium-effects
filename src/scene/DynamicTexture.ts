import * as Cesium from 'cesium';

interface TextureSource { width: number; height: number; arrayBufferView: Uint8Array }
export interface GpuTexture {
  copyFrom(options: { source: TextureSource }): void;
  destroy(): void;
  isDestroyed(): boolean;
}

/** WebGL2 hardware trilinear, repeat-wrapped noise volume (four channels). */
export function createRepeatingVolume(scene: Cesium.Scene, size: number, bytes: Uint8Array): GpuTexture {
  const api=Cesium as unknown as {
    Texture3D:new(options:object)=>GpuTexture;
    Sampler:new(options:object)=>unknown;
    TextureWrap:{REPEAT:number};
  };
  const {context}=scene as unknown as {context:unknown};
  return new api.Texture3D({context,flipY:false,
    source:{width:size,height:size,depth:size,arrayBufferView:bytes},
    sampler:new api.Sampler({wrapS:api.TextureWrap.REPEAT,wrapT:api.TextureWrap.REPEAT,wrapR:api.TextureWrap.REPEAT}),
  });
}
interface TextureConstructor {
  new(options: { context: unknown; source: TextureSource; flipY: boolean }): GpuTexture;
}

/**
 * The only Cesium internal API boundary. Texture is exported at runtime, but
 * marked private and omitted from Cesium.d.ts. Pinned/tested with 1.146.0.
 * Keeping it here makes future Cesium upgrades easy to audit.
 */
export class DynamicTexture {
  readonly texture: GpuTexture;
  constructor(scene: Cesium.Scene, readonly width: number, readonly height: number) {
    const { Texture } = Cesium as unknown as { Texture: TextureConstructor };
    const { context } = scene as unknown as { context: { depthTexture: boolean } };
    if (!context.depthTexture) throw new Error('当前设备不支持深度纹理，无法进行体积渲染。');
    this.texture = new Texture({
      context, flipY: false,
      source: { width, height, arrayBufferView: new Uint8Array(width*height*4) },
    });
  }
  update(bytes: Uint8Array) {
    this.texture.copyFrom({ source: { width: this.width, height: this.height, arrayBufferView: bytes } });
  }
  destroy() {
    if (!this.texture.isDestroyed()) this.texture.destroy();
  }
}
