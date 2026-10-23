# 日月系统验证 · 2026-10-24

本轮在当前工作树的 `66daa6b396f1d504764122edfcec64ecf7b5401e` 上实现。旧审查基线 `df4ab3c` 之后的大气、全球云、独立高云、球壳排序、深度裁切、WGS84 输运、近景体素、mip 和 RGBA8 路径均保留。没有回退提交，没有提高曝光或云积分步数。

## 先确认仍存在的问题

当前 HEAD 已有太阳 2.8×、月亮 2.2×、球面月相、手动太阳一致性和暗面遮星。原来的手动模式及恢复星历测试本来就通过，本轮没有把这些已有修正重新算作新成果。

| 问题 | 可复现的原行为 | 本轮行为 |
| --- | --- | --- |
| 云复用相机的月球方向和月相 | 固定 UTC 移动相机，云光源方向向量距离变化 `0.0691914236` | `CelestialState.observer` 服务月盘/UI；`lighting` 采用明确的地心远光源近似。相同检查为 `0` |
| 冻结时间缓存初始参考系 | ICRF 数据加载后，相同 UTC 的即时方向与缓存差 `0.00659300964`，约 0.38° | 查询 `computeIcrfToFixedMatrix` 的真实就绪状态；暂停时也刷新初始 TEME 回退，方向误差为 `0` |
| 太阳整盘共用中心射线透射 | 地平线测试中，上/下半盘均为 240 | 当前像素射线独立求 T，地球遮挡的下半盘为 0，上半盘为 240 |
| 空场景沿用旧深度 | 地面→空天空，完整 Cesium 场景中的月盘中心仅为 3 / 4 | HDR/RGBA8 均为 229；加入前景不透明实体降到 10，移除后恢复 229 |

Cesium 1.146 的 `computeIcrfToCentralBodyFixedMatrix` 内部已经返回 TEME 回退，不能用“是否返回矩阵”判断 ICRF 就绪。另一个问题是 Cesium 在可见视锥循环中清除深度，零视锥时可能留下上一帧深度。`sceneDepth.ts` 仅在**当前零视锥**时忽略该过期附件；有当前地形/实体时继续使用正常深度。这个版本相关接口集中在一处，接口缺失时保留原深度路径。

反例结果保存在本地忽略目录：`artifacts/celestial-red-state.json`、`celestial-red-icrf.json`、`celestial-baseline-gpu.json`、`celestial-baseline-scene.json`。修正结果为对应的 `celestial-current-*.json`。

## 实现与文件

| 文件 | 职责 |
| --- | --- |
| `src/effects/hillaire-atmosphere/CelestialLighting.ts` | 同一 ECEF 星历/艺术模式下的观察点与地心几何；精确月相点积；ICRF 就绪；IAU 月球固连朝向 |
| `AtmosphereEffect.ts`、`celestialPresets.ts`、`atmosphereMath.ts` | 状态、资源所有权和盘径/亮度/光晕参数；物理 1×、2×、日 3.2× / 月 3.0× 增强预设 |
| `LunarAlbedo.ts`、`lunarAlbedoMath.ts`、`assets/`、`src/scene/DynamicTexture.ts` | NASA 2K 相对反照率图；sRGB 先转线性后生成 mip；经度 repeat、纬度 clamp；异步取消和释放 |
| `shaders/composite.glsl` | 逐像素太阳透射；月面 UV、显式 footprint/mip；独立几何 mask；保留前方空气 L 与未截断 HDR |
| `src/scene/sceneDepth.ts`、全球云 `GlobalCloudEffect.ts` / `march.glsl` / `resolve.glsl` | 空视锥遗留深度修正，同步用于天空、云积分及深度重建 |
| `src/main.ts`、`src/ui/EnvironmentPanel.ts` | 连接地心云月光；日期步进、四相、播放状态、独立显示控制 |
| `tests/celestial*`、`tests/cloud-scene.browser.ts`、`tests/lighting-gpu.browser.ts`、`scripts/build-validation.mjs` | 数值、实际 GLSL、UI/生命周期、完整 Cesium 场景及固定截图夹具 |

月相使用 `moonToSun=normalize(S−M)`、`moonToObserver=normalize(C−M)`，`fraction=(1+dot(moonToSun,moonToObserver))/2`。艺术模式将太阳定义为同一条 ECEF 无穷远方向；月球位置仍来自所选 UTC。球面着色已经表达受光面积，没有对整个月盘再次乘 fraction。地心云光源仍在各云点经过当地行星遮挡和大气透射，视觉盘径/亮度/光晕不参与其能量。

日晕与月晕的宽度按物理角半径计算，独立于盘径滑块；月晕默认关闭。日盘亮度仍为 1，月面亮度仍为 2.4，曝光仍为 8。增强尺寸是可读性的展示选择，物理 1× 随时可用。

贴图来源、SHA-256、许可、上传和坐标约定见 [NASA 资产说明](../src/effects/hillaire-atmosphere/assets/README.md)。使用 Cesium 1.146 的 IAU 2000 月球朝向；UV 的东向、北向和无镜像通过带颜色象限的真实生产 shader 检查，并检查地心视线落在近月面。NASA 图是经过视觉调整的相对反照率，不能视为绝对科学测量。

## 数值与真实 WebGL 验证

`npm test`：34/34；`npm run build` 通过（保留既有 Cesium 大包警告）。11 组浏览器检查共 115 项通过，使用 Chrome、WebGL2、ANGLE D3D11、NVIDIA GeForce RTX 5080。

| 浏览器夹具 | 通过项数 | 主要覆盖 |
| --- | ---: | --- |
| celestial-state | 21 | 暂停 ICRF 更新、手动/星历、相机与地心几何、显示参数能量独立、日期/播放、资源释放 |
| celestial-gpu | 6 | 四相明暗、暗面挡星、逐像素地平线、太阳 HDR / RGBA8 |
| celestial-optics | 4 | 盘径、空气入散射、深度遮挡、月面 UV 朝向 |
| celestial-scene | 7 | 完整 Cesium 空视锥、前景实体和移除，HDR/RGBA8 一致姿态 |
| atmosphere-gpu / lighting-gpu | 9 / 6 | 太空透射反例、SkyView/80–101 km、当地照明、太阳穿薄云 |
| cloud-gpu / water-cloud-gpu | 21 / 14 | 云输运与兼容路径 |
| high-cloud-gpu / satellite-lod / cloud-pipeline | 11 / 8 / 8 | 高云、空间 LOD、附件生命周期及 quality 切换 |

盘径测量使用生产 GLSL 浮点读回的半高边界，1920×1080、垂直 FOV 60°、满月 UTC `2026-10-26T04:12:00Z`、固定观察点。对应投影式 `H*tan(radius*scale)/tan(fovy/2)`；抗锯齿容差为 0.35 像素，未按截图缩放后的 CSS 像素计数。

| 天体 | 1× 实测 / 投影 | 2× 实测 / 投影 | 增强实测 / 投影 |
| --- | ---: | ---: | ---: |
| 太阳 | 8.487 / 8.750 px | 17.685 / 17.500 px | 27.993 / 28.001 px（3.2×） |
| 月亮 | 8.805 / 8.961 px | 17.947 / 17.922 px | 26.738 / 26.884 px（3×） |

暗月面内部的前方空气 L 实测 `0.0306868106`，期望 `0.0306868075`；盘外含星空为 `0.0329993516`。完整场景的地形测试使用 Cesium `CustomHeightmapTerrainProvider`：相机 800 m、月球仰角 0.75°、前方 20 km 的 1150 m 高斯山脊。加入山脊后月盘下部被当前地形深度遮住。这是实际地形管线上的确定性程序化高度场，**不是实测 DEM**。

薄云 HDR 数值测试把太阳 `L=8.0384` 在云遮挡之后才显示映射，RGBA16F 实测 `8.0383997`；RGBA8 解码为 `8.3641993`。这组强光、高消光测试的最大显示值绝对误差分别为 `0.00000948` / `0.01064062`，属于编码量化边界，不声称两种存储逐像素相同。

## 固定截图与复现

本地截图和 JSON 不提交 Git，见 `artifacts/celestial-report.html`。每张图都有同名前缀的 `-state.json`，保存完整 ECEF 相机位置/朝向、fovy、drawingBuffer、UTC、所有参数、风场、quality、渲染器和纹理状态。

共用条件：drawingBuffer **1920×1080**，medium（scale 0.65，64×3 个云子区间），seed 13，冻结风场 `angle=highAngle=evolution=0`，曝光 8，Rayleigh/Mie/ozone 均为 1。截图中的画布缩放显示至 984 CSS 像素宽，原始积分分辨率不随显示尺寸改变。四相镜头使用确定性的月下点相机、1000 km 高度、垂直 FOV 6°；每个 UTC 对应各自明确的世界相机，前后对照使用相同 UTC/相机。固定夹具先 preload ICRF，再设置相机。

| 文件前缀 `artifacts/` | 条件 / 检查 |
| --- | --- |
| `celestial-final-new` | 2026-10-10 15:50 UTC，新月；观察点 fraction 0.001127 |
| `celestial-final-first` | 2026-10-18 16:12 UTC，上弦；fraction 0.501045 |
| `celestial-final-baseline-full` / `celestial-final-full` | 2026-10-26 04:12 UTC；基线因遗留深度误挡，修正后满月 fraction 0.998413。这组不是纯贴图对照 |
| `celestial-final-last` | 2026-11-01 20:28 UTC，下弦；fraction 0.503018 |
| `celestial-final-manual` | 满月日期切换艺术太阳 elevation=15°、azimuth=245°；相机月相变为 0.540047，地心云月相为 0.540044 |
| `celestial-final-size1/size2/size3` | 同一满月镜头改为垂直 FOV 60°，仅改变盘径 |
| `celestial-final-moon-thin` / `-rgba8` | 相机 7 km、FOV 12°；Cirrostratus、highCoverage=1、tau_v=0.2；其余低云保留但位于相机后方 |
| `celestial-final-sun-thin` | 同一薄云参数，太阳下方 7 km，相机对准太阳 |
| `celestial-final-horizon-clear` / `-ridge` | 同相机、0.75° 月仰角、FOV 6°；仅这组隔离地形遮挡时关闭云 |
| `celestial-final-cloud-night` | 满月下方 800 m、FOV 60°，所有默认云层启用，GPU 性能场景 |

四相时刻来自 [USNO](https://aa.usno.navy.mil/calculated/moon/phases?date=2026-10-01&format=p&nump=6)。它们是星历预设，不通过手工修改光照比例制造四相；相机视差和轨道倾角允许可见比例稍偏离 0 / 0.5 / 1。截图相机的滚转记录在 JSON 中，上弦在该镜头中左侧受光，不能据此把贴图任意镜像。

复现构建：先运行 `npm run build`，再运行 `node scripts/build-validation.mjs . artifacts/celestial-current`；可用 `npx vite preview --outDir artifacts --host 127.0.0.1 --port 4180` 服务这些夹具。基线通过 `git archive 66daa6b` 导出到忽略目录，以相同夹具构建，未切换或覆盖当前工作树。

## 成本与近似边界

新增月面 JPEG 457,942 字节。2048×1024 线性 RGBA8 全 mip 链 **11,184,812 字节（10.6667 MiB）**；中性 1×1 回退在贴图就绪后释放。所有新 GPU 纹理、ImageBitmap 和请求均由大气 effect 所有，卸载时释放/取消。这个存储量不包括驱动、解码、canvas/ImageData 等临时 CPU 内存；未测浏览器总体峰值内存。

月盘有效像素内增加一次显式 mip 的 2D 纹理采样，替换程序化纹理。IAU 朝向随星历缓存刷新；几何状态仍随相机更新。空视锥深度检查不增加纹理附件或云步数。下方 GPU 数字是完整 Cesium 场景计时，不是单独月面着色器的成本。

默认有云夜景 A/B 的 UTC、ECEF 相机、FOV、drawingBuffer、medium、seed、风场及曝光逐项一致；盘径保留各版本默认值，月面亮度均为 2.4。两个截图为 `celestial-baseline-cloud-night.jpg` / `celestial-final-cloud-night.jpg`。

| 版本 / 固定场景 | GPU 有效样本 | 平均 | 中位数 | P95 |
| --- | ---: | ---: | ---: | ---: |
| `66daa6b`，800 m 有云夜景 | 11 | 46.271 ms | 46.456 ms | 49.136 ms |
| 本轮，800 m 有云夜景 | 41 | 44.832 ms | 45.287 ms | 46.789 ms |
| 本轮，1000 km 窄视角满月，射线位于云层以上 | 23 | 3.115 ms | 0.526 ms | 10.237 ms |

基线夜景发生约 1 Hz 的浏览器帧节流，本轮夜景有 222 个帧间隔样本。以上都是有效 GPU query 的实测时间，但**没有获得严格相同前台调度与桌面负载的性能 A/B**；不能把两行差异解释为优化收益。窄视角样本波动也很大。单独月面采样的 GPU 增量没有隔离测量。

同一夜景的云 mount CPU 时间为基线 634.8 ms / 本轮 680.0 ms；从云 mount 开始到云资产及月面 ready 为 2689.4 / 2992.7 ms。此计时不包含之前的 Viewer / 大气 mount，也不包含之后等待完整帧和瓦片的时间。本轮月面异步加载墙钟时间为 783.9 ms，与云生成/主线程工作重叠，**不是独立 JPEG 解码或 GPU 上传耗时**。没有从这些启动样本推导性能百分比。

性能数据见本地 `*-gpu.json`：2 秒预热、10 秒采集，`EXT_disjoint_timer_query_webgl2`，排除 disjoint 结果。桌面其它程序和浏览器仍运行、GPU 频率未锁定；只有 timer-query 是 GPU 时间，帧间隔和 CPU 提交时间不替代它。窄视角满月复测出现后台帧节流，不用于推导性能改进比例。

剩余近似 / 未验证目标：

- 云月光采用地心远光源方向/相位，忽略各云点到月球的视差；固定世界点收到的光照不随相机漂移。云的夜间亮度增益、月面反射与地照仍为原有展示近似，未做绝对月光照度标定。
- NASA 图是相对视觉反照率，线性 RGBA8 仍有量化；没有位移、精确微表面、冲日增亮、月食/精确日食。IAU 解析朝向不是 JPL DE440/441 精度。
- 暗面遮挡的是背景，前方空气/云照常保留；空气 LUT 不包含月球驱动的大气多重散射。艺术月晕不是真实冰晶光晕，默认关闭。
- RGBA8 薄幕截图可见平滑区域色带；HDR 路径更平滑。固定曝光 8 下，太阳穿薄云的显示图像接近饱和，保留 HDR 不等于显示端无限动态范围。
- Cesium 地表和星空仍是 LDR 输入的逆显示近似，不能恢复已有截断高光；窄 FOV 会放大原星空贴图的低分辨率。自定义日月的 HDR 不经过这种恢复。
- 地形验收覆盖程序化高度场和不透明实体；真实全球 DEM、3D Tiles、其它 GPU/移动设备没有在本轮验证。没有宣称画质相似度或性能改善百分比。
