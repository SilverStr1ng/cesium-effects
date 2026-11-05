"""Local storage and direct OpenAI Images API calls. No credentials are persisted."""

from __future__ import annotations

import base64
import io
import json
import os
import re
import threading
import time
import uuid
from datetime import datetime
from pathlib import Path

import httpx
from PIL import Image

ROOT = Path(__file__).resolve().parent
DATA = ROOT / "data"
PRESETS = [
    "gpt-image-2.6-flare", "gpt-image-2.6-sunburst",
    "gpt-image-2.5-flare", "gpt-image-2.5-sunburst",
    "gpt-image-2", "gpt-image-1.5", "gpt-image-1-mini",
]
FORMATS = {"PNG": "png", "JPEG": "jpeg", "WEBP": "webp"}
LOCK = threading.Lock()


class StudioError(Exception):
    """An actionable, credential-free message that is safe to show in the UI."""


def parameters(model, prompt, size, quality, output_format, background, n, advanced):
    model, prompt = (model or "").strip(), (prompt or "").strip()
    if not model or len(model) > 200 or not re.fullmatch(r"[\w.:-]+", model):
        raise StudioError("请输入有效的模型 ID，例如 gpt-image-2.6-flare。")
    if not prompt or len(prompt) > 32000:
        raise StudioError("提示词不能为空，且不能超过 32000 个字符。")
    if isinstance(n, bool) or not isinstance(n, (int, float)) or not 1 <= n <= 10 or int(n) != n:
        raise StudioError("一次生成的图片数量必须是 1–10 的整数。")
    if output_format not in ("png", "jpeg", "webp"):
        raise StudioError("目前支持 PNG、JPEG 和 WebP 输出。")
    if quality not in ("", "auto", "low", "medium", "high", "xhigh", "max"):
        raise StudioError("请选择有效画质。")
    if background not in ("", "auto", "opaque", "transparent"):
        raise StudioError("请选择有效背景。")
    if background == "transparent" and output_format == "jpeg":
        raise StudioError("透明背景请选择 PNG 或 WebP。")
    size = (size or "").strip().lower()
    if size and size != "auto" and not re.fullmatch(r"[1-9]\d{0,4}x[1-9]\d{0,4}", size):
        raise StudioError("尺寸请输入 auto 或 宽x高，例如 1536x864。")
    try:
        extra = json.loads(advanced or "{}", parse_constant=lambda _: (_ for _ in ()).throw(ValueError()))
    except (ValueError, TypeError):
        raise StudioError("额外参数必须是合法的 JSON 对象。") from None
    if not isinstance(extra, dict):
        raise StudioError("额外参数必须是 JSON 对象，例如 {\"complexity\": \"high\"}。")
    reserved = {"model", "prompt", "size", "quality", "output_format", "background", "n",
                "image", "images", "mask", "stream", "partial_images", "response_format"}
    if reserved.intersection(extra):
        raise StudioError("额外参数不能覆盖界面字段、参考图、流式输出或 response_format。")
    result = dict(model=model, prompt=prompt, n=int(n), output_format=output_format)
    result.update({k: v for k, v in dict(size=size, quality=quality, background=background).items() if v})
    return result | extra


def reference_data(paths):
    if len(paths) > 16:
        raise StudioError("最多上传 16 张参考图。")
    images = []
    for name in paths:
        path = Path(name)
        if path.stat().st_size > 14 * 1024 * 1024:
            raise StudioError("每张参考图请控制在 14 MiB 以内（编码后需要小于 API 限制）。")
        raw = path.read_bytes()
        try:
            with Image.open(io.BytesIO(raw)) as img:
                fmt = img.format
                img.verify()
        except (OSError, ValueError, Image.DecompressionBombError):
            raise StudioError("参考图无法读取，请上传有效的 PNG、JPEG 或 WebP 图片。") from None
        if fmt not in FORMATS:
            raise StudioError("参考图只支持 PNG、JPEG 或 WebP。")
        mime = "jpeg" if fmt == "JPEG" else fmt.lower()
        images.append({"image_url": f"data:image/{mime};base64,{base64.b64encode(raw).decode()}"})
    return images


def api_error(response, key):
    hints = {400: "模型或参数不兼容，请检查模型 ID 和高级参数。", 401: "API Key 无效或已失效。",
             403: "当前项目没有此模型的访问权限，可能需要完成组织验证。",
             404: "模型不存在，或当前项目无法访问该模型。",
             429: "额度不足或触发速率限制，请到 OpenAI 控制台检查。"}
    message = hints.get(response.status_code, "OpenAI 服务暂时无法完成请求。")
    try:
        err = response.json().get("error", {})
        detail = str(err.get("message", ""))[:1500]
        code = str(err.get("code", ""))[:100]
    except (ValueError, AttributeError):
        detail, code = "", ""
    # Error payloads may echo input. Never expose a supplied key, including sk-* tokens.
    detail = re.sub(r"sk-[A-Za-z0-9_-]+", "[已隐藏 Key]", detail.replace(key, "[已隐藏 Key]"))
    code = re.sub(r"sk-[A-Za-z0-9_-]+", "[已隐藏 Key]", code.replace(key, "[已隐藏 Key]"))
    return StudioError(f"HTTP {response.status_code} · {message}\n{code}\n{detail}".strip())


def generate(params, paths, key, data_dir=None, transport=None):
    """One paid request, without retries. transport is injectable for offline tests."""
    key = (key or os.getenv("OPENAI_API_KEY", "")).strip()
    if not key:
        raise StudioError("请在连接设置中输入 API Key，或在工具目录的 .env 中配置 OPENAI_API_KEY。")
    images = reference_data(paths or [])
    payload = dict(params)
    if images:
        payload["images"] = images
    headers = {"Authorization": f"Bearer {key}"}
    for name, env in [("OpenAI-Project", "OPENAI_PROJECT_ID"), ("OpenAI-Organization", "OPENAI_ORG_ID")]:
        if os.getenv(env):
            headers[name] = os.environ[env]
    started = time.monotonic()
    try:
        with httpx.Client(timeout=httpx.Timeout(900, connect=30), transport=transport) as client:
            response = client.post(
                "https://api.openai.com/v1/images/edits" if images else "https://api.openai.com/v1/images/generations",
                headers=headers, json=payload,
            )
    except httpx.TimeoutException:
        raise StudioError("请求超时，未自动重试。服务端可能仍在生成并计费，请先检查用量再决定是否重试。") from None
    except httpx.HTTPError:
        raise StudioError("连接 OpenAI 失败，未自动重试。请检查网络或系统代理；请求若已送达，可能仍会计费。") from None
    if not response.is_success:
        raise api_error(response, key)
    try:
        result = response.json()
        entries = result.get("data")
        if not isinstance(entries, list) or not entries:
            raise ValueError()
        decoded = []
        for entry in entries:
            raw = base64.b64decode(entry["b64_json"], validate=True)
            with Image.open(io.BytesIO(raw)) as img:
                fmt = FORMATS[img.format]
                img.verify()
            decoded.append((raw, fmt))
    except (ValueError, KeyError, TypeError, OSError, AttributeError, Image.DecompressionBombError):
        raise StudioError("API 已返回，但图片数据无法解析。未自动重试；此请求可能已计费。") from None
    run_id = datetime.now().strftime("%Y%m%d-%H%M%S") + "-" + uuid.uuid4().hex[:8]
    data_dir = Path(data_dir) if data_dir is not None else DATA
    data_dir.mkdir(parents=True, exist_ok=True)
    staging, final = data_dir / (".pending-" + run_id), data_dir / run_id
    metadata = {
        "id": run_id, "created_at": datetime.now().astimezone().isoformat(timespec="seconds"),
        "mode": "edit" if images else "generate", "parameters": params,
        "reference_count": len(images), "elapsed_seconds": round(time.monotonic() - started, 2),
        "request_id": response.headers.get("x-request-id"), "usage": result.get("usage"),
        "files": [f"{i + 1}.{fmt}" for i, (_, fmt) in enumerate(decoded)],
    }
    try:
        staging.mkdir()
        for filename, (raw, _) in zip(metadata["files"], decoded):
            (staging / filename).write_bytes(raw)
        (staging / "metadata.json").write_text(json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8")
        staging.rename(final)
    except OSError:
        # Keep partial files for recovery; never repeat a paid request after a disk failure.
        raise StudioError(f"API 已成功，但保存图片失败。请检查磁盘空间；可恢复文件可能位于 {staging}。未自动重试。") from None
    return metadata, [str(final / name) for name in metadata["files"]]


def history(data_dir=None):
    data_dir = Path(data_dir) if data_dir is not None else DATA
    rows = []
    if not Path(data_dir).exists():
        return rows
    for folder in sorted(Path(data_dir).iterdir(), reverse=True):
        if not folder.is_dir() or folder.name.startswith("."):
            continue
        try:
            record = json.loads((folder / "metadata.json").read_text(encoding="utf-8"))
            for name in record["files"]:
                path = (folder / name).resolve()
                if path.is_relative_to(folder.resolve()) and path.is_file():
                    rows.append((str(path), record))
        except (OSError, ValueError, KeyError, TypeError):
            continue
        if len(rows) >= 200:
            break
    return rows[:200]


def models(data_dir=None):
    data_dir = Path(data_dir) if data_dir is not None else DATA
    try:
        saved = json.loads((Path(data_dir) / "models.json").read_text(encoding="utf-8"))
        saved = [s for s in saved if isinstance(s, str)] if isinstance(saved, list) else []
    except (OSError, ValueError):
        saved = []
    return list(dict.fromkeys(saved + PRESETS))


def favorite(model, data_dir=None):
    data_dir = Path(data_dir) if data_dir is not None else DATA
    model = (model or "").strip()
    if not model or not re.fullmatch(r"[\w.:-]{1,200}", model):
        raise StudioError("请先输入有效的模型 ID。")
    with LOCK:
        choices = list(dict.fromkeys([model] + models(data_dir)))
        Path(data_dir).mkdir(parents=True, exist_ok=True)
        target = Path(data_dir) / "models.json"
        temporary = target.with_suffix(".tmp")
        temporary.write_text(json.dumps(choices, ensure_ascii=False, indent=2), encoding="utf-8")
        temporary.replace(target)
    return choices
