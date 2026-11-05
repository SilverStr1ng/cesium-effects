"""Optional real-browser integration check with mocked OpenAI, never a paid call.

Install playwright in .venv; uses an installed Chrome browser via its channel.
Run from the tool directory: .venv/Scripts/python.exe tests/browser_check.py
"""

import base64
import io
import json
import os
import re
import sys
import tempfile
from pathlib import Path
from unittest.mock import patch

os.environ["GRADIO_ANALYTICS_ENABLED"] = "False"
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import httpx
from PIL import Image
from playwright.sync_api import sync_playwright, expect

import app
import studio


def check():
    requests = []
    image = io.BytesIO()
    Image.new("RGB", (512, 512), "#aa8af4").save(image, format="PNG")

    def respond(request):
        requests.append((request.url.path, json.loads(request.content)))
        return httpx.Response(200, json={"data": [{"b64_json": base64.b64encode(image.getvalue()).decode()}],
                                         "usage": {"total_tokens": 10}})

    original = studio.generate
    def mocked(params, paths, key):
        return original(params, paths, key, transport=httpx.MockTransport(respond))

    with tempfile.TemporaryDirectory() as temporary, patch.dict(os.environ, {"OPENAI_API_KEY": ""}), \
            patch.object(studio, "DATA", Path(temporary)), patch.object(studio, "generate", mocked):
        demo = app.create_app()
        demo.queue().launch(server_name="127.0.0.1", server_port=7862, share=False,
                            prevent_thread_lock=True, allowed_paths=[temporary], css=app.CSS,
                            theme=app.gr.themes.Soft(primary_hue="violet"), quiet=True)
        try:
            with sync_playwright() as p:
                browser = p.chromium.launch(channel="chrome", headless=True)
                page = browser.new_page(viewport={"width": 1440, "height": 1100})
                errors = []
                page.on("pageerror", lambda error: errors.append(str(error)))
                page.goto("http://127.0.0.1:7862", wait_until="domcontentloaded")
                expect(page.get_by_label("提示词 / 编辑指令", exact=True)).to_be_visible(timeout=30000)
                page.get_by_label("提示词 / 编辑指令", exact=True).fill("测试提示词")
                page.get_by_role("button", name="生成图片", exact=True).click()
                status = page.get_by_label("状态", exact=True)
                expect(status).to_have_value(re.compile("请在连接设置中输入 API Key"), timeout=20000)
                assert len(requests) == 0
                page.get_by_label("OpenAI API Key", exact=True).fill("sk-offline-test")
                model = page.get_by_role("combobox").first
                model.fill("gpt-image-browser-custom")
                model.press("Enter")
                page.get_by_role("button", name="收藏模型", exact=True).click()
                expect(status).to_have_value("已收藏模型，下次启动仍可选择。")
                page.get_by_role("button", name="生成图片", exact=True).click()
                expect(status).to_have_value(re.compile("已完成 1 张"), timeout=20000)
                assert requests[-1][0] == "/v1/images/generations"
                assert requests[-1][1]["model"] == "gpt-image-browser-custom"
                links = page.locator('a[href*="1.png"]')
                expect(links).to_have_count(1)
                assert page.request.get(links.first.get_attribute("href")).ok
                assert len(studio.history(Path(temporary))) == 1
                page.get_by_role("tab", name="历史图库", exact=True).click()
                page.get_by_role("button", name="刷新本地图库", exact=True).click()
                page.locator(".gallery-item").last.click()
                page.get_by_role("button", name="复用选中图片的提示词与参数", exact=True).click()
                expect(status).to_have_value(re.compile("已复用提示词和参数"))
                expect(page.get_by_label("提示词 / 编辑指令", exact=True)).to_have_value("测试提示词")
                reference = Path(temporary) / "reference.png"
                reference.write_bytes(image.getvalue())
                page.locator('input[type="file"]').first.set_input_files(str(reference))
                expect(page.get_by_text("reference.png", exact=False).first).to_be_visible()
                page.get_by_role("button", name="生成图片", exact=True).click()
                expect(status).to_have_value(re.compile("已完成 1 张"), timeout=20000)
                assert requests[-1][0] == "/v1/images/edits"
                assert requests[-1][1]["images"][0]["image_url"].startswith("data:image/png;base64,")
                assert len(studio.history(Path(temporary))) == 2
                page.get_by_role("tab", name="本次结果", exact=True).click()
                screenshot = studio.ROOT.parents[1] / "artifacts" / "image-studio" / "browser-check.png"
                screenshot.parent.mkdir(parents=True, exist_ok=True)
                page.screenshot(path=str(screenshot), full_page=True)
                assert errors == [], errors
                page.set_viewport_size({"width": 390, "height": 844})
                page.screenshot(path=str(screenshot.with_name("mobile-check.png")), full_page=True)
                assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth"), "Mobile overflow"
                print("PASS: missing key, custom model, favorites, generation, downloads, history, reuse, reference edit, mobile layout; no browser errors.")
                print(f"Screenshot: {screenshot}")
                browser.close()
        finally:
            demo.close()


if __name__ == "__main__":
    check()
