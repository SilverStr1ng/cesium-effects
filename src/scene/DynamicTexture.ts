import * as Cesium from 'cesium';

interface TextureSource { width: number; height: number; arrayBufferView: Uint8Array }
interface GpuTexture {
  copyFrom(options: { source: TextureSource }): void;
  destroy(): void;
  isDestroyed(): boolean;
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
