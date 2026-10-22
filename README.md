# Cesium Effects Lab

一个可扩展的 Cesium 特效实验项目。使用 **Cesium 1.146.0**（初始化时从 npm 查询的最新稳定版本）、Vite 8 和 TypeScript。第一个特效是三维 LBM 龙卷风。

当前默认进入“全球天空”，包含独立的 [Hillaire LUT 大气](docs/atmosphere.md)。左侧“观察场景”可返回 LBM 龙卷风，或通过 `/?effect=tornado` 直接打开。Cesium 默认天空大气、地面大气和雾已关闭。

## 启动

需要 Node.js **22.12+** 或 **24+**。

```bash
npm install
npm run dev
```

打开终端提示的地址，默认是 http://127.0.0.1:5173/ 。首次启动会自动复制 Cesium Workers、Assets、Widgets 和 ThirdParty 到 `public/cesium/`。这些生成文件不需要提交。

项目已留下 `.env`：

```dotenv
VITE_CESIUM_ION_TOKEN=
```

在等号后填写 [Cesium ion Access Token](https://ion.cesium.com/tokens)，然后**重启开发服务器**。生产部署需要重新构建。`.env` 已被 Git 忽略；新克隆项目可以复制 `.env.example`。

不填 Token 也能使用本地 Natural Earth 底图、实验网格和全部龙卷风功能。填写有效 Token 后，右上角可切换「卫星影像 · ion」。影像需要联网及对应 ion 资源权限。当前基础场景使用 WGS84 椭球地表，没有默认加载真实高程。

`VITE_` 变量会进入浏览器构建产物：这里应使用允许公开给前端、限制来源和资源权限的 ion Token，不要填写服务端密钥。

## 使用

- 六个滑块：旋转强度、上升气流、湍流扰动、烟雾浓度、漏斗宽度、风暴高度。
- 三个预设：经典漏斗、强风暴、轻烟涡流；应用预设会重建流场。
- 三档画质：调整三维网格、体积采样步数和渲染分辨率，切换时重建 Worker 与纹理。
- 底部播放键 / 空格：暂停与继续。暂停同时冻结 LBM 步进和烟雾细节动画。
- 重置键：保留当前参数，重新初始化流场；「恢复默认」重置参数。
- 右侧：定位、环绕观察、放大/缩小、距离参考圈、地球总览。
- 默认进入「3:42 · 云冠近景」；标题下的同名按钮可返回这个机位，右侧定位键切换到整体侧视。
- 顶部特效开关：关闭绘制及后续模拟调度，重新开启保留当前状态。
- 页面隐藏时停止调度模拟；特效销毁时释放 Worker、纹理、后处理阶段及事件监听。

视点固定在美国俄克拉荷马附近（35.46° N, 97.52° W）；位置定义在特效的 `config.ts`。高度为渲染空间尺度，流体参数为无量纲参数，并非实测气象数据。

## 项目结构

```text
src/
  scene/
    createScene.ts           # Cesium Viewer、底图、地面网格、场景配置
    DynamicTexture.ts        # 动态 GPU 纹理适配，隔离 Cesium 内部 API
  effects/
    types.ts                 # 特效生命周期契约
    registry.ts              # 特效目录与工厂注册表
    lbm-tornado/
      config.ts              # 参数、质量档位、Worker 消息协议
      TornadoEffect.ts       # 特效入口，调度与资源生命周期
      LbmSolver.ts           # 独立于 Cesium 的 D3Q19 流体求解器
      simulation.worker.ts   # Worker 中计算并传输密度场
      VolumeRenderer.ts      # 坐标转换、纹理上传、体积阶段
      NoiseVolume.ts         # 可重复采样的四通道三维云噪声
      shaders/volume.frag.glsl
  ui/icons.ts
  main.ts                    # 实验室界面与交互
  style.css
tests/lbm.test.ts
```

新增特效时，在 `src/effects/<effect-id>/` 创建目录，实现 `SceneEffect` 的 `mount / setEnabled / setPaused / reset / focus / destroy`，然后在 `registry.ts` 注册工厂和描述。特效自身负责创建与释放资源，不要销毁共用 Viewer。当前参数面板针对龙卷风；增加第二个特效时，在 `main.ts` 接入对应参数面板和选择入口。可以直接在其他 Cesium 应用中实例化 `TornadoEffect` 并挂载，不依赖此界面。

```ts
const tornado = new TornadoEffect();
tornado.mount({ viewer, onStatus: console.info });
tornado.focus();
tornado.updateParameters({ swirl: 1.5 });
// 使用结束时
tornado.destroy();
```

## LBM 与渲染实现

参考：[凹凸鑫巴「加了 LBM 终于成完美陀螺龙卷了」](https://www.bilibili.com/video/BV13WMB6SEEf/?t=222)。本轮以用户选定的 **3:42** 大尺度云冠近景为方向，将体积域扩大至 7.2 km，增加环形云冠、中心空腔、起伏云沿与近景机位。代码独立实现，没有使用或转载视频素材。视频相似度尚未有可复现的量化结果，不能据此宣称误差小于 5%。

1. **真实三维 LBM 流场**：D3Q19 的 19 个分布函数，pull streaming，BGK 碰撞与 Guo 外力。`tau = 0.64`，底部采用反弹边界，侧面和顶部为密度 1 的平衡态储库。
2. **受控涡旋**：径向汇聚、切向旋转、中心上升流与时变扰动作为外力驱动。漏斗、云冠和尘雾是持续凝结/注入源，初始场预填充以便立即观察。
3. **烟雾输运**：用 LBM 求出的速度场做三线性半拉格朗日标量平流，并结合耗散与凝结源。为适合实时视觉展示，标量使用 3 倍输运系数。
4. **GPU 体积渲染**：RGBA8 二维 atlas 的 R 通道保存密度，G 通道保存 Worker 单次方向扫描生成的光学深度。使用半 texel 寻址、ENU 包围盒求交、前向透明度累积和提前终止，并用 Cesium 场景深度裁剪。缓存自遮蔽避免每个视线采样点再次追踪阴影射线。
5. **云体细节**：一次性生成 48³ RGBA 周期性 Worley / value-noise 纹理（约 432 KiB），WebGL 2 三线性采样。大尺度侵蚀、细节扰动、局部光照梯度和有界差分剪切形成翻卷云层；剪切幅度有界，避免运行越久越被拉成细密同心圆。缓存噪声复用于画质切换。
6. **主线程与 Worker 分离**：每次最多一个在途计算请求，transferable 传输密度和光照 atlas；主线程仅在收到新帧时上传纹理。程序化细节在渲染端平滑动画。

这是一套**受艺术参数控制的实时视觉流体特效**：包含实际 LBM 求解，但不是气象级数值预测，也不等同于视频的 UE 原工程或全 GPU 高分辨率求解。渲染高度独立缩放；噪声细节与云形凝结源用于改善浏览器端低分辨率网格的外观。半透明物体之间不保证精确排序，体积阴影目前只做自遮蔽，不向地表投射真实阴影。

`DynamicTexture.ts` 使用了 Cesium 导出但未写入公开 TypeScript 声明的 `Texture`、`Texture3D` 与 Scene context。兼容边界集中于此文件，升级 Cesium 时需实际检查纹理上传、GLSL 编译和深度遮挡。版本使用精确锁定和 `package-lock.json`，避免自动升级破坏渲染。

## 验证与构建

```bash
npm test        # D3Q19 守恒矩、静止态、涡旋/上升流、极端参数、atlas 与重置
npm run build  # TypeScript 检查 + 生产构建
npm run preview
```

将 `dist/` 部署到静态 HTTP 服务即可，支持相对路径。不要通过 `file://` 双击打开，Worker 和 Cesium 资源需要 HTTP。Cesium 的引擎 bundle 较大，建议服务器开启 gzip/Brotli。

性能取决于 GPU、浏览器分辨率和选择的画质；面板显示真实渲染 FPS 和最近一次 Worker 批次耗时。低性能设备优先选择「流畅」。

使用 `/?benchmark` 打开可见的 10 秒性能采样工具（先预热 2 秒），分别记录帧间隔、CPU 提交时间和 GPU timer query 时间。没有 GPU 计时扩展时显示不可用；页面进入后台时取消测量。该入口默认使用全景侧视机位，便于前后版本比较。[验证记录](docs/tornado-validation.md) 包含本机测量和视觉验收边界。

## 许可与提交

代码采用 [MIT License](LICENSE)。Cesium 及其他依赖保留各自许可证。仓库地址为 https://github.com/SilverStr1ng/cesium-effects.git，提交采用 Angular 风格：`type(scope): description`。`.env` 保留在本地，仓库仅提供空值模板 `.env.example`。
