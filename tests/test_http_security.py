from __future__ import annotations

import http.client
import io
import json
import tempfile
import threading
import unittest
from email.message import Message
from pathlib import Path
from unittest import mock

from server import http_security, http_surface


def headers(**values: str) -> Message:
    result = Message()
    for name, value in values.items():
        result.add_header(name.replace("_", "-"), value)
    return result


class InstallationTokenTests(unittest.TestCase):
    def test_token_is_persistent_high_entropy_and_created_only_at_injected_path(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "runtime" / "installation-token"
            first = http_security.load_installation_token(path)
            second = http_security.load_installation_token(path)
            self.assertEqual(first, second)
            self.assertRegex(first, r"^[A-Za-z0-9_-]{64}$")
            self.assertEqual(first, path.read_text(encoding="ascii").strip())

    def test_invalid_existing_token_fails_closed(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "installation-token"
            path.write_text("short\n", encoding="ascii")
            with self.assertRaisesRegex(RuntimeError, "invalid"):
                http_security.load_installation_token(path)


class JsonFramingTests(unittest.TestCase):
    def parse(self, header_values: Message, body: bytes, limit: int = 1024) -> dict:
        return http_security.read_json_object(header_values, io.BytesIO(body), max_bytes=limit)

    def assert_refused(
        self, status: int, header_values: Message, body: bytes = b"{}", limit: int = 1024
    ) -> None:
        with self.assertRaises(http_security.RequestRefusedError) as raised:
            self.parse(header_values, body, limit)
        self.assertEqual(status, raised.exception.status)
        self.assertTrue(raised.exception.close)

    def test_valid_json_and_explicit_utf8_parameters_are_accepted(self) -> None:
        body = b'{"ok":true}'
        for media_type in (
            "application/json",
            "application/json; charset=utf-8",
            'Application/JSON; charset="UTF-8"',
            "application/json; charset=utf8",
        ):
            with self.subTest(media_type=media_type):
                self.assertEqual(
                    {"ok": True},
                    self.parse(
                        headers(Content_Length=str(len(body)), Content_Type=media_type), body
                    ),
                )

    def test_missing_duplicate_invalid_negative_and_oversized_lengths_are_refused(self) -> None:
        self.assert_refused(411, headers(Content_Type="application/json"))
        duplicate = headers(Content_Length="2", Content_Type="application/json")
        duplicate.add_header("Content-Length", "2")
        self.assert_refused(400, duplicate)
        for value in ("two", "-1", "+2", "2.0"):
            with self.subTest(value=value):
                self.assert_refused(
                    400,
                    headers(Content_Length=value, Content_Type="application/json"),
                )
        self.assert_refused(
            413, headers(Content_Length="3", Content_Type="application/json"), limit=2
        )
        self.assert_refused(
            413,
            headers(
                Content_Length=str(http_security.GLOBAL_JSON_LIMIT + 1),
                Content_Type="application/json",
            ),
            limit=http_security.GLOBAL_JSON_LIMIT * 2,
        )
        self.assert_refused(
            413,
            headers(Content_Length="9" * 21, Content_Type="application/json"),
            limit=http_security.GLOBAL_JSON_LIMIT * 2,
        )

    def test_transfer_encoding_and_non_json_media_types_are_refused(self) -> None:
        self.assert_refused(
            400,
            headers(
                Content_Length="2", Content_Type="application/json", Transfer_Encoding="chunked"
            ),
        )
        for media_type in (
            "text/plain",
            "application/x-www-form-urlencoded",
            "multipart/form-data; boundary=x",
            "application/json; charset=latin-1",
            "application/json; profile=x",
        ):
            with self.subTest(media_type=media_type):
                self.assert_refused(415, headers(Content_Length="2", Content_Type=media_type))

    def test_truncated_malformed_and_non_object_json_are_refused(self) -> None:
        self.assert_refused(
            400, headers(Content_Length="3", Content_Type="application/json"), b"{}"
        )
        for body in (b"{", b"[]", b'"text"', b"null", b"\xff"):
            with self.subTest(body=body):
                self.assert_refused(
                    400,
                    headers(Content_Length=str(len(body)), Content_Type="application/json"),
                    body,
                )


class HttpSecurityBoundaryTests(unittest.TestCase):
    MUTATIONS = (
        ("POST", "/api/modules/state"),
        ("POST", "/api/platform/relations"),
        ("POST", "/api/platform/actions/invoke"),
        ("POST", "/api/platform/ui-prefs"),
        ("POST", "/api/platform/assignments/activation"),
        ("POST", "/api/platform/assignments/selection"),
        ("POST", "/api/platform/grants/revoke"),
        ("POST", "/api/modules/skills/activation"),
        ("POST", "/api/modules/improvements/signals"),
        ("POST", "/api/modules/improvements/analyze"),
        ("POST", "/api/modules/improvements/eval-runs"),
        ("POST", "/api/modules/improvements/jobs/1/cancel"),
        ("POST", "/api/modules/improvements/cases/1/actions"),
        ("POST", "/api/ingest"),
        ("POST", "/api/session-seen"),
        ("POST", "/api/session-seen"),
        ("POST", "/api/launch"),
        ("POST", "/api/stop"),
        ("POST", "/api/card"),
        ("POST", "/api/summary"),
        ("POST", "/api/move"),
        ("PUT", "/api/modules/improvements/profile"),
    )

    def setUp(self) -> None:
        self._temporary = tempfile.TemporaryDirectory()
        token_path = Path(self._temporary.name) / "installation-token"
        self.server = http_surface.PlatformHTTPServer(
            ("127.0.0.1", 0), http_surface.Handler, token_path=token_path
        )
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.authority = f"127.0.0.1:{self.server.server_port}"
        self.origin = f"http://{self.authority}"

    def tearDown(self) -> None:
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=3)
        self._temporary.cleanup()

    def request(
        self,
        method: str,
        path: str,
        *,
        request_headers: dict[str, str] | None = None,
        body: bytes | None = None,
        host: str | None = None,
    ) -> tuple[int, dict[str, str], bytes]:
        client = http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=3)
        client.putrequest(method, path, skip_host=True)
        if host is not None:
            client.putheader("Host", host)
        for name, value in (request_headers or {}).items():
            client.putheader(name, value)
        client.endheaders(body)
        response = client.getresponse()
        result = (
            response.status,
            {name.casefold(): value for name, value in response.getheaders()},
            response.read(),
        )
        client.close()
        return result

    def browser_headers(self, token: str | None = None) -> dict[str, str]:
        result = {
            "Origin": self.origin,
            "Content-Type": "application/json",
            "Content-Length": "2",
        }
        if token is not None:
            result["X-Valkama-Session"] = token
        return result

    def test_server_refuses_non_loopback_binding(self) -> None:
        with self.assertRaisesRegex(ValueError, "127.0.0.1"):
            http_surface.PlatformHTTPServer(
                ("0.0.0.0", 0),  # noqa: S104 - refusal is the behavior under test
                http_surface.Handler,
                token_path=Path(self._temporary.name) / "unused",
            )

    def test_host_is_exact_for_reads_and_bootstrap(self) -> None:
        for host in (
            None,
            "localhost:" + str(self.server.server_port),
            "evil.test",
            self.authority + ".evil",
        ):
            with self.subTest(host=host):
                status, _, _ = self.request("GET", "/api/security/bootstrap", host=host)
                self.assertEqual(400, status)

    def test_host_is_validated_before_unsupported_verb_dispatch(self) -> None:
        for method in ("HEAD", "PATCH", "DELETE", "TRACE", "BREW"):
            with self.subTest(method=method):
                body = b"{}" if method == "PATCH" else None
                request_headers = (
                    {"Content-Type": "application/json", "Content-Length": "2"}
                    if body is not None
                    else None
                )
                status, response_headers, response_body = self.request(
                    method,
                    "/api/session-seen",
                    host="hostile.example",
                    request_headers=request_headers,
                    body=body,
                )
                self.assertEqual(400, status)
                self.assertEqual("close", response_headers.get("connection"))
                if method != "HEAD":
                    self.assertEqual(
                        {
                            "error": {
                                "code": "invalid_host",
                                "message": "request Host is not the bound loopback authority",
                            }
                        },
                        json.loads(response_body),
                    )

    def test_bootstrap_is_no_store_and_returns_only_process_session_token(self) -> None:
        status, response_headers, body = self.request(
            "GET", "/api/security/bootstrap", host=self.authority
        )
        self.assertEqual(200, status)
        self.assertEqual("no-store", response_headers["cache-control"])
        self.assertNotIn("set-cookie", response_headers)
        payload = json.loads(body)
        self.assertEqual({"session_token"}, set(payload))
        self.assertEqual(
            self.server.security_context.browser_session_token, payload["session_token"]
        )
        self.assertNotIn(self.server.security_context.installation_token.encode(), body)

    def test_bootstrap_rejects_foreign_and_null_origins(self) -> None:
        for origin in ("https://evil.test", "null", "http://localhost:5173"):
            with self.subTest(origin=origin):
                status, _, _ = self.request(
                    "GET",
                    "/api/security/bootstrap",
                    host=self.authority,
                    request_headers={"Origin": origin},
                )
                self.assertEqual(403, status)

    def test_browser_refusals_happen_before_domain_or_database_calls(self) -> None:
        cases = (
            ({}, 403),
            ({"Origin": "null"}, 403),
            ({"Origin": "https://evil.test"}, 403),
            ({"Origin": self.origin}, 401),
            ({"Origin": self.origin, "X-Valkama-Session": "stale"}, 401),
        )
        for extra, expected in cases:
            with (
                self.subTest(extra=extra),
                mock.patch.object(
                    http_surface, "connect", side_effect=AssertionError("database reached")
                ),
            ):
                request_headers = {
                    "Content-Type": "application/json",
                    "Content-Length": "2",
                    **extra,
                }
                status, _, _ = self.request(
                    "POST",
                    "/api/session-seen",
                    host=self.authority,
                    request_headers=request_headers,
                    body=b"{}",
                )
                self.assertEqual(expected, status)

    def test_every_mutation_route_refuses_hostile_web_origin_before_dispatch(self) -> None:
        for method, path in self.MUTATIONS:
            with (
                self.subTest(method=method, path=path),
                mock.patch.object(http_surface.Handler, "_module_gate") as dispatch,
            ):
                request_headers = {
                    "Origin": "https://hostile.example",
                    "Content-Type": "application/json",
                    "Content-Length": "2",
                }
                status, _, _ = self.request(
                    method,
                    path,
                    host=self.authority,
                    request_headers=request_headers,
                    body=b"{}",
                )
                self.assertEqual(403, status)
                dispatch.assert_not_called()

    def test_framing_refusal_precedes_module_dispatch(self) -> None:
        request_headers = self.browser_headers(self.server.security_context.browser_session_token)
        request_headers["Content-Type"] = "text/plain"
        with mock.patch.object(http_surface.Handler, "_module_gate") as dispatch:
            status, response_headers, _ = self.request(
                "POST",
                "/api/modules/skills/activation",
                host=self.authority,
                request_headers=request_headers,
                body=b"{}",
            )
        self.assertEqual(415, status)
        self.assertEqual("close", response_headers.get("connection"))
        dispatch.assert_not_called()

    def test_post_and_put_not_found_responses_use_the_bounded_error_envelope(self) -> None:
        request_headers = self.browser_headers(self.server.security_context.browser_session_token)
        expected = {"error": {"code": "not_found", "message": "API endpoint was not found"}}

        status, response_headers, body = self.request(
            "POST",
            "/api/unknown",
            host=self.authority,
            request_headers=request_headers,
            body=b"{}",
        )
        self.assertEqual(404, status)
        self.assertEqual("application/json", response_headers["content-type"])
        self.assertEqual(expected, json.loads(body))

        with mock.patch.object(http_surface.improvements_api, "handle_put", return_value=None):
            status, response_headers, body = self.request(
                "PUT",
                "/api/unknown",
                host=self.authority,
                request_headers=request_headers,
                body=b"{}",
            )
        self.assertEqual(404, status)
        self.assertEqual("application/json", response_headers["content-type"])
        self.assertEqual(expected, json.loads(body))

    def test_generic_post_failure_is_stable_json_and_does_not_expose_exception(self) -> None:
        payload = json.dumps({"id": "session-1"}).encode()
        request_headers = self.browser_headers(self.server.security_context.browser_session_token)
        request_headers["Content-Length"] = str(len(payload))
        connection = mock.Mock()
        with (
            mock.patch.object(http_surface.Handler, "_module_gate", return_value=True),
            mock.patch.object(http_surface, "connect", return_value=connection),
            mock.patch.object(
                http_surface,
                "op_mark_attention_seen",
                side_effect=RuntimeError("database password leaked"),
            ),
        ):
            status, response_headers, body = self.request(
                "POST",
                "/api/session-seen",
                host=self.authority,
                request_headers=request_headers,
                body=payload,
            )
        self.assertEqual(400, status)
        self.assertEqual("application/json", response_headers["content-type"])
        self.assertEqual(
            {
                "error": {
                    "code": "request_failed",
                    "message": "request could not be completed",
                }
            },
            json.loads(body),
        )
        self.assertNotIn(b"database password", body)

    def test_generic_module_gate_failure_uses_the_same_stable_envelope(self) -> None:
        payload = json.dumps({"id": "session-1"}).encode()
        request_headers = self.browser_headers(self.server.security_context.browser_session_token)
        request_headers["Content-Length"] = str(len(payload))
        with mock.patch.object(
            http_surface, "connect", side_effect=RuntimeError("registry secret leaked")
        ):
            status, response_headers, body = self.request(
                "POST",
                "/api/session-seen",
                host=self.authority,
                request_headers=request_headers,
                body=payload,
            )
        self.assertEqual(500, status)
        self.assertEqual("application/json", response_headers["content-type"])
        self.assertEqual(
            {
                "error": {
                    "code": "request_failed",
                    "message": "request could not be completed",
                }
            },
            json.loads(body),
        )
        self.assertNotIn(b"registry secret", body)

    def test_ingest_rejection_names_its_reason_while_other_posts_stay_generic(self) -> None:
        # `docs/session-event-contract.md` promises a rejected event answers
        # with its reason, and an adapter author reading "request could not be
        # completed" has nothing to fix. The exception is this route alone: a
        # bounded validation message from the same domain on another path is
        # still answered generically, which is what stops the exception from
        # becoming the rule.
        rejected = json.dumps(
            {"event": "not_an_event", "session_id": "s-1", "client": "claude"}
        ).encode()
        adapter_headers = {
            "Authorization": f"Bearer {self.server.security_context.installation_token}",
            "Content-Type": "application/json",
            "Content-Length": str(len(rejected)),
        }
        connection = mock.Mock()
        with (
            mock.patch.object(http_surface.Handler, "_module_gate", return_value=True),
            mock.patch.object(http_surface, "connect", return_value=connection),
        ):
            status, response_headers, body = self.request(
                "POST",
                "/api/ingest",
                host=self.authority,
                request_headers=adapter_headers,
                body=rejected,
            )
        self.assertEqual(400, status)
        self.assertEqual("application/json", response_headers["content-type"])
        error = json.loads(body)["error"]
        self.assertEqual("ingest_rejected", error["code"])
        self.assertIn("not_an_event", error["message"])

        payload = json.dumps({"id": "session-1"}).encode()
        request_headers = self.browser_headers(self.server.security_context.browser_session_token)
        request_headers["Content-Length"] = str(len(payload))
        with (
            mock.patch.object(http_surface.Handler, "_module_gate", return_value=True),
            mock.patch.object(http_surface, "connect", return_value=connection),
            mock.patch.object(
                http_surface,
                "op_mark_attention_seen",
                side_effect=ValueError("session id names no session"),
            ),
        ):
            status, _, body = self.request(
                "POST",
                "/api/session-seen",
                host=self.authority,
                request_headers=request_headers,
                body=payload,
            )
        self.assertEqual(400, status)
        self.assertEqual(
            {"error": {"code": "request_failed", "message": "request could not be completed"}},
            json.loads(body),
        )

    def test_browser_and_adapter_credentials_cannot_cross(self) -> None:
        session = self.server.security_context.browser_session_token
        installation = self.server.security_context.installation_token
        browser_on_adapter = self.browser_headers(session)
        browser_on_adapter.pop("Origin")
        status, _, _ = self.request(
            "POST",
            "/api/ingest",
            host=self.authority,
            request_headers=browser_on_adapter,
            body=b"{}",
        )
        self.assertEqual(401, status)

        bearer_on_browser = self.browser_headers(session)
        bearer_on_browser["Authorization"] = f"Bearer {installation}"
        status, _, _ = self.request(
            "POST",
            "/api/session-seen",
            host=self.authority,
            request_headers=bearer_on_browser,
            body=b"{}",
        )
        self.assertEqual(401, status)

    def test_valid_adapter_bearer_reaches_only_the_designated_ingest_endpoint(self) -> None:
        authorization = f"Bearer {self.server.security_context.installation_token}"
        adapter_headers = {
            "Authorization": authorization,
            "Content-Type": "application/json",
            "Content-Length": "2",
        }
        connection = mock.Mock()
        with (
            mock.patch.object(http_surface.Handler, "_module_gate", return_value=True),
            mock.patch.object(http_surface, "connect", return_value=connection),
            mock.patch.object(
                http_surface, "op_ingest_session_event", return_value={"accepted": True}
            ) as ingest,
            mock.patch.object(http_surface.watchers.WATCHERS, "publish"),
        ):
            status, _, _ = self.request(
                "POST",
                "/api/ingest",
                host=self.authority,
                request_headers=adapter_headers,
                body=b"{}",
            )
        self.assertEqual(200, status)
        ingest.assert_called_once_with(connection, {})

        status, _, _ = self.request(
            "POST",
            "/api/session-seen",
            host=self.authority,
            request_headers=adapter_headers,
            body=b"{}",
        )
        self.assertEqual(403, status)

    def test_preflight_has_no_cors_or_authenticated_fallback(self) -> None:
        status, response_headers, _ = self.request(
            "OPTIONS", "/api/session-seen", host=self.authority
        )
        self.assertEqual(405, status)
        self.assertFalse(any(name.startswith("access-control-") for name in response_headers))


if __name__ == "__main__":
    unittest.main()
