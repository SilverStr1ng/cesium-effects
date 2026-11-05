"""Run with python app.py. Serves only on loopback, without a public share link."""

import argparse
import json
import os
import webbrowser

os.environ.setdefault("GRADIO_ANALYTICS_ENABLED", "False")

import gradio as gr
import httpx
from dotenv import load_dotenv

import studio

load_dotenv(studio.ROOT / ".env")

CSS = """
.gradio-container { max-width: 1440px !important; }
#masthead {padding: 22px 4px 12px;}
#masthead h1 {font-size: 32px; letter-spacing: -1px; margin-bottom: 6px;}
#masthead p {color: #7b8291;}
#create {min-height: 52px; font-size: 16px;}
footer {display: none !important;}
"""


def history_view():
    rows = studio.history()
    gallery = [(path, f"{meta['created_at'][:16]} · {meta['parameters']['model']}\n{meta['parameters']['prompt'][:90]}")
               for path, meta in rows]
    return gallery, rows


def run(key, model, prompt, refs, size, quality, fmt, background, count, advanced, progress=gr.Progress()):
    try:
        params = studio.parameters(model, prompt, size, quality, fmt, background, count, advanced)
        progress(0, desc="正在请求 OpenAI，请耐心等待；关闭页面不会撤销已发出的请求。")
        meta, files = studio.generate(params, refs, key)
        gallery, rows = history_view()
        return files, files + [str(studio.DATA / meta["id"] / "metadata.json")], meta, \
            f"已完成 {len(files)} 张 · {meta['elapsed_seconds']} 秒 · 已保存到本地图库", gallery, rows
    except studio.StudioError as exc:
        # Plain textbox, so API errors cannot inject HTML or Markdown.
        return gr.skip(), gr.skip(), gr.skip(), str(exc), gr.skip(), gr.skip()
    except OSError:
        return gr.skip(), gr.skip(), gr.skip(), "本地文件读写失败。请检查参考图、目录权限和磁盘空间；不要立即重复生成。", gr.skip(), gr.skip()


def save_model(model):
    try:
        choices = studio.favorite(model)
        return gr.Dropdown(choices=choices, value=model.strip(), allow_custom_value=True), "已收藏模型，下次启动仍可选择。"
    except (studio.StudioError, OSError) as exc:
        return gr.skip(), str(exc) if isinstance(exc, studio.StudioError) else "模型收藏保存失败，请检查目录权限。"


def inspect_history(rows, evt: gr.SelectData):
    index = evt.index[0] if isinstance(evt.index, (tuple, list)) else evt.index
    if index is None or not 0 <= index < len(rows):
        return gr.skip(), gr.skip()
    path, meta = rows[index]
    return meta, [path, str(studio.DATA / meta["id"] / "metadata.json")]


def reuse(meta):
    if not meta or "parameters" not in meta:
        return [gr.skip()] * 10
    p = meta["parameters"]
    standard = {"model", "prompt", "size", "quality", "output_format", "background", "n"}
    advanced = json.dumps({k: v for k, v in p.items() if k not in standard}, ensure_ascii=False, indent=2)
    return (p["model"], p["prompt"], p.get("size", ""), p.get("quality", ""),
            p.get("output_format", "png"), p.get("background", ""), p.get("n", 1), advanced,
            None, "已复用提示词和参数。参考图已清空；编辑任务请重新上传参考图。")


def create_app():
    with gr.Blocks(title="Image Studio · 本地绘图") as demo:
        gr.HTML('<header id="masthead"><h1>Image Studio <span style="color:#9b8afb">/ 本地绘图</span></h1>'
                '<p>自己的 Key，自己的模型，自己的图库。直连 OpenAI · 仅本机访问</p></header>')
        rows = gr.State([])
        with gr.Row():
            with gr.Column(scale=5, min_width=340):
                with gr.Accordion("连接设置 · API Key", open=not bool(os.getenv("OPENAI_API_KEY"))):
                    key = gr.Textbox(label="OpenAI API Key", type="password", placeholder="sk-…（只用于当前页面，不保存）")
                    gr.Markdown("已配置环境变量 Key，可留空。" if os.getenv("OPENAI_API_KEY") else
                                "在此输入 Key，或在此工具的 `.env` 文件中配置。Key 不写入图库。")
                with gr.Row():
                    model = gr.Dropdown(studio.models(), value=studio.PRESETS[0], allow_custom_value=True,
                                        label="模型 ID · 可以直接输入", scale=5)
                    favorite = gr.Button("收藏模型", scale=1)
                prompt = gr.Textbox(label="提示词 / 编辑指令", lines=7,
                                    placeholder="描述主体、构图、光线和风格；编辑图片时说明要修改的内容。")
                refs = gr.File(label="参考图 · 拖入图片后自动使用编辑接口（最多 16 张）", file_count="multiple",
                               file_types=[".png", ".jpg", ".jpeg", ".webp"], type="filepath")
                with gr.Row():
                    size = gr.Dropdown(["auto", "1024x1024", "1536x1024", "1024x1536", "1536x864", ""],
                                       value="auto", allow_custom_value=True, label="尺寸 · 可输入宽x高；空值不发送")
                    quality = gr.Dropdown(["auto", "low", "medium", "high", "xhigh", "max", ""], value="auto",
                                          label="画质 · 空值不发送")
                with gr.Row():
                    fmt = gr.Dropdown(["png", "jpeg", "webp"], value="png", label="输出格式")
                    background = gr.Dropdown(["auto", "opaque", "transparent", ""], value="auto", label="背景 · 空值不发送")
                count = gr.Slider(1, 10, value=1, step=1, label="图片数量 · 更多图片会增加费用")
                with gr.Accordion("高级参数 · JSON", open=False):
                    advanced = gr.Code(value="{}", language="json", label="额外 API 参数", lines=5)
                    gr.Markdown('例如 `{"complexity": "high", "output_compression": 90}`。'
                                '只填写所选模型支持的参数；不能覆盖上方字段或开启流式输出。')
                submit = gr.Button("生成图片", variant="primary", elem_id="create")
                status = gr.Textbox(label="状态", value="就绪 · 每次点击只发起一次请求，失败后不会自动重试。", interactive=False, lines=3)
            with gr.Column(scale=7, min_width=380):
                with gr.Tabs():
                    with gr.Tab("本次结果"):
                        output = gr.Gallery(label="生成结果", columns=2, height=530, object_fit="contain", type="filepath")
                        downloads = gr.File(label="下载原图与参数", file_count="multiple", interactive=False)
                        with gr.Accordion("本次请求详情 / 用量", open=False):
                            details = gr.JSON(label="参数与 API 返回用量（不估算费用）")
                        reuse_current = gr.Button("复用本次提示词与参数")
                    with gr.Tab("历史图库"):
                        refresh = gr.Button("刷新本地图库")
                        saved = gr.Gallery(label="最近 200 张 · 点击查看参数", columns=3, height=530, object_fit="contain", type="filepath")
                        selected = gr.JSON(label="选中图片的生成参数")
                        saved_downloads = gr.File(label="下载选中的原图与参数", file_count="multiple", interactive=False)
                        reuse_saved = gr.Button("复用选中图片的提示词与参数")
                gr.Markdown("图片保存在工具目录的 `data/`。模型可选不代表账户已有访问权限；参数支持情况以 API 返回为准。")
        favorite.click(save_model, [model], [model, status], api_name=False)
        submit.click(run, [key, model, prompt, refs, size, quality, fmt, background, count, advanced],
                     [output, downloads, details, status, saved, rows], concurrency_limit=1,
                     concurrency_id="generation", trigger_mode="once", api_name=False)
        demo.load(history_view, outputs=[saved, rows], api_name=False)
        refresh.click(history_view, outputs=[saved, rows], api_name=False)
        saved.select(inspect_history, [rows], [selected, saved_downloads], api_name=False)
        fields = [model, prompt, size, quality, fmt, background, count, advanced, refs, status]
        reuse_current.click(reuse, [details], fields, api_name=False)
        reuse_saved.click(reuse, [selected], fields, api_name=False)
    return demo


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=7861)
    parser.add_argument("--no-browser", action="store_true")
    args = parser.parse_args()
    # Double-clicking the launcher twice reopens this app instead of failing on its port.
    try:
        config = httpx.get(f"http://127.0.0.1:{args.port}/config", timeout=1, trust_env=False).json()
        existing = config.get("title") == "Image Studio · 本地绘图"
    except (httpx.HTTPError, ValueError, AttributeError):
        existing = False
    if existing:
        if not args.no_browser:
            webbrowser.open(f"http://127.0.0.1:{args.port}")
        print(f"Image Studio is already running: http://127.0.0.1:{args.port}")
        raise SystemExit(0)
    studio.DATA.mkdir(parents=True, exist_ok=True)
    create_app().queue(max_size=8).launch(
        server_name="127.0.0.1", server_port=args.port, share=False,
        inbrowser=not args.no_browser, theme=gr.themes.Soft(primary_hue="violet"), css=CSS,
        allowed_paths=[str(studio.DATA)], blocked_paths=[str(studio.ROOT / ".env")],
        max_file_size="15mb", show_error=False,
    )
