# 第六阶段：正式入口、有限段统计、成本与 quality（2026-10-28）

审查基线为 `016156a07119e36fa3d4b274bdd6d5bfa20e5755`，性能比较基线为 `f1c2d051762608a7939d8871168ad1d0d11af9a3`。开始时 HEAD 与审查基线一致，保留第五阶段全部历史。本轮在原工作树实现，没有重置、关闭云层、改曝光或引入 TAA。

**整体验收仍为红色。** 有限柱的 Jensen 错误、材质表与运行时参数不同步、正式入口的同步重复生成、quality 源码变体已处理。扩展空间矩阵、一个有限掠射病例、高档远景辐亮度和全球/低轨成本仍未全部达到原门槛。通过的功能项不能替代这些独立门槛。

## 变更与契约

| 文件 | 根因与结果 |
| --- | --- |
| `CloudComparison.ts`、`CloudAssetManager.ts`、`GlobalCloudEffect.ts`、`main.ts` | 过去默认 cellular 仍同步挂载 WaterCloudEffect，后者重复生成 weather/noise。现在仅挂载选中的模型；比较器拥有共享 GPU 资产，两个 effect 借用。首次 water 切换沿用已加载资产，不延后再生成一次。独立 effect 仍拥有自己的 manager |
| `CloudAssets.ts`、`CloudAssetCache.ts`、`CloudAssetLoader.ts`、`CloudInitialization.ts` | 固定资产和天气走既有 worker/Transferable 路径；seed 与天气原子采用。固定资产版本和 optics 算法版本都校验，拒绝同尺寸旧数据。取消、部分上传、失败和销毁释放资源 |
| `CloudOptics.ts`、`CloudMaterialLoader.ts`、`optics.worker.ts` | detail 改变侵蚀分布，thickness 也改变体素采样位置，不能只缩放固定表。按实际二者生成小表，120 ms 防抖，取消旧 worker，最多缓存 4 组。表与已采用材质一起更新。density 保持纯光深 scale，不重建固定资产 |
| `shaders/density.glsl`、`march.glsl` | 完整柱 mean T 转 sigma 后截短得到 `(E[T])^f`。改为正光深分量先施加每子柱的有限球壳路径，再形成累计响应 Q(s)。云内从真实观察起点开始，段内条件增量望远镜相乘；每个有限低云段构建一次统计 |
| `shaders/droplet-lighting.glsl`、`density.glsl` | L 与 T 使用同一相关分量；每个分量应用近景已有的散射阶次概率与前向消光，再平均。遗漏这些权重会让远景变亮。保留日/月地心照明、HG 和独立高云 |
| `shaders/quality.glsl` | LIGHT_STEPS 与 CLOUD_SUBSTEPS 也由运行时 uniform 提供。三档和两种附件格式共享源码，仍使用各档原有采样位置、预算和附件尺寸 |
| `tests/actual-entry*`、`cloud-finite*`、`cloud-layered-closure*`、`cloud-work*`、`cloud-partial.test.ts`、现有 GPU 夹具 | 覆盖真实 main 生命周期、有限路径、统计复用、生产背景基色提取、工作量和原回归。诊断计数只存在于测试 shader，不混入正常 GPU 计时 |

共享资产 manager 取消请求时终止 worker，并用 epoch 拒绝迟到结果。未挂载模型不注册场景监听器；已挂载但 inactive 的模型不推进风场，切换时复制当前 motion。两个模型参数广播保持一致。Worker 不可用的兼容分支仍分帧执行同步程序化 weather/noise/cirrus，**不能声称该失败路径也完全无主线程阻塞**。材质 worker 失败保留上一组匹配的材质与纹理。

## 有限段统计与材质

新分量纹理为 `32×32×8 RGBA8`（32,768 B）。cut/type 为两轴，每个格保留 8 个正光深分量，以平方分位边界细分薄尾部。RG 存 16-bit `log(1+tau)/log(65)`；B 存 population/256；A 存 interior。未占用概率隐含为清空柱。旧 CloudOptics.A 仍是 `P(T<.9)`，没有用它冒充严格非空概率。

生产使用实际裁切起止端点，以及每个空间子柱的 type/top。短陡路径用端点半径和真实平均径向速度积分剖面，长掠射用有限球壳 Gauss 积分。相同分布内计算 Q(s)，按 `Q(s1)/Q(s0)` 得到条件 T，并以同一分量的吸收权重准备源项。没有把独立平均的小段 T 连乘，也没有条件化到云内相机身后的路径。

| 检查 | 结果与边界 |
| --- | --- |
| 原 partial 16 条 | 16/16；opacity ≤.02、参考自收敛 ≤.002 不变 |
| patch7 / F28 / h0=.5 | 旧 CPU .370206001；CPU 384² .707817710。新 GPU .705358744；GPU 384² .707628707。CPU/GPU 参考的小差异单列，不混用 |
| 16 条 GPU partial | 最大 opacity 误差 .007024584；参考最大变化 .000013275；分段乘积与整段响应一致 |
| 七条真实有限球壳 | 六条达到 .02；patch5 / height80 km / mu=.16 / F12：.071847081 对 .092772999，误差 −.020925918，仍失败。该参考 192²→384² 变化 −.001452891，已在 .002 内 |
| 响应节点复用 | 七条通过；8节点对64节点最大 L误差 .000474152、T误差0，32→64最大变化 .000019093，保留 .002 门槛。这是同源项的复用误差，不是独立完整程序化 L 参考 |
| 96 点空间矩阵 | 仍有原三个失败点：+.020152154、+.020099566、−.020116692；最细参考最大变化 .001903575。脚本保留非零退出码 |
| 材质范围 14 条 | 重建匹配表后最大误差 .003323983，参考变化 .000564524。旧 detail=0、thickness=1/slant10、thickness=8/slant1 的错误仍随 JSON 保存 |
| 分量压缩 480 条 | 最大 opacity 误差 .014749314；五材质×四 cut×三 type×八 scale，参考为原 256 柱集合，不能推广为整个世界画面误差 |

空间矩阵的三个失败点分别是 patch3/F12/mu.04/π4、patch5/F4/mu.1/π4、patch5/F12/mu.1/π4。没有为三个点整体继续提高空间预算。原四反例、主轴/平行四边形面积过滤、4/12 km 与 .35/2 km 端点和内部采样保持。

远景仍将天气冻结在该有限段的 footprint anchor。各子柱有自己的云顶和路径，但没有表示长掠射过程中不断变化的天气，也没有跨独立 interval 保存同一柱身份。8 个分量及共同高度剖面不能恢复完整三维体素的所有条件相关性。高云原有统计近似未扩展为新的低云分量模型。

实际高采样近景对照还发现远景散射源项不一致。修正分量的散射阶次权重后，medium 最大 RGB L 向量误差 .016658692→.007985569；low 为 .006870749，high 为 .010774062，**high 仍超过原 .01**。相应 T 误差分别 .018331238/.019123589/.059927039；这是旧卫星 LOD 夹具自己的 .06 门槛，不替代新的 .02 空间/partial 门槛。没有修改二者门槛。

## 工作量、启动与 program

`cloud-work` 在七个固定镜头各采 5×3 条实际生产射线，分开记录低/高云的近/远分支。它不是全画面像素普查。主云分布构建次数 / 空间 taps / 分量纹理查询总数分别为：global 1/144/176、orbit 15/304/280、inside 0/0/0、ground 0/0/0、night 0/0/0、high-only 0/0/0、two-layers 1/144/176。主云近/远段调用数分别 0/1、1/15、15/0、10/0、10/0、0/0、0/1。

这些选中射线每个主云有限段构建一次，没有旧点密度缓存命中。响应节点复用限于同一个已裁切有限段；新段重新构建，原因及原 anchor/footprint/slant 触发量保存于逐射线 JSON。旧缓存诊断仍保留 .002 失败，不能用其原约 .062 的低轨误差换速度。没有扩大旧复用距离。

真实 `main.ts` 入口默认、首次 water、加载中切换、快速 seed、禁用/启用、材质取消/原子采用和销毁分别运行。冷/热生命周期各 10/10，加载中流程 9/9；三个流程均确认参数/seed/纹理所有权一致。审查基线的真实入口 mount=517.3 ms，inactive Water 主线程 weather/noise=276.2/238.8 ms；本轮 mount=.1 ms，inactive Water 未挂载。冷资产生成均为 worker：noise279.5、cirrus17.8、voxel780.0、optics674.8、weather267.1 ms。

| 真实 main，墙钟 ms | 冷资产 / 本轮源码首次 program | 热资产 / 热 shader |
| --- | ---: | ---: |
| boot 返回 | 95.1 | 105.2 |
| mount | .1 | .1 |
| 首次 postRender | 119.0 | 132.5 |
| 首次 postRender 后 timer | 127.0 | 141.0 |
| 资源 ready（相对入口） | 2157.7 | 205.4 |
| ready 后 10 帧 | 54858.9 | 366.7 |
| 主线程最长 Long Task | 52607 | 75 |
| worker 等待 / 执行墙钟 / 交付等待 | 80.4 / 2019.3 / .3 | 88.1 / 45.1 / 5.5 |

冷启动纹理上传 CPU 提交合计约 2.2 ms；热缓存读取15.3 ms且没有生成。生成项也是worker内performance.now墙钟，不是CPU profiler自耗时；独立GPU上传/DMA时间未分离。上述 ready 不等于 GPU fence。127 ms 的 timer 是早期交互代理指标，**随后仍有52.6秒同步停顿，不能称为持续可交互**。本轮源码 hash=`0c2f9e90` 的首次 cloud program `LINK_STATUS` 等待52595.9 ms；linkProgram调用约.1 ms。未清除驱动全局缓存，“首次”只指本次链路和该源码的首次记录。

真实入口使用应用默认视口、时间及UI状态（随JSON保存），不与1920×1080矩阵的帧成本混用。随后固定1920场景的冷资产/热shader启动资源ready=2050.5 ms、10帧ready=2400.7 ms，同一hash链接等待20.6 ms。首次draw GPU query单样本：cloud-volume70.971712、sky-view1.327040、atmosphere-composite.181664、resolve.122784 ms；单样本不替代稳态分布。

首次 water 切换提交.1 ms、到两帧6754.3 ms；热 shader 重复流程为101.0 ms。没有重新生成 weather/noise，第一次停顿来自尚未使用的 Water program；因此仅“资产异步/复用”通过，首次模型画面的非阻塞性仍未解决。加载中流程在 `startedWhileLoading=true` 时切换并取消13→14→15→13请求，最终只有采用的13及对应纹理可见。失败/取消/释放另外由10项资源生命周期测试覆盖。

| 切换顺序 | wall ms（3 postRender） | 新cloud link | 附件提交数 | 整帧 mean / median / P95 ms | volume | frame/volume 样本 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 low HDR | 121.8 | 0 | 8 | 28.449 / 26.348 / 50.359 | 24.980 / 24.532 / 29.017 | 200/200 |
| 2 high HDR | 12.9 | 0 | 8 | 69.782 / 69.576 / 77.116 | 70.273 / 69.793 / 76.318 | 200/200 |
| 3 medium RGBA8 | 14.1 | 0 | 8 | 41.761 / 39.978 / 66.736 | 37.197 / 37.381 / 41.569 | 200/201 |
| 4 medium HDR | 28.7 | 0 | 8 | 40.419 / 40.400 / 45.107 | 39.259 / 38.438 / 43.208 | 200/201 |
| 5 low HDR | 20.5 | 0 | 8 | 26.230 / 25.950 / 30.439 | 24.539 / 24.374 / 27.530 | 200/200 |
| 6 high HDR | 25.4 | 0 | 8 | 69.681 / 69.469 / 75.941 | 70.727 / 69.777 / 75.950 | 201/200 |
| 7 medium HDR | 38.2 | 0 | 8 | 40.706 / 40.352 / 45.324 | 39.118 / 38.779 / 43.688 | 200/200 |

以上7次切换新增cloud program/link均为0；初始program 19/source hash 0c2f9e90复用。附件重建单列，quality使用原有low/.5、medium/.65、high/1分辨率与40/64/96高度预算，不把不同档成本称作同画质加速。每次切换分别采集整帧和pass，均至少200有效query。wall只到3次postRender，未等待GPU fence；quality首次变体停顿已消除，但单一program的首次冷链接仍未消除。

Cesium 1.146 的实际调用链仍在 `ShaderProgram.js` 的 program 初始化里同步调用 `getProgramParameter(program, LINK_STATUS)`。记录的 API 墙钟包含驱动、延迟编译、调度和可能的 GC，不能拆称纯 CPU 编译或 GPU 时间。本轮没有接管 Cesium 的异步 program 生命周期，也没有声称获取 KHR_parallel_shader_compile 就完成了非阻塞编译。

| 单因素源码缩减（仅测试） | source hash | LINK_STATUS 墙钟 ms |
| --- | --- | ---: |
| no-statistics | 819c4708 | 32483.9 |
| no-cone | 743f8699 | 34966.7 |
| no-ice | 677b59c2 | 31393.0 |

缩减只用于定位：no-statistics移除有限段统计构建/光照，no-cone替换近景光锥，no-ice移除高云密度/光照。均是故意不正确的画面，没有拿其GPU时间宣称同画质加速。每个新source各一次，驱动缓存未清空；对比本轮完整source首次52595.9 ms，三个缩减仍分别阻塞31–35秒。多个源码部分都影响驱动优化，不能相加或据此分配编译百分比。未采用预热全部变体隐藏等待。

资产版本为 `CLOUD_ASSET_VERSION=3`，统计算法版本 `CLOUD_OPTICS_VERSION=3`；缓存键包括资产版本、统计版本、detail、thickness。天气还校验 seed。固定生成器/布局/分量分组或材质定律改变必须升版本。quality/HDR/density 不使固定资产失效。材质缓存最多 4×(131072+32768)=655360 B，不含 IndexedDB 元数据；固定+天气原始 payload 合计 16,347,328 B。保留用于材质重建的 CPU noise+voxel 为 9,437,184 B，传给 worker 的副本使用 Transferable，取消时由 worker 终止释放。

GPU 附件规格没有增加：medium 云积分 1248×702，RGBA16F 7,008,768 B，RGBA8 3,504,384 B。这不是总显存；月面纹理含 mip 的 11,184,812 B 未改。上传仍以整张纹理为不可分割操作，4 ms CPU 调用预算只在纹理之间让出帧，不保证每张 DMA/驱动耗时 ≤4 ms。

## 同机 GPU 分布

本轮按用户选择使用**内置浏览器**，在同一 RTX 5080 / ANGLE D3D11 重新测 `f1c2d05` 和本轮，不能与第五阶段 Chrome 数字直接作同环境比较。固定 drawingBuffer=1920×1080、fovy60°、medium/.65、HDR、exposure8、seed13；风速参数保留但角度和演化暂停为 0。白昼 UTC=2026-06-21T17:00Z，夜景=2026-10-26T04:12Z。相机 ECEF/direction/up、全部参数、日/月尺度随原始 JSON 保存。

| 场景 | f1c2d05 整帧 mean / median / P95 ms | 本轮整帧 | 本轮 cloud-volume | 有效样本（整帧 / volume） |
| --- | ---: | ---: | ---: | ---: |
| global | 5.912 / 5.887 / 6.735 | 40.792 / 40.521 / 45.334 | 39.142 / 38.883 / 43.263 | 401 / 400 |
| orbit | 8.846 / 8.731 / 9.654 | 13.967 / 13.743 / 14.880 | 11.492 / 11.456 / 12.347 | 400 / 400 |
| inside | 55.341 / 55.054 / 58.174 | 25.430 / 24.333 / 36.983 | 22.850 / 22.039 / 34.315 | 400 / 401 |
| ground | 45.775 / 45.562 / 47.123 | 21.667 / 20.555 / 31.543 | 18.781 / 18.287 / 21.582 | 400 / 400 |
| night | 35.963 / 35.786 / 38.840 | 17.064 / 15.795 / 25.093 | 14.764 / 14.046 / 22.816 | 401 / 400 |
| high-only | 4.064 / 4.049 / 4.666 | 4.122 / 4.052 / 4.999 | 2.231 / 2.051 / 2.825 | 400 / 400 |
| two-layers | 6.063 / 6.020 / 6.815 | 40.960 / 40.455 / 45.213 | 39.090 / 38.769 / 43.428 | 403 / 400 |

两端所有轮次的 hidden/unfocused/disjoint 均为0。本轮超过100 ms的帧间隔计数：global=2、orbit=0、inside=0、ground=0、night=0、high-only=0、two-layers=1。原始分布保留这些状态，不据此推断时钟节流。

全球、低轨和双层成本目标仍失败；云内、地面和夜景平均成本低于本轮同机重新测量的 f1c2d05，但P95波动也按原值报告。high-only 的小幅差别不能作为统计等价或加速结论。

整帧与分 pass 分轮，均各两轮目标 200 有效 EXT_disjoint_timer_query_webgl2 样本；不嵌套 TIME_ELAPSED。固定条件逐组校验，除相机 up 的重复归一化允许 128 个 double epsilon，其它字段精确相等。帧间隔和 CPU submit 只说明运行状态，不代替 GPU 时间。硬件时钟/功耗未读，不能排除系统级降频。

曾尝试 vec4 分量向量化，全球从约 40.6 ms 退到约 49.6 ms，云内/夜景也退步，已撤回；原始试验单列保存。生产保留标量分量。纠正统计和源项后，不能以近景的改善宣称所有场景已恢复比较基线成本。

## 生产闭环与回归

保留六例受控 `integrateCloudInterval → appendCloudSegment → resolve` 和真实 Hillaire LUT。新增四例实际 layered 生产段：零云、亮背景薄主云、双层、云内部分柱。固定光源/LUT，仅改变末端黑、白、R、G、B 基色，经真实 Hillaire composite 与 resolve 独立提取显示映射前 L 和 RGB T。没有把参考 clearT 拼接成生产 T。

独立参考对正光深分量和空柱分别做 2048/4096 步整条空气/云射线积分，再合并 L/T，不调用被测 transport helper。最终四例最大 L 误差 .000116606，RGB T .000348295，参考变化 .000020231，均通过 .002/.002/.0002。该测试采用常量天气/noise 隔离传输契约，仍保留真实材质分量和高云定律，不能证明空间变化天气下的完整源项误差。旧六例的 `referenceAirTimesMeasuredCloudT` 只作为 factorization 检查明确命名。

Cesium 地表输入仍是既有 LDR 近似：已裁掉的地表高光不能逆恢复；自定义天空/日月/云则保持 scene-linear HDR 到统一显示映射。没有改动已经正确的有序空气/云段合成公式。

`npm test` 62/62、`npm run build`通过（既有bundle体积提示）、`git diff --check`通过。原14组浏览器功能回归为151/152：仅satellite-lod的high辐亮度检查失败；并非全部通过。其余包括grazing21、startup10、pipeline8、closure6、atmosphere9、lighting6、cloud21、water14、high-cloud11、celestial-state21、celestial-scene7、celestial-gpu6、celestial-optics4。额外四组背景基色检查、三档静态/运行时预算一致性也通过（后者最大L/T差0）。独立partial/material/finite/cache/实际入口/成本类别单列，不能并入功能计数冲淡失败。

最终连续镜头24秒、1204帧状态、25关键帧；含七场景与七张quality/HDR截图，共47张PNG通过IEND和解码长度检查。抽查global/inside/night、高档、RGBA8及云上/云内关键帧：天气位置连贯，但近景抖动颗粒、云缘模糊和远处重复形态仍可见。没有逐像素重投影误差参考，不将帧间隔解释为零闪烁。global与two-layers是相同参数的两次观测，不是不同天气。

固定状态校验同时覆盖28组前后GPU轮次和7组前后截图；PNG与状态分别保存。灯光夹具最初因隔离stub缺少新增有限响应声明而编译失败，修复测试接口后按原0/2次phase准备门槛通过，首次失败文本保留。生产shader没有用stub替换，数值阈值未调整。

证据在忽略目录 `artifacts/stage6/` 和单独的 `stage6-evidence-<HEAD>` 包。小型 `result.json` 明确各类状态；HTML 展示固定镜头、连续镜头、原始 query、启动及失败项。打包时要求工作树已提交，提供同一 HEAD 源码快照、两个基线快照和 SHA-256 清单，不将 artifacts 加入 Git。

未验证：真实 DEM、真实 3D Tiles、其它 GPU/驱动、硬件频率节流、长掠射沿途变化天气的独立完整 L 参考、严格逐像素时域误差。程序化地形/前景深度回归不能代替真实数据服务。连续镜头只支持已保存区间的观察，不能宣称零闪烁或固定 FPS。空间与成本红色项解决前没有引入 TAA/重投影。
