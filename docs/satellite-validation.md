# 卫星云、高云与日月验证 · 2026-10-22

审查基线及开始时 HEAD 均为 `df4ab3cef769f48bdf35c76fabf83d41026ebe05`，工作树干净。实现留在当前 `master` 工作树，没有回退历史。Cesium 仍为 1.146.0 / WebGL2。

## 根因与行为

| 项目 | 基线行为与根因 | 本轮结果 |
| --- | --- | --- |
| 卫星云 | 先平均噪声，再阈值化密度；粗 mip 丢失云柱覆盖，成为硬边块状轮廓。相机所在地的天空补光被整颗地球复用。 | 保留近景体素，以条件平均透射率和反射率构建远景有限体积；平滑过渡，并按实际球壳位置计算补光。逐点直射透射与地球遮挡保留。 |
| 高云 | 同样的非线性过滤使细丝消失；公里宽的噪声瓣形成过宽软团，过滤未考虑纤维方向。 | 先塑造冰云光学量再做 mip；横向数百米、纵向数十公里的独立纤维域，方向过滤跟随高云风旋转。冰云使用独立前向散射近似。 |
| 日月 | 手动太阳只改变月面着色，月光比例仍取星历；移动观察点不更新比例。缩放坐标扭曲圆盘角距；显示映射截断的太阳无法被云恢复。 | 统一观察者几何与当前太阳，真实/模拟月相有明确标记；稳定角距抗锯齿，暗半球遮住星光，月面采用 regolith 反射近似；云直接采样编码 HDR 天空。增加观察太阳入口。 |

没有提高曝光、锁住噪声 LOD0、关闭云层或增加积分预算。40/64/96 视线区间、3/5/7 光照样本以及原细分上限保留。保留四段球壳排序、深度裁切、WGS84 度量、近景体素、RGBA8 回退与资源释放。

## 固定条件

- 生产构建；同一 Chrome、ANGLE D3D11，工具读取的 adapter 为 **NVIDIA GeForce RTX 5080**。
- drawingBuffer **984×652**；垂直 FOV **45°**；quality **medium**；曝光 **8**；太阳大小 2.8、月亮大小 2.2、月面亮度 2.4。
- seed **13**；覆盖 0.62、密度 1.1、主云底 1.5 km、厚度 3.8 km、细节 0.55。高云覆盖 0.35、底部 9 km、厚度 1.5 km。
- 风速参数主云 24 m/s、高云 48 m/s；时钟与风均暂停，平流角、高云平流角、演化均为 0。
- 白昼 UTC **2026-06-21 17:00:00Z**；满月截图 UTC **2026-10-26 03:00:00Z**。
- 全球：−97.52°/35.46°，高度 17,000 km，heading 0°、pitch −90°。高空：同一经纬度，高度 12.5 km，heading 245°、pitch −18°。近景：同一经纬度，高度 0.8 km，heading 245°、pitch 12°。
- 独立卷云截图用 `view=between`：同一经纬度，高度 7 km、heading 245°、pitch 0°，**两端 highCoverage 都为 0.65**，其余不变，两层都开启。
- 日月截图由固定星历和固定高度 800 m 的月下/日下机位生成；前后使用相同相机算法，完整 ECEF position/direction/up 随 JSON 保存。

内置浏览器及早期 Chrome 窗口出现约 1 Hz 限流的采样已弃用，后者另存为 `satellite-throttled-*.json`。下表来自独立 Chrome 验证窗口的单个场景顺序采样，每组 2 秒预热 + 10 秒查询；前后帧调度中位数均约 29.2 ms，因此不以帧率推断 GPU 耗时。记录的是**整场景 GPU 时间**，不是 CPU 提交时间，也不是云 shader 单独耗时。前后密度/散射场不同，因此不是固定介质微基准；短测受 GPU 频率和系统负载影响。最终采样包含最后的天空编码抖动修正。

| 场景 | 基线 GPU 平均 / P95 | 最终 GPU 平均 / P95 | GPU 查询样本（前 / 后） |
| --- | ---: | ---: | ---: |
| 全球 | 3.470 / 4.817 ms | 3.737 / 5.216 ms | 334 / 327 |
| 12.5 km 高空 | 6.689 / 7.893 ms | 10.082 / 11.497 ms | 335 / 335 |
| 0.8 km 近景 | 5.090 / 6.322 ms | 8.235 / 11.435 ms | 327 / 335 |

高空与近景有明显成本增加；全球也增加约 0.267 ms。本轮没有获得通用加速结论。固定云纹理由约 12.29 MiB 增至约 13.55 MiB；编码天空另需约 2.45 MiB 的 984×652 RGBA8 目标，另计原有 framebuffer 和驱动分配。

## 测试证据

- `npm test`：**27 项通过**。新增未解析云柱透射率、条件反射率边界、冰云 mip 光学量守恒、手动太阳/观察点月相几何。
- `npm run build`：通过。保留原有 Vite 大 chunk 提示；未把它当作失败或隐藏。
- `/tests/cloud-gpu.html`：**21 项通过**。包含 WGS84 端点、地球/深度裁切、四段排序、三云型、日月响应、远景零介质、过渡端点、夜半球补光，以及原体素/侵蚀/跳过回归。
- `/tests/water-cloud-gpu.html`：**14 项通过**，共用光照与水云路径保持可用。
- `/tests/celestial-gpu.html`：**5 项通过**，执行生产合成 GLSL。满月/两侧半月/新月亮区比例为 1 / 0.5 / 0.5 / 0；暗面遮星；RGBA8 太阳编码解码结果为 8.364，参考约 8.038（包含逐像素量化）。
- `/tests/celestial-state.html`：**7 项通过**。手动太阳、冻结 UTC 重联、观察点移动、暂停/重置、三档 shader 重建、RGBA8/独立大气开关、Worker 准备时销毁及场景状态恢复。

固定 512 个行星云柱、32 个高度采样：主云平均不透明度在基线从 0.19549（0.02 km 足迹）降至 0.11572（64 km），最终为 0.19549 / 0.19591。冰云基线为 0.01249 / 0.00081，最终为 0.01271 / 0.01452。这里是数值回归统计，**不是画质或相似度百分比**。原近景 512 条射线仍有 45 条透射大于 0.5、443 条小于 0.1；1024 条跳过探针仍跳过约 167 个空区间，RGBA8 探针精度内透射误差为 0。

最终截图复核发现新增天空编码目标把太阳连续光晕量化成同心色带。新增生产 GLSL 探针按编码值的小数区间统计空间平均偏差，修正前最大偏差约 0.372 个字节等级，回归失败。使用固定、零均值的亚字节抖动后，最大偏差约 0.028，回归通过；实景色带消失。曝光、太阳大小和缓冲格式不变，没有增加纹理内存。抖动不是时域降噪，仍存在细微空间噪声。失败证据保存在 `artifacts/satellite-halo-before.json`。

## 修改文件

| 文件 | 用途 |
| --- | --- |
| `src/effects/global-clouds/CloudOptics.ts`、`CirrusField.ts` | 新增条件光学统计与冰云消光 mip 资产。 |
| `src/effects/global-clouds/VoxelCloudField.ts`、`voxel.worker.ts` | 复用体素采样，在所属 Worker 生成远景表并转移缓冲。 |
| `src/effects/global-clouds/GlobalCloudEffect.ts` | 独立纹理生命周期、天空附件依赖和开关重绑定。 |
| `src/effects/global-clouds/shaders/density.glsl`、`voxel.glsl` | 近远过渡、光学 LUT、各向异性冰云与有效跳过范围。 |
| `src/effects/global-clouds/shaders/droplet-lighting.glsl`、`march.glsl`、`resolve.glsl` | 局地天空、冰晶相函数、远景条件散射、HDR 背景合成。 |
| `src/effects/hillaire-atmosphere/CelestialLighting.ts`、`AtmosphereEffect.ts`、`shaders/composite.glsl` | 观察者几何、状态、天空辐亮度目标、圆盘/月面合成。 |
| `src/main.ts`、`src/ui/EnvironmentPanel.ts` | 接入共享天空、观察太阳入口和模拟月相标记。 |
| `tests/cloud-optics.test.ts`、`celestial.test.ts`、`cloud-gpu.browser.ts` | CPU 和生产 GLSL 回归。 |
| `tests/celestial-gpu.html`、`celestial-gpu.browser.ts`、`celestial-state.html`、`celestial-state.browser.ts` | 新增天体 GPU 与挂载/切换/销毁验证页面。 |
| `tests/cloud-scene.html`、`cloud-scene.browser.ts`、`scripts/build-validation.mjs` | 固定 FOV、UTC、风、机位、GPU adapter 元数据和生产验证构建。 |
| `docs/atmosphere.md`、`global-clouds.md`、`satellite-validation.md` | 当前模型、成本、证据和限制。 |

## 截图与复现

截图、相机状态和 GPU 原始 JSON 保留在忽略目录 `artifacts/satellite-*`，不提交生成文件。`artifacts/satellite-report.html` 为本地前后对照图库。文件包括 `before/final-global`、`high`、`below`、`cirrus`、`sun`、`moon`；图片是本项目实时渲染，不含参考视频素材。

六组对照的 UTC、drawingBuffer、quality、参数、风状态、曝光、日月大小和相机几何经过逐字段检查，前后匹配。额外保存 `satellite-final-quarter-moon.jpg`（真实 UTC 下约半月，云层保留）和 `satellite-final-rgba8-low.jpg`（低档 RGBA8 全球回退）；两者是补充功能截图，不混入均衡档性能对照。

```powershell
npm run dev -- --port 5173
# 另一个终端：构建和提供生产验证页，5173 同时提供 Cesium runtime assets。
node scripts/build-validation.mjs
node node_modules/vite/bin/vite.js preview --outDir artifacts --port 4180 --host 127.0.0.1
# 浏览器打开 /satellite-current/tests/cloud-scene.html?benchmark&view=global&quality=medium
# 其余实际 GPU 检查位于同一 tests/ 目录。
```

基线构建使用 `git archive df4ab3c` 导出的本地只读源码快照，复制相同的固定场景 fixture 后调用 `build-validation.mjs <snapshot> artifacts/satellite-before`；没有切换或重置当前工作树。

## 剩余近似与未验证目标

远景为统计等效体积，使用默认细节和厚度的固定样本集合；不是每个像素的完整体素超采样。双流散射、局部高云柱深、合并距离空气透视、月夜适应均为近似。没有层间投影、真实气象风场、时域重投影或气象观测数据。卷云浅角度仍可见软化，近景仍有静态颗粒；照片级卷云、Sky Pro/Nubis 完整复现和任何图像相似度目标均**未验证**。

WGS84 椭球和 shader 深度路径已验证；真实地形、3D Tiles 前景遮挡没有新增专项实景验证。Worker 不可用时仍回到原程序化主云，该回退不具有新的体素统计远景。月面为程序化纹理；未实现真实月貌、秤动、月食及精确日食。未测其他 GPU、移动设备或高分辨率下的通用性能。
