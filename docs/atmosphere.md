# Hillaire LUT 风格大气

独立 effect：`src/effects/hillaire-atmosphere/`，注册 ID `hillaire-atmosphere`。

依据 Sébastien Hillaire 的 [A Scalable and Production Ready Sky and Atmosphere Rendering Technique (2020)](https://sebh.github.io/publications/egsr2020.pdf) 中的 LUT 分解与各向同性高阶散射闭合思想实现。透射与 SkyView 参数化参考并改写了作者的 [MIT 示例](https://github.com/sebh/UnrealEngineSkyAtmosphere/blob/master/Resources/RenderSkyCommon.hlsl)，保留 [许可](../src/effects/hillaire-atmosphere/LICENSE.hillaire)。没有包含商业 Sky Pro 源码。

## 渲染流程

1. 256×64 透射率 LUT：按到大气顶的距离和 `sqrt(r²−Rg²)` 参数化，仅存未被地球遮挡的射线，64 步 Beer–Lambert 积分。行星遮挡在查询前解析判断，避免插值混入地球内部的零值。大气外射线先用与积分器相同的入口裁切：错过大气返回 1，地球遮挡返回 0，进入者移动到真实入口并重新计算高度和 `mu`。
2. 32×32 多重散射 LUT：24 个 Fibonacci 球面方向、每方向 24 步积分，用 `L / (1 − f)` 近似高阶各向同性散射，包含近似地表反射。
3. 192×108 天空视图 LUT：32 步积分，围绕真实地平线 `thetaH=π−acos(sqrt(r²−Rg²)/r)` 加密角度。生成和采样共用互逆函数与 texel-center 变换，保留本模块完整周期方位角。大气内使用此 LUT，最后 5 km 平滑过渡到太空的直接积分，避免两种数值近似在边界跳变；不再于 99 km 突然切换。天空 LUT 仅随太阳/介质/相机位置更新，转头不重建。
4. 64×32×2 天空漫射照明缓存，16 KiB RGBA8：按当地高度、太阳天顶角，保存向上法线及方位平均水平法线的 `E/π`。32 个极角、8 个太阳平面对称方位，每方向 24 步，实际积分天空一次及高阶散射；不把 MultipleScattering LUT 当作天空 irradiance。仅介质变化时重建，移动相机、太阳或云层不重建。以单位太阳照度归一化，编码为 `encodeL(16*E/π)`，采样严格除以 16；这个系数只改善存储精度，不改变光照或曝光。
5. 合成：太空视角及地表空气透视仍使用 24 步，但按最低射线高度分配样本；从太空看地面时，不再把样本集中在稀薄的相机附近。日月、大气、星空与地表先合成 scene-linear HDR，支持时输出 RGBA16F，兼容路径输出编码 RGBA8。云通过 `CloudLighting.backgroundStage` 和 `backgroundIsHdr` 读取此附件，在云遮挡之后执行同一显示映射。大气独立使用时由自己的显示阶段输出；云旁路该显示图像，最终像素不会二次曝光。

四张 LUT 仍使用固定尺寸 GPU ComputeCommand 和 RGBA8 纹理，共 165 KiB；无需浮点颜色附件扩展。RGBA16F 全尺寸辐亮度附件在 984×652 时为 4.895 MiB，RGBA8 回退为 2.447 MiB，不计驱动、深度及其它 framebuffer。`new AtmosphereEffect({hdr:false})` 可验证回退。LUT 资源接口集中于 `src/scene/GpuLut.ts`，固定到 Cesium 1.146.0。

天空、太阳、月亮先在线性辐亮度中相加，最终使用 `scene/display.glsl` 的 ACES 拟合曲线与 Gamma 编码。两种云使用同一显示变换。Cesium 地表和星空输入已是 LDR，只能用逆曲线赋予有效线性值：这不是 Cesium 原始材质辐亮度，不能恢复已截断的地表高光，也不能保证其色调映射与这里的 ACES 拟合完全一致。自定义日月不经过这条恢复路径。外部 `CloudLighting` 未提供 HDR 附件或天空照明缓存时保留原兼容近似；本应用正常连接时不依赖 `recoverRadiance` 重建太阳。

地表深度通过 `atmosphereRayDistance` 转到椭球缩放后的射线距离，与云共用转换。此前漏乘射线方向的缩放长度，在轨道高度提前截断空气积分，造成海面网格状明暗；此问题已修复。

世界坐标以公里为积分单位；WGS84 极轴缩放到等效球体，使地面/极区不会与球形大气错开。椭球光程因此是近似。这里没有 UE 的视锥 3D aerial-perspective LUT、真实体积阴影或自动曝光；自定义效果虽保留 HDR，Cesium 地表仍是上述 LDR 近似，不宣称与 UE 完全等价。

## 场景与控制

大气默认跟随 `viewer.clock.currentTime`，通过 Cesium 自身使用的 Simon1994 星历及惯性系到 ECEF 变换计算太阳和月亮。UI 可编辑 UTC 时间、播放/暂停和调整时间倍率。手动太阳预设会退出时间联动，重新勾选后恢复。太阳显示带光晕，`太阳视大小 = 1` 使用真实角半径；根据可见性反馈，默认提高至 2.8 倍视觉增强，不改变大气光照方向。此大小是展示选择，不声称比真实视直径更符合物理。

月亮使用观察点到月球的方向和距离计算视大小，绘制球面明暗以表达月相；不使用 Cesium 默认 Moon，避免叠加。提供 `moonScale`（默认 2.2，1 为真实视直径）与 `moonBrightness`（默认 2.4），月面辐亮度经过大气透射、曝光和亮度增益后显示映射，替代直接叠加较暗的灰色显示值。月面纹理是程序化灰度细节，不是天文摄影贴图；没有月食、日食或月光散射积分。`观察月亮` 会飞到月下点，方便检查各时刻月相。新月和厚云遮挡仍会自然使月面变暗，亮度控制不改变月相。

默认打开“全球天空”，可切换回原龙卷风。大气拥有独立开关、Rayleigh / Mie / 臭氧浓度、曝光、太阳高度与方位，并提供晴昼、日落、夜晚、地面、轨道和全球视角。太阳角度以俄克拉荷马实验位置的 ENU 为参考，转换为统一 ECEF 光照方向，整个地球共享同一个太阳。

Cesium `SkyAtmosphere.show`、`globe.showGroundAtmosphere` 和 `fog.enabled` 均关闭，默认太阳圆盘也关闭。地表使用同一太阳的 DirectionalLight，避免近地视角的 Cesium 默认“全天照亮”淡出。effect 销毁时释放四张 LUT、着色器、计算 primitive 和合成阶段，并恢复挂载前的场景状态。

## 2026-10-22 日月状态修正

`observerCelestials` 统一未缩放 ECEF 中的观察点到日月方向、月面到太阳方向、角半径与可见受光比例。手动太阳下，圆盘、月面明暗、界面比例与云的月光强度使用同一个模拟太阳；界面会明确标为模拟月相。重新联动时钟不会因参数修改而丢弃同一 UTC 的星历缓存。冻结时间移动观察点仍更新月球视差、角半径和月相。WGS84 缩放只进入大气和云的输运方向，不再扭曲圆盘角距和月面法线。

太阳和月亮用稳定角距及像素角宽抗锯齿，默认大小与曝光保持原值。月面使用 Lambert / Lommel–Seeliger 混合反射，使满月边缘保持可读，仍由太阳决定明暗线。暗半球会遮挡背景星光；背景先于月面合成。增加“观察太阳”入口；不承诺任何被厚云遮挡的天体始终可见。

云现在能保留薄云后的太阳辐亮度；RGBA8 天空编码使用固定亚字节抖动，避免新增编码目标把连续光晕量化成同心色带，仍有逐像素量化误差。月面纹理依旧是程序化细节，不包括真实地貌、秤动、月食和物理光晕。日月相互遮盖只是当前绘制顺序，不作为日食精确模拟。完整状态、GLSL、资源验证与固定截图见 [本轮验证报告](satellite-validation.md)。

## 验证

本轮全球透射、当地天空缓存、HDR 合成、80/99/101 km 过渡、体素尺度和日月门限的根因、数值误差、固定截图与实际 GPU 成本见 [全球光照验证报告](lighting-validation.md)。

`npm test` 覆盖球体求交、地球遮挡、真空透射率、消光非负、光谱顺序、低空/高空透射和积分收敛。浏览器实际检查 GLSL 编译、晴昼/日落/夜晚、全球视角与独立开关；性能可用 `/?benchmark` 中的 CPU/GPU 采样工具观察。
