# 第五阶段：掠射、启动与端到端验证（2026-10-27）

本轮从干净的 `f1c2d051762608a7939d8871168ad1d0d11af9a3`、`master` 开始，没有回退历史。保留 Cesium 1.146/WebGL2、前四阶段的大气入口、当地 E/π、日月、HDR、球壳排序、WGS84、深度裁切、近景体素/mip、独立高云和有序空气/云输运。

**这不是“全部门槛通过”的报告。** 四个指定掠射反例和 HG 已修复；启动生成已移出主线程并加入版本化缓存。扩展空间扫描、部分柱、已有沿射线缓存和非默认材质表的适用范围仍有失败项，下面与已经通过的生产合成闭环分开记录。没有放宽测试、改变曝光、关层、锁 mip0、增加生产积分步数或加入时域重投影。

## 变更及根因

| 文件 | 根因与最终行为 |
| --- | --- |
| `shaders/density.glsl` | 掠射拉伸了支持域，却仍按未拉伸 footprint 选网格。现在用完整屏幕到切平面映射的主轴，按长短支持独立分配有界预算；平均完成非线性查询后的光学矩 |
| `shaders/droplet-lighting.glsl` | HG 的 `.015` 下限截断合法 g 的峰值；移除下限，只限制 cosine 浮点越界，保留方向约定及默认 .72/.78 |
| `CloudAssets.ts`、`CloudAssetCache.ts`、`CloudAssetLoader.ts`、`CloudInitialization.ts`、`voxel.worker.ts`、`GlobalCloudEffect.ts` | weather/noise/cirrus 在主线程生成，worker 又生成 noise；统一在 effect 自有 worker 中生成，以 Transferable 交付，缓存固定资产及最近 seed 的天气，按帧提交上传 |
| `shaders/quality.glsl`、`march.glsl`、`storage.glsl` | 大 shader 的重复展开和格式变体造成链接等待。保留小的 light/substep 常量循环，外层及高度上界由 uniform 提供；HDR/RGBA8 共用 shader，但附件格式仍正确独立 |
| 新增 `tests/cloud-grazing*`、`cloud-phase.test.ts`、`farColumnReference.ts` | 保留旧失败数值，独立空间参考与真实生产 GLSL 对照 |
| 新增 `tests/cloud-startup*`、`cloud-assets.test.ts`、`webglTrace.ts`、`stage5-scene*` | 资源生命周期、启动分解、互斥整帧/分 pass GPU query、固定状态截图与连续镜头 |
| 新增 `tests/cloud-closure*`、`cloud-partial*`、`cloud-cache*`，`scripts/validate-grazing.ts`、`validate-material-range.ts` | 分别测生产合成闭环、部分柱统计、沿射线缓存、空间扫描和材质表适用范围；失败诊断保持红色 |

## A：空间过滤与 HG

固定 seed=13、coverage=.62、density=1.1、base=1.5 km、thickness=3.8 km、detail=.55、type=0，风角/演化均 0。patch 经纬度和匹配正交屏幕基采用任务指定公式。CPU 使用实际天气/noise/CloudOptics 字节与独立双精度纹理插值；均匀 192²/384² 参考不调用被测主轴规则。

| patch / footprint km / mu | 旧 opacity | 参考 192² | 新 opacity | 旧绝对误差 | 新绝对误差 | 柱查询数 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 5 / 28 / .25 | .432947019 | .377614323 | .378426057 | .055332696 | .000811734 | 432 |
| 3 / 4 / .1 | .444025717 | .512165883 | .512811850 | .068140166 | .000645967 | 144 |
| 5 / 4 / .04 | .624345483 | .411100718 | .420830895 | .213244765 | .009730177 | 144 |
| 0 / 4 / .1 | 0 | .062043154 | .061323635 | .062043154 | .000719519 | 144 |

这张表是同一远景模型的局部空间平均，不是旧 GPU 最终 L/T 的失败数据。四例参考自身最大变化 .000241752。真实 GLSL 四例最大 opacity 误差 .009643774；加入旋转 .37/π4/1.2 的 16 例最大误差 .018365172。端点连续性与参考准确度分别检查，前者不意味着后者通过。

投影后仍是屏幕方形对应的平行四边形；逆 CDF 条带保持面积分布，不把它替换成外接矩形。长轴嵌套 4→12→36、短轴 4→12，混合完整 optical moments；径向保留原规则，奇异值比 1.05–1.25 过渡。最多 432 柱，窄过渡最多 576，没有新增纹理。生产高度预算仍 40/64/96。

96 组（patch 0/3/5/7，F 4/12/28，mu .04/.1/.25/1，旋转 0/π4）有 3 组未达到建议的 .02：

| patch / F / mu / rotation | opacity 有符号误差 |
| --- | ---: |
| 3 / 12 / .04 / π4 | +.020653916 |
| 5 / 4 / .1 / π4 | +.020125789 |
| 5 / 12 / .1 / π4 | −.020243913 |

全部 96 点均追加 384² 参考。原四例和候选失败点的最大变化 .000501762；全扫描中 patch 5 / F28 / mu .04 / rotation 0 的 700 km 支持域变化 .002954427，192² 未收敛。对该点追加 768² 后，384²→768² 变化 .000107160，候选误差 −.011046407；其它点的 192²→384² 变化均 ≤.002。三个候选失败点改用 384² 参考仍分别为 +.020152154、+.020099566、−.020116692，没有把参考自身未收敛当成算法通过。`npx tsx scripts/validate-grazing.ts` 保留退出码 1；没有扩大 .02。该预算不保证所有世界点。

最终脚本按各点已检查的最细参考判定 accuracy，同时保留原始 192² 行。全扫描最终最大参考变化 .001903575、最大候选 opacity 误差 .020152154；参考收敛门槛通过，候选准确度仍有同样 3 个失败点。

HG 使用 262,144 个方向余弦中点积分并检查有限值/非负值。g=0/.72/.78/.88/.9 均覆盖。g=.9 旧峰值 8.230132902 sr⁻¹、旧积分 .949944843；修复后 CPU 峰值 15.119719594，GPU 峰值 15.11974144、积分 1.0000004625。没有引入冰晶微物理。

### 统计模型的剩余范围

`material-range.json` 使用同一个 256 柱集合，独立 96/192 高度积分检查 detail/thickness/density，最大参考变化 .000565。默认及 density=.5/2 的 opacity 误差约 ≤.00165；detail=0 达 −.04290，detail=1 达 +.03600；thickness=1 km 达 +.26102，8 km 达 −.12943。固定表仍按 detail=.55、3.8 km 烘焙；通过“变参数后的同一表的空间平均”不能证明它仍同源于修改后的近景体素。

部分柱诊断单独运行生产 `farCloudDensity`，与各子柱先应用相同归一化剖面截取比例、再平均 T 的参考比较。其边界是冻结当地径向云柱，不等同完整程序化掠射路径。完整柱的 `E[T]` 无法唯一决定截取柱的 `E[T^f]`；将有效密度截短通常得到 `(E[T])^f`。16 组中 10 组未通过 .02，最大 opacity 误差 −.337364601（patch 7，起点归一化高度 .5），参考 192²→384² 最大变化约 .000012167。详细数值见 partial-gpu.json；该项明确未修复。

沿射线缓存另用生产密度与照明、相同 256 步有限球壳积分比较逐样本重算，只隔离缓存误差。低轨一组已有缓存最大 T 误差 .062012553，全球一组 .011750638。尝试扩大长轴复用后没有通过完整 .002 门槛，**生产改动已撤回**；诊断保留候选和原算法数值。该测试不是高步数整条射线的独立输运参考。

## B：启动、成本与存储

GPU 数据来自同一前台 Chrome、ANGLE D3D11、NVIDIA RTX 5080。固定 drawingBuffer=1920×1080、垂直 FOV=60°、medium、HDR、exposure=8、seed=13，参数和相机 ECEF/direction/up 随每组 JSON 保存。风速参数 24/48 m/s，但平流与演化暂停为 0。白昼 UTC=2026-06-21T17:00Z；默认有云夜景=2026-10-26T04:12Z。日/月尺寸 3.2/3，亮度未改。七场景为全球、低轨、云内、地面昼景、默认有云夜景、仅高云、双层；“全球”和“双层”同参数是重复观测，不是不同天气。

整帧和分 pass 分轮进行，不嵌套 TIME_ELAPSED。每场景每模式两轮，目标每轮 200 有效样本，剔除 disjoint，保存原始毫秒数组、均值/中位/P95、样本数、隐藏/失焦与 >100 ms 帧间隔计数。帧间隔和 CPU submit 只用于状态说明，绝不代替 GPU 时间。两轮合并的分布如下；独立轮次及 atmosphere/resolve 分布保存在 gpu-summary.json。

| 场景 | 基线整帧 mean / median / P95 ms | 本轮整帧 mean / median / P95 ms | 本轮 cloud-volume mean / median / P95 ms | 每列样本数 |
| --- | ---: | ---: | ---: | ---: |
| global | 9.808 / 10.737 / 11.789 | 17.816 / 17.325 / 22.091 | 14.013 / 13.892 / 15.868 | 400 / 400 |
| orbit | 10.730 / 10.902 / 12.015 | 16.532 / 16.582 / 17.473 | 10.343 / 10.242 / 10.961 | 400 / 400 |
| inside | 56.276 / 55.522 / 61.240 | 98.730 / 98.325 / 104.001 | 96.424 / 95.969 / 101.467 | 400 / 400 |
| ground | 49.501 / 49.875 / 50.978 | 72.900 / 72.103 / 75.720 | 69.113 / 68.571 / 72.610 | 400 / 400 |
| night | 38.253 / 38.632 / 40.049 | 66.209 / 65.564 / 71.991 | 64.109 / 63.391 / 74.205 | 400 / 400 |
| high-only | 5.286 / 5.353 / 6.425 | 5.468 / 5.471 / 5.919 | 1.781 / 1.648 / 2.208 | 400 / 400 |
| two-layers | 9.994 / 10.778 / 11.925 | 17.667 / 17.259 / 21.620 | 14.171 / 14.116 / 15.998 | 400 / 400 |

两端全部轮次 hidden/unfocused/disjoint 均为 0。本轮云内有 221 个、地面 6 个、夜景 8 个帧间隔超过 100 ms；这反映重负载，未据此推断 GPU 时间或宣称没有系统频率节流。未读取 GPU 时钟/功耗，硬件降频状态未知。主云场景明显变慢，稳态性能目标尚未达成。

基线（shader 缓存状态未清空）mount=532.3 ms，完整画面 ready=3432.1 ms，最长任务=534 ms；主线程 weather/noise/cirrus=274.4/236.5/17.5 ms；worker noise/voxel/optics=254.4/806.4/646.8 ms，等待=76 ms。不能把此前约 46 秒 ready 全算为生成，也不能全部算为编译。

基线首次 low/high/RGBA8 切换墙钟约 38.3/40.6/41.5 秒，其中 cloud LINK_STATUS 等待约 38.28/40.56/41.40 秒；返回已用 medium HDR 约 12.7 ms。API 等待可能包括延迟编译/驱动/调度，无法直接拆成纯 CPU 编译及 GPU 时间。

优化后的资源生命周期夹具：不使用缓存时 worker noise/cirrus/voxel/optics/weather 约 284.2/17.9/792.0/627.1/284.1 ms，worker 等待 62.3 ms，资源 ready 2073.1 ms；热缓存读取约 13.3 ms，资源 ready 22.3 ms，无生成。它在资源就绪后立即销毁，**不是完整场景启动时间**。最终完整场景冷/热记录如下。

最终完整场景启动（资产 cold = 显式绕过 IndexedDB，**未清空驱动 shader 缓存**）：

| 项目 / ms | 资产冷启动 | 热资产启动 |
| --- | ---: | ---: |
| mount | 0.1 | 0.4 |
| 首次 postRender 后 timer 任务 | 132.0 | 150.6 |
| 所有资源 ready | 2161.5 | 239.2 |
| 完整画面（ready 后 10 帧） | 2281.8 | 451.8 |
| 资源上传提交合计 | 2.0 | 3.9 |
| worker 启动等待 | 36.4 | 33.1 |
| worker 执行墙钟 | 1996.1 | 24.7 |
| worker 结果交付等待 | 0.3 | 25.3 |

冷启动 worker noise/cirrus/voxel/optics/weather 分别为 268.2/18.3/794.1/643.5/271.6 ms；热启动生成量为 0，缓存读取 15.0 ms。冷启动未观测到 ≥50 ms 的 Long Task（不代表最长任务为 0）；热启动观测到的最长任务 86 ms。首次 timer 任务是可交互代理指标，没有测真实输入响应延迟。resourcesReady 指资源 promise 完成及上传已提交，fullFrameReady 指其后的 10 次 postRender，均不等于 GPU fence 或操作系统实际呈现完成。GPU 首次 draw query 另存于启动 JSON，不把提交或 link 等待记成 GPU。



曾把所有 loop 上界改为 uniform，但实际云内整帧从基线约 56 ms 增至约 101 ms，且一次新 program 链接仍约 49.9 秒。恢复静态高度循环仍约 101–104 ms，并出现 44.9 秒 LINK_STATUS 等待；只换回旧过滤规则、保留其余改动，云内恢复为 55.30/55.39 ms。成本增量随纠正后的过滤出现，不能宣称同画质加速。最终保留运行时高度/外层界限及小光照循环常量；各尝试的原始数据也随包提供。最终首次 low/high 切换仍为 45,381.7 / 45,561.8 ms，未解决首次画质编译停顿；medium HDR→RGBA8→HDR 为 19.3 / 15.3 ms，格式共用 shader 的收益不能冒充首次 quality 编译优化。

缓存 `CLOUD_ASSET_VERSION=1`；WeatherField/CloudNoise/CumulusNoise/VoxelCloudField/CirrusField/CloudOptics 的生成、布局、材质定律变化必须升版本；天气记录还校验 seed。质量/HDR 不使固定资产失效。IndexedDB 仅保留 fixed 和 latest weather 两条记录，失败按 miss 处理。全云纹理/原始 payload 合计 16,314,560 B，其中天气 2,097,152 B、固定材质 14,217,408 B；缓存数据库开销未直接测量。Transferable 单测校验内容 hash 一致及源 buffer 已 detach。

GPU 附件数量和规格未增加：medium 云积分 1248×702，RGBA16F=7,008,768 B，RGBA8=3,504,384 B；这不是总显存。月面纹理含 mip=11,184,812 B，保持原资源。上传以 4 ms CPU 调用预算在整张纹理之间让出帧；单张上传不可分割，不能保证驱动每次 ≤4 ms。已测 upload 是提交调用墙钟，不是独立 DMA/GPU 上传时间。

worker、取消的 frame callback、部分上传、被替换纹理和 postprocess stage 由 effect 释放。新请求取消旧请求并用 epoch 阻止迟到结果；加载中的 quality/HDR 设置保留。Worker 不可用时仍有程序化低/高云回退；上传失败标记 failed，不伪装资源 ready。没有仅用 loading 界面隐藏主线程阻塞。

## C：生产合成闭环

`cloud-closure` 生成真实 Hillaire transmittance/multiple/irradiance LUT，调用生产 `integrateCloudInterval → appendCloudSegment → resolve`，只在既有测试 seam 将显示映射替换成 identity，读取显示前的线性 L/T。覆盖零云、单薄云亮背景、双层、云内部分段、有限掠射和日落。

参考独立实现整条射线 4096/8192 步混合空气/云及 clear-air 源项、RGB 光深累积，不调用被测 transport helper 或 integrateAtmosphere。相同 LUT、光学假设与源项，使用补偿求和避免 float32 长链重复相乘的漂移。最大 L 误差 .000284195、RGB T .000035680、参考变化 .000075579；6/6 通过（门槛分别 .002/.002/.0002）。静态/运行时高度预算结果最大差 0。保留当前正确的段合成结构，没有以调空气参数掩盖统计模型误差。

范围：这里的受控有限球壳介质隔离合成正确性；它不证明程序化远景部分柱或沿射线缓存已正确。

## 复核与交付

- `npm test`：46/46 通过；`npm run build`：通过（既有 bundle 大小提示仍在）。
- 14 个真实浏览器回归夹具共 152/152 检查通过：grazing-gpu 21，startup-lifecycle-final 10，pipeline-gpu 8，closure-gpu 6，atmosphere-gpu 9，lighting-gpu 6，cloud-gpu 21，water-cloud-gpu 14，high-cloud-gpu 11，satellite-lod 8，celestial-state 21，celestial-scene 7，celestial-gpu 6，celestial-optics 4。这是功能回归计数；空间矩阵、部分柱和缓存诊断的红色门槛单列，不包含在这 152 项中。
- 浏览器各夹具的结果、截图、相机逐帧状态和 GPU 原始样本见忽略目录 `artifacts/stage5/` 及独立 `artifacts/stage5-evidence.zip`。
- PNG 通过分块提取，检查完整 IEND 和解码；不交付截断图片。
- 交付打包要求工作树已提交，保存同一 HEAD 的源码快照和 SHA-256 清单；另外逐项检查 28 组前后计时的相机、UTC、参数、风、FOV、drawingBuffer、quality、HDR 和曝光相同，结果保存为 `condition-validation.json`。独立红色诊断仍随包交付，不计入功能通过数。
- 真实 DEM、真实 3D Tiles、跨 GPU/驱动表现未验证。保留并运行程序化地形/不透明实体回归；不能据此声称真实数据服务已覆盖。
- 连续镜头的关键帧只能支持已观察区间的视觉判断；记录了 24 秒、783 帧状态和 25 个关键帧；抽查可见近景固定抖动颗粒和部分高云条纹重复。没有光流/逐像素时序参考时，不宣称“零闪烁”或画质百分比。没有引入 TAA。

最早的 Windows 原生浏览器控制接口因不能可靠识别 URL 停止；随后 Chrome 扩展接口恢复，用户确认保持验证页前台。此后证据来自本轮真实浏览器，不是借用以前阶段的截图或计时。


前景回归首次因异步实体尚未准备完（frusta=0，月盘仍 229）失败。夹具从固定等 5 帧改为最多 120 帧等待真实前景绘制队列，再检查原来的像素阈值；不是放宽遮挡门槛。独立高云探针也发现新增循环宏在截取 integration 函数时缺失，默认值已移到使用处，生产完整 shader 的预处理含义不变。两条首次失败证据均保留。

首次 draw 的 GPU query（各仅 1 个样本，不能替代稳态分布）：基线 cloud-volume=134.594560 ms，冷资产本轮=17.038048 ms；本轮 sky-view=1.324448、atmosphere-composite=.185888、cloud-resolve=.112768 ms。对应 CPU link/status/draw 时间保留在启动 JSON；没有把这一个样本解释为同画质加速。

异步 seed 更新额外修复：加载期间 u_seed 与已采用的天气纹理配对；新纹理和 seed 一起提交。快速取消和 13→14→13 的资源/状态回归通过，固定 seed=13 的 GPU 场景含义不变。

全链 RGBA8 已运行并保存 full-rgba8-state.json；程序化 1150 m 山脊与椭球用同一 sun-horizon 镜头保存 terrain-*-state.json。另有太阳薄幕云/无云对照：1920×1080、垂直 FOV=6°、曝光8、同一 UTC、Cirrostratus、低云 coverage=0；它是隔离光学检查，不进入七场景性能对比。所有额外镜头参数与 enabled 状态保存在对应 JSON。

最终保存 54 张通过 IEND/解码检查的 PNG。薄幕云太阳的 6° 窄视场显示大面积接近白色的前向散射和显示饱和；该图是运行证据，不据此宣称真实薄云画质通过。地形对照显示程序化山脊挡住相应地平线区域；实际 DEM/3D Tiles 仍未运行。

