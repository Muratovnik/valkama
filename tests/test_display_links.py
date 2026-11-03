"""The `MessageDisplay` hook endpoint: what the client gets, on a real listener.

The oracle for "a real item" is the `/open` route itself, followed over HTTP, so the
batched read cannot drift from what a click on the link does.
"""

from __future__ import annotations

import contextlib
import http.client
import io
import json
import os
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest import mock
from urllib.parse import urlsplit

from server import http_surface, store
from server.planning import acknowledgements, display_links, interactions
from tests.test_work_item_link import LinkedStoreCase

MESSAGE_ID = "5b2a9c8e-1f63-4d8a-b7c4-9e0d2a6f1c3b"


def batch(delta: str, *, index: int = 0, final: bool = True, message_id: str = MESSAGE_ID) -> dict:
    return {
        "session_id": "abc123",
        "transcript_path": "C:\\work\\t.jsonl",
        "cwd": "C:\\work",
        "hook_event_name": "MessageDisplay",
        "turn_id": "0c9e6a2f-7d41-4f4e-9a15-3f4f7c2b8d10",
        "message_id": message_id,
        "index": index,
        "final": final,
        "delta": delta,
    }


def shown(delta: str, url: str = "http://u") -> str:
    return delta.replace("MAIN-1", f"[MAIN-1]({url})")


class OpenMessagesTests(unittest.TestCase):
    """The state between batches, without a store: no candidate ever opens one."""

    def setUp(self) -> None:
        self.open_store = mock.Mock(side_effect=AssertionError("the store was opened"))
        self.messages = display_links.OpenMessages(limit=2)

    def answer(self, payload: dict) -> dict:
        return display_links.answer(payload, self.open_store, "unused", messages=self.messages)

    def test_a_text_with_no_candidate_never_opens_the_store(self) -> None:
        for text in ("", "plain text\n", "`MAIN-1`", "```\nMAIN-1\n```\n", "http://x/MAIN-1"):
            with self.subTest(text=text):
                self.assertEqual({}, self.answer(batch(text)))
        self.open_store.assert_not_called()

    def test_the_final_batch_releases_the_message_even_when_empty(self) -> None:
        self.answer(batch("a\n", index=0, final=False))
        self.assertEqual(1, len(self.messages))
        self.answer(batch("", index=1, final=True))
        self.assertEqual(0, len(self.messages))

    def test_the_bound_pushes_out_the_oldest_message(self) -> None:
        for name in ("a", "b", "c"):
            self.answer(batch("x\n", final=False, message_id=name))
        self.assertEqual(2, len(self.messages))
        self.assertIsNone(self.messages.take("a", 1))
        self.assertIsNotNone(self.messages.take("c", 1))

    def test_a_batch_of_a_message_it_never_saw_is_left_alone_to_the_end(self) -> None:
        # A restart: the first batch opened a fence in the process that is gone.
        for index, final in ((1, False), (2, False), (3, True)):
            self.assertEqual({}, self.answer(batch("MAIN-1\n", index=index, final=final)))
        self.assertEqual(0, len(self.messages))
        self.open_store.assert_not_called()

    def test_a_skipped_batch_ends_linking_for_that_message(self) -> None:
        self.answer(batch("```\n", index=0, final=False))
        self.assertEqual({}, self.answer(batch("MAIN-1\n", index=2, final=False)))
        self.assertEqual({}, self.answer(batch("MAIN-1\n", index=3, final=True)))
        self.open_store.assert_not_called()

    def test_a_fence_held_between_batches_protects_the_next_one(self) -> None:
        self.answer(batch("```\n", index=0, final=False))
        self.assertEqual({}, self.answer(batch("MAIN-1\n", index=1, final=False)))
        self.open_store.assert_not_called()

    def test_a_payload_that_is_not_a_batch_answers_nothing(self) -> None:
        for change in (
            {"hook_event_name": "Stop"},
            {"delta": None},
            {"delta": 5},
            {"message_id": None},
            {"message_id": ""},
            {"message_id": "x" * 129},
            {"index": True},
            {"index": -1},
            {"index": "0"},
            {"final": "yes"},
        ):
            with self.subTest(change=change):
                self.assertEqual({}, self.answer({**batch("MAIN-1"), **change}))
        self.open_store.assert_not_called()

    def test_a_batch_with_too_many_candidates_is_left_alone(self) -> None:
        text = " ".join(f"MAIN-{number}" for number in range(1, display_links.MAX_CANDIDATES + 2))
        self.assertEqual({}, self.answer(batch(text)))
        self.open_store.assert_not_called()


class ListenerCase(LinkedStoreCase):
    def post(
        self,
        payload: object,
        *,
        host: str | None = None,
        headers: dict[str, str] | None = None,
        path: str = display_links.HOOK_PATH,
    ) -> http.client.HTTPResponse:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        client = http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=5)
        self.addCleanup(client.close)
        client.putrequest("POST", path, skip_host=True, skip_accept_encoding=True)
        client.putheader("Host", host or f"127.0.0.1:{self.server.server_port}")
        sent = {"Content-Type": "application/json", **(headers or {})}
        for name, value in sent.items():
            client.putheader(name, value)
        client.putheader("Content-Length", str(len(body)))
        client.endheaders(body)
        return client.getresponse()


class AnswerTests(ListenerCase):
    def displayed(self, payload: dict) -> str | None:
        response = self.post(payload)
        body = response.read()
        self.assertEqual(200, response.status)
        if not body:
            return None
        answer = json.loads(body)
        self.assertEqual({"hookSpecificOutput"}, set(answer))
        self.assertEqual("MessageDisplay", answer["hookSpecificOutput"]["hookEventName"])
        return answer["hookSpecificOutput"]["displayContent"]

    def test_a_real_item_comes_back_as_the_link_a_tool_hands_out(self) -> None:
        url = acknowledgements.work_item_url("MAIN-1")
        self.assertEqual(
            f"См. [MAIN-1]({url}) и UTF-8.\n", self.displayed(batch("См. MAIN-1 и UTF-8.\n"))
        )

    def test_no_real_item_answers_an_empty_body_with_a_success_status(self) -> None:
        self.assertIsNone(self.displayed(batch("UTF-8 SHA-256 MAIN-99999 XMAIN-1 NOPE-1\n")))
        self.assertIsNone(self.displayed(batch("nothing here\n")))

    def test_a_batch_is_linked_when_its_reference_is_outside_the_code_around_it(self) -> None:
        self.assertEqual(
            f"```\nMAIN-1\n```\n`MAIN-1` [MAIN-1]({acknowledgements.work_item_url('MAIN-1')})\n",
            self.displayed(batch("```\nMAIN-1\n```\n`MAIN-1` MAIN-1\n")),
        )

    def test_a_link_is_offered_exactly_where_the_route_leads_to_a_card(self) -> None:
        # MAIN-2 is only in the attached store, LOOSE-1 is in a space no project binds.
        for reference in ("MAIN-1", "MAIN-2", "DOCS-1", "LOOSE-1", "MAIN-3", "DOCS-2", "NOPE-1"):
            with self.subTest(reference=reference):
                response = self.get(f"/open/{reference}?in=browser")
                response.read()
                expected = response.status == 302
                self.assertEqual(
                    f"[{reference}](" in (self.displayed(batch(f"{reference}\n")) or ""), expected
                )

    def test_the_link_a_batch_gets_opens_that_card(self) -> None:
        content = self.displayed(batch("MAIN-1\n"))
        assert content is not None
        address = content[content.index("(") + 1 : content.index(")")]
        self.assert_leads_to(urlsplit(address).path, "example-project", self.main, "MAIN-1")

    def test_a_message_in_parts_keeps_its_fence_across_requests(self) -> None:
        self.assertIsNone(self.displayed(batch("```\n", index=0, final=False)))
        self.assertIsNone(self.displayed(batch("MAIN-1\n", index=1, final=False)))
        self.assertIsNone(self.displayed(batch("```\n", index=2, final=False)))
        self.assertIn("[MAIN-1](", self.displayed(batch("MAIN-1", index=3, final=True)) or "")

    def test_many_candidates_cost_one_read_of_the_items(self) -> None:
        statements: list[str] = []

        def traced() -> sqlite3.Connection:
            conn = store.open_read_only()
            conn.set_trace_callback(statements.append)
            return conn

        references = " ".join(f"MAIN-{number}" for number in range(1, 51))
        answer = display_links.answer(
            batch(references), traced, store.db_path(), messages=display_links.OpenMessages()
        )
        self.assertIn("[MAIN-1](", str(answer))
        self.assertEqual(1, sum("work_items" in statement for statement in statements), statements)

    def test_an_attached_store_is_not_opened_for_a_key_only_the_primary_holds(self) -> None:
        with mock.patch.object(interactions.scopes, "open_readonly") as opened:
            self.assertIn("[DOCS-1](", self.displayed(batch("DOCS-1\n")) or "")
        opened.assert_not_called()

    def test_an_attached_store_that_cannot_be_read_costs_only_its_own_links(self) -> None:
        with mock.patch.object(
            interactions.scopes, "open_readonly", side_effect=sqlite3.OperationalError("gone")
        ):
            self.assertEqual(
                f"[MAIN-1]({acknowledgements.work_item_url('MAIN-1')}) MAIN-2\n",
                self.displayed(batch("MAIN-1 MAIN-2\n")),
            )


class NothingReachesTheReaderTests(ListenerCase):
    def assert_empty_success(self, response: http.client.HTTPResponse) -> None:
        self.assertEqual((200, b""), (response.status, response.read()))

    def test_an_internal_error_answers_as_if_nothing_changed_and_logs_no_text(self) -> None:
        reply = "PRIVATE-TEXT MAIN-1"
        error = RuntimeError(reply)
        stderr = io.StringIO()
        with (
            mock.patch.object(display_links, "answer", side_effect=error),
            contextlib.redirect_stderr(stderr),
        ):
            self.assert_empty_success(self.post(batch(reply)))
        self.assertEqual("message display hook: RuntimeError\n", stderr.getvalue())

    def test_a_store_that_will_not_open_answers_as_if_nothing_changed(self) -> None:
        failure = sqlite3.OperationalError("unable to open database file")
        with (
            mock.patch.object(http_surface, "open_read_only", side_effect=failure),
            contextlib.redirect_stderr(io.StringIO()),
        ):
            self.assert_empty_success(self.post(batch("MAIN-1\n")))

    def test_a_malformed_registry_links_nothing_and_a_missing_one_too(self) -> None:
        self.registry.write_bytes(b"{")
        self.assert_empty_success(self.post(batch("MAIN-1\n")))
        self.registry.unlink()
        self.assert_empty_success(self.post(batch("MAIN-1\n")))

    def test_the_text_is_written_nowhere_and_no_call_is_recorded(self) -> None:
        marker = "UNIQUEMARKER MAIN-1 UNIQUEMARKER"
        conn = store.connect()
        self.addCleanup(conn.close)
        tables = [
            row[0]
            for row in conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
            )
        ]

        def counts() -> dict[str, int]:
            return {
                table: conn.execute(f'SELECT COUNT(*) FROM "{table}"').fetchone()[0]
                for table in tables
            }

        before = counts()
        self.post(batch(marker)).read()
        self.assertEqual(before, counts())
        for path in self.root.rglob("*"):
            if path.is_file():
                with self.subTest(path=path.name):
                    self.assertNotIn(b"UNIQUEMARKER", path.read_bytes())


class GuardTests(ListenerCase):
    def assert_refused(self, status: int, code: str, response: http.client.HTTPResponse) -> None:
        body = response.read()
        self.assertEqual(status, response.status)
        self.assertEqual(code, json.loads(body)["error"]["code"])
        self.assertNotIn(b"MAIN-1", body)
        self.assertIsNone(response.getheader("Access-Control-Allow-Origin"))

    def test_a_page_of_any_site_is_refused_before_the_text_is_read(self) -> None:
        with mock.patch.object(display_links, "answer") as answered:
            for headers in (
                {"Origin": "https://evil.example"},
                {"Origin": "null"},
                {"Origin": f"http://127.0.0.1:{self.server.server_port}"},
                {"Sec-Fetch-Site": "cross-site"},
                {"Sec-Fetch-Site": "same-origin"},
                {"Sec-Fetch-Site": "none"},
            ):
                with self.subTest(headers=headers):
                    self.assert_refused(
                        403, "origin_refused", self.post(batch("MAIN-1"), headers=headers)
                    )
        answered.assert_not_called()

    def test_a_foreign_host_is_refused(self) -> None:
        response = self.post(batch("MAIN-1"), host="evil.example")
        self.assert_refused(400, "invalid_host", response)

    def test_localhost_is_a_foreign_host_so_the_registration_must_name_the_address(self) -> None:
        port = self.server.server_port
        self.assert_refused(400, "invalid_host", self.post(batch("x"), host=f"localhost:{port}"))

    def test_only_framed_json_is_read(self) -> None:
        response = self.post(batch("MAIN-1"), headers={"Content-Type": "text/plain"})
        self.assert_refused(415, "unsupported_media_type", response)

    def test_a_larger_message_than_the_bound_is_refused_and_shows_as_it_was(self) -> None:
        response = self.post(batch("x" * (1024 * 1024 + 1)))
        self.assert_refused(413, "request_too_large", response)

    def test_a_long_message_within_the_bound_is_answered(self) -> None:
        response = self.post(batch("MAIN-1\n" + "x" * 900_000))
        self.assertEqual(200, response.status)
        self.assertIn("[MAIN-1](", response.read().decode("utf-8"))

    def test_the_answer_carries_no_cors_header_a_page_could_read_it_by(self) -> None:
        response = self.post(batch("MAIN-1"))
        response.read()
        self.assertEqual(200, response.status)
        self.assertFalse(
            [name for name, _ in response.getheaders() if "access-control" in name.lower()]
        )

    def test_the_browser_credential_routes_are_unchanged_for_the_same_caller(self) -> None:
        # What lets the hook in must let nothing else in.
        response = self.post({"text": "MAIN-1"}, path="/api/planning/comment")
        response.read()
        self.assertEqual(403, response.status)


class OpenReadOnlyTests(unittest.TestCase):
    def setUp(self) -> None:
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)
        self.path = self.root / "deep" / "store.sqlite3"
        environment = mock.patch.dict(os.environ, {"VALKAMA_DB": str(self.path)})
        environment.start()
        self.addCleanup(environment.stop)

    def test_a_missing_store_is_refused_and_nothing_is_created(self) -> None:
        self.path.parent.mkdir()
        with self.assertRaises(sqlite3.OperationalError):
            store.open_read_only()
        self.assertEqual([], list(self.path.parent.iterdir()))

    def test_a_missing_directory_stays_missing(self) -> None:
        with self.assertRaises(sqlite3.OperationalError):
            store.open_read_only()
        self.assertFalse(self.path.parent.exists())

    def test_it_cannot_write(self) -> None:
        store.connect().close()
        conn = store.open_read_only()
        self.addCleanup(conn.close)
        with self.assertRaises(sqlite3.OperationalError):
            conn.execute("CREATE TABLE x(y)")

    def test_a_store_at_another_schema_is_refused(self) -> None:
        store.connect().close()
        for offset in (-1, 1):
            conn = sqlite3.connect(self.path)
            conn.execute(f"PRAGMA user_version={store.STORE_SCHEMA_VERSION + offset}")
            conn.commit()
            conn.close()
            with self.subTest(offset=offset), self.assertRaises(sqlite3.OperationalError):
                store.open_read_only()

    def test_a_path_with_uri_characters_opens_the_right_file(self) -> None:
        odd = self.root / "a%20b#c?d" / "store.sqlite3"
        with mock.patch.dict(os.environ, {"VALKAMA_DB": str(odd)}):
            if os.name == "nt":
                self.skipTest("'?' cannot be in a Windows path")
            store.connect().close()
            store.open_read_only().close()


if __name__ == "__main__":
    unittest.main()
