"""The HTTP half of alerts: what a page reports, what the owner sets, and what they answered.

Against a real listener on a free port, with the browser's credentials where a
write needs them. The toast executor is replaced throughout: nothing here shows or
removes one. `check` is replaced too, so a test does not depend on what this
machine's Windows would say.
"""

from __future__ import annotations

import http.client
import json
import os
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest import mock

from server import http_surface, launcher, mcp_surface, store
from server.alerts import emit, messages, presence, readiness
from server.alerts import settings as alert_settings
from server.hooks import notify
from server.ops import toast
from server.planning import requests, service
from server.projects import project_registry
from server.store_identity.metadata import read_store_metadata
from server.store_identity.refs import planning_space_entity
from tests.registry_fixtures import project_entry, registry_bytes

FIELD = {"id": "answer", "label": "Answer", "type": "text", "required": True, "options": []}
ENABLED: toast.Check = {"state": "enabled", "setting": 0, "reason": None}
ROOT = Path(__file__).resolve().parent.parent
#: The session of an agent on the work, proved the way Codex proves it in `_meta`.
HOLDER = {"sessionId": "019a3c2e-5b7d-7c11-9e0f-2f4b6d8a1c3e"}


class PresenceRecordTests(unittest.TestCase):
    """The record itself, on a clock the test moves."""

    def setUp(self) -> None:
        self.now = 1000.0
        self.record = presence.Presence(clock=lambda: self.now)

    def report(self, **fields: object) -> None:
        self.record.report(
            {
                "page_id": "one",
                "focused": True,
                "work_item_id": "item",
                "hub_open": False,
                **fields,
            }
        )

    def test_a_focused_page_shows_its_card_and_nothing_else(self) -> None:
        self.report()
        self.assertTrue(self.record.visible("item"))
        self.assertFalse(self.record.visible("other"))

    def test_a_report_lapses_after_thirty_seconds_and_a_new_one_renews_it(self) -> None:
        self.report()
        self.now += presence.TTL - 1
        self.assertTrue(self.record.visible("item"))
        self.report()
        self.now += presence.TTL - 1
        self.assertTrue(self.record.visible("item"), "the second report counts from itself")
        self.now += 1
        self.assertFalse(self.record.visible("item"))

    def test_a_page_out_of_focus_shows_nothing(self) -> None:
        self.report(focused=False, hub_open=True)
        self.assertFalse(self.record.visible("item"))
        self.assertFalse(self.record.visible("item", hub=True))

    def test_a_new_report_replaces_the_page_before_it(self) -> None:
        self.report()
        self.report(work_item_id="other")
        self.assertFalse(self.record.visible("item"))
        self.assertTrue(self.record.visible("other"))

    def test_the_panel_counts_only_when_asked_about_a_question(self) -> None:
        self.report(work_item_id=None, hub_open=True)
        self.assertTrue(self.record.visible("any", hub=True))
        self.assertFalse(self.record.visible("any"))

    def test_any_focused_page_is_enough(self) -> None:
        self.report()
        self.report(page_id="two", focused=False, work_item_id=None)
        self.assertTrue(self.record.visible("item"))

    def test_a_report_of_another_shape_is_refused(self) -> None:
        for wrong in (
            {"page_id": "one"},
            {"page_id": "one", "focused": True, "work_item_id": None, "hub_open": False, "x": 1},
            {"page_id": "", "focused": True, "work_item_id": None, "hub_open": False},
            {"page_id": "one", "focused": "yes", "work_item_id": None, "hub_open": False},
            {"page_id": "one", "focused": True, "work_item_id": 12, "hub_open": False},
        ):
            with self.subTest(wrong), self.assertRaises(presence.PresenceError):
                self.record.report(wrong)

    def test_pages_are_bounded_and_a_late_one_still_counts(self) -> None:
        for number in range(200):
            self.report(page_id=f"page-{number}", focused=False)
        self.report(page_id="last")
        self.assertTrue(self.record.visible("item"))
        self.assertLessEqual(len(self.record._pages), 64)


class Listener(unittest.TestCase):
    def setUp(self) -> None:
        directory = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)
        environment = mock.patch.dict(os.environ, {"VALKAMA_DB": str(self.root / "alerts.sqlite3")})
        environment.start()
        self.addCleanup(environment.stop)
        self.conn = store.connect()
        self.addCleanup(self.conn.close)
        service.create_planning_space(self.conn, project_id="example", name="Quality", key="MAIN")
        self.ref = str(
            service.create_work_item(self.conn, space="MAIN", title="Order")["reference"]
        )
        self.conn.commit()

        self.shown: list[dict] = []
        self.removed: list[tuple[str, str]] = []
        self.check = mock.Mock(return_value=dict(ENABLED))
        for patch in (
            mock.patch.object(toast, "active", return_value=True),
            mock.patch.object(toast, "log_path", return_value=str(self.root / "log")),
            mock.patch.object(toast, "logo_uri", return_value=None),
            mock.patch.object(toast, "show", side_effect=self._show),
            mock.patch.object(toast, "remove", side_effect=self._remove),
            mock.patch.object(toast, "check", self.check),
            mock.patch.object(presence, "PRESENCE", presence.Presence()),
            mock.patch.object(emit, "EMITTER", emit.Emitter(window=60.0)),
        ):
            patch.start()
            self.addCleanup(patch.stop)
        self.addCleanup(lambda: emit.EMITTER.flush(5))

        self.server = http_surface.PlatformHTTPServer(
            ("127.0.0.1", 0), http_surface.Handler, token_path=self.root / "installation-token"
        )
        thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(thread.join, 2)
        self.addCleanup(self.server.server_close)
        self.addCleanup(self.server.shutdown)
        port = mock.patch.dict(os.environ, {"VALKAMA_PORT": str(self.server.server_port)})
        port.start()
        self.addCleanup(port.stop)

    def _show(self, message: dict) -> bool:
        self.shown.append(message)
        return True

    def _remove(self, tag: str, group: str) -> bool:
        self.removed.append((tag, group))
        return True

    def call(
        self,
        method: str,
        path: str,
        payload: object = None,
        *,
        credentials: bool = True,
        host: str | None = None,
    ) -> tuple[int, dict]:
        client = http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=10)
        headers: dict[str, str] = {}
        if host is not None:
            headers["Host"] = host
        if credentials:
            headers |= {
                "Content-Type": "application/json",
                "Origin": f"http://127.0.0.1:{self.server.server_port}",
                "Sec-Fetch-Site": "same-origin",
                "X-Valkama-Session": self.server.security_context.browser_session_token,
            }
        body = None if payload is None else json.dumps(payload)
        try:
            client.request(method, path, body=body, headers=headers)
            response = client.getresponse()
            raw = response.read()
            return response.status, json.loads(raw) if raw else {}
        finally:
            client.close()

    def work_item_id(self) -> str:
        return str(service.get_work_item(self.conn, self.ref)["work_item_id"])

    def page(self, **fields: object) -> dict:
        return {
            "page_id": "page",
            "focused": True,
            "work_item_id": self.work_item_id(),
            "hub_open": False,
            **fields,
        }


class PresenceOverHttpTests(Listener):
    def test_a_page_reports_with_credentials_and_a_session_reads_without_them(self) -> None:
        status, answer = self.call("POST", "/api/alerts/presence", self.page())
        self.assertEqual((200, {"ok": True}), (status, answer))

        status, answer = self.call(
            "GET", f"/api/alerts/presence?work_item={self.work_item_id()}", credentials=False
        )
        self.assertEqual((200, {"visible": True}), (status, answer))
        status, answer = self.call("GET", "/api/alerts/presence?work_item=other", credentials=False)
        self.assertEqual((200, {"visible": False}), (status, answer))

    def test_a_report_without_credentials_is_refused_and_records_nothing(self) -> None:
        status, _ = self.call("POST", "/api/alerts/presence", self.page(), credentials=False)
        self.assertIn(status, (401, 403))
        self.assertFalse(presence.PRESENCE.visible(self.work_item_id()))

    def test_a_report_of_another_shape_is_a_400(self) -> None:
        status, answer = self.call("POST", "/api/alerts/presence", {"page_id": "x"})
        self.assertEqual(400, status)
        self.assertEqual("invalid_request", answer["error"]["code"])

    def test_the_read_keeps_the_host_rule(self) -> None:
        status, _ = self.call(
            "GET", "/api/alerts/presence?work_item=x", credentials=False, host="evil.example"
        )
        self.assertNotEqual(200, status)

    def test_a_read_naming_no_item_is_a_400(self) -> None:
        self.assertEqual(400, self.call("GET", "/api/alerts/presence", credentials=False)[0])

    def test_the_session_side_reads_this_answer(self) -> None:
        """`emit.listener_sees` over the wire: the card always, the panel for a question only."""

        identity = self.work_item_id()
        self.assertFalse(emit.listener_sees(identity, question=True))
        self.call("POST", "/api/alerts/presence", self.page())
        self.assertTrue(emit.listener_sees(identity, question=False))
        self.call("POST", "/api/alerts/presence", self.page(work_item_id=None, hub_open=True))
        self.assertTrue(emit.listener_sees(identity, question=True))
        self.assertFalse(emit.listener_sees(identity, question=False))


class SettingsOverHttpTests(Listener):
    def test_a_store_without_the_row_answers_the_defaults(self) -> None:
        status, answer = self.call("GET", "/api/alerts/settings", credentials=False)
        self.assertEqual(200, status)
        self.assertEqual(
            {"question": True, "review": True, "launchFailed": False}, answer["events"]
        )
        self.assertTrue(answer["enabled"])
        self.assertEqual("title", answer["content"])
        self.assertEqual({"enabled", "events", "content", "locale"}, set(answer))

    def test_a_put_is_stored_and_read_back(self) -> None:
        wanted = {
            "enabled": False,
            "events": {"question": True, "review": False, "launchFailed": True},
            "content": "prompt",
            "locale": "en",
        }
        self.assertEqual((200, wanted), self.call("PUT", "/api/alerts/settings", wanted))
        self.assertEqual(wanted, self.call("GET", "/api/alerts/settings")[1])
        reader = store.connect()
        self.addCleanup(reader.close)
        self.assertEqual(wanted, alert_settings.read(reader), "committed for the next reader")

    def test_a_put_with_an_unknown_key_is_a_400_and_writes_nothing(self) -> None:
        before = self.call("GET", "/api/alerts/settings")[1]
        status, answer = self.call("PUT", "/api/alerts/settings", {"sound": True})
        self.assertEqual(400, status)
        self.assertIn("sound", answer["error"]["message"])
        self.assertEqual(before, self.call("GET", "/api/alerts/settings")[1])

    def test_a_put_without_credentials_is_refused(self) -> None:
        status, _ = self.call("PUT", "/api/alerts/settings", {"enabled": False}, credentials=False)
        self.assertIn(status, (401, 403))
        self.assertTrue(self.call("GET", "/api/alerts/settings")[1]["enabled"])


class TrialAndStatusTests(Listener):
    def test_the_trial_shows_a_toast_when_windows_would(self) -> None:
        with mock.patch.object(toast, "shortcut_found", return_value=True):
            status, answer = self.call("POST", "/api/alerts/test", {})
        self.assertEqual(200, status)
        self.assertEqual({**ENABLED, "shown": True}, answer)
        (message,) = self.shown
        self.assertEqual(messages.TRIAL_TAG, message["tag"])

    def test_the_trial_names_the_reason_windows_would_not(self) -> None:
        refused: toast.Check = {
            "state": "disabled-for-application",
            "setting": 1,
            "reason": None,
        }
        self.check.return_value = refused
        status, answer = self.call("POST", "/api/alerts/test", {})
        self.assertEqual((200, {**refused, "shown": False}), (status, answer))
        self.assertEqual([], self.shown)

    def test_the_trial_says_when_the_helper_failed(self) -> None:
        failed: toast.Check = {"state": "unavailable", "setting": None, "reason": "no compiler"}
        self.check.return_value = failed
        _, answer = self.call("POST", "/api/alerts/test", {})
        self.assertEqual({**failed, "shown": False}, answer)

    def test_the_trial_says_when_no_shortcut_would_carry_the_toast(self) -> None:
        with mock.patch.object(toast, "shortcut_found", return_value=False):
            _, answer = self.call("POST", "/api/alerts/test", {})
        self.assertEqual("no-shortcut", answer["state"])
        self.assertFalse(answer["shown"])
        self.assertIn("shortcut", answer["reason"])
        self.assertEqual([], self.shown)

    def test_the_trial_needs_credentials(self) -> None:
        status, _ = self.call("POST", "/api/alerts/test", {}, credentials=False)
        self.assertIn(status, (401, 403))
        self.assertEqual([], self.shown)

    def test_the_trial_is_written_in_the_stored_language(self) -> None:
        self.call("PUT", "/api/alerts/settings", {"locale": "ru"})
        with mock.patch.object(toast, "shortcut_found", return_value=True):
            self.call("POST", "/api/alerts/test", {})
        self.assertIn("проверка", self.shown[0]["xml"])

    def test_status_names_the_shortcut_the_helper_autostart_and_windows(self) -> None:
        with (
            mock.patch.object(toast, "shortcut_found", return_value=False),
            mock.patch.object(toast, "buildable", return_value=True),
            mock.patch.object(launcher, "autostart_status", return_value={"state": "disabled"}),
        ):
            status, answer = self.call("GET", "/api/alerts/status", credentials=False)
        self.assertEqual(200, status)
        self.assertEqual(
            {"shortcut": False, "helper": True, "autostart": "disabled", "windows": ENABLED}, answer
        )

    def test_status_survives_an_unreadable_autostart(self) -> None:
        with mock.patch.object(
            launcher, "autostart_status", side_effect=launcher.LauncherError("no")
        ):
            self.assertEqual("unknown", readiness.status()["autostart"])

    def test_what_is_installed_is_read_without_starting_the_helper(self) -> None:
        with (
            mock.patch.object(toast, "check", side_effect=AssertionError("asked Windows")),
            mock.patch.object(toast, "helper", side_effect=AssertionError("compiled")),
            mock.patch.object(toast, "show", side_effect=AssertionError("showed a toast")),
            mock.patch.object(toast, "shortcut_found", return_value=True),
            mock.patch.object(toast, "buildable", return_value=True),
            mock.patch.object(
                launcher, "autostart_status", return_value={"state": "enabled", "port": 8642}
            ),
        ):
            self.assertEqual(
                {"shortcut": True, "helper": True, "autostart": "enabled"}, readiness.installed()
            )


class ShortcutTests(unittest.TestCase):
    """What the shortcut check reads, on files written here: not the owner's Start menu."""

    def setUp(self) -> None:
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.programs = Path(directory.name, *toast._SHORTCUT[:-1])
        self.programs.mkdir(parents=True)
        for patch in (
            mock.patch.dict(os.environ, {"APPDATA": directory.name}),
            mock.patch.object(toast.sys, "platform", "win32"),
        ):
            patch.start()
            self.addCleanup(patch.stop)

    def test_no_shortcut_is_not_found(self) -> None:
        self.assertFalse(toast.shortcut_found())

    def test_a_shortcut_without_the_identity_is_not_found(self) -> None:
        (self.programs / toast._SHORTCUT[-1]).write_bytes(b"L\x00\x00\x00 no identity")
        self.assertFalse(toast.shortcut_found())

    def test_a_shortcut_carrying_the_identity_in_utf16_is_found(self) -> None:
        stored = b"L\x00\x00\x00" + toast.AUMID.encode("utf-16-le") + b"\x00\x00"
        (self.programs / toast._SHORTCUT[-1]).write_bytes(stored)
        self.assertTrue(toast.shortcut_found())

    def test_the_name_is_the_one_the_installer_gives_it(self) -> None:
        package = json.loads((ROOT / "desktop" / "package.json").read_text(encoding="utf-8"))
        self.assertEqual(f"{package['build']['nsis']['shortcutName']}.lnk", toast._SHORTCUT[-1])
        self.assertEqual(package["build"]["appId"], toast.AUMID)


class AnsweredInTheInterfaceTests(Listener):
    """The panel of questions writes through the exact route; both routes take a toast back."""

    def setUp(self) -> None:
        super().setUp()
        reference = {
            "data_scope_id": read_store_metadata(self.conn)["data_scope_id"],
            "space_key": "MAIN",
        }
        self.scope = {"project_id": "example", **reference}
        entry = project_entry("example", self.root)
        entry["planning_binding"] = planning_space_entity(reference)
        registry = registry_bytes([entry])
        patch = mock.patch.object(project_registry, "_read_registry_bytes", lambda: registry)
        patch.start()
        self.addCleanup(patch.stop)

    def question(self) -> dict:
        record = requests.create(
            self.conn, self.ref, kind="question", prompt="Which?", fields=[FIELD], author="agent"
        )
        self.conn.commit()
        return record

    def resolve(self, action: str, record: dict, **fields: object) -> dict:
        status, answer = self.call(
            "POST",
            f"/api/modules/planning/request/{action}",
            {
                **self.scope,
                "id": record["request_id"],
                "expected_revision": record["revision"],
                **fields,
            },
        )
        self.assertEqual(200, status, answer)
        return answer

    def wait_for_removal(self) -> None:
        deadline = time.monotonic() + 5
        while not self.removed and time.monotonic() < deadline:
            time.sleep(0.01)

    def agent_claims(self) -> None:
        mcp_surface.call_tool(self.conn, "claim_work_item", {"id": self.ref}, meta=HOLDER)
        self.conn.commit()

    def notice(self) -> str:
        answer = notify.deliver(
            "claude", "post-tool-use", {"session_id": HOLDER["sessionId"]}, dict(os.environ)
        )
        return (
            "" if answer is None else json.loads(answer)["hookSpecificOutput"]["additionalContext"]
        )

    def test_the_holder_hears_each_way_a_person_settles_a_question(self) -> None:
        self.agent_claims()
        self.resolve("answer", self.question(), answers={"answer": "first"})
        self.assertIn("question_answered", self.notice())

        record = self.resolve("answer", self.question(), answers={"answer": "first"})["request"]
        self.notice()
        self.resolve("change", record, answers={"answer": "second"})
        self.assertIn("question_changed", self.notice())

        self.resolve("decline", self.question())
        self.assertIn("question_declined", self.notice())

    def test_the_holder_hears_a_person_withdrawing_a_question(self) -> None:
        self.agent_claims()
        self.resolve("expire", self.question())
        self.assertIn("question_withdrawn", self.notice())

    def test_the_next_write_carries_the_answer_back(self) -> None:
        self.agent_claims()
        self.resolve("answer", self.question(), answers={"answer": "first"})
        answer = mcp_surface.call_tool(
            self.conn, "comment_work_item", {"id": self.ref, "body": "Noted"}, meta=HOLDER
        )
        self.conn.commit()
        assert isinstance(answer, dict)
        self.assertEqual(["question_answered"], [event["kind"] for event in answer["from_person"]])

    def test_answering_the_last_question_takes_the_toast_and_a_summary_back(self) -> None:
        self.resolve("answer", self.question(), answers={"answer": "first"})
        emit.EMITTER.flush(5)
        self.assertEqual(
            [(self.ref, messages.GROUP), (messages.SUMMARY_TAG, messages.GROUP)], self.removed
        )

    def test_declining_it_does_the_same(self) -> None:
        self.resolve("decline", self.question())
        self.wait_for_removal()
        self.assertIn((self.ref, messages.GROUP), self.removed)

    def test_answering_one_of_two_keeps_the_toast(self) -> None:
        first = self.question()
        self.question()
        self.resolve("answer", first, answers={"answer": "first"})
        emit.EMITTER.flush(5)
        self.assertEqual([], self.removed)

    def test_the_older_route_takes_it_back_too(self) -> None:
        record = self.question()
        status, answer = self.call(
            "POST",
            "/api/planning/request/decline",
            {"id": record["request_id"], "expected_revision": record["revision"]},
        )
        self.assertEqual(200, status, answer)
        self.wait_for_removal()
        self.assertIn((self.ref, messages.GROUP), self.removed)

    def test_an_answer_never_raises_a_toast(self) -> None:
        self.resolve("answer", self.question(), answers={"answer": "first"})
        emit.EMITTER.flush(5)
        self.assertEqual([], self.shown)

    def test_a_refused_answer_takes_nothing_back(self) -> None:
        record = self.question()
        status, _ = self.call(
            "POST",
            "/api/modules/planning/request/answer",
            {
                **self.scope,
                "id": record["request_id"],
                "expected_revision": record["revision"] + 5,
                "answers": {"answer": "first"},
            },
        )
        self.assertEqual(409, status)
        emit.EMITTER.flush(5)
        self.assertEqual([], self.removed)

    def test_a_failure_taking_it_back_leaves_the_answer_standing(self) -> None:
        with mock.patch.object(emit, "_write_dues", side_effect=RuntimeError("broken")):
            answer = self.resolve("answer", self.question(), answers={"answer": "first"})
        self.assertEqual("answered", answer["request"]["status"])
        self.assertEqual([], self.removed)


if __name__ == "__main__":
    unittest.main()
