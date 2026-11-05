"""What a click on a session does: the matrix of places, states and surfaces.

The expected plans come from the product's click table, not from the planner: where
a session opens, per place and per surface, the routes each client documents or was
observed to take, and the rule that a live session in a terminal never gets a second
process. Links are spelled out whole on purpose, so a test cannot agree with a builder
it shares.

Every id, path and value here is invented.
"""

from __future__ import annotations

import http.client
import json
import os
import tempfile
import threading
import unittest
from dataclasses import replace
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from unittest import mock
from urllib.parse import quote, urlencode

from server import documents, http_surface, processes, session_open, sessions, store
from server.ops import url_schemes
from server.ops.url_schemes import Installed
from server.planning import leases, service
from server.projects import project_registry
from server.session_open import PathTarget, SessionTarget
from server.store_identity.metadata import read_store_metadata
from server.store_identity.refs import planning_space_entity
from tests.registry_fixtures import project_entry, registry_bytes

UID = "00000000-0000-4000-8000-0000000000a1"
OTHER_UID = "00000000-0000-4000-8000-0000000000a2"
DESKTOP_ID = "local_0d1e2f3a-4b5c-4d6e-8f70-81920a1b2c3d"
EDITORS = tuple(url_schemes.EDITOR_HOMES)
EVERYTHING = Installed(
    schemes=frozenset(url_schemes.SCHEMES),
    extensions=frozenset(
        (editor, extension)
        for editor in EDITORS
        for extension in (url_schemes.CLAUDE_EXTENSION, url_schemes.CODEX_EXTENSION)
    ),
    terminal=True,
)
ALL_SEEN = frozenset(
    {
        url_schemes.DESKTOP_CONTINUE,
        url_schemes.CLI_RESUME_LINK,
        url_schemes.ELSEWHERE_NOTICE,
        url_schemes.CODEX_EXTENSION_ROUTE,
    }
)
EXTENSION_LINK = f"vscode://anthropic.claude-code/open?session={UID}"


def machine(*schemes: str, extensions: tuple[tuple[str, str], ...] = (), terminal: bool = True):
    return Installed(frozenset(schemes), frozenset(extensions), terminal)


def kinds(plan: dict[str, Any]) -> list[str]:
    return [step["kind"] for step in plan["steps"]]


def links(plan: dict[str, Any]) -> list[str]:
    return [step["link"] for step in plan["steps"] if "link" in step]


class OpenPlacesTests(unittest.TestCase):
    def test_a_place_is_offered_by_what_a_plan_would_find_installed(self) -> None:
        places = session_open.open_places(
            url_schemes.Installed(schemes=frozenset({"vscode", "codex"}))
        )
        self.assertEqual(set(places), set(session_open.OPEN_PLACES))
        self.assertTrue(places["vscode"])
        self.assertTrue(places["codex-app"])
        # A dangling `cursor://` is no scheme here, and without Windows Terminal a plan copies.
        self.assertFalse(places["cursor"])
        self.assertFalse(places["claude-desktop"])
        self.assertTrue(places["terminal"])


class PlanCase(unittest.TestCase):
    def setUp(self) -> None:
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name).resolve()
        environment = mock.patch.dict(os.environ, {"VALKAMA_DB": str(self.root / "store.sqlite3")})
        environment.start()
        self.addCleanup(environment.stop)
        self.conn = store.connect()
        self.addCleanup(self.conn.close)
        self.folder = self.root / "project"
        self.folder.mkdir()
        self.transcript = self.root / "transcript.jsonl"
        self.transcript.write_text("{}\n", encoding="utf-8")

    def session(self, session_id: str = UID, **columns: str) -> str:
        row = {
            "id": session_id,
            "client": "claude",
            "status": "ended",
            "cwd": str(self.folder),
            "transcript_path": str(self.transcript),
            "opened_folder": str(self.folder),
            **columns,
        }
        names = ", ".join(row)
        marks = ", ".join("?" for _ in row)
        self.conn.execute(f"INSERT INTO sessions({names}) VALUES ({marks})", tuple(row.values()))
        self.conn.commit()
        return session_id

    def plan(
        self,
        session_id: str = UID,
        *,
        surface: str = "desktop",
        schemes: Installed = EVERYTHING,
        seen: frozenset[str] = ALL_SEEN,
        **ask: str,
    ) -> dict[str, Any]:
        before = self.conn.total_changes
        plan = session_open.open_plan(
            self.conn, SessionTarget(session_id), surface=surface, schemes=schemes, seen=seen, **ask
        )
        self.assertEqual(before, self.conn.total_changes, "a plan writes nothing")
        self.assertIn(plan["state"], session_open.STATES)
        for step in plan["steps"]:
            self.assertIn(step["kind"], session_open.STEP_KINDS)
            if step["kind"] == "explain":
                self.assertIn(step["reason"], session_open.REASONS)
            if step["kind"] == "open-link":
                self.assertIn(step["scheme"], url_schemes.SCHEMES)
                self.assertTrue(step["link"].startswith(f"{step['scheme']}://"))
        return plan

    def window_then_link(self, editor: str = "vscode") -> list[dict[str, str]]:
        return [
            {"kind": "focus-folder", "ide": editor, "folder": str(self.folder)},
            {
                "kind": "open-link",
                "scheme": editor,
                "link": f"{editor}://anthropic.claude-code/open?session={UID}",
            },
        ]


class EveryRowOfTheClickTableTests(PlanCase):
    """Each row with everything installed and every route seen working."""

    def test_vscode_opens_the_window_and_then_the_session(self) -> None:
        self.session(opened_in="ide", opened_host="vscode")
        plan = self.plan()
        self.assertEqual(self.window_then_link(), plan["steps"])
        self.assertTrue(plan["one_action"])
        self.assertEqual("recorded", plan["opens"]["source"])

    def test_a_browser_takes_the_same_two_steps_as_two_actions(self) -> None:
        self.session(opened_in="ide", opened_host="vscode")
        plan = self.plan(surface="browser")
        self.assertEqual(["focus-folder", "open-link"], kinds(plan))
        self.assertFalse(plan["one_action"])
        self.assertEqual(Path(plan["steps"][0]["folder"]), self.folder)
        self.assertEqual(
            [f"vscode://file/{self.folder.as_posix().lstrip('/')}", EXTENSION_LINK], links(plan)
        )

    def test_a_fork_with_the_extension_opens_in_its_own_product(self) -> None:
        for editor in ("vscode-insiders", "cursor", "windsurf"):
            with self.subTest(editor=editor):
                self.session(
                    f"{UID[:-1]}{EDITORS.index(editor)}", opened_in="ide", opened_host=editor
                )
                plan = self.plan(f"{UID[:-1]}{EDITORS.index(editor)}")
                self.assertEqual(["focus-folder", "open-link"], kinds(plan))
                self.assertEqual(editor, plan["steps"][0]["ide"])
                self.assertEqual(editor, plan["opens"]["opened_host"])
                self.assertTrue(
                    plan["steps"][1]["link"].startswith(f"{editor}://anthropic.claude-code/")
                )

    def test_a_fork_without_the_extension_opens_in_vscode_and_says_so(self) -> None:
        self.session(opened_in="ide", opened_host="cursor")
        schemes = machine(
            "vscode", "cursor", extensions=(("vscode", url_schemes.CLAUDE_EXTENSION),)
        )
        plan = self.plan(schemes=schemes)
        self.assertEqual(self.window_then_link(), plan["steps"])
        self.assertEqual("cursor", plan["opens"]["missed"])
        self.assertEqual("fallback", plan["opens"]["source"])
        self.assertEqual("cursor", plan["place"]["opened_host"])

    def test_an_ide_terminal_opens_like_the_ide_of_the_same_product(self) -> None:
        self.session(opened_in="ide-terminal", opened_host="vscode")
        self.assertEqual(self.window_then_link(), self.plan()["steps"])
        self.conn.execute("UPDATE sessions SET status = 'active'")
        self.assertEqual(self.window_then_link(), self.plan()["steps"])

    def test_claude_desktop_with_its_own_id_opens_by_link_on_both_surfaces(self) -> None:
        self.session(opened_in="app", opened_host="claude-desktop", host_session_id=DESKTOP_ID)
        step = {
            "kind": "open-link",
            "scheme": "claude",
            "link": f"claude://code/continue?session={DESKTOP_ID}",
        }
        self.assertEqual([step], self.plan()["steps"])
        self.assertEqual([step], self.plan(surface="browser")["steps"])

    def test_claude_desktop_without_its_id_resumes_or_copies_the_command(self) -> None:
        self.session(opened_in="app", opened_host="claude-desktop")
        self.assertEqual([{"kind": "desktop-resume", "session": UID}], self.plan()["steps"])
        self.assertEqual(
            [{"kind": "copy", "text": f'cd "{self.folder}" && claude --desktop --resume {UID}'}],
            self.plan(surface="browser")["steps"],
        )

    def test_an_ended_terminal_session_resumes_in_a_new_terminal(self) -> None:
        self.session(opened_in="terminal")
        self.assertEqual(
            [
                {
                    "kind": "resume-in-terminal",
                    "client": "claude",
                    "session": UID,
                    "folder": str(self.folder),
                }
            ],
            self.plan()["steps"],
        )

    def test_without_windows_terminal_or_in_a_browser_it_goes_through_the_cli_link(self) -> None:
        self.session(opened_in="terminal")
        expected = f"claude-cli://open?cwd={quote(str(self.folder), safe='')}&q=%2Fresume%20{UID}"
        without_terminal = machine(*url_schemes.SCHEMES, terminal=False)
        self.assertEqual([expected], links(self.plan(schemes=without_terminal)))
        self.assertEqual([expected], links(self.plan(surface="browser")))

    def test_a_live_terminal_session_gets_no_second_process(self) -> None:
        self.session(opened_in="terminal", status="active")
        for surface in session_open.SURFACES:
            with self.subTest(surface=surface):
                plan = self.plan(surface=surface)
                self.assertEqual("live", plan["state"])
                self.assertEqual("live-in-terminal", plan["steps"][0]["reason"])
                self.assertEqual(["explain", "focus-folder", "open-link"], kinds(plan))
                self.assertEqual(EXTENSION_LINK, links(plan)[-1])
                self.assertEqual("terminal", plan["place"]["opened_in"])
                self.assertFalse(plan["one_action"])

    def test_a_background_session_is_attached_to_live_or_ended(self) -> None:
        for status in ("active", "ended"):
            with self.subTest(status=status):
                self.session(f"{UID[:-1]}{len(status)}", opened_in="background", status=status)
                plan = self.plan(f"{UID[:-1]}{len(status)}")
                self.assertEqual(["resume-in-terminal"], kinds(plan))
                browser = self.plan(f"{UID[:-1]}{len(status)}", surface="browser")
                self.assertTrue(links(browser)[0].startswith("claude-cli://open?"))

    def test_a_live_session_without_a_window_has_nothing_to_open(self) -> None:
        self.session(opened_in="headless", status="active")
        for surface in session_open.SURFACES:
            plan = self.plan(surface=surface)
            self.assertEqual("headless", plan["state"])
            self.assertEqual("recorded", plan["place"]["source"])
            self.assertEqual([{"kind": "explain", "reason": "live-headless"}], plan["steps"])

    def test_an_ended_session_without_a_window_opens_in_the_fallback(self) -> None:
        self.session(opened_in="headless")
        plan = self.plan()
        self.assertEqual(self.window_then_link(), plan["steps"])
        self.assertEqual("fallback", plan["opens"]["source"])

    def test_the_codex_app_opens_its_thread_on_both_surfaces(self) -> None:
        self.session(client="codex", opened_in="app", opened_host="codex-app")
        step = {"kind": "open-link", "scheme": "codex", "link": f"codex://threads/{UID}"}
        self.assertEqual([step], self.plan()["steps"])
        self.assertEqual([step], self.plan(surface="browser")["steps"])

    def test_codex_in_vscode_opens_through_the_extension_route(self) -> None:
        self.session(client="codex", opened_in="ide", opened_host="vscode")
        plan = self.plan()
        self.assertEqual(["focus-folder", "open-link"], kinds(plan))
        self.assertEqual([f"vscode://openai.chatgpt/local/{UID}"], links(plan))

    def test_an_ended_codex_terminal_resumes_or_copies_the_command(self) -> None:
        self.session(client="codex", opened_in="terminal")
        self.assertEqual(
            [
                {
                    "kind": "resume-in-terminal",
                    "client": "codex",
                    "session": UID,
                    "folder": str(self.folder),
                }
            ],
            self.plan()["steps"],
        )
        self.assertEqual(
            [{"kind": "copy", "text": f'cd "{self.folder}" && codex resume {UID}'}],
            self.plan(surface="browser")["steps"],
        )

    def test_a_live_codex_terminal_gets_no_second_process(self) -> None:
        self.session(client="codex", opened_in="terminal", status="active")
        plan = self.plan()
        self.assertEqual("live-in-terminal", plan["steps"][0]["reason"])
        self.assertEqual([f"vscode://openai.chatgpt/local/{UID}"], links(plan))
        self.assertNotIn("resume-in-terminal", kinds(plan))

    def test_an_unknown_place_opens_in_the_fallback(self) -> None:
        self.session(opened_folder="", transcript_path="")
        plan = self.plan()
        self.assertEqual(self.window_then_link(), plan["steps"])
        self.assertEqual("fallback", plan["opens"]["source"])
        self.assertEqual("none", plan["place"]["source"])

    def test_the_owner_fallback_comes_before_vscode(self) -> None:
        self.session(opened_folder="", transcript_path="")
        self.assertEqual(["resume-in-terminal"], kinds(self.plan(fallback="terminal")))
        plan = self.plan(fallback="cursor")
        self.assertEqual("cursor", plan["opens"]["opened_host"])


class ASessionLongSilentTests(PlanCase):
    """A client that crashed sends no end: its row says it runs, and only silence hints otherwise."""

    NOW = datetime(2026, 11, 4, 12, 0, tzinfo=UTC)
    JUST_OVER = "2026-11-03T11:59:00Z"
    JUST_UNDER = "2026-11-03T12:01:00Z"

    def setUp(self) -> None:
        super().setUp()
        clock = mock.patch.object(leases, "utc_now", return_value=self.NOW)
        clock.start()
        self.addCleanup(clock.stop)

    def silent(self, last_seen: str = JUST_OVER, **columns: str) -> None:
        self.session(opened_in="terminal", status="active", last_seen=last_seen, **columns)

    def test_a_minute_past_the_day_it_says_since_when_and_offers_to_resume_last(self) -> None:
        self.silent()
        plan = self.plan()
        self.assertEqual("live", plan["state"], "silence proves nothing about the process")
        self.assertEqual(
            {"kind": "explain", "reason": "live-in-terminal", "silent_since": self.JUST_OVER},
            plan["steps"][0],
        )
        self.assertEqual(
            ["explain", "focus-folder", "open-link", "resume-in-terminal"], kinds(plan)
        )
        self.assertEqual(
            {
                "kind": "resume-in-terminal",
                "client": "claude",
                "session": UID,
                "folder": str(self.folder),
            },
            plan["steps"][-1],
        )
        self.assertFalse(plan["one_action"], "nothing runs without its own press")

    def test_a_minute_short_of_the_day_there_is_no_offer(self) -> None:
        self.silent(self.JUST_UNDER)
        plan = self.plan()
        self.assertEqual(["explain", "focus-folder", "open-link"], kinds(plan))
        self.assertNotIn("silent_since", plan["steps"][0])

    def test_a_browser_is_offered_the_command_to_copy(self) -> None:
        self.silent()
        plan = self.plan(surface="browser")
        self.assertEqual(
            {"kind": "copy", "text": f'cd "{self.folder}" && claude --resume {UID}'},
            plan["steps"][-1],
        )

    def test_a_codex_session_gets_its_own_command(self) -> None:
        self.silent(client="codex")
        self.assertEqual(
            {"kind": "copy", "text": f'cd "{self.folder}" && codex resume {UID}'},
            self.plan(surface="browser", fallback="codex-app")["steps"][-1],
        )

    def test_the_app_without_a_terminal_or_a_folder_offers_the_command(self) -> None:
        self.silent()
        plan = self.plan(schemes=replace(EVERYTHING, terminal=False))
        self.assertEqual("copy", plan["steps"][-1]["kind"])

    def test_a_process_the_client_saw_alive_gets_no_offer(self) -> None:
        self.silent()
        plan = self.plan(liveness="live")
        self.assertEqual(["explain", "focus-folder", "open-link"], kinds(plan))
        self.assertNotIn("silent_since", plan["steps"][0])

    def test_a_process_the_client_saw_gone_is_simply_ended(self) -> None:
        self.silent()
        plan = self.plan(liveness="ended")
        self.assertEqual(["resume-in-terminal"], kinds(plan))
        self.assertEqual("ended", plan["state"])

    def test_no_last_signal_or_an_unreadable_one_gets_no_offer(self) -> None:
        for session, last_seen in ((UID, ""), (OTHER_UID, "not a time")):
            with self.subTest(last_seen=last_seen):
                self.silent(last_seen, id=session)
                plan = self.plan(session)
                self.assertNotIn("silent_since", plan["steps"][0])
                self.assertNotIn("resume-in-terminal", kinds(plan))

    def test_a_session_in_an_editors_terminal_or_its_tab_gets_no_offer(self) -> None:
        for session, place in (
            (UID, {"opened_in": "ide-terminal", "opened_host": "vscode"}),
            (OTHER_UID, {"opened_in": "ide", "opened_host": "vscode"}),
        ):
            with self.subTest(place=place):
                self.session(session, status="active", last_seen=self.JUST_OVER, **place)
                plan = self.plan(session)
                self.assertNotIn("resume-in-terminal", kinds(plan))
                self.assertFalse(any("silent_since" in step for step in plan["steps"]))

    def test_the_offer_stands_where_looking_elsewhere_was_not_seen_to_be_safe(self) -> None:
        self.silent()
        plan = self.plan(seen=ALL_SEEN - {url_schemes.ELSEWHERE_NOTICE})
        self.assertEqual(["explain", "resume-in-terminal"], kinds(plan))

    def test_the_offer_stands_when_there_is_nowhere_to_look(self) -> None:
        self.silent()
        plan = self.plan(schemes=replace(EVERYTHING, schemes=frozenset(), extensions=frozenset()))
        self.assertEqual(["explain", "resume-in-terminal"], kinds(plan))
        self.assertEqual("live-in-terminal", plan["steps"][0]["reason"])


class WithoutWhatWasNotSeenTests(PlanCase):
    """Each undocumented route has a documented way round while it is unobserved."""

    def seen_without(self, name: str) -> frozenset[str]:
        return ALL_SEEN - {name}

    def test_nothing_is_taken_as_seen_until_it_has_been(self) -> None:
        self.assertEqual(frozenset(), url_schemes.SEEN_LIVE)

    def test_the_app_takes_the_window_and_the_link_as_one_action_with_nothing_seen(self) -> None:
        self.session(opened_in="ide", opened_host="vscode")
        plan = self.plan(seen=url_schemes.SEEN_LIVE)
        self.assertEqual(self.window_then_link(), plan["steps"])
        self.assertTrue(plan["one_action"])

    def test_a_browser_takes_them_as_two_with_nothing_seen(self) -> None:
        self.session(opened_in="ide", opened_host="vscode")
        plan = self.plan(surface="browser", seen=url_schemes.SEEN_LIVE)
        self.assertEqual(["focus-folder", "open-link"], kinds(plan))
        self.assertFalse(plan["one_action"])

    def test_what_a_live_session_elsewhere_says_still_comes_before_any_action(self) -> None:
        self.session(opened_in="app", opened_host="claude-desktop", status="active")
        plan = self.plan(seen=url_schemes.SEEN_LIVE, always="vscode")
        self.assertEqual(["explain"], kinds(plan))
        self.assertEqual("live-elsewhere", plan["steps"][0]["reason"])
        self.assertFalse(plan["one_action"])

    def test_a_session_in_an_editors_terminal_says_so_before_any_action(self) -> None:
        self.session(opened_in="ide-terminal", opened_host="vscode", status="active")
        plan = self.plan(seen=url_schemes.SEEN_LIVE)
        self.assertEqual(["explain"], kinds(plan))
        self.assertEqual("live-in-terminal", plan["steps"][0]["reason"])
        self.assertFalse(plan["one_action"])

    def test_the_desktop_link_not_seen_working_gives_the_documented_command(self) -> None:
        self.session(opened_in="app", opened_host="claude-desktop", host_session_id=DESKTOP_ID)
        seen = self.seen_without(url_schemes.DESKTOP_CONTINUE)
        self.assertEqual(["desktop-resume"], kinds(self.plan(seen=seen)))
        self.assertEqual(["copy"], kinds(self.plan(surface="browser", seen=seen)))

    def test_the_cli_link_not_seen_working_gives_the_command_to_copy(self) -> None:
        self.session(opened_in="terminal")
        plan = self.plan(surface="browser", seen=self.seen_without(url_schemes.CLI_RESUME_LINK))
        self.assertEqual(
            [{"kind": "copy", "text": f'cd "{self.folder}" && claude --resume {UID}'}],
            plan["steps"],
        )

    def test_the_notice_not_seen_holding_leaves_only_the_hint_for_a_live_terminal(self) -> None:
        self.session(opened_in="terminal", status="active")
        plan = self.plan(seen=self.seen_without(url_schemes.ELSEWHERE_NOTICE))
        self.assertEqual([{"kind": "explain", "reason": "live-in-terminal"}], plan["steps"])

    def test_the_notice_not_seen_holding_leaves_only_the_hint_whatever_the_fallback(self) -> None:
        self.session(client="codex", opened_in="terminal", status="active")
        seen = self.seen_without(url_schemes.ELSEWHERE_NOTICE)
        plan = self.plan(fallback="codex-app", seen=seen)
        self.assertEqual([{"kind": "explain", "reason": "live-in-terminal"}], plan["steps"])

    def test_the_notice_not_seen_holding_covers_an_ide_terminal_too(self) -> None:
        self.session(opened_in="ide-terminal", opened_host="vscode", status="active")
        plan = self.plan(seen=self.seen_without(url_schemes.ELSEWHERE_NOTICE))
        self.assertEqual([{"kind": "explain", "reason": "live-in-terminal"}], plan["steps"])

    def test_the_notice_not_seen_holding_keeps_an_unplaced_live_session_out_of_vscode(self) -> None:
        self.session(opened_folder="", transcript_path="", status="active")
        plan = self.plan(seen=self.seen_without(url_schemes.ELSEWHERE_NOTICE))
        self.assertEqual([{"kind": "explain", "reason": "live-elsewhere"}], plan["steps"])

    def test_a_live_session_in_its_own_extension_tab_needs_no_notice(self) -> None:
        self.session(opened_in="ide", opened_host="vscode", status="active")
        plan = self.plan(seen=self.seen_without(url_schemes.ELSEWHERE_NOTICE))
        self.assertEqual(self.window_then_link(), plan["steps"])

    def test_the_codex_route_not_seen_working_opens_the_codex_app(self) -> None:
        seen = self.seen_without(url_schemes.CODEX_EXTENSION_ROUTE)
        self.session(client="codex", opened_in="ide", opened_host="vscode")
        plan = self.plan(seen=seen)
        self.assertEqual([f"codex://threads/{UID}"], links(plan))
        self.assertEqual("codex-app", plan["opens"]["opened_host"])
        self.assertEqual("fallback", plan["opens"]["source"])
        second = self.session(UID[:-1] + "2", client="codex", opened_folder="", transcript_path="")
        self.assertEqual([f"codex://threads/{second}"], links(self.plan(second, seen=seen)))


class RowsOlderThanTheRecordTests(PlanCase):
    def lines(self, *records: object) -> None:
        self.transcript.write_text(
            "".join(json.dumps(record) + "\n" for record in records), encoding="utf-8"
        )

    def old_row(self, **columns: str) -> None:
        self.session(opened_folder="", **columns)

    def test_a_claude_vscode_transcript_gives_vscode(self) -> None:
        self.lines({"type": "user", "entrypoint": "claude-vscode", "text": "words"})
        self.old_row()
        plan = self.plan()
        self.assertEqual(self.window_then_link(), plan["steps"])
        self.assertEqual("derived", plan["place"]["source"])
        self.assertEqual("derived", plan["opens"]["source"])
        self.assertFalse(plan["place"]["first_open"])

    def test_the_newest_entrypoint_decides_after_a_session_moved(self) -> None:
        self.lines(
            {"entrypoint": "claude-vscode"},
            {"entrypoint": "claude-desktop"},
            {"type": "no entrypoint here"},
        )
        self.old_row()
        plan = self.plan()
        self.assertEqual("app", plan["place"]["opened_in"])
        self.assertEqual(["desktop-resume"], kinds(plan))

    def test_each_entrypoint_reads_as_its_place(self) -> None:
        for number, (entrypoint, expected) in enumerate(
            (("cli", "terminal"), ("sdk-cli", "headless"), ("remote_mobile", ""))
        ):
            with self.subTest(entrypoint=entrypoint):
                path = self.root / f"t{number}.jsonl"
                path.write_text(json.dumps({"entrypoint": entrypoint}) + "\n", encoding="utf-8")
                session_id = f"{UID[:-1]}{number}"
                self.session(session_id, opened_folder="", transcript_path=str(path))
                self.assertEqual(expected, self.plan(session_id)["place"]["opened_in"])

    def test_only_the_tail_is_read_and_its_cut_line_is_not_taken(self) -> None:
        padding = "x" * (64 * 1024)
        self.lines({"entrypoint": "cli"}, {"pad": padding})
        self.old_row()
        self.assertEqual("", self.plan()["place"]["opened_in"])

    def test_an_entrypoint_in_a_line_the_read_began_inside_is_not_taken(self) -> None:
        head = json.dumps({"pad": "x" * 100, "entrypoint": "cli"})
        tail = json.dumps({"pad": "y" * (64 * 1024 - 60)})
        self.transcript.write_text(head + "\n" + tail + "\n", encoding="utf-8")
        self.old_row()
        self.assertEqual("", self.plan()["place"]["opened_in"])

    def test_a_transcript_that_is_not_json_leaves_the_place_unknown(self) -> None:
        self.transcript.write_bytes(b'\xff\xfe "entrypoint" not json\n')
        self.old_row()
        self.assertEqual("fallback", self.plan()["opens"]["source"])

    def test_a_codex_rollout_names_its_creator_and_the_plan_says_it_is_the_first_open(self) -> None:
        for number, (originator, opened_in, host) in enumerate(
            (
                ("Codex Desktop", "app", "codex-app"),
                ("codex_vscode", "ide", "vscode"),
                ("codex-tui", "terminal", ""),
                ("codex_cli_rs", "terminal", ""),
            )
        ):
            with self.subTest(originator=originator):
                path = self.root / f"rollout{number}.jsonl"
                meta = {"type": "session_meta", "payload": {"originator": originator}}
                path.write_text(
                    json.dumps(meta)
                    + "\n"
                    + json.dumps({"payload": {"originator": "later"}})
                    + "\n",
                    encoding="utf-8",
                )
                session_id = f"{UID[:-1]}{number}"
                self.session(
                    session_id, client="codex", opened_folder="", transcript_path=str(path)
                )
                shown = self.plan(session_id)["place"]
                self.assertEqual((opened_in, host), (shown["opened_in"], shown["opened_host"]))
                self.assertTrue(shown["first_open"])

    def test_a_start_nothing_recognized_is_not_a_row_older_than_the_record(self) -> None:
        self.lines({"entrypoint": "claude-desktop"})
        self.session()  # the folder of the last start is there, `opened_in` is not
        plan = self.plan()
        self.assertEqual("", plan["place"]["opened_in"])
        self.assertEqual("fallback", plan["opens"]["source"])

    def link_to_attempt(self, relation: str) -> None:
        self.conn.execute("PRAGMA foreign_keys = OFF")
        self.conn.execute(
            "INSERT INTO execution_sessions(execution_id, session_id, relation) VALUES (?, ?, ?)",
            ("attempt", UID, relation),
        )

    def test_a_session_valkama_ran_has_no_window(self) -> None:
        for client in ("codex", "claude"):
            with self.subTest(client=client):
                self.conn.execute("DELETE FROM sessions")
                self.conn.execute("DELETE FROM execution_sessions")
                self.session(client=client, opened_folder="", status="active")
                self.link_to_attempt("launched")
                plan = self.plan()
                self.assertEqual("headless", plan["state"])
                self.assertEqual("live-headless", plan["steps"][0]["reason"])

    def test_a_session_a_person_attached_ran_elsewhere(self) -> None:
        self.session(client="codex", opened_folder="", transcript_path="", status="active")
        self.link_to_attempt("attached")
        self.assertEqual("", self.plan()["place"]["opened_in"])

    def test_a_place_recorded_since_wins_over_the_attempt(self) -> None:
        self.session(client="codex", opened_in="app", opened_host="codex-app", status="active")
        self.link_to_attempt("launched")
        self.assertEqual([f"codex://threads/{UID}"], links(self.plan()))


class WhatARecordCanBeBelievedForTests(PlanCase):
    def test_a_host_left_behind_by_a_moved_session_is_not_believed(self) -> None:
        self.session(opened_in="terminal", opened_host="claude-desktop", host_session_id=DESKTOP_ID)
        plan = self.plan()
        self.assertEqual(["resume-in-terminal"], kinds(plan))
        self.assertEqual("", plan["place"]["opened_host"])

    def test_an_id_with_another_host_does_not_reach_a_link(self) -> None:
        self.session(opened_in="app", opened_host="vscode", host_session_id=DESKTOP_ID)
        plan = self.plan()
        self.assertEqual("claude-desktop", plan["place"]["opened_host"])
        self.assertEqual(["desktop-resume"], kinds(plan))

    def test_an_editor_left_behind_by_desktop_becomes_vscode(self) -> None:
        self.session(opened_in="ide", opened_host="claude-desktop")
        plan = self.plan()
        self.assertEqual(self.window_then_link(), plan["steps"])
        self.assertEqual("vscode", plan["place"]["opened_host"])
        self.assertEqual(("recorded", ""), (plan["opens"]["source"], plan["opens"]["missed"]))

    def test_a_jetbrains_terminal_behaves_as_a_terminal(self) -> None:
        self.session(opened_in="ide-terminal", opened_host="jetbrains")
        self.assertEqual(["resume-in-terminal"], kinds(self.plan()))
        self.conn.execute("UPDATE sessions SET status = 'active'")
        self.assertEqual("live-in-terminal", self.plan()["steps"][0]["reason"])

    def test_a_value_outside_the_enumeration_is_no_place(self) -> None:
        self.session(opened_in="spaceship", opened_host="vscode")
        self.assertEqual("fallback", self.plan()["opens"]["source"])

    def test_a_status_the_executor_checked_replaces_the_stored_one(self) -> None:
        self.session(opened_in="terminal", status="active")
        self.assertEqual(["resume-in-terminal"], kinds(self.plan(liveness="ended")))
        self.conn.execute("UPDATE sessions SET status = 'ended'")
        self.assertEqual("live", self.plan(liveness="live")["state"])

    def test_a_session_id_a_command_line_would_read_is_refused(self) -> None:
        for session in ("abcd&calc", "--dangerously-skip-permissions"):
            with self.subTest(session=session):
                self.session(session, opened_in="terminal")
                plan = self.plan(session)
                self.assertEqual([{"kind": "explain", "reason": "invalid-session"}], plan["steps"])

    def test_an_id_the_extension_would_not_find_is_refused_before_an_empty_conversation(
        self,
    ) -> None:
        self.session("not-a-uuid", opened_in="ide", opened_host="vscode")
        self.assertEqual("invalid-session", self.plan("not-a-uuid")["steps"][0]["reason"])

    def test_a_client_outside_the_families_cannot_be_opened(self) -> None:
        self.session(client="gemini")
        self.assertEqual("unsupported-client", self.plan()["steps"][0]["reason"])

    def test_a_session_nobody_recorded_says_so(self) -> None:
        plan = self.plan("nobody-recorded")
        self.assertEqual("none", plan["state"])
        self.assertEqual("no-session", plan["steps"][0]["reason"])

    def test_a_subagent_opens_through_its_parent(self) -> None:
        self.session(opened_in="ide", opened_host="vscode")
        self.session(
            f"{UID}:agent-1", parent_session_id=UID, agent_id="agent-1", opened_in="terminal"
        )
        plan = self.plan(f"{UID}:agent-1")
        self.assertEqual({"kind": "session", "session": UID, "agent": "agent-1"}, plan["target"])
        self.assertEqual(self.window_then_link(), plan["steps"])

    def test_a_subagent_whose_parent_is_gone_has_no_session(self) -> None:
        self.session(f"{UID}:agent-1", parent_session_id=UID, agent_id="agent-1")
        self.assertEqual("no-session", self.plan(f"{UID}:agent-1")["steps"][0]["reason"])


class AGoneSessionTests(PlanCase):
    def test_a_deleted_transcript_explains_and_offers_no_link(self) -> None:
        self.session(opened_in="ide", opened_host="vscode")
        self.transcript.unlink()
        for surface in session_open.SURFACES:
            plan = self.plan(surface=surface)
            self.assertEqual("gone", plan["state"])
            self.assertEqual(
                [{"kind": "explain", "reason": "gone", "archived": False}], plan["steps"]
            )
            self.assertIsNone(plan["opens"])

    def test_it_says_when_valkama_keeps_a_copy(self) -> None:
        self.session(opened_in="ide", opened_host="vscode")
        self.transcript.unlink()
        self.conn.execute(
            "INSERT INTO execution_events(event_uid, kind, client, session_id, archive_path, archive_sha256,"
            " identity_state, identity_source, received_at)"
            " VALUES ('one', 'transcript_archived', 'claude', ?, 'a/b.jsonl', 'ff', 'confirmed', 'valkama', 'now')",
            (UID,),
        )
        self.assertTrue(self.plan()["steps"][0]["archived"])

    def test_a_live_session_whose_file_has_not_appeared_yet_is_not_gone(self) -> None:
        self.session(opened_in="ide", opened_host="vscode", status="active")
        self.transcript.unlink()
        self.assertEqual("live", self.plan()["state"])

    def test_the_executor_own_check_of_the_process_decides_gone_too(self) -> None:
        self.session(opened_in="ide", opened_host="vscode", status="active")
        self.transcript.unlink()
        self.assertEqual("gone", self.plan(liveness="ended")["state"])

    def test_a_path_that_cannot_be_read_says_nothing_about_the_file(self) -> None:
        self.session(opened_in="ide", opened_host="vscode", transcript_path=str(self.folder))
        self.assertEqual("ended", self.plan()["state"])

    def test_a_row_with_no_transcript_path_is_not_gone(self) -> None:
        self.session(opened_in="ide", opened_host="vscode", transcript_path="")
        self.assertEqual("ended", self.plan()["state"])


class ChoosingTheWindowTests(PlanCase):
    def bind_to_root(self, root: Path) -> None:
        service.create_planning_space(self.conn, project_id="example", name="Example", key="MAIN")
        item = service.create_work_item(self.conn, space="MAIN", title="Item")
        self.conn.execute("UPDATE sessions SET work_item_id = ?", (item["work_item_id"],))
        self.conn.commit()
        entry = project_entry("example", root)
        entry["planning_binding"] = planning_space_entity(
            {
                "data_scope_id": read_store_metadata(self.conn)["data_scope_id"],
                "space_key": "MAIN",
            }
        )
        reader = mock.patch.object(
            project_registry, "_read_registry_bytes", return_value=registry_bytes([entry])
        )
        reader.start()
        self.addCleanup(reader.stop)

    def test_the_last_start_folder_comes_before_the_cwd(self) -> None:
        other = self.root / "worktree"
        other.mkdir()
        self.session(opened_in="ide", opened_host="vscode", cwd=str(other))
        self.assertEqual(str(self.folder), self.plan()["steps"][0]["folder"])

    def test_a_folder_that_went_away_gives_way_to_the_cwd(self) -> None:
        self.session(opened_in="ide", opened_host="vscode", opened_folder=str(self.root / "gone"))
        self.assertEqual(str(self.folder), self.plan()["steps"][0]["folder"])

    def test_a_network_or_climbing_folder_is_not_a_window(self) -> None:
        climbing = os.path.join(str(self.folder), "..", "project")
        for folder in (r"\\server\share", "//server/share", climbing, "relative/folder"):
            with self.subTest(folder=folder):
                self.conn.execute("DELETE FROM sessions")
                self.session(opened_in="ide", opened_host="vscode", opened_folder=folder, cwd="")
                self.assertEqual("no-folder", self.plan()["steps"][0]["reason"])

    def test_a_network_folder_that_answers_is_still_not_a_window(self) -> None:
        for folder in (r"\\server\share", "//server/share"):
            with self.subTest(folder=folder):
                self.conn.execute("DELETE FROM sessions")
                self.session(opened_in="ide", opened_host="vscode", opened_folder=folder, cwd="")
                with mock.patch.object(session_open.os.path, "isdir", return_value=True):
                    plan = self.plan()
                self.assertEqual("no-folder", plan["steps"][0]["reason"])

    def test_with_neither_the_project_root_is_the_window(self) -> None:
        self.session(opened_in="ide", opened_host="vscode", opened_folder="", cwd="")
        self.bind_to_root(self.folder)
        self.assertEqual(str(self.folder), self.plan()["steps"][0]["folder"])

    def test_with_no_window_at_all_there_is_no_link_to_the_extension(self) -> None:
        self.session(opened_in="ide", opened_host="vscode", opened_folder="", cwd="")
        plan = self.plan()
        self.assertEqual([{"kind": "explain", "reason": "no-folder"}], plan["steps"])
        self.assertEqual([], links(plan))

    def test_a_link_with_no_window_still_works_where_no_window_is_needed(self) -> None:
        self.session(
            client="codex", opened_in="app", opened_host="codex-app", opened_folder="", cwd=""
        )
        self.assertEqual([f"codex://threads/{UID}"], links(self.plan()))

    def test_a_terminal_with_no_folder_gives_the_command_to_copy(self) -> None:
        self.session(opened_in="terminal", opened_folder="", cwd="")
        self.assertEqual(["copy"], kinds(self.plan()))

    def test_a_folder_rooted_on_no_drive_is_not_a_window(self) -> None:
        # Python takes `\work` as absolute, and the app takes only a folder on a drive.
        for folder in ("\\work\\repo", "/work/repo"):
            with self.subTest(folder=folder):
                self.conn.execute("DELETE FROM sessions")
                self.session(opened_in="ide", opened_host="vscode", opened_folder=folder, cwd="")
                with mock.patch.object(session_open.os.path, "isdir", return_value=True):
                    plan = self.plan()
                self.assertEqual([{"kind": "explain", "reason": "no-folder"}], plan["steps"])

    def test_a_folder_windows_terminal_would_split_is_resumed_another_way(self) -> None:
        folder = self.root / "my;folder"
        folder.mkdir()
        self.session(opened_in="terminal", opened_folder=str(folder), cwd="")
        plan = self.plan()
        self.assertEqual(["open-link"], kinds(plan))
        self.assertTrue(links(plan)[0].startswith("claude-cli://open?cwd="))
        self.assertEqual(["copy"], kinds(self.plan(seen=frozenset())))
        # A window takes the folder as an argument, where `;` starts nothing.
        self.conn.execute("UPDATE sessions SET opened_in = 'ide', opened_host = 'vscode'")
        self.assertEqual(str(folder), self.plan()["steps"][0]["folder"])

    def test_a_silent_session_in_such_a_folder_is_offered_the_command(self) -> None:
        folder = self.root / "my;folder"
        folder.mkdir()
        self.session(
            opened_in="terminal",
            opened_folder=str(folder),
            cwd="",
            status="active",
            last_seen="2026-01-01T00:00:00Z",
        )
        plan = self.plan()
        self.assertEqual("copy", plan["steps"][-1]["kind"])

    def test_a_folder_with_url_characters_stays_one_path(self) -> None:
        folder = self.root / "a b#c"
        folder.mkdir()
        self.session(opened_in="terminal", opened_folder=str(folder))
        plan = self.plan(surface="browser")
        self.assertIn("a%20b%23c", links(plan)[0])
        self.conn.execute("UPDATE sessions SET opened_in = 'ide', opened_host = 'vscode'")
        window = self.plan(surface="browser")["steps"][0]["link"]
        self.assertTrue(window.startswith("vscode://file/"))
        self.assertTrue(window.endswith("a%20b%23c"))


class WhenAPlaceCannotBeOpenedTests(PlanCase):
    def test_a_dangling_cursor_registration_reads_as_not_installed(self) -> None:
        """The scheme reader already dropped it, so this is what the plan is given."""

        self.session(opened_folder="", transcript_path="")
        schemes = machine(extensions=(("cursor", url_schemes.CLAUDE_EXTENSION),))
        plan = self.plan(always="cursor", schemes=schemes)
        self.assertEqual(
            [{"kind": "explain", "reason": "not-installed", "host": "cursor"}], plan["steps"]
        )

    def test_nothing_installed_says_vscode_is_not(self) -> None:
        self.session(opened_folder="", transcript_path="")
        plan = self.plan(schemes=machine())
        self.assertEqual(
            [{"kind": "explain", "reason": "not-installed", "host": "vscode"}], plan["steps"]
        )

    def test_vscode_without_the_extension_is_not_installed_for_this(self) -> None:
        self.session(opened_folder="", transcript_path="")
        self.assertEqual(
            "not-installed", self.plan(schemes=machine("vscode"))["steps"][0]["reason"]
        )

    def test_desktop_gone_gives_way_to_the_fallback_and_names_what_was_passed(self) -> None:
        self.session(opened_in="app", opened_host="claude-desktop", host_session_id=DESKTOP_ID)
        schemes = machine("vscode", extensions=(("vscode", url_schemes.CLAUDE_EXTENSION),))
        plan = self.plan(schemes=schemes)
        self.assertEqual(self.window_then_link(), plan["steps"])
        self.assertEqual("claude-desktop", plan["opens"]["missed"])

    def test_the_codex_app_gone_gives_way_and_so_does_a_thread_id_it_would_not_take(self) -> None:
        self.session(client="codex", opened_in="app", opened_host="codex-app")
        plan = self.plan(schemes=machine("vscode"))
        self.assertEqual("not-installed", plan["steps"][0]["reason"])
        self.assertEqual("vscode", plan["steps"][0]["host"], "the last place tried")
        self.session("not-a-uuid", client="codex", opened_in="app", opened_host="codex-app")
        self.assertEqual("invalid-session", self.plan("not-a-uuid")["steps"][0]["reason"])


class AlwaysOpenInTests(PlanCase):
    def test_it_overrides_the_recorded_place_and_says_so(self) -> None:
        self.session(opened_in="app", opened_host="claude-desktop", host_session_id=DESKTOP_ID)
        plan = self.plan(always="vscode")
        self.assertEqual(self.window_then_link(), plan["steps"])
        self.assertEqual("always", plan["opens"]["source"])
        self.assertEqual("claude-desktop", plan["place"]["opened_host"])

    def test_it_does_not_fall_through_to_another_place_when_it_cannot_open(self) -> None:
        self.session(opened_in="ide", opened_host="vscode")
        plan = self.plan(always="windsurf", schemes=machine("vscode"))
        self.assertEqual("windsurf", plan["steps"][0]["host"])
        self.assertEqual(1, len(plan["steps"]))

    def test_it_never_starts_a_second_process_on_a_live_session(self) -> None:
        self.session(opened_in="ide", opened_host="vscode", status="active")
        plan = self.plan(always="terminal")
        self.assertEqual(self.window_then_link(), plan["steps"])

    def test_it_never_starts_a_second_process_on_a_live_terminal(self) -> None:
        self.session(opened_in="terminal", status="active")
        plan = self.plan(always="terminal")
        self.assertNotIn("resume-in-terminal", kinds(plan))
        self.assertEqual("live-in-terminal", plan["steps"][0]["reason"])

    def test_the_fallback_never_starts_a_second_process_on_a_live_session(self) -> None:
        self.session(opened_folder="", transcript_path="", status="active")
        self.assertEqual(self.window_then_link(), self.plan(fallback="terminal")["steps"])

    def test_it_keeps_a_live_session_without_a_window_out(self) -> None:
        self.session(opened_in="headless", status="active")
        self.assertEqual("live-headless", self.plan(always="vscode")["steps"][0]["reason"])

    def test_a_place_of_another_client_is_ignored(self) -> None:
        self.session(opened_in="ide", opened_host="vscode")
        self.assertEqual("recorded", self.plan(always="codex-app")["opens"]["source"])
        self.conn.execute("UPDATE sessions SET opened_in = '', opened_host = ''")
        self.assertEqual(self.window_then_link(), self.plan(fallback="codex-app")["steps"])

    def test_a_place_it_cannot_open_while_live_elsewhere_is_explained(self) -> None:
        self.session(opened_in="ide", opened_host="vscode", status="active")
        seen = ALL_SEEN - {url_schemes.ELSEWHERE_NOTICE}
        plan = self.plan(always="cursor", seen=seen)
        self.assertEqual([{"kind": "explain", "reason": "live-elsewhere"}], plan["steps"])


class PathTargetCase(PlanCase):
    def setUp(self) -> None:
        super().setUp()
        # A junction must not land where a tracked tree could hold it.
        scratch_root = Path(__file__).resolve().parent.parent / "tmp"
        scratch_root.mkdir(exist_ok=True)
        scratch = tempfile.TemporaryDirectory(dir=scratch_root)
        self.addCleanup(scratch.cleanup)
        self.scratch = Path(os.path.realpath(scratch.name))
        self.project = self.scratch / "project"
        self.nested = self.project / "docs" / "a b#c"
        self.nested.mkdir(parents=True)
        self.document = self.nested / "plan.md"
        self.document.write_text("words\n", encoding="utf-8")
        self.neighbour = self.scratch / "neighbour"
        self.neighbour.mkdir()
        (self.neighbour / "secret.md").write_text("words\n", encoding="utf-8")
        entries = [project_entry("example", self.project), project_entry("other", self.neighbour)]
        reader = mock.patch.object(
            project_registry, "_read_registry_bytes", return_value=registry_bytes(entries)
        )
        reader.start()
        self.addCleanup(reader.stop)

    def path_plan(
        self,
        kind: str,
        path: str,
        *,
        project: str = "example",
        line: int | None = None,
        surface: str = "desktop",
        schemes: Installed = EVERYTHING,
        fallback: str = "",
    ) -> dict[str, Any]:
        return session_open.open_plan(
            self.conn,
            PathTarget(kind, project, path, line),
            surface=surface,
            fallback=fallback,
            schemes=schemes,
            seen=frozenset(),
        )

    def assert_refused(self, code: str, plan: dict[str, Any]) -> None:
        self.assertEqual(
            [{"kind": "explain", "reason": "path-refused", "code": code}], plan["steps"]
        )
        self.assertIsNone(plan["opens"])
        self.assertNotIn(str(self.scratch), json.dumps(plan))


class FileTargetTests(PathTargetCase):
    def test_the_app_opens_the_project_window_and_then_the_file_at_its_line(self) -> None:
        plan = self.path_plan("file", "docs/a b#c/plan.md", line=42)
        self.assertEqual(
            [
                {"kind": "focus-folder", "ide": "vscode", "folder": str(self.project)},
                {"kind": "open-file", "ide": "vscode", "path": str(self.document), "line": 42},
            ],
            plan["steps"],
        )
        self.assertTrue(plan["one_action"])
        self.assertEqual("vscode", plan["opens"]["opened_host"])
        self.assertEqual(
            {"kind": "file", "project": "example", "path": "docs/a b#c/plan.md", "line": 42},
            plan["target"],
        )

    def test_a_browser_opens_it_by_one_link_with_the_path_kept_whole(self) -> None:
        plan = self.path_plan("file", "docs/a b#c/plan.md", line=42, surface="browser")
        encoded = self.document.as_uri().removeprefix("file:///")
        self.assertIn("a%20b%23c", encoded)
        self.assertEqual(
            [
                {
                    "kind": "open-file",
                    "ide": "vscode",
                    "path": str(self.document),
                    "line": 42,
                    "link": f"vscode://file/{encoded}:42:1",
                }
            ],
            plan["steps"],
        )
        self.assertTrue(plan["one_action"])

    def test_with_no_line_it_opens_at_the_top(self) -> None:
        plan = self.path_plan("file", "docs/a b#c/plan.md", surface="browser")
        self.assertIsNone(plan["steps"][0]["line"])
        self.assertFalse(plan["steps"][0]["link"].endswith(":1"))

    def test_the_owner_editor_is_used_and_needs_no_extension(self) -> None:
        schemes = machine("vscode", "cursor")
        plan = self.path_plan("file", "docs/a b#c/plan.md", fallback="cursor", schemes=schemes)
        self.assertEqual("cursor", plan["steps"][1]["ide"])
        self.assertEqual("", plan["opens"]["missed"])

    def test_a_setting_that_is_no_editor_leaves_vscode(self) -> None:
        plan = self.path_plan("file", "docs/a b#c/plan.md", fallback="terminal")
        self.assertEqual("vscode", plan["steps"][1]["ide"])

    def test_an_editor_gone_gives_way_to_vscode_and_is_named(self) -> None:
        plan = self.path_plan(
            "file", "docs/a b#c/plan.md", fallback="cursor", schemes=machine("vscode")
        )
        self.assertEqual("vscode", plan["steps"][1]["ide"])
        self.assertEqual("cursor", plan["opens"]["missed"])

    def test_no_editor_at_all_says_which_was_wanted(self) -> None:
        plan = self.path_plan("file", "docs/a b#c/plan.md", fallback="cursor", schemes=machine())
        self.assertEqual(
            [{"kind": "explain", "reason": "not-installed", "host": "cursor"}], plan["steps"]
        )

    def test_a_path_that_climbs_out_is_refused(self) -> None:
        self.assert_refused("outside_root", self.path_plan("file", "../neighbour/secret.md"))

    def test_another_registered_project_is_outside_this_one(self) -> None:
        self.assert_refused(
            "outside_root", self.path_plan("file", str(self.neighbour / "secret.md"))
        )
        self.assertEqual(
            ["focus-folder", "open-file"],
            kinds(self.path_plan("file", "secret.md", project="other")),
        )

    @unittest.skipUnless(os.name == "nt", "a junction is a Windows reparse point")
    def test_a_junction_out_of_the_project_is_refused(self) -> None:
        link = self.project / "escape"
        made = processes.run_text(
            ["cmd.exe", "/d", "/c", "mklink", "/J", str(link), str(self.neighbour)],
            # The console's code page: read only to name a failure to a person.
            errors="replace",
        )
        self.assertEqual(0, made.returncode, made.stdout + made.stderr)
        # Removing a junction must leave what it points at alone.
        self.addCleanup(os.rmdir, link)
        self.assert_refused("outside_root", self.path_plan("file", "escape/secret.md"))
        self.assertTrue((self.neighbour / "secret.md").exists())

    def test_a_form_windows_would_not_take_is_refused(self) -> None:
        for path in ("//server/share/a.md", "C:relative.md", "docs/NUL.txt", "plan.md:stream"):
            with self.subTest(path=path):
                self.assert_refused("invalid_path", self.path_plan("file", path))

    def test_nothing_there_and_an_unknown_project_say_so(self) -> None:
        self.assert_refused("not_found", self.path_plan("file", "docs/none.md"))
        self.assert_refused("project_unknown", self.path_plan("file", "plan.md", project="nobody"))

    def test_a_folder_is_not_a_file(self) -> None:
        self.assert_refused("directory", self.path_plan("file", "docs"))

    def test_a_project_on_a_network_share_is_explained_not_offered(self) -> None:
        # The app opens only what lies on a drive, and would refuse the whole plan.
        share = "\\\\server\\share\\repo"
        root = documents.Root("example", share)
        found = documents.Located("file", "example", "a.md", True, share + "\\a.md")
        with (
            mock.patch.object(documents, "registered_roots", return_value=(root,)),
            mock.patch.object(documents, "locate", return_value=found),
        ):
            plan = self.path_plan("file", "a.md")
        self.assertEqual(
            [{"kind": "explain", "reason": "path-refused", "code": "invalid_path"}],
            plan["steps"],
        )


class FolderTargetTests(PathTargetCase):
    def test_the_app_focuses_the_folder(self) -> None:
        plan = self.path_plan("folder", "docs")
        self.assertEqual(
            [{"kind": "focus-folder", "ide": "vscode", "folder": str(self.project / "docs")}],
            plan["steps"],
        )
        self.assertTrue(plan["one_action"])
        self.assertNotIn("line", plan["target"])

    def test_a_browser_follows_a_link_to_it(self) -> None:
        plan = self.path_plan("folder", "docs/a b#c", surface="browser")
        encoded = self.nested.as_uri().removeprefix("file:///")
        self.assertEqual([f"vscode://file/{encoded}"], links(plan))

    def test_a_file_is_not_a_folder(self) -> None:
        self.assert_refused("not_a_folder", self.path_plan("folder", "docs/a b#c/plan.md"))

    def test_a_folder_outside_is_refused(self) -> None:
        self.assert_refused("outside_root", self.path_plan("folder", "../neighbour"))


FOLDER_SAMPLES = Path(__file__).resolve().parent / "fixtures" / "folder-samples.json"


def project_directory(folder: Path) -> str:
    """Claude Code's documented name for a folder's transcripts: `-` for every non-alphanumeric."""

    return "".join(c if c.isascii() and c.isalnum() else "-" for c in str(folder))


class TheFolderASessionOpensInTests(PlanCase):
    """A session started in one folder whose shell moved on, as a real row of that kind reads."""

    def setUp(self) -> None:
        super().setUp()
        self.nested = self.folder / "services" / "api"
        self.nested.mkdir(parents=True)

    def started_in(self, started: Path | str, **columns: str) -> str:
        """A row whose transcript lies where the client keeps one for a start in `started`."""

        name = started if isinstance(started, str) else project_directory(started)
        directory = self.root / "projects" / name
        directory.mkdir(parents=True, exist_ok=True)
        transcript = directory / f"{UID}.jsonl"
        transcript.write_text("{}\n", encoding="utf-8")
        return self.session(transcript_path=str(transcript), **columns)

    def moved_on(self) -> dict[str, str]:
        """The columns of a row whose every record says the folder the shell reached."""

        return {"opened_folder": str(self.nested), "cwd": str(self.nested)}

    def test_the_window_is_the_folder_its_transcript_names_not_the_one_its_shell_reached(
        self,
    ) -> None:
        self.started_in(self.folder, opened_in="ide", opened_host="vscode", **self.moved_on())
        self.assertEqual(self.window_then_link(), self.plan()["steps"])

    def test_the_terminal_and_the_command_get_that_same_folder(self) -> None:
        self.started_in(self.folder, opened_in="terminal", **self.moved_on())
        self.assertEqual(
            [
                {
                    "kind": "resume-in-terminal",
                    "client": "claude",
                    "session": UID,
                    "folder": str(self.folder),
                }
            ],
            self.plan()["steps"],
        )
        self.assertEqual(
            [{"kind": "copy", "text": f'cd "{self.folder}" && claude --resume {UID}'}],
            self.plan(surface="browser", seen=frozenset())["steps"],
        )

    def test_cwd_alone_names_the_folder_when_the_record_of_the_start_is_empty(self) -> None:
        self.started_in(
            self.folder,
            opened_in="ide",
            opened_host="vscode",
            opened_folder="",
            cwd=str(self.nested),
        )
        self.assertEqual(str(self.folder), self.plan()["steps"][0]["folder"])

    def test_a_moved_session_opens_where_its_transcript_moved_to(self) -> None:
        # `/cd` relocates the transcript, so the record of the start is what is out of date.
        self.started_in(
            self.nested,
            opened_in="ide",
            opened_host="vscode",
            opened_folder=str(self.folder),
            cwd=str(self.nested),
        )
        self.assertEqual(str(self.nested), self.plan()["steps"][0]["folder"])

    def test_a_drive_letter_written_either_way_is_the_same_folder(self) -> None:
        self.started_in(
            project_directory(self.folder).swapcase(),
            opened_in="ide",
            opened_host="vscode",
            **self.moved_on(),
        )
        self.assertEqual(str(self.folder), self.plan()["steps"][0]["folder"])

    def test_with_no_match_the_order_is_the_old_one(self) -> None:
        self.started_in(
            self.root / "elsewhere",
            opened_in="ide",
            opened_host="vscode",
            opened_folder=str(self.nested),
            cwd=str(self.folder),
        )
        self.assertEqual(str(self.nested), self.plan()["steps"][0]["folder"])

    def test_a_folder_that_is_gone_gives_way_to_the_old_order(self) -> None:
        self.started_in(self.nested / "gone", opened_in="ide", opened_host="vscode")
        self.assertEqual(str(self.folder), self.plan()["steps"][0]["folder"])

    def test_a_codex_rollout_says_nothing_of_a_folder(self) -> None:
        self.started_in(
            self.folder,
            client="codex",
            opened_in="terminal",
            **self.moved_on(),
        )
        self.assertEqual(
            f'cd "{self.nested}" && codex resume {UID}',
            self.plan(surface="browser", seen=frozenset())["steps"][-1]["text"],
        )

    def test_a_session_context_names_the_same_folder_and_keeps_cwd_as_it_is(self) -> None:
        self.started_in(self.folder, opened_in="ide", opened_host="vscode", **self.moved_on())
        context = sessions.session_context(self.conn, UID)
        self.assertEqual(str(self.folder), context["session_folder"])
        self.assertEqual(str(self.nested), context["cwd"])
        self.assertEqual(str(self.nested), context["session_cwd"])


class ProjectDirectoryNameTests(unittest.TestCase):
    """Which folder a transcript's directory names, by the rule Claude Code documents."""

    def named(self, directory: str, *folders: str) -> str:
        transcript = f"D:\\work\\.claude\\projects\\{directory}\\{UID}.jsonl"
        return sessions.transcript_folder(transcript, *folders)

    def test_every_other_character_is_a_dash_with_nothing_collapsed(self) -> None:
        self.assertEqual(
            "C:\\work\\my_app.v2 (old)",
            self.named("C--work-my-app-v2--old-", "C:\\work\\my_app.v2 (old)\\sub"),
        )

    def test_the_extension_writes_the_drive_in_lower_case(self) -> None:
        self.assertEqual("C:\\work\\demo", self.named("c--work-demo", "C:\\work\\demo\\sub\\deep"))

    def test_the_first_folder_given_wins(self) -> None:
        self.assertEqual(
            "C:\\work\\a-b", self.named("C--work-a-b", "C:\\work\\a-b", "C:\\work\\a_b")
        )

    def test_the_drive_itself_can_be_where_it_started(self) -> None:
        self.assertEqual("C:\\", self.named("C--", "C:\\work"))

    def test_a_folder_that_only_looks_alike_is_no_match(self) -> None:
        self.assertEqual("", self.named("C--work-demo", "C:\\work\\demo-two\\sub"))

    def test_a_long_name_is_compared_where_the_client_cut_it(self) -> None:
        long = "C:\\" + "a" * 210
        cut = "C--" + "a" * 197 + "-1a2b3c"
        self.assertEqual(long, self.named(cut, long))
        self.assertEqual("", self.named("C--" + "a" * 197, long), "a cut name carries a hash")

    def test_no_directory_names_nothing(self) -> None:
        self.assertEqual("", sessions.transcript_folder("", "C:\\work"))


class CopiedCommandTests(unittest.TestCase):
    """What is pasted runs in the session's folder, or names none it cannot quote."""

    def test_each_sample_is_taken_as_the_app_takes_it(self) -> None:
        samples = json.loads(FOLDER_SAMPLES.read_text(encoding="utf-8"))["pasted"]
        self.assertGreater(len(samples), 4)
        command = f"claude --resume {UID}"
        for sample in samples:
            folder = sample["folder"] + "a" * sample.get("pad", 0)
            with self.subTest(folder=folder[:60]):
                expected = f'cd "{folder}" && {command}' if sample["pastes"] else command
                self.assertEqual(expected, session_open._copied_command(command, folder))


class FolderRuleTests(unittest.TestCase):
    """The folders a plan may carry, as the app takes them: `desktop/session_opener.js`
    reads the same samples, so neither side can take one the other refuses."""

    def test_each_sample_is_taken_as_the_app_takes_it(self) -> None:
        samples = json.loads(FOLDER_SAMPLES.read_text(encoding="utf-8"))["samples"]
        self.assertGreater(len(samples), 10)
        for sample in samples:
            folder = sample["folder"] + "a" * sample.get("pad", 0)
            with self.subTest(folder=folder[:60]):
                self.assertEqual(sample["opens"], session_open._written_folder(folder))
                self.assertEqual(
                    sample["terminal"], session_open._written_folder(folder, terminal=True)
                )


class OverHttpTests(unittest.TestCase):
    def setUp(self) -> None:
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name).resolve()
        environment = mock.patch.dict(os.environ, {"VALKAMA_DB": str(self.root / "store.sqlite3")})
        environment.start()
        self.addCleanup(environment.stop)
        conn = store.connect()
        conn.execute(
            "INSERT INTO sessions(id, client, cwd, status, opened_in, opened_host)"
            " VALUES (?, 'claude', ?, 'ended', 'ide', 'vscode')",
            (UID, str(self.root)),
        )
        conn.commit()
        conn.close()
        detect = mock.patch.object(url_schemes, "detect", return_value=EVERYTHING)
        detect.start()
        self.addCleanup(detect.stop)
        self.server = http_surface.PlatformHTTPServer(
            ("127.0.0.1", 0), http_surface.Handler, token_path=self.root / "installation-token"
        )
        thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(thread.join, 2)
        self.addCleanup(self.server.server_close)
        self.addCleanup(self.server.shutdown)

    def get(self, *, headers: dict[str, str] | None = None, **query: str) -> tuple[int, dict, Any]:
        client = http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=5)
        try:
            client.request("GET", f"/api/open-plan?{urlencode(query)}", headers=headers or {})
            response = client.getresponse()
            return response.status, json.loads(response.read()), response
        finally:
            client.close()

    SAME_ORIGIN = {"Sec-Fetch-Site": "same-origin"}  # noqa: RUF012

    def test_the_places_reach_only_a_same_origin_fetch(self) -> None:
        for headers, status in ((self.SAME_ORIGIN, 200), ({"Sec-Fetch-Site": "cross-site"}, 403)):
            client = http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=5)
            try:
                client.request("GET", "/api/open-places", headers=headers)
                response = client.getresponse()
                body = json.loads(response.read())
            finally:
                client.close()
            with self.subTest(headers=headers):
                self.assertEqual(response.status, status)
                self.assertEqual(status == 200, "places" in body)

    def test_the_plan_reaches_a_same_origin_fetch_and_is_not_cached(self) -> None:
        status, plan, response = self.get(
            headers=self.SAME_ORIGIN, target="session", session=UID, surface="browser"
        )
        self.assertEqual(200, status)
        self.assertEqual("no-store", response.getheader("Cache-Control"))
        self.assertEqual(["focus-folder", "open-link"], kinds(plan))

    def test_the_settings_travel_in_the_query(self) -> None:
        status, plan, _ = self.get(
            headers=self.SAME_ORIGIN,
            target="session",
            session=UID,
            surface="browser",
            always="cursor",
        )
        self.assertEqual(200, status)
        self.assertEqual("always", plan["opens"]["source"])
        self.assertEqual("cursor", plan["opens"]["opened_host"])

    def test_local_paths_do_not_go_to_another_site_or_to_no_site(self) -> None:
        for headers in ({}, {"Sec-Fetch-Site": "cross-site"}, {"Sec-Fetch-Site": "same-site"}):
            with self.subTest(headers=headers):
                status, answer, _ = self.get(
                    headers=headers, target="session", session=UID, surface="browser"
                )
                self.assertEqual(403, status)
                self.assertNotIn("steps", answer)

    def test_another_origin_is_refused_even_with_the_header(self) -> None:
        status, _, _ = self.get(
            headers={**self.SAME_ORIGIN, "Origin": "http://example.test"},
            target="session",
            session=UID,
            surface="browser",
        )
        self.assertEqual(403, status)

    def test_a_request_outside_the_closed_values_is_refused_by_name(self) -> None:
        for query, name in (
            ({"target": "session", "session": UID}, "surface"),
            ({"target": "session", "session": UID, "surface": "tv"}, "surface"),
            ({"session": UID, "surface": "browser"}, "target"),
            ({"target": "url", "session": UID, "surface": "browser"}, "target"),
            ({"target": "session", "surface": "browser"}, "session"),
            (
                {"target": "session", "session": UID, "surface": "browser", "fallback": "x"},
                "fallback",
            ),
            ({"target": "session", "session": UID, "surface": "browser", "always": "x"}, "always"),
            (
                {"target": "session", "session": UID, "surface": "browser", "liveness": "x"},
                "liveness",
            ),
        ):
            with self.subTest(query=query):
                status, answer, _ = self.get(headers=self.SAME_ORIGIN, **query)
                self.assertEqual(400, status)
                self.assertIn(name, answer["error"]["message"])

    def test_a_file_and_a_folder_are_asked_for_by_project_and_path(self) -> None:
        folder = self.root / "docs"
        folder.mkdir()
        (folder / "plan.md").write_text("words\n", encoding="utf-8")
        entry = project_entry("example", self.root)
        with mock.patch.object(
            project_registry, "_read_registry_bytes", return_value=registry_bytes([entry])
        ):
            status, plan, response = self.get(
                headers=self.SAME_ORIGIN,
                target="file",
                project="example",
                path="docs/plan.md",
                line="7",
                surface="browser",
            )
            self.assertEqual(200, status)
            self.assertEqual("no-store", response.getheader("Cache-Control"))
            self.assertEqual(7, plan["steps"][0]["line"])
            self.assertTrue(plan["steps"][0]["link"].endswith("/docs/plan.md:7:1"))
            status, plan, _ = self.get(
                headers=self.SAME_ORIGIN,
                target="folder",
                project="example",
                path="docs",
                surface="desktop",
            )
            self.assertEqual(200, status)
            self.assertEqual(["focus-folder"], kinds(plan))
            status, plan, _ = self.get(
                headers=self.SAME_ORIGIN,
                target="file",
                project="example",
                path="../secret.md",
                surface="browser",
            )
            self.assertEqual(200, status)
            self.assertEqual("outside_root", plan["steps"][0]["code"])

    def test_a_path_target_needs_its_project_its_path_and_a_real_line(self) -> None:
        file_target = {"target": "file", "project": "example", "path": "a.md", "surface": "browser"}
        for query, name in (
            ({**file_target, "project": ""}, "project"),
            ({**file_target, "path": ""}, "path"),
            ({**file_target, "line": "0"}, "line"),
            ({**file_target, "line": "seven"}, "line"),
            ({**file_target, "line": "1" * 5000}, "line"),
        ):
            with self.subTest(query={key: value[:12] for key, value in query.items()}):
                status, answer, _ = self.get(headers=self.SAME_ORIGIN, **query)
                self.assertEqual(400, status)
                self.assertIn(name, answer["error"]["message"])

    def test_a_store_that_cannot_open_gets_the_stable_envelope(self) -> None:
        with mock.patch.object(http_surface, "connect", side_effect=ValueError("store is too new")):
            status, answer, _ = self.get(
                headers=self.SAME_ORIGIN, target="session", session=UID, surface="browser"
            )
        self.assertGreaterEqual(status, 400)
        self.assertEqual("error", answer["status"])
