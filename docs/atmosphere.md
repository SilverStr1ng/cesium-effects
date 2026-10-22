# Hillaire LUT 风格大气

独立 effect：`src/effects/hillaire-atmosphere/`，注册 ID `hillaire-atmosphere`。

依据 Sébastien Hillaire 的 [A Scalable and Production Ready Sky and Atmosphere Rendering Technique (2020)](https://sebh.github.io/publications/egsr2020.pdf) 中的 LUT 分解与各向同性高阶散射闭合思想独立实现。不是 UE 源码移植，也未包含商业 Sky Pro 源码。

## 渲染流程

1. 256×64 透射率 LUT：高度平方映射集中采样低空，64 步 Beer–Lambert 积分；包含 Rayleigh、Mie 消光、臭氧吸收和行星遮挡。
2. 32×32 多重散射 LUT：24 个 Fibonacci 球面方向、每方向 24 步积分，用 `L / (1 − f)` 近似高阶各向同性散射，包含近似地表反射。
3. 192×108 天空视图 LUT：地平线附近更密集的角度采样，32 步积分。基础 LUT 仅在介质变化时更新；天空 LUT 在太阳/介质/相机位置变化时更新。转头直接采样同一全天球 LUT。
4. 合成：低空背景查天空 LUT；太空视角与不透明场景的空气透视使用 24 步积分，读取基础 LUT。太阳圆盘单独绘制并经过大气透射。

LUT 使用固定尺寸 GPU ComputeCommand 和 RGBA8 纹理；辐亮度用平方根压缩编码，无需浮点颜色附件扩展。与 Cesium 内部渲染 API 的接口集中于 `src/scene/GpuLut.ts`，固定到 Cesium 1.146.0。

天空、太阳、月亮先在线性辐亮度中相加，最终使用 `scene/display.glsl` 的 ACES 拟合曲线与 Gamma 编码。两种云使用相同显示变换，避免薄云与天空之间出现曝光曲线不一致。地表输入已由 Cesium 显示映射，使用逆曲线恢复有效线性值后计算空气透视，无法恢复此前被截断的 HDR 信息。

地表深度通过 `atmosphereRayDistance` 转到椭球缩放后的射线距离，与云共用转换。此前漏乘射线方向的缩放长度，在轨道高度提前截断空气积分，造成海面网格状明暗；此问题已修复。

世界坐标以公里为积分单位；WGS84 极轴缩放到等效球体，使地面/极区不会与球形大气错开。椭球光程因此是近似。这里没有 UE 的视锥 3D aerial-perspective LUT、真实体积阴影或 HDR 曝光管线；不宣称与 UE 完全等价。

## 场景与控制

大气默认跟随 `viewer.clock.currentTime`，通过 Cesium 自身使用的 Simon1994 星历及惯性系到 ECEF 变换计算太阳和月亮。UI 可编辑 UTC 时间、播放/暂停和调整时间倍率。手动太阳预设会退出时间联动，重新勾选后恢复。太阳显示带光晕，`太阳视大小 = 1` 使用真实角半径；根据可见性反馈，默认提高至 2.8 倍视觉增强，不改变大气光照方向。此大小是展示选择，不声称比真实视直径更符合物理。

月亮使用观察点到月球的方向和距离计算视大小，绘制球面明暗以表达月相；不使用 Cesium 默认 Moon，避免叠加。提供 `moonScale`（默认 2.2，1 为真实视直径）与 `moonBrightness`（默认 2.4），月面辐亮度经过大气透射、曝光和亮度增益后显示映射，替代直接叠加较暗的灰色显示值。月面纹理是程序化灰度细节，不是天文摄影贴图；没有月食、日食或月光散射积分。`观察月亮` 会飞到月下点，方便检查各时刻月相。新月和厚云遮挡仍会自然使月面变暗，亮度控制不改变月相。

默认打开“全球天空”，可切换回原龙卷风。大气拥有独立开关、Rayleigh / Mie / 臭氧浓度、曝光、太阳高度与方位，并提供晴昼、日落、夜晚、地面、轨道和全球视角。太阳角度以俄克拉荷马实验位置的 ENU 为参考，转换为统一 ECEF 光照方向，整个地球共享同一个太阳。

Cesium `SkyAtmosphere.show`、`globe.showGroundAtmosphere` 和 `fog.enabled` 均关闭，默认太阳圆盘也关闭。地表使用同一太阳的 DirectionalLight，避免近地视角的 Cesium 默认“全天照亮”淡出。effect 销毁时释放三张 LUT、着色器、计算 primitive 和合成阶段，并恢复挂载前的场景状态。

## 验证

`npm test` 覆盖球体求交、地球遮挡、真空透射率、消光非负、光谱顺序、低空/高空透射和积分收敛。浏览器实际检查 GLSL 编译、晴昼/日落/夜晚、全球视角与独立开关；性能可用 `/?benchmark` 中的 CPU/GPU 采样工具观察。
