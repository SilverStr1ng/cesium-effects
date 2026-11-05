# Image Studio · 本地 OpenAI 绘图工具

独立的 Python 工具，使用自己的 OpenAI API 账户。无需本地显卡。MIT 许可沿用仓库根目录 LICENSE。

## Windows 启动

1. 安装 Python 3.12 或更高版本，并勾选 **Add Python to PATH**。
2. 双击本目录的 **start.bat**（首次运行会创建 `.venv` 并下载依赖）。
3. 浏览器自动打开 `http://127.0.0.1:7861`，在“连接设置”输入自己的 API Key。
4. 选择或输入完整的模型 ID，填写提示词，点击“生成图片”。关闭启动窗口可停止服务。

也可将 `.env.example` 复制成 `.env`，填入 `OPENAI_API_KEY`。此文件只由本地服务读取，不上传 Git。环境变量优先于 `.env`；界面临时填写的 Key 优先于环境变量。可选 `OPENAI_PROJECT_ID` 和 `OPENAI_ORG_ID` 指定账户项目和组织。

端口冲突时运行 `.venv\Scripts\python.exe app.py --port 7862`。终端启动时不想自动打开页面，可增加 `--no-browser`。

## 功能

- 模型输入框可手填，收藏后下次启动保留；内置 2.5 / 2.6 Sunburst、Flare 等快捷选项。
- 不上传参考图时调用 Images generations；上传 PNG/JPEG/WebP 后调用 Images edits。最多 16 张，每张不超过 14 MiB。
- 自定义尺寸、画质、背景、输出格式，一次生成 1–10 张；不支持的组合由 API 返回明确错误。
- 尺寸、画质、背景可清空，完全不发送对应参数，方便使用模型默认值。
- 高级 JSON 支持新参数，例如 `{"complexity":"high"}`；不会将模型 ID 固定在 SDK 枚举中。
- 结果保存到 `data/<时间-随机ID>/`，包含原图及 `metadata.json`；下载、查看 API 用量、复用提示词和参数。
- 复用参数会清空参考图，避免意外将上一任务的图片用于新请求；编辑任务需重新上传。
- 图库展示最近 200 张，原文件全部保留。备份整个 `data/` 即可备份图库和模型收藏。

模型列表只是快捷选项，不是权限探测；手填 ID 也不能绕过项目权限、组织验证、额度或模型参数限制。

## 数据和计费

仅监听 `127.0.0.1`，不创建公开分享链接，禁用 Gradio 分析。请求固定发往 `https://api.openai.com/v1`；提示词和参考图会发送给 OpenAI。此工具面向单用户本机运行。

界面填写的 Key 不写入配置或历史记录；如果希望重启后可用，请自行填写 `.env`。不要在提示词或高级参数中粘贴密钥。`.venv/`、`.env`、`data/` 均被 Git 忽略。

每次点击发送一次请求，**不自动重试**。图片数量越多费用越高；超时、连接断开或关闭网页不代表服务端已取消任务，可能仍会计费，请先检查控制台用量再重试。界面不编造价格；显示 API 返回的 usage。高级参数不能覆盖模型、提示词、图片数量、输出格式等主字段，也不能开启流式输出。

当前仅提供 PNG、JPEG、WebP 静态图片，未实现 GIF/SVG、遮罩绘制、流式预览或跨重启任务恢复。历史元数据记录参考图数量，不复制原始参考图。

## 开发与验证

```powershell
python -m venv .venv
.venv\Scripts\python.exe -m pip install -r requirements.txt
.venv\Scripts\python.exe -m unittest discover -s tests -v
.venv\Scripts\python.exe app.py
```

API 请求测试通过 HTTP mock 验证，不消耗真实额度。依赖锁定版本见 `requirements-lock.txt`，需要复现时使用 `pip install -r requirements-lock.txt`。

可选浏览器集成检查：安装 `pip install playwright`，确保已安装 Chrome，然后运行 `.venv\Scripts\python.exe tests/browser_check.py`。测试在独立临时图库和 7862 端口执行，API 完全模拟，覆盖生成、编辑、下载、历史、复用和窄屏布局。截图写入仓库忽略的 `artifacts/image-studio/`。

官方 API 文档：[图像生成](https://developers.openai.com/api/reference/resources/images/methods/generate)、[图像编辑](https://developers.openai.com/api/reference/resources/images/methods/edit)。
