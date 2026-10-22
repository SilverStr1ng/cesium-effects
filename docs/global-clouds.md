# 全球尺度体积云

独立 effect：`src/effects/global-clouds/GlobalCloudEffect.ts`，注册 ID `global-clouds`。与 `hillaire-atmosphere` 分开管理；可以独立挂载，也可通过 `CloudLighting` 接口共享太阳、月亮和大气透射率纹理。

## 方案选择

| 参考 | 采用的思路 | 本项目的取舍 |
| --- | --- | --- |
| Three.js Sky Pro v2.2.1 的 clouds API / performance 文档 | 天气覆盖、分层形状/侵蚀噪声、风场、低分辨率体积渲染 | 商业 ZIP 仅用于阅读许可和功能文档；没有移植源码、着色器或素材。所有天气/噪声均独立生成。 |
| [Nubis³, SIGGRAPH 2023](https://www.guerrilla-games.com/read/nubis-cubed) | 可穿行体积、近场阴影细节加缓存远场光照、内部散射与边缘亮度 | 全球尺度使用球壳天气场，避免密集地球体素占用；缓存光照是本项目的低成本近似。没有复制 Nubis 的 BC6 体素资产、压缩 SDF 或创作管线。 |
| [Advances in Real-Time Rendering 2023](https://www.advances.realtimerendering.com/s2023/index.html) | 云的采样预算、空区跳过与远景细节控制 | 精确跳过球壳外部，天气/高度为零时不读细节纹理，按像素覆盖范围淡出高频噪声；不把密度阈值步进称作 SDF sphere tracing。 |

本版本选择每帧低分辨率积分和深度感知重建，避免长历史带来的移动拖影。没有实现 Sky Pro / Nubis 完整时域重投影。对于全球漫游，这是显存、集成复杂度和画质之间的初始折中，不代表所有设备和天气条件下的最优解。

## 数据与渲染

- 512×256 RGBA8 天气图：在三维单位球面上计算覆盖和云型，然后存为经纬度纹理。经度重复采样、纬度钳制，保证日期变更线连续且极点不依赖经度。
- 48³ RGBA8 周期性三维噪声：Worley/value noise，CPU 数据复用，GPU 纹理由每个 effect 单独拥有。区域噪声保留全球云系的破碎结构，近景噪声形成不同高度的云团和侵蚀边缘。
- WGS84 极轴归一化到等效球体，使用 km 积分。外球减内球得到最多两段云层路径，并与地球实体、Cesium 场景深度裁剪。支持云下、云中、云上和轨道外观察。
- 256×128 光照 atlas：4×4 个高度切片，每片 64×32，经纬度与高度三线性插值。7 个递增长度样本估算远场太阳光学深度，4 个向上样本估算环境遮蔽；太阳/参数变化时更新，风动时最多约每秒更新一次。
- 每个有效视线样本再取 2 个近场阴影样本，结合双 HG 相位函数、Beer 衰减、近似内部散射和月光环境项。太阳颜色与行星遮挡读取大气透射率 LUT。
- 40/64/96 个积分步，分别使用 50%/65%/100% 的宽高分辨率。近地长路径使用二次采样分布，透射率足够低后提前结束。固定空间抖动保持暂停后的稳定性。
- 低分辨率射线通过连续地表的四点深度插值进行裁剪，避免使用邻近全分辨率射线的深度导致轨道云层网格状破洞；深度断层保持最近点采样。再用全分辨率深度感知四点重建，云颜色使用预乘 alpha 覆盖大气结果。风场按真实秒平流；Cesium 时间加速只影响天体和光照，不会让云在 3600× 时瞬间绕地球移动。

固定纹理约 1.05 MiB（天气 512 KiB、噪声 432 KiB、光照 128 KiB），另加随视口变化的体积/合成 framebuffer。精确总显存取决于 Cesium framebuffer 缓存和画质切换；不能把固定纹理大小当作全部显存。销毁时释放所有云纹理、计算 primitive、post-process stages 与事件监听。

## 使用

```ts
const clouds = new GlobalCloudEffect({
  sunDirection: () => atmosphere.sunDirection,
  moonDirection: () => atmosphere.moonDirection,
  moonFraction: () => atmosphere.moonFraction,
  transmittance: () => atmosphere.transmissionTexture,
  atmosphereEnabled: () => atmosphere.enabled,
});
// 先挂载 atmosphere，再挂载 clouds。
clouds.mount({ viewer, onStatus: console.info });
clouds.updateParameters({ coverage: 0.58, base: 1.5, thickness: 3.8 });
clouds.setQuality('medium');
clouds.view('inside');
// 使用结束时先销毁 clouds，再销毁提供纹理的 atmosphere。
clouds.destroy();
```

实验室切换回龙卷风时默认关闭全球云，避免原龙卷风机位被全球云层覆盖；可用独立开关重新启用。两个后处理体积并没有统一的逐样本透明排序，不保证重叠体积的精确合成。

## 已知边界

这是程序化全球天气视觉效果，不是真实天气预报。当前为单个可调厚度球壳，没有独立高空卷云层、雷暴闪电、降水或向地表投射的云影。光照缓存分辨率较低，不能表示每个小云团的长距离阴影；太阳接近地平线时尤其如此。多重散射、云的空气透视与月光都是近似。低画质的地平线和稀薄边缘可能出现采样噪声，远景细节经过滤波，不追求逐体素重现 Nubis。

球壳与近地空间使用浮点公里坐标和 WGS84 缩放近似，不适用于要求厘米精度的遮挡。云在 HDR/曝光之后合成，尚未与大气组成完整的线性 HDR 光照管线。

## 验证

`npm test`：16 项通过，包含云下/云中/轨道求交、地球和深度裁剪、双段切线路径、天气图确定性、经度接缝与极点连续性，以及已有大气、星历和 LBM 测试。`npm run build` 通过；Cesium 大 bundle 提示仍存在。

2026-10-22，本机 Windows 内置 Chromium 浏览器、生产构建，窗口 1280×720，实际绘制缓冲 984×652。CPU 为 Ryzen 7 9800X3D，机器配置含 RTX 5080 / AMD 核显；此记录未读取浏览器选定的 ANGLE adapter，因此不作为特定 GPU 的通用指标。每组预热 2 秒、测量 10 秒，使用 WebGL GPU timer query，记录的是整个场景，不是云 shader 单独耗时。

固定「云上」机位：经度 −97.52°、纬度 35.46°、高度 8.3 km、heading 245°、pitch −18°；时间固定为 2026-06-21 17:00 UTC，云/大气默认参数，风和 Cesium Clock 暂停，龙卷风关闭。

| 生产版场景 | 平均帧间隔 | GPU 平均 | GPU P95 |
| --- | ---: | ---: | ---: |
| 仅大气、无云 | 4.17 ms | 0.370 ms | 1.358 ms |
| 流畅云（复测） | 4.17 ms | 0.918 ms | 2.110 ms |
| 均衡云 | 4.17 ms | 1.034 ms | 1.588 ms |
| 精细云 | 4.17 ms | 2.135 ms | 2.626 ms |
| 全球机位、均衡云、24 m/s 风动 | 4.17 ms | 1.487 ms | 2.172 ms |

全球机位高度 17,000 km、heading 0°、pitch −90°。最后一组包含风场更新和光照缓存刷新，与前四组机位不同。各组帧率均受约 240 Hz 的帧调度限制，不能据此推导云的 GPU 成本为零。均衡档相对基线增加约 0.664 ms GPU 时间；这不是所有设备都能维持同一帧率的承诺。流畅档初测 1.344 ms、复测 0.918 ms，显示短测受 GPU 频率和系统负载波动影响；不以单次 P95 推断档位之间的严格排序。

原始采样保存在本地忽略目录 `artifacts/cloud-prod-*.json`，记录起止参数、相机和缓冲尺寸。开发版在 1440×1000 下的早期测量不与生产版混用。

生产浏览器实际检查了三档 GLSL 编译、独立开关、云量为零、云下/云内/云上/全球视角、日落/夜晚、满月、Cesium 时间播放，以及切回原 LBM 龙卷风。未观察到浏览器 error/warn。轨道深度插值修复前后的画面对照确认网格状破洞消失。真实地形和 3D Tiles 前景遮挡尚未专项测试，当前验收地表为 WGS84 椭球。
