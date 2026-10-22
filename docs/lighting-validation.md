# 全球大气与光照基础验证 · 2026-10-22–23

本轮在现有 `master` 工作树继续实现。开始时 HEAD 为 `9d6524f03d623eb787816246f2d4db1866022a02`，不是审查基线 `df4ab3cef769f48bdf35c76fabf83d41026ebe05`；没有回退或覆盖用户修改。对照版本来自该 HEAD 的 `git archive`，两端使用相同测试场景文件与生产构建。截图、原始数值和计时 JSON 留在忽略目录 `artifacts/lighting-*`，不进入 Git。

## 根因、修改文件与前后行为

| 范围与文件 | 当前 HEAD 的问题 | 本轮行为 |
| --- | --- | --- |
| [common.glsl](../src/effects/hillaire-atmosphere/shaders/common.glsl)、[transmittance.glsl](../src/effects/hillaire-atmosphere/shaders/transmittance.glsl)、[integrate.glsl](../src/effects/hillaire-atmosphere/shaders/integrate.glsl)、[atmosphereMath.ts](../src/effects/hillaire-atmosphere/atmosphereMath.ts) | 大气外位置被直接压到 LUT 顶行，原始 `mu` 与入口 `mu` 不同；线性 `mu` 插值还混合地球遮挡零值 | 共用入口裁切：先判断地球遮挡，未穿过大气返回 1，进入者移动到真实入口再映射。透射表只参数化未被地球遮挡的射线。CPU 参考同样裁切起点 |
| [sky-view-parameters.glsl](../src/effects/hillaire-atmosphere/shaders/sky-view-parameters.glsl)、[sky-view.glsl](../src/effects/hillaire-atmosphere/shaders/sky-view.glsl)、[composite.glsl](../src/effects/hillaire-atmosphere/shaders/composite.glsl) | 高空仍把采样密度集中在当地水平线；99 km 突然从 LUT 切换到另一积分近似 | 按真实下降的地平线分配样本，生成/采样互逆；最后 5 km 平滑过渡到直接积分，100 km 外继续同一路径 |
| [sky-irradiance.glsl](../src/effects/hillaire-atmosphere/shaders/sky-irradiance.glsl)、[sky-irradiance-sample.glsl](../src/effects/hillaire-atmosphere/shaders/sky-irradiance-sample.glsl)、[AtmosphereEffect.ts](../src/effects/hillaire-atmosphere/AtmosphereEffect.ts) | 两条天空方向不足以表示完整环境照明，且每段云都重复积分 | 新建当地高度 × 太阳天顶角缓存，实际积分天空辐亮度；MultipleScattering 只作为积分中的高阶源项。介质变化时重建，太阳/相机变化不重建，销毁时释放 |
| [droplet-lighting.glsl](../src/effects/global-clouds/shaders/droplet-lighting.glsl)、[march.glsl](../src/effects/global-clouds/shaders/march.glsl)、[GlobalCloudEffect.ts](../src/effects/global-clouds/GlobalCloudEffect.ts) | 主云使用视线区间中点环境光，水云仍使用相机所在地；相函数在空像素也预先计算；固定日月高度门限提前去掉高空直射 | 确认有效球壳区间后准备相函数，仅在实际有密度的点按当地坐标查照明。日月用行星几何遮挡和逐点透射判断可见性 |
| [voxel.glsl](../src/effects/global-clouds/shaders/voxel.glsl) | 13.57 km 的第二域内部深度按 7.83 km 换算 | 在选择联合密度域时按 `13.57/7.83` 统一内部深度单位；两域密度、mip 与保守空区距离不变 |
| [resolve.glsl](../src/effects/global-clouds/shaders/resolve.glsl)、[radiometry.glsl](../src/effects/global-clouds/shaders/radiometry.glsl)、[main.ts](../src/main.ts) 及大气合成 | **HEAD 已有**显示前编码 RGBA8 辐亮度附件，不能把旧基线的太阳截断问题误报成仍完全存在；但没有直接线性浮点路径 | 保留已有附件旁路，增加 RGBA16F 和明确的 `backgroundIsHdr` 契约。天空/日月先保留 HDR，云遮挡后统一显示映射；兼容编码 RGBA8 和无附件提供者 |

运行时太空积分仍为 **24 步**，SkyView 仍为 **32 步**，云仍为 **40/64/96** 区间。修改的是样本分布：围绕射线在有效区间内的最低高度集中采样，而非始终围绕相机。没有调高曝光、锁 LOD0、关闭云层、添加固定白色环境光或用增加运行时步数掩盖误差。球壳排序、深度裁切、WGS84 射线度量、近景体素和逐点太阳透射均保留。

## 对照作者实现

阅读了 [Hillaire 作者示例的 RenderSkyCommon.hlsl](https://github.com/sebh/UnrealEngineSkyAtmosphere/blob/master/Resources/RenderSkyCommon.hlsl)（取得的 blob SHA `e32b8fbd5ed893628ed1a59c7dfa7575d70c2cc6`）及 [RenderSkyRayMarching.hlsl](https://github.com/sebh/UnrealEngineSkyAtmosphere/blob/master/Resources/RenderSkyRayMarching.hlsl)（`fdd980efd7268041b26fb6f1c108dce283a33d53`）。改写的参数化保留 [MIT 许可及 Epic Games 署名](../src/effects/hillaire-atmosphere/LICENSE.hillaire)。

采用作者的 `thetaH = π − acos(sqrt(r²−Rg²)/r)`，并把上下半段二次分布及其逆变换放在同一 GLSL 文件中。保留本模块完整周期方位角，没有照搬作者的太阳相对方位折叠；texel-center 变换使用严格配对的 `(uv*(size−1)+0.5)/size`。太阳透射使用到顶边界距离参数化，与作者的移至大气入口处理相呼应；入口裁切仍来自本项目原有积分器。

## 缓存与归一化

纹理为 **64×32×2 RGBA8，16,384 字节**，两条 RGB 带分别存向上法线与方位平均水平法线接收的漫射 `E/π`。坐标是当地 `sqrt(height/100 km)` 和集中于晨昏线的太阳天顶角映射。使用单位太阳照度，不包含太阳圆盘；先计算一次及高阶散射天空，再积分立体角和投影余弦。水平法线的方位平均余弦为 `sin(theta)/π`。

每个纹素计算 32 个极角 × 8 个太阳平面对称方位 × 24 个射线区间，最多约 2517 万个大气样本/重建。这是仅在介质变化时执行的缓存生成，不是每帧工作。编码为 `encodeL(16*E/π)`，解码严格除以 16；不是光照增益。两条纹理带各自使用 texel-center 范围，避免边界串色。云每个有密度的点只需两次查询。

四张大气 LUT 共 **165 KiB**。984×652 时，RGBA16F 天空附件 **4.895 MiB**，编码 RGBA8 **2.447 MiB**，相对旧 HEAD 默认增加 **2.447 MiB**；以上不含驱动、深度及其它 framebuffer。最终数值探针的一次缓存绘制 GPU 时间为 **1.317 ms**，查询紧贴 `drawArrays` 两侧，排除 shader 准备与同步读回；这是单次绘制结果，不代表总初始化时间。早期范围包含准备/读回的计时不作为该成本结论。

## 自动验证与误差

`npm test` **28/28 通过**；`npm run build` 通过（保留原有的大 bundle 提示）。实际 Chromium/WebGL2 检查 **65/65 通过**：主云 21、水云 14、日月 GLSL 5、状态及资源 10、大气 9、光照链路 6。无页面 shader/render 错误。

| 检查 | 实际结果 |
| --- | --- |
| `Rg=6378.137, Rt=6478.137, r=23378.137 km, mu=−0.5` | 修复前 GPU 返回 `(0,0,0)`；修复后严格 `(1,1,1)` |
| 地球遮挡、边界、切线、起点在内部、从 101/17000 km 进入 | 相对 4096 步 CPU 透射参考，所测射线最大绝对通道误差 `0.0014963` |
| 80/99/101 km 边缘射线；太阳 `mu=−0.12/0/0.3/1` | 相对同一介质的 512 步参考，24 步最大相对 RMS `0.0053493`。保留旧采样分布的中间诊断最大为 `0.0936365`；由此调整分布，没有提高运行时步数 |
| SkyView 参数化 | 0.001/0.8/80/99/101/17000 km，256×256 个往返点，最大误差 **0.06990 纹素**，小于 0.1 纹素 |
| SkyView 边缘辐亮度 | 80/99/101 km，所测白昼方向相对 512 步积分最大 RMS `0.0113385` |
| 实际合成跨 99.99 / 100.01 km | 相同切线高度方向集，太阳 `mu=0/0.3`，最大相对 RMS `0.00003891`、绝对通道差 `0.00001074`。包括 20 m 的真实观察点变化 |
| 漫射缓存与 4096 方向 / 128 步参考 | 白昼及晨昏线 `mu≥0` 的最大相对 RMS `0.011281`。极微弱暮光 `mu=−0.12` 最大相对 RMS `0.097972`，该组最大绝对通道误差 `0.000005376`；未把近零相对误差隐藏成画质分数 |
| 单位各向同性辐亮度归一化 | 两个 `E/π` 分别为 `1.003581`、`1.000658`，残差来自有限角度积分 |
| 固定世界点环境光 | 三个地面/太空相机位置下最大差 **0**；旋转当地法线和太阳后的最大差 **0** |
| 高空日月 | 32 km、太阳 `mu=−0.09` 和 10 km、月亮 `mu=−0.04` 保留直射；同方向低空被地球挡住 |
| 体素第二域 | 512 个点覆盖 A/B 两域；内部深度最大换算误差 `2.8×10⁻⁸ km` |
| 太阳穿透云后显示 | 实际太阳 shader 的线性峰值 `8.0383997`；编码 RGBA8 单像素读回 `8.3641993`。云透明度测试中，HDR 显示误差最大 `0.00000948`；RGBA8 最大 `0.010641`，保留量化误差声明 |
| 空像素准备 | 实际 march 调用点计数：完全错过云壳 **0** 次，命中两个有效云壳 **2** 次 |
| 生命周期 | 相机/太阳移动不重建漫射缓存，介质改变恰好重建一次；独立开关、三档重建、RGBA8、Worker 中途销毁、纹理释放和场景状态恢复均通过 |

高步数参考仍使用同一介质、透射表及多重散射闭合，并非独立物理路径追踪真值；数值误差不是图像相似度或画质百分比。

## 固定截图与性能条件

两端均固定 seed **13**、UTC **2026-06-21T17:00:00Z**、风速 **24/48 m/s** 且平流/演化累积 **0**、垂直 FOV **45°**、drawingBuffer **984×652**、quality **medium**、曝光 **8**、太阳大小 **2.8**、月亮大小 **2.2**、月亮亮度 **2.4**。相机输入关闭，时间暂停。精确位置、方向、up、模型和全部参数保存在每张图同名 JSON。

| 图组（`lighting-before/after-*.png`） | 场景条件；同组前后匹配 |
| --- | --- |
| `global` | 经度 −97.52°、纬度 35.46°，高度 17000 km，heading 0°、pitch −90° |
| `high` | 同地点 12.5 km，heading 245°、pitch −18° |
| `below` | 同地点 0.8 km，heading 245°、pitch 12° |
| `80km / 99km / 101km` | 同地点指定高度，heading 245°、pitch −9°；固定手动太阳 elevation 0° / azimuth 245°，UTC 仍固定 |
| `terminator` | 全球相机；固定手动太阳 elevation 0° / azimuth 245° |
| `sun-thin` | 固定 UTC 的太阳下点，7 km 高度朝向太阳，主云覆盖 0.62、高云覆盖 0.65；两个云层仍开启 |
| `rgba8` | 全球相机；强制两个模块走 RGBA8 |

[本地前后截图画廊](../artifacts/lighting-report.html) 同时提供原始 PNG 和 JSON；此链接仅在保留本轮本地 artifacts 时可用。没有把参考视频图像作为项目资产。

9 组成对参数逐项核对通过：仅大气默认存储由 RGBA8 改为 RGBA16F；相机浮点向量允许 `1e-12` 的舍入差，地面机位实际约 `1.7e-14`。每张原图均重新统一到完整画布取景，画廊只用 CSS 隐去右侧空白。目视检查未见 80/99/101 km 突然消失的大气带；云边采样纹理和程序化形态仍可见，连续性结论主要由上表的实际合成数值检查支持。

性能在 Windows Chrome、ANGLE D3D11、**NVIDIA GeForce RTX 5080** 上逐场景测量。使用 `EXT_disjoint_timer_query_webgl2` 测整帧 GPU，各 2 秒预热 + 10 秒采样；测量期间数值探针已结束。帧间隔和 CPU 提交时间不冒充 GPU 时间。

| 场景 | HEAD GPU 平均 / P95 | 本轮 GPU 平均 / P95 | GPU 样本数（前 / 后） |
| --- | --- | --- | --- |
| 全球 | 3.597 / 4.542 ms | 3.652 / 4.578 ms | 1089 / 1199 |
| 高云 | 7.959 / 9.692 ms | 7.586 / 10.732 ms | 580 / 565 |
| 地面 | 7.130 / 9.118 ms | 7.767 / 9.936 ms | 523 / 666 |

全球均值增加约 0.055 ms，地面增加约 0.637 ms；高云均值降低，但 P95 上升。短测受频率和系统负载影响，不能据此承诺整体加速或跨设备帧率。原始记录为 `artifacts/lighting-{before,after}-{global,high,below}-perf.json`。

补充强制 RGBA8 全球采样：当前版本 GPU 平均 **3.157 ms**、P95 **4.155 ms**，1264 个查询。重启验证服务后的基线补测为 **6.795 / 17.390 ms**、78 个查询，帧间隔 P95 为 **391.8 ms**，出现严重调度抖动；不能用这对补测推断提速。两份原始记录仍保留在 `lighting-{before,after}-rgba8-perf.json`，各自起止参数一致。

## 复现入口与测试修改

```sh
npm test
npm run build
node scripts/build-validation.mjs . artifacts/lighting-current
```

用 Vite preview 的 `artifacts` 根目录访问 `lighting-current/tests/atmosphere-gpu.html`、`lighting-gpu.html`、`cloud-gpu.html`、`water-cloud-gpu.html`、`celestial-gpu.html`、`celestial-state.html`。`cloud-scene.html?benchmark&view=global&quality=medium` 提供固定场景和 GPU 采样按钮。验证构建使用的 Cesium 资源地址由 `scripts/build-validation.mjs` 固定到本地 5173 端口；本轮 preview 为 4180。

新增 [gpuProbe.ts](../tests/gpuProbe.ts)、[atmosphere-gpu.browser.ts](../tests/atmosphere-gpu.browser.ts)、[lighting-gpu.browser.ts](../tests/lighting-gpu.browser.ts) 及对应 HTML；修改 [atmosphere.test.ts](../tests/atmosphere.test.ts)、[cloud-scene.browser.ts](../tests/cloud-scene.browser.ts)、[cloud-gpu.browser.ts](../tests/cloud-gpu.browser.ts)、[water-cloud-gpu.browser.ts](../tests/water-cloud-gpu.browser.ts)、[celestial-gpu.browser.ts](../tests/celestial-gpu.browser.ts)、[celestial-state.browser.ts](../tests/celestial-state.browser.ts) 和 [build-validation.mjs](../scripts/build-validation.mjs)。浏览器测试直接执行生产 GLSL，浮点读回只用于数值参考。文档同步更新 [atmosphere.md](atmosphere.md) 与 [global-clouds.md](global-clouds.md)。

## 剩余近似与未验证项

- Cesium 地表/星空输入仍是 LDR。逆 ACES 只赋予有效线性值，不能恢复原始地表高光或保证与 Cesium 之前的显示处理完全一致；自定义日月绕过此恢复路径。
- 漫射缓存只保留两个角度矩，云对天空的遮挡、内部多次散射和云底补光仍是近似；没有完整云气路径追踪、跨层投影或月光天空积分。
- WGS84 缩放球的光程、代表距离空气透视、有限纹理精度、程序化卷云与远景统计云仍保留其原有近似；近地细节和云边仍可见空间采样纹理。
- 已验证同一 GPU 上强制 RGBA8 的实际纹理/着色器路径；**未在缺少浮点附件扩展的独立设备上测试**。GPU 探针的高精度参考读回本身需要浮点颜色附件扩展。
- 本轮场景为 WGS84 椭球；**真实地形、3D Tiles 前景遮挡、移动端和其它 GPU 未专项验证**。未声明照片级云、独立物理真值或图像相似度百分比。
