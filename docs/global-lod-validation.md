# 卫星云的空间场与 LOD 验证（2026-10-23）

本轮在 `ba403d74b9849653589bc3223732a44a5e0dc9fd` 当前工作树继续；更早的审查基线为 `df4ab3cef769f48bdf35c76fabf83d41026ebe05`。没有回退或覆盖其他修改。前一轮大气外透射、SkyView、当地天空照明、线性 HDR、日月可见性和第二体素域深度换算保留。

## 根因与实现

- `CloudOptics.ts` 原先把世界各处的约 30 km 云团一起统计。全球均值可以接近参考，但同一片局地云团会被换成全球平均空隙。新表只统计同源体素材质；运行时保留当地天气、云型和云团掩码，再对屏幕足迹内的 **12×12 子云柱**平均最终透射率与覆盖概率。
- 平均噪声再阈值不等于过滤最终云；`exp(-E[tau])` 也不等于 `E[exp(-tau)]`。新路径先得到 `E[T]`，然后用 `-ln(E[T])` 构造归一化有限厚度介质。这仍是有说明边界的云柱近似，尤其不能把局部平均 tau 当作精确遮挡。
- `march.glsl` 在 **0.35–2 km 屏幕足迹**之间分别积分两种表示，混合预乘线性 L 与 T，再与前面的云段合成。没有按相机海拔切换，没有把两份云密度叠加。近景体素与完整 mip 链保留；远景密度和照明都不再读取已坍缩的体素 mip。
- 原远景双流反射补光与近景光照不一致，局部亮度偏高；改为同样的方向相函数和 1.5 km 有限自阴影域，使用表内的条件内部遮蔽概率。光照路径也不能指数化平均 tau：由当地条件 E[tau] 与 E[T] 拟合 Gamma 光深分布，以其 Laplace 变换计算各散射阶次的平均透射，避免二次暗化；这是矩闭合近似，并非完整路径追踪。每点大气太阳透射、当地 E/π 天空照明和日月遮挡仍生效。
- 远景是平滑三次垂直剖面，通常使用 16 个区间；长掠射路径仍按路径长度分配，最多使用原 quality 的 40/64/96 区间。近景 40/64/96 与 2/3/4 子步预算不变。没有增加曝光或主射线步数。
- `WeatherField.ts` 增加确定性球面天气系统：弯曲锋面、旋涡、对流区、层积云区及宽广晴空。纬度只影响锋面活动的软统计权重。世界点在三维球面计算，系统切平面绑定到系统中心；经度接缝和两极没有采样坐标奇点。主云和水云共用相同天气图；风仍是连续球面平流，不是气象风场模拟。
- 实际切换 high 时发现独立 GLSL 测试覆盖不到的合成缺陷：Cesium 1.146 的附件缓存只查看当前阶段依赖，full-resolution 云积分复用了后续 resolve 仍需读取的大气 HDR。`GlobalCloudEffect.ts` 为积分阶段声明保留该输出的命名依赖；它只参与资源生命周期，不引入着色器采样。真实 Cesium 零密度用例修复前在 HDR/RGBA8 high 档均产生最大 254/255 显示误差且附件相同，修复后 low→medium→high→medium 全部为 0，附件独立。

## 存储、预算与调试

条件表仍为 **32³ RGBA8 = 131,072 B（128 KiB）**。三个轴为密度扣除值 `[0,0.52]`、云型 `[0,1]`、光学尺度 `log2(scale) ∈ [-5,7]`。R 保存平均不透明度，G 保存未缩放平均 tau 的 `tau/(1+tau)`，B 保存按可见不透明度加权的内部遮蔽概率，A 保存 `P(T<0.9)`。默认 256 个确定性体素柱、24 个高度样本构成材质集合；不是另一个完整天空 irradiance 表。

每个远景足迹至多 144 个天气/云团/材质查询；4 km 以下用其 4×4 子集，4–12 km 对两组最终矩连续混合，12 km 以上使用完整 12×12。沿射线以约半个足迹间距缓存，所有 quality 使用相同集合。缓存是 shader 局部值，不新增纹理。循环使用运行时上界，避免 ANGLE 把嵌套滤波复制展开到每个阴影采样；近景阴影锥直接调用近景密度，避免在其不可达分支内编译远景滤波。

固定云纹理合计约 **13.554 MiB**：天气 2 MiB、64³ 噪声及 mip 约 1.143 MiB、128³ 体素及 mip 约 9.143 MiB、卷云及 mip 约 1.143 MiB、条件表 0.125 MiB。本轮没有新增固定纹理、后处理阶段或后台监听。1920×1080 medium 的云积分附件为 1248×702：RGBA16F 约 6.684 MiB，RGBA8 约 3.342 MiB。high 的 1920×1080 附件为 15.820 / 7.910 MiB；修复错误复用后，这一张必须独立于大气附件，high 相比错误路径增加相应分配，medium 原本已因尺寸不同而独立。这不是包括 Cesium、地图、驱动分配在内的总显存。

界面和 `setDebugView()` 提供下列视图；诊断关闭提前退出，**不能把诊断 GPU 成本当作正常渲染成本**。

| 视图 | 数值含义 |
| --- | --- |
| footprint | `log2(1+足迹 km)/6`，色阶 0–63 km |
| mip | R/G 为两个体素域实际请求并限制到 `[0,7]` 的最高滤波 LOD/7，含光照和跳过查询；蓝色代表没有体素查询 |
| weather | 有效主云段中天气覆盖参数的路径平均；不是最终遮挡率 |
| density | 最终等效消光 `-ln(T)/有效云段 km`，按 `log2(1+rho)` 映射 0–9 km⁻¹；混合 L/T 后没有唯一微观密度 |
| optical-depth | 两层合成的有效 `-ln(T)`，色阶 0–16 |
| transmittance | 两层合成的 T，黑 0、白 1 |
| column-coverage | 最后主云缓存的 `P(T<0.9)`，灰度 0–1 |

## 固定条件及数值方法

前后均为生产构建，同一 Windows Chrome / WebGL2 / ANGLE D3D11 / NVIDIA GeForce RTX 5080。seed **13**，风角、高云风角、形变时间均 **0**，UTC **2026-06-21T17:00:00Z**，曝光 **8**，垂直 FOV **60°**，drawingBuffer **1920×1080**，medium scale **0.65**。全球机位 `(-97.52°,35.46°,17000000 m)`，heading 0°、pitch −90°。截图在页面内缩小显示，实际 drawingBuffer 和相机向量保存在每张图的 JSON 中。

指定条件下 `17000 × 2tan(30°)/(1080×0.65) = 27.96283355 km`。7.83 / 13.57 km 的 128³ 体素域理论 LOD 均达到 7，即 1³。实际远景分支没有读取这两个体素域，不能把理论 LOD 当作一次发生过的纹理查询。

`tests/satellite-lod.browser.ts` 使用真实生产 GLSL、纹理和段积分函数。8 个固定世界区域，以 64×64 子射线、每条 96 个高度样本计算近景参考，在线性空间平均预乘 RGB 与 T；覆盖率另计为 `T<0.9` 的比例。大气在这个数值探针中关闭，以隔离云空间过滤；完整大气合成由场景和专门 GPU 回归验证。另用双倍空间/高度分辨率检查参考收敛。

修改天气场前，独立保留原天气的对照：最大 T 误差从 **0.11263** 降至 **0.01789**（当时 8×8 子云柱），最大 RGB 范数误差从 **0.19979** 降至 **0.04367**。这些数据只用于定位 LOD/光照原因，不与改变天气后的场景直接当作同一图像比较。

最终天气和预算的结果、真实 GPU 计时、初始化耗时与截图索引见下方实测记录。原始 JSON、截图和可交互报告位于被 Git 忽略的 `artifacts/`；重现入口为 `node scripts/build-validation.mjs . artifacts/global-lod-current`，构建将生成的 Cesium 资源复制到 `artifacts/cesium`，从同一个 preview 根目录提供，不依赖另一个开发服务。首次克隆先运行 `npm run build` 准备 Cesium 静态资源，再构建夹具并以 `npx vite preview --host 127.0.0.1 --port 4180 --outDir artifacts` 启动本地服务。真实浏览器打开 `/global-lod-current/tests/*.html`。

## 最终实测

`npm test` **29/29**、`npm run build` 通过；Vite 保留已有的大 bundle 提示。真实 Chrome WebGL2 共 **71/71** 个检查通过：主云 21、水云 14、大气 9、光照 6、日月 5、空间过滤 8、真实 Cesium 附件管线 8。原始结果为 `artifacts/global-lod-final-{cloud-gpu,water-gpu,atmosphere-gpu,lighting-gpu,celestial-gpu,probe,pipeline}.json`。

最终空间探针在各档位自己的像素足迹下比较同一世界场；误差均为绝对量，**不是画质改善百分比**。

| quality | 足迹 km | 最大 T 绝对误差 | 最大线性 RGB L2 误差 |
| --- | ---: | ---: | ---: |
| low | 36.351684 | 0.014202 | 0.003563 |
| medium | 27.962834 | 0.017048 | 0.005101 |
| high | 18.175842 | 0.057515 | 0.004663 |

medium 覆盖率最大误差 **0.033298**。参考高度分辨率加倍后的最大均值差为 **0.00007684**，空间分辨率加倍为 **0.00246030**。0.35/2 km 表示过渡及 4/12 km 过滤规则过渡两侧的最大 L/T 分量差为 **0.00001687**。旧极区切平面边界附近的最大矩差为 **0.00084287**；日期变更线及北极两侧为 **0**（本次 Float32 读回精度与固定样本）。高档位的小足迹误差较大，说明有限材质集合还不能替代逐世界点体素统计；不能从这 8 片区域推断所有机位都达到同一误差。

正常渲染、完整两层云和大气、2 秒预热后计时 10 秒，使用 `EXT_disjoint_timer_query_webgl2` 测量完整场景：

| 固定场景 | 修改前 GPU 平均 / P95 ms | 修改后 GPU 平均 / P95 ms | 前 / 后有效 GPU 样本 |
| --- | ---: | ---: | ---: |
| 全球，17000 km | 3.70062 / 4.88486 | 7.37690 / 8.55702 | 1081 / 622 |
| 低轨，1200 km | 11.47033 / 16.19581 | 7.69399 / 8.73376 | 108 / 537 |

这组观察中全球场景增加 **3.67628 ms**，低轨减少 **3.77634 ms**。12×12 局地过滤有实际代价；低轨使用 4×4，且平滑远景剖面减少了无效高度查询。两端天气和光照模型有变化，因此是最终场景成本，不是固定密度场的微基准。最终连续采样的基线文件为 `global-lod-repeat-before-{global,orbit}-gpu.json`，修改后为 `global-lod-after-{global,orbit}-gpu.json`。较早的基线记录也保留在 `global-lod-before-{global,orbit}-gpu.json`。

同一最终代码的另一轮全球观察为 **8.74222 / 10.49453 ms**。低轨另两轮为 **13.57697 / 22.66506 ms**（42 个样本）及 **17.03803 / 50.08528 ms**（33 个样本），同时帧间隔 P95 达到约 1 秒；原始记录保存在 `global-lod-variable-global-gpu.json`、`global-lod-variable-orbit-gpu.json`、`global-lod-variable-orbit-repeat-gpu.json`，没有删除或当作稳定结果混入均值。最终连续采样的修改后帧间隔 P95 均为 **8.5 ms**。测试时没有关闭用户其它应用，也没有锁定 GPU 频率；调度停顿的具体外部原因未确认，不能把上述一组较稳定计时推广成所有场景/设备的性能改善承诺。调试视图未参与计时。

初始化按实际墙钟记录：较早全球基线 mount **500.6 ms**、assetsReady **2899.5 ms**；附件修复后的缓存命中观察为 mount **582.2 ms**、assetsReady **2740.1 ms**。最终 GLSL 的首次观察为 mount **591.1 ms**、assetsReady **22265.5 ms**，是明显的冷启动限制，首次切换未缓存画质也观察到编译停顿。assetsReady 包含主线程调度、worker 和编译等待，并非纯 GPU 上传时间；场景 READY 还要求随后实际渲染 10 帧。独立数值探针本轮 CPU 资源生成加上传提交为 **3273 ms**，不能当作 GPU 初始化耗时。纯 GPU 上传/编译耗时没有分离测量。固定纹理仍为 **13.554 MiB**，FBO 成本见上文说明；未新增远景纹理。

## 场景与截图索引

文件均位于本地 `artifacts/`，截图配有同名前缀的 `-state.json`，其中记录世界相机向量、UTC、seed、冻结风、FOV、实际 drawingBuffer、参数和选定 GPU。本地画廊为 `global-lod-report.html`，使用浏览器原始 JPEG 截图。下表除特别标注外使用上文固定条件；对照前后相机、显示映射和曝光相同，但新天气的组织结构已变化。

| 证据 | 文件前缀 / 参数 |
| --- | --- |
| 全球前后 | `global-lod-{before,after}-global`，17000 km、heading 0°、pitch −90° |
| 低轨前后 | `global-lod-{before,after}-orbit`，1200 km、heading 245°、pitch −90° |
| 晨昏线 | `global-lod-terminator`，经纬度 15°/0° |
| 夜侧 | `global-lod-night`，82.48°/−35.46° |
| 北极、南极 | `global-lod-{north,south}-pole`，0°/±89.9° |
| 日期变更线两侧 | `global-lod-dateline-{east,west}`，±179.99°/0°；两图 UTC 均为 2026-06-21T00:00:00Z |
| RGBA8 回退 | `global-lod-rgba8`，云和大气附件均为 RGBA8 |
| 三档画质 | `global-lod-quality-{low,medium,high}`，冻结场景内切换 |
| 7 种诊断 | `global-lod-debug-{footprint,mip,weather,density,optical-depth,transmittance,column-coverage}` |
| 云上、云内 | `global-lod-{above,inside}`，高度 8.3/3.02 km |

`cloud-scene.html?view=global&buffer=1920x1080&fov=60&validation` 可重复执行 24 秒全球→1200 km→160 km→12.5 km→8.3 km→3.02 km→800 m 镜头。已实际完成一次，未触发 renderError，并保存终点 `global-lod-tour-frame.png` 和 `global-lod-tour-end-state.json`。没有取得可交付的本地录像，也未逐帧量化整个镜头；静态边界回归不能替代整段视频的时间稳定性评价。画质切换保留同一 seed、天气和风场，滤波锐度仍随实际像素足迹变化。

## 近似与未验证范围

条件材质集合使用默认 detail、3.8 km 厚度和固定方向集合，再缩放光学尺度；它不保存每个世界点的全部体素相位、形变和细节参数。局部云顶使用足迹平均云型，剖面只保证完整近垂直柱的归一化；斜视投影足迹、部分云柱、长掠射相关性与多层投影仍为近似。太阳/月亮散射采用有限局部阴影及经验阶次，线性 L 仍有可测偏差。均衡档近景仍能看到空间采样颗粒和远处柔化。

Cesium 地表仍是 LDR 输入的有效线性恢复；已截断的地表高光无法恢复。自定义天空、日月及云仍在线性 HDR 合成后统一显示，RGBA8 保留编码回退。没有时域重投影，没有真实气象服务、流体演变、跨云层阴影或照片相似度承诺。其它 GPU、移动设备、真实地形/3D Tiles 前景的专项实景质量没有在本轮验证。

## 修改文件

- 远景统计、天气与输运：`src/effects/global-clouds/CloudOptics.ts`、`WeatherField.ts`、`shaders/density.glsl`、`droplet-lighting.glsl`、`march.glsl`。
- 诊断、合成依赖与界面：`src/effects/global-clouds/GlobalCloudEffect.ts`、`shaders/voxel.glsl`、`resolve.glsl`、`src/effects/water-clouds/CloudComparison.ts`、`src/ui/CloudPanel.ts`。
- CPU / GPU 回归：`tests/clouds.test.ts`、`cloud-gpu.browser.ts`、`lighting-gpu.browser.ts`；新增 `cloudProbe.ts`、`satellite-lod.browser.ts` / `.html`、`cloud-pipeline.browser.ts` / `.html`。
- 固定场景与复现：`tests/cloud-scene.browser.ts` / `.html`、`scripts/build-validation.mjs`；文档 `docs/atmosphere.md`、`global-clouds.md` 和本报告。
