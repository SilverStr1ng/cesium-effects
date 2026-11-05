import base64
import io
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import httpx
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import studio


def png():
    buffer = io.BytesIO()
    Image.new("RGB", (16, 16), "violet").save(buffer, format="PNG")
    return buffer.getvalue()


def params(**overrides):
    fields = dict(model="gpt-image-future-custom", prompt="画一朵云", size="1536x864", quality="max",
                  output_format="png", background="auto", n=1, advanced='{"complexity":"high"}')
    return studio.parameters(**(fields | overrides))


class StudioTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def test_generate_preserves_custom_model_and_saves_original_bytes_without_key(self):
        requests = []
        def respond(request):
            requests.append(request)
            return httpx.Response(200, headers={"x-request-id": "test-request"}, json={
                "data": [{"b64_json": base64.b64encode(png()).decode()}], "usage": {"total_tokens": 42}})
        meta, files = studio.generate(params(), [], "sk-test-secret", self.root, httpx.MockTransport(respond))
        self.assertEqual(len(requests), 1)
        self.assertEqual(requests[0].url.path, "/v1/images/generations")
        body = json.loads(requests[0].content)
        self.assertEqual(body["model"], "gpt-image-future-custom")
        self.assertEqual(body["complexity"], "high")
        self.assertNotIn("response_format", body)
        self.assertEqual(Path(files[0]).read_bytes(), png())
        self.assertEqual(meta["usage"]["total_tokens"], 42)
        saved = Path(files[0]).with_name("metadata.json").read_text(encoding="utf-8")
        self.assertNotIn("sk-test-secret", saved)
        self.assertEqual(studio.history(self.root)[0][1]["parameters"], params())

    def test_edit_sends_data_url_references_as_json(self):
        image = self.root / "reference.png"
        image.write_bytes(png())
        def respond(request):
            self.assertEqual(request.url.path, "/v1/images/edits")
            body = json.loads(request.content)
            self.assertEqual(body["images"][0]["image_url"], "data:image/png;base64," + base64.b64encode(png()).decode())
            return httpx.Response(200, json={"data": [{"b64_json": base64.b64encode(png()).decode()}]})
        meta, _ = studio.generate(params(), [image], "test", self.root, httpx.MockTransport(respond))
        self.assertEqual(meta["mode"], "edit")
        self.assertEqual(meta["reference_count"], 1)

    def test_errors_are_not_retried_and_keys_are_redacted(self):
        calls = []
        def respond(request):
            calls.append(request)
            return httpx.Response(429, json={"error": {"message": "invalid sk-test-secret and sk-another-secret", "code": "insufficient_quota"}})
        with self.assertRaises(studio.StudioError) as raised:
            studio.generate(params(), [], "sk-test-secret", self.root, httpx.MockTransport(respond))
        self.assertEqual(len(calls), 1)
        self.assertNotIn("sk-", str(raised.exception))
        self.assertIn("insufficient_quota", str(raised.exception))
        self.assertEqual(studio.history(self.root), [])

    def test_timeout_is_not_retried(self):
        calls = []
        def timeout(request):
            calls.append(request)
            raise httpx.ReadTimeout("timeout")
        with self.assertRaisesRegex(studio.StudioError, "可能仍在生成并计费"):
            studio.generate(params(), [], "test", self.root, httpx.MockTransport(timeout))
        self.assertEqual(len(calls), 1)

    def test_missing_key_fails_before_network(self):
        with patch.dict(os.environ, {"OPENAI_API_KEY": ""}):
            with self.assertRaisesRegex(studio.StudioError, "API Key"):
                studio.generate(params(), [], "", self.root)

    def test_reject_invalid_or_reserved_advanced_parameters(self):
        for advanced in ['[]', 'null', '{oops}', '{"x":NaN}', '{"model":"other"}', '{"n":100}',
                         '{"stream":true}', '{"images":[]}', '{"output_format":"svg"}']:
            with self.subTest(advanced=advanced), self.assertRaises(studio.StudioError):
                params(advanced=advanced)

    def test_transparent_jpeg_and_invalid_counts_rejected(self):
        with self.assertRaises(studio.StudioError):
            params(background="transparent", output_format="jpeg")
        for n in [0, 11, 1.5, True, float("nan")]:
            with self.subTest(n=n), self.assertRaises(studio.StudioError):
                params(n=n)

    def test_omit_optional_parameters(self):
        p = params(size="", quality="", background="")
        for name in ["size", "quality", "background"]:
            self.assertNotIn(name, p)

    def test_bad_reference_fails_before_network(self):
        image = self.root / "bad.png"
        image.write_text("not an image")
        with self.assertRaisesRegex(studio.StudioError, "参考图无法读取"):
            studio.generate(params(), [image], "test", self.root)

    def test_corrupt_success_payload_is_not_saved(self):
        for result in [{"data": []}, {"data": [{"b64_json": "bad!"}]}, {"data": [{"b64_json": base64.b64encode(b"broken image").decode()}]}]:
            with self.subTest(result=result):
                with self.assertRaisesRegex(studio.StudioError, "可能已计费"):
                    studio.generate(params(), [], "test", self.root,
                                    httpx.MockTransport(lambda _: httpx.Response(200, json=result)))
        self.assertEqual(studio.history(self.root), [])

    def test_favorites_persist_and_deduplicate(self):
        studio.favorite("gpt-image-custom", self.root)
        studio.favorite("gpt-image-custom", self.root)
        choices = studio.models(self.root)
        self.assertEqual(choices[0], "gpt-image-custom")
        self.assertEqual(choices.count("gpt-image-custom"), 1)

    def test_history_skips_incomplete_and_corrupt_records(self):
        for name in [".pending-incomplete", "20261106-corrupt"]:
            folder = self.root / name
            folder.mkdir()
            (folder / "metadata.json").write_text("broken")
        self.assertEqual(studio.history(self.root), [])


if __name__ == "__main__":
    unittest.main()
