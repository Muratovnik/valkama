"""Tests for immutable hashed static-asset response policy."""

from __future__ import annotations

import io
import os
import tempfile
import unittest
from types import SimpleNamespace
from unittest import mock

from server import http_surface, static_assets


class StaticAssetTests(unittest.TestCase):
    def test_runtime_snapshot_keeps_old_bytes_when_dist_is_rebuilt(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            dist = os.path.join(directory, "dist")
            os.makedirs(os.path.join(dist, "assets"))
            index = os.path.join(dist, "index.html")
            with open(index, "wb") as handle:
                handle.write(b"<html>old</html>")
            with open(os.path.join(dist, "assets", "app.js"), "wb") as handle:
                handle.write(b"old-js")

            snapshot = static_assets.capture_runtime_snapshot(
                source_root=directory,
                dist_dir=dist,
            )
            with open(index, "wb") as handle:
                handle.write(b"<html>new</html>")
            with open(os.path.join(dist, "assets", "app.js"), "wb") as handle:
                handle.write(b"new-js")

            handler = object.__new__(http_surface.Handler)
            handler._host_validated = True
            handler.headers = {}
            handler.wfile = io.BytesIO()
            captured: dict[str, object] = {"headers": {}}
            handler.send_response = lambda code: captured.update(code=code)
            handler.send_header = lambda name, value: captured["headers"].__setitem__(name, value)
            handler.end_headers = lambda: None
            handler.path = "/index.html"
            handler.server = SimpleNamespace(runtime_snapshot=snapshot)
            with mock.patch.object(http_surface, "DIST_DIR", dist):
                handler.do_GET()

            self.assertEqual(200, captured["code"])
            self.assertEqual(b"<html>old</html>", handler.wfile.getvalue())

    def test_runtime_snapshot_keeps_hashed_asset_etag_after_rebuild(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            dist = os.path.join(directory, "dist")
            assets = os.path.join(dist, "assets")
            os.makedirs(assets)
            path = os.path.join(assets, "app.js")
            with open(path, "wb") as handle:
                handle.write(b"old-js")
            snapshot = static_assets.capture_runtime_snapshot(directory, dist)
            first = snapshot.assets["assets/app.js"]
            with open(path, "wb") as handle:
                handle.write(b"new-js")

            def request(if_none_match: str | None = None) -> tuple[int, dict[str, str], bytes]:
                handler = object.__new__(http_surface.Handler)
                handler._host_validated = True
                handler.headers = {"If-None-Match": if_none_match} if if_none_match else {}
                handler.wfile = io.BytesIO()
                captured: dict[str, object] = {"headers": {}}
                handler.send_response = lambda code: captured.update(code=code)
                handler.send_header = lambda name, value: captured["headers"].__setitem__(
                    name, value
                )
                handler.end_headers = lambda: None
                handler.path = "/assets/app.js"
                handler.server = SimpleNamespace(runtime_snapshot=snapshot)
                with mock.patch.object(http_surface, "DIST_DIR", dist):
                    handler.do_GET()
                return int(captured["code"]), captured["headers"], handler.wfile.getvalue()

            code, headers, body = request()
            self.assertEqual(200, code)
            self.assertEqual(first.body, body)
            cached_code, cached_headers, cached_body = request(headers["ETag"])
            self.assertEqual(304, cached_code)
            self.assertEqual(headers["ETag"], cached_headers["ETag"])
            self.assertEqual(b"", cached_body)

    def test_runtime_identity_changes_when_static_bytes_change(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            dist = os.path.join(directory, "dist")
            os.makedirs(dist)
            index = os.path.join(dist, "index.html")
            with open(index, "wb") as handle:
                handle.write(b"old")
            first = static_assets.runtime_identity(directory, dist)
            with open(index, "wb") as handle:
                handle.write(b"new")
            second = static_assets.runtime_identity(directory, dist)
            self.assertNotEqual(first["identity"], second["identity"])

    def test_runtime_identity_changes_when_backend_source_changes(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            dist = os.path.join(directory, "dist")
            os.makedirs(dist)
            source = os.path.join(directory, "backend.py")
            with open(source, "wb") as handle:
                handle.write(b"VALUE = 'old'\n")
            first = static_assets.runtime_identity(source, dist)
            with open(source, "wb") as handle:
                handle.write(b"VALUE = 'new'\n")
            second = static_assets.runtime_identity(source, dist)
            self.assertNotEqual(first["identity"], second["identity"])

    def test_hashed_asset_policy_returns_immutable_strong_etag_and_304(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = os.path.join(directory, "app-a1b2c3.js")
            with open(path, "wb") as handle:
                handle.write(b"console.log('stable');")
            result = static_assets.hashed_asset_policy(path, if_none_match=None)
            self.assertEqual("public, max-age=31536000, immutable", result["cache_control"])
            self.assertTrue(result["etag"].startswith('"'))
            self.assertTrue(result["etag"].endswith('"'))
            self.assertFalse(result["not_modified"])
            cached = static_assets.hashed_asset_policy(path, if_none_match=result["etag"])
            self.assertTrue(cached["not_modified"])
            self.assertEqual(result["etag"], cached["etag"])

    def test_http_handler_serves_hashed_assets_with_immutable_etag_and_304(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            assets = os.path.join(directory, "assets")
            os.makedirs(assets)
            path = os.path.join(assets, "index-contenthash.js")
            with open(path, "wb") as handle:
                handle.write(b"console.log('stable');")

            def request(
                if_none_match: str | None = None,
            ) -> tuple[int, dict[str, str], bytes, bytes | None]:
                handler = object.__new__(http_surface.Handler)
                handler._host_validated = True
                handler.headers = {"If-None-Match": if_none_match} if if_none_match else {}
                handler.wfile = io.BytesIO()
                captured: dict[str, object] = {"headers": {}}
                handler.send_response = lambda code: captured.update(code=code)
                handler.send_header = lambda name, value: captured["headers"].__setitem__(
                    name, value
                )
                handler.end_headers = lambda: None
                handler.path = "/assets/index-contenthash.js"
                with (
                    mock.patch.object(http_surface, "DIST_DIR", directory),
                    mock.patch.object(
                        static_assets,
                        "hashed_asset_policy",
                        wraps=static_assets.hashed_asset_policy,
                    ) as policy,
                ):
                    handler.do_GET()
                representation = policy.call_args.kwargs.get("representation")
                return (
                    int(captured["code"]),
                    captured["headers"],
                    handler.wfile.getvalue(),
                    representation,
                )

            code, headers, body, representation = request()
            self.assertEqual(200, code)
            self.assertEqual(b"console.log('stable');", body)
            self.assertEqual(body, representation)
            self.assertEqual("public, max-age=31536000, immutable", headers["Cache-Control"])
            self.assertRegex(headers["ETag"], r'^"[0-9a-f]{64}"$')

            cached_code, cached_headers, cached_body, cached_representation = request(
                headers["ETag"]
            )
            self.assertEqual(304, cached_code)
            self.assertEqual(headers["ETag"], cached_headers["ETag"])
            self.assertEqual(b"", cached_body)
            self.assertEqual(body, cached_representation)

    def test_etag_changes_when_representation_bytes_change_with_same_stat_identity(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = os.path.join(directory, "app-a1b2c3.js")
            with open(path, "wb") as handle:
                handle.write(b"aaaaaaaaaaaaaaaaaaaa")
            original_stat = os.stat(path)
            first = static_assets.hashed_asset_policy(path, file_stat=original_stat)
            with open(path, "wb") as handle:
                handle.write(b"bbbbbbbbbbbbbbbbbbbb")
            os.utime(path, ns=(original_stat.st_atime_ns, original_stat.st_mtime_ns))
            second = static_assets.hashed_asset_policy(path, file_stat=original_stat)
            self.assertNotEqual(first["etag"], second["etag"])
            self.assertFalse(
                static_assets.hashed_asset_policy(
                    path, file_stat=original_stat, if_none_match=first["etag"]
                )["not_modified"]
            )


if __name__ == "__main__":
    unittest.main()
