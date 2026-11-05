"""Where a session was last opened: what the hook reads, keeps and writes.

The classification cases are the plan's environment table, one row per way a
client can open a session, with the signals each client is documented or
observed to give: `CLAUDE_CODE_ENTRYPOINT` and its known values, the
background session kinds, Claude Desktop's host session id, `TERM_PROGRAM` in
an IDE's integrated terminal, JetBrains' terminal emulator name, the Codex VS
Code extension's originator override, and the executable names of the
processes above the hook. The store cases follow the session row rules of the
hook contract: an event older than the row's `last_seen` is history, and a
session start is the one boundary that may say where the session now is.

Every id, path and value here is invented.
"""

from __future__ import annotations

import io
import json
import os
import sys
import tempfile
import unittest
from typing import ClassVar
from unittest import mock

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from server import store
from server.hooks import entry, ingest, normalize, place, spool

UID_A = "00000000-0000-4000-8000-0000000000a1"
UID_B = "00000000-0000-4000-8000-0000000000b2"
UID_C = "00000000-0000-4000-8000-0000000000c3"
DESKTOP_ID = "local_0d1e2f3a-4b5c-4d6e-8f70-81920a1b2c3d"

#: The keys a spool line of a pre-place build may hold, and the version it
#: wrote. A build of that age sets aside any line with another key or version,
#: so a line without a place must keep exactly this shape.
PRE_PLACE_KEYS = frozenset(
    {
        "v",
        "event_uid",
        "occurred_at",
        "client",
        "hook_event",
        "kind",
        "session_id",
        "agent_id",
        "agent_type",
        "turn_id",
        "permission_mode",
        "model",
        "source",
        "reason",
        "cwd",
        "transcript_path",
        "agent_transcript_path",
        "label",
        "spooled_at",
        "spool_reason",
    }
)

#: A line exactly as a pre-place build spooled a session start.
PRE_PLACE_LINE = (
    '{"v":1,"event_uid":"00000000-0000-4000-8000-0000000000a1",'
    '"occurred_at":"2026-10-31T10:00:00.000Z","client":"claude","hook_event":"SessionStart",'
    '"kind":"session_start","session_id":"S","agent_id":null,"agent_type":null,'
    '"turn_id":null,"permission_mode":null,"model":null,"source":"startup","reason":null,'
    '"cwd":"C:/demo","transcript_path":null,"agent_transcript_path":null,"label":null,'
    '"spooled_at":"2026-10-31T10:00:01.000Z","spool_reason":"busy"}'
)


def env(**values: str) -> dict[str, str]:
    return dict(values)


#: (row, client, variables, ancestors nearest first, expected place).
CASES: list[tuple[str, str, dict[str, str], tuple[str, ...], tuple[str, str, str]]] = [
    # E1: the Claude Code extension in VS Code.
    ("E1 extension", "claude", env(CLAUDE_CODE_ENTRYPOINT="claude-vscode"),
     ("claude.exe", "Code.exe", "Code.exe", "explorer.exe"), ("ide", "vscode", "")),
    ("E1 extension, no ancestors read", "claude", env(CLAUDE_CODE_ENTRYPOINT="claude-vscode"),
     (), ("ide", "vscode", "")),
    # E2: the extension in a fork of VS Code; the product comes from the ancestor.
    ("E2 Insiders", "claude", env(CLAUDE_CODE_ENTRYPOINT="claude-vscode"),
     ("claude.exe", "Code - Insiders.exe"), ("ide", "vscode-insiders", "")),
    ("E2 Cursor", "claude", env(CLAUDE_CODE_ENTRYPOINT="claude-vscode"),
     ("claude.exe", "Cursor.exe"), ("ide", "cursor", "")),
    ("E2 Windsurf", "claude", env(CLAUDE_CODE_ENTRYPOINT="claude-vscode"),
     ("claude.exe", "WINDSURF.EXE"), ("ide", "windsurf", "")),
    # E3: the Code tab of Claude Desktop, with the id Desktop knows it by.
    ("E3 Desktop", "claude",
     env(CLAUDE_CODE_ENTRYPOINT="claude-desktop", CLAUDE_CODE_HOST_SESSION_ID=DESKTOP_ID),
     ("claude.exe", "claude.exe"), ("app", "claude-desktop", DESKTOP_ID)),
    ("E3 Desktop, third-party build", "claude",
     env(CLAUDE_CODE_ENTRYPOINT="claude-desktop-3p", CLAUDE_CODE_HOST_SESSION_ID="local_ab-12"),
     (), ("app", "claude-desktop", "local_ab-12")),
    ("E3 Desktop without its id", "claude", env(CLAUDE_CODE_ENTRYPOINT="claude-desktop"),
     (), ("app", "claude-desktop", "")),
    # E4: the CLI in a terminal of its own.
    ("E4 Windows Terminal", "claude", env(CLAUDE_CODE_ENTRYPOINT="cli"),
     ("claude.exe", "pwsh.exe", "OpenConsole.exe", "WindowsTerminal.exe"), ("terminal", "", "")),
    ("E4 console host", "claude", env(CLAUDE_CODE_ENTRYPOINT="cli"),
     ("claude.exe", "cmd.exe", "explorer.exe"), ("terminal", "", "")),
    # E5: the CLI in the integrated terminal of VS Code or a fork.
    ("E5 VS Code terminal", "claude", env(CLAUDE_CODE_ENTRYPOINT="cli", TERM_PROGRAM="vscode"),
     ("claude.exe", "pwsh.exe", "Code.exe"), ("ide-terminal", "vscode", "")),
    ("E5 Cursor terminal", "claude", env(CLAUDE_CODE_ENTRYPOINT="cli", TERM_PROGRAM="vscode"),
     ("claude.exe", "pwsh.exe", "Cursor.exe"), ("ide-terminal", "cursor", "")),
    # E6: the CLI in a JetBrains IDE's terminal.
    ("E6 JetBrains by emulator", "claude",
     env(CLAUDE_CODE_ENTRYPOINT="cli", TERMINAL_EMULATOR="JetBrains-JediTerm"),
     (), ("ide-terminal", "jetbrains", "")),
    ("E6 JetBrains by ancestor", "claude", env(CLAUDE_CODE_ENTRYPOINT="cli"),
     ("claude.exe", "powershell.exe", "idea64.exe"), ("ide-terminal", "jetbrains", "")),
    # E7: a background session, whatever started it.
    ("E7 background", "claude",
     env(CLAUDE_CODE_ENTRYPOINT="cli", CLAUDE_CODE_SESSION_KIND="bg"), (), ("background", "", "")),
    ("E7 daemon worker", "claude",
     env(CLAUDE_CODE_ENTRYPOINT="claude-desktop", CLAUDE_CODE_SESSION_KIND="daemon-worker",
         CLAUDE_CODE_HOST_SESSION_ID=DESKTOP_ID),
     (), ("background", "", "")),
    # E8: no window at all.
    ("E8 print mode", "claude", env(CLAUDE_CODE_ENTRYPOINT="sdk-cli"), (), ("headless", "", "")),
    ("E8 TypeScript SDK", "claude", env(CLAUDE_CODE_ENTRYPOINT="sdk-ts"), (), ("headless", "", "")),
    ("E8 Python SDK", "claude", env(CLAUDE_CODE_ENTRYPOINT="sdk-py"), (), ("headless", "", "")),
    # E8 for Codex: the server tells an execution attempt by its link, not the hook.
    ("E8 codex exec", "codex", env(), ("codex.exe", "python.exe"), ("", "", "")),
    # E9: a cloud session sends no hook; a remote entrypoint is not a local place.
    ("E9 remote", "claude", env(CLAUDE_CODE_ENTRYPOINT="remote"), (), ("", "", "")),
    ("E9 remote mobile", "claude", env(CLAUDE_CODE_ENTRYPOINT="remote_mobile"), (), ("", "", "")),
    ("E9 remote desktop", "claude",
     env(CLAUDE_CODE_ENTRYPOINT="remote_desktop", CLAUDE_CODE_HOST_SESSION_ID=DESKTOP_ID),
     (), ("", "", "")),
    # E10: Remote Control drives a local process; its place is that local client.
    ("E10 remote control of a VS Code session", "claude",
     env(CLAUDE_CODE_ENTRYPOINT="claude-vscode"), ("claude.exe", "Code.exe"), ("ide", "vscode", "")),
    ("E10 local agent", "claude", env(CLAUDE_CODE_ENTRYPOINT="local-agent"), (), ("", "", "")),
    ("no entrypoint", "claude", env(), ("claude.exe", "Code.exe"), ("", "", "")),
    # E11: the Codex app.
    ("E11 Codex app", "codex", env(),
     ("cmd.exe", "codex.exe", "ChatGPT.exe", "explorer.exe"), ("app", "codex-app", "")),
    # E12: Codex in VS Code, by its override or by its ancestor.
    ("E12 override", "codex", env(CODEX_INTERNAL_ORIGINATOR_OVERRIDE="codex_vscode"),
     (), ("ide", "vscode", "")),
    ("E12 override in Cursor", "codex", env(CODEX_INTERNAL_ORIGINATOR_OVERRIDE="codex_vscode"),
     ("codex.exe", "Cursor.exe"), ("ide", "cursor", "")),
    ("E12 ancestor only", "codex", env(), ("codex.exe", "Code.exe"), ("ide", "vscode", "")),
    # E13: the Codex CLI.
    ("E13 Windows Terminal", "codex", env(),
     ("codex.exe", "pwsh.exe", "WindowsTerminal.exe"), ("terminal", "", "")),
    ("E13 VS Code terminal", "codex", env(TERM_PROGRAM="vscode"),
     ("codex.exe", "pwsh.exe", "Code.exe"), ("ide-terminal", "vscode", "")),
    ("E13 JetBrains terminal", "codex", env(TERMINAL_EMULATOR="JetBrains-JediTerm"),
     ("codex.exe", "pwsh.exe", "pycharm64.exe"), ("ide-terminal", "jetbrains", "")),
    ("E13 no sign", "codex", env(), ("codex.exe", "pwsh.exe", "explorer.exe"), ("", "", "")),
    # The nearest sign wins: a Codex app started from an IDE's terminal is the app.
    ("nearest ancestor wins", "codex", env(),
     ("codex.exe", "ChatGPT.exe", "pwsh.exe", "Code.exe"), ("app", "codex-app", "")),
    ("an unknown override is no sign", "codex",
     env(CODEX_INTERNAL_ORIGINATOR_OVERRIDE="something_else"), (), ("", "", "")),
    ("unknown client", "cursor", env(CLAUDE_CODE_ENTRYPOINT="claude-vscode"), ("Code.exe",),
     ("", "", "")),
]  # fmt: skip


class ClassificationTests(unittest.TestCase):
    def test_every_environment_row(self) -> None:
        for name, client, variables, ancestors, expected in CASES:
            with self.subTest(name):
                found = place.classify(client, variables, ancestors)
                self.assertEqual(
                    expected, (found.opened_in, found.opened_host, found.host_session_id)
                )

    def test_rows_e1_to_e13_are_all_covered(self) -> None:
        covered = {name.split()[0] for name, *_ in CASES if name[0] == "E"}
        self.assertEqual({f"E{n}" for n in range(1, 14)}, covered)

    def test_only_enumerations_and_a_desktop_id_are_kept(self) -> None:
        marker = "invented-value-0000"
        hostile = {
            "CLAUDE_CODE_ENTRYPOINT": f"claude-desktop {marker}",
            "CLAUDE_CODE_SESSION_KIND": marker,
            "CLAUDE_CODE_HOST_SESSION_ID": f"local_x/{marker}",
            "TERM_PROGRAM": f"vscode {marker}",
            "TERMINAL_EMULATOR": marker,
            "CODEX_INTERNAL_ORIGINATOR_OVERRIDE": marker,
        }
        paths = ("C:/example/Programs/Code.exe", f"C:/{marker}/Cursor.exe")
        for client in ("claude", "codex"):
            for variables in (hostile, {**hostile, "CLAUDE_CODE_ENTRYPOINT": "claude-desktop"}):
                with self.subTest(client=client, variables=variables["CLAUDE_CODE_ENTRYPOINT"]):
                    found = place.classify(client, variables, paths)
                    self.assertIn(found.opened_in, ("", *place.OPENED_IN))
                    self.assertIn(found.opened_host, ("", *place.OPENED_HOST))
                    self.assertEqual("", found.host_session_id)
                    self.assertNotIn(marker, repr(found))

    def test_a_desktop_id_is_kept_only_in_its_own_form(self) -> None:
        refused = (
            "LOCAL_abc",
            "local_",
            "local_" + "a" * 65,
            "local_abc/def",
            "local_abc def",
            "local_abc\n",
            "local_é",
            "session_abc",
        )
        for value in refused:
            with self.subTest(value=value):
                found = place.classify(
                    "claude",
                    {
                        "CLAUDE_CODE_ENTRYPOINT": "claude-desktop",
                        "CLAUDE_CODE_HOST_SESSION_ID": value,
                    },
                )
                self.assertEqual(("app", ""), (found.opened_in, found.host_session_id))
        kept = place.classify(
            "claude",
            {
                "CLAUDE_CODE_ENTRYPOINT": "claude-desktop",
                "CLAUDE_CODE_HOST_SESSION_ID": "local_" + "a" * 64,
            },
        )
        self.assertEqual("local_" + "a" * 64, kept.host_session_id)
        # Another environment's id is not kept, even in Desktop's form.
        cli = place.classify(
            "claude", {"CLAUDE_CODE_ENTRYPOINT": "cli", "CLAUDE_CODE_HOST_SESSION_ID": DESKTOP_ID}
        )
        self.assertEqual("", cli.host_session_id)

    def test_only_the_named_variables_are_read(self) -> None:
        environ = dict.fromkeys(place.VARIABLES, "x") | {
            "PATH": "C:/bin",
            "ANTHROPIC_API_KEY": "sk-invented",
            "OPENAI_API_KEY": "sk-invented",
        }
        self.assertEqual(set(place.VARIABLES), set(place.whitelisted(environ)))
        self.assertEqual(
            {
                "CLAUDE_CODE_ENTRYPOINT",
                "CLAUDE_CODE_SESSION_KIND",
                "CLAUDE_CODE_HOST_SESSION_ID",
                "TERM_PROGRAM",
                "TERMINAL_EMULATOR",
                "CODEX_INTERNAL_ORIGINATOR_OVERRIDE",
            },
            set(place.VARIABLES),
        )
        self.assertEqual(dict.fromkeys(place.VARIABLES, ""), place.whitelisted({}))


class AncestorTests(unittest.TestCase):
    def test_the_chain_walks_parents_nearest_first_and_stops(self) -> None:
        processes = {
            10: (9, "python.exe"),
            9: (8, "cmd.exe"),
            8: (7, "claude.exe"),
            7: (6, "Code.exe"),
            6: (0, "explorer.exe"),
        }
        self.assertEqual(
            ("cmd.exe", "claude.exe", "Code.exe", "explorer.exe"), place.chain(processes, 10)
        )

    def test_the_chain_is_bounded_and_survives_a_cycle_and_a_gap(self) -> None:
        long = {pid: (pid + 1, f"p{pid}.exe") for pid in range(1, 30)}
        self.assertEqual(place.ANCESTOR_DEPTH, len(place.chain(long, 1)))
        self.assertEqual(8, place.ANCESTOR_DEPTH)
        cycle = {1: (2, "a.exe"), 2: (3, "b.exe"), 3: (2, "c.exe")}
        self.assertEqual(("b.exe", "c.exe"), place.chain(cycle, 1))
        gap = {1: (2, "a.exe"), 2: (99, "b.exe")}
        self.assertEqual(("b.exe",), place.chain(gap, 1))
        self.assertEqual((), place.chain({}, 1))

    @unittest.skipUnless(sys.platform == "win32", "the process snapshot is read on Windows only")
    def test_this_process_has_named_ancestors_without_paths(self) -> None:
        found = place.ancestors()
        self.assertTrue(found)
        self.assertLessEqual(len(found), place.ANCESTOR_DEPTH)
        for name in found:
            with self.subTest(name=name):
                self.assertNotIn("\\", name)
                self.assertNotIn("/", name)


def session_start(
    at: str,
    *,
    uid: str = UID_A,
    cwd: str = "C:/demo",
    where: place.Place | None = None,
    source: str = "startup",
) -> normalize.HookEvent:
    record = normalize.lifecycle_event(
        "claude",
        "session-start",
        {"session_id": "S", "cwd": cwd, "source": source},
        event_uid=uid,
        occurred_at=at,
        place=where,
    )
    assert record is not None
    return record


VSCODE = place.Place("ide", "vscode", "")
DESKTOP = place.Place("app", "claude-desktop", DESKTOP_ID)


class SpoolTests(unittest.TestCase):
    def line(self, record: normalize.HookEvent) -> dict:
        return json.loads(
            normalize.spool_line(record, spooled_at="2026-10-31T10:00:01.000Z", reason="busy")
        )

    def test_a_line_without_a_place_keeps_the_pre_place_shape(self) -> None:
        for record in (
            session_start("2026-10-31T10:00:00.000Z"),
            normalize.lifecycle_event(
                "claude",
                "stop",
                {"session_id": "S"},
                event_uid=UID_B,
                occurred_at="2026-10-31T10:00:00.000Z",
                place=VSCODE,
            ),
        ):
            assert record is not None
            with self.subTest(kind=record.kind):
                line = self.line(record)
                self.assertEqual(1, line["v"])
                self.assertEqual(PRE_PLACE_KEYS, set(line))
                self.assertEqual(
                    (record, "2026-10-31T10:00:01.000Z"), normalize.read_spool_line(line)
                )

    def test_a_line_with_a_place_is_the_next_version_and_reads_back(self) -> None:
        record = session_start("2026-10-31T10:00:00.000Z", where=DESKTOP)
        line = self.line(record)
        self.assertEqual(2, line["v"])
        self.assertEqual(
            ("app", "claude-desktop", DESKTOP_ID),
            (line["opened_in"], line["opened_host"], line["host_session_id"]),
        )
        self.assertEqual((record, "2026-10-31T10:00:01.000Z"), normalize.read_spool_line(line))
        unknown = session_start("2026-10-31T10:00:00.000Z", where=place.Place())
        self.assertEqual(
            (unknown, "2026-10-31T10:00:01.000Z"), normalize.read_spool_line(self.line(unknown))
        )

    def test_a_line_a_pre_place_build_wrote_still_reads(self) -> None:
        read = normalize.read_spool_line(json.loads(PRE_PLACE_LINE))
        assert read is not None
        record, _ = read
        self.assertEqual(("session_start", "C:/demo"), (record.kind, record.cwd))
        self.assertEqual(
            (None, None, None), (record.opened_in, record.opened_host, record.host_session_id)
        )

    def test_a_place_of_another_shape_is_refused(self) -> None:
        good = self.line(session_start("2026-10-31T10:00:00.000Z", where=DESKTOP))
        changes = {
            "place in a version 1 line": {"v": 1},
            "unknown opened_in": {"opened_in": "browser"},
            "unknown opened_host": {"opened_host": "notepad"},
            "host id of another form": {"host_session_id": "sk-invented"},
            "missing opened_in": {"opened_in": None},
            "opened_host is a list": {"opened_host": ["vscode"]},
            "place on another kind": {"kind": "turn_end", "hook_event": "Stop"},
            "unknown version": {"v": 3},
        }
        for name, change in changes.items():
            with self.subTest(name):
                line = {**good, **change}
                if change.get("opened_in", "") is None:
                    del line["opened_in"]
                self.assertIsNone(normalize.read_spool_line(line))

    def test_a_version_2_line_without_its_place_is_refused(self) -> None:
        line = {**self.line(session_start("2026-10-31T10:00:00.000Z")), "v": 2}
        self.assertIsNone(normalize.read_spool_line(line))

    def test_only_a_session_start_carries_a_place(self) -> None:
        for event in ("stop", "session-end", "user-prompt-submit", "pre-compact"):
            with self.subTest(event=event):
                record = normalize.lifecycle_event(
                    "claude",
                    event,
                    {"session_id": "S"},
                    event_uid=UID_B,
                    occurred_at="2026-10-31T10:00:00.000Z",
                    place=VSCODE,
                )
                assert record is not None
                self.assertEqual(
                    (None, None, None),
                    (record.opened_in, record.opened_host, record.host_session_id),
                )


class IdentityPlaceTests(unittest.TestCase):
    PAYLOAD: ClassVar[dict] = {
        "session_id": "11111111-2222-4333-8444-555555555555",
        "hook_event_name": "PreToolUse",
        "tool_name": "mcp__valkama__get_work_item",
        "tool_input": {"id": "DEMO-1"},
        "tool_use_id": "toolu_demo",
    }

    def identity(self, opened_in: str) -> dict:
        output = normalize.identity_output(dict(self.PAYLOAD), opened_in=opened_in)
        assert output is not None
        return output["hookSpecificOutput"]["updatedInput"]["_identity"]

    def test_the_identity_names_how_the_session_is_open(self) -> None:
        self.assertEqual("ide", self.identity("ide")["place"])
        self.assertNotIn("place", self.identity(""))
        self.assertNotIn(
            "place",
            normalize.identity_output(dict(self.PAYLOAD))["hookSpecificOutput"]["updatedInput"][
                "_identity"
            ],
        )  # type: ignore[index]

    def test_the_transform_reads_its_place_from_the_variables_alone(self) -> None:
        out = io.BytesIO()
        variables = {"CLAUDE_CODE_ENTRYPOINT": "claude-vscode", "TERM_PROGRAM": ""}
        with (
            mock.patch.dict(os.environ, variables),
            mock.patch.object(place, "ancestors", side_effect=AssertionError("not on a tool call")),
        ):
            status = entry.main(
                ["claude", "pre-tool-use"], io.BytesIO(json.dumps(self.PAYLOAD).encode()), out
            )
        self.assertEqual(0, status)
        identity = json.loads(out.getvalue())["hookSpecificOutput"]["updatedInput"]["_identity"]
        self.assertEqual("ide", identity["place"])


class PlaceStoreCase(unittest.TestCase):
    """A throwaway store at the current schema, and the spool beside it."""

    def setUp(self) -> None:
        self.home = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.addCleanup(self.home.cleanup)
        self.path = os.path.join(self.home.name, "store", "valkama.sqlite3")
        patch = mock.patch.dict(
            os.environ,
            {"VALKAMA_DB": self.path, "HOME": self.home.name, "USERPROFILE": self.home.name},
        )
        patch.start()
        self.addCleanup(patch.stop)
        self.conn = store.connect()
        self.addCleanup(self.conn.close)
        self.spool = spool.directory(self.path)

    def write(self, *records: normalize.HookEvent) -> None:
        conn = ingest.open_light(self.path, store.STORE_SCHEMA_VERSION)
        self.addCleanup(conn.close)
        ingest.write(conn, [(record, None) for record in records], delivery="direct")

    def drain(self) -> ingest.DrainResult:
        conn = ingest.open_light(self.path, store.STORE_SCHEMA_VERSION)
        self.addCleanup(conn.close)
        return ingest.drain(conn, self.spool)

    def spool_event(self, record: normalize.HookEvent) -> None:
        spool.write(
            self.spool,
            record,
            occurred_ns=int(record.occurred_at[14:16]) * 10**10 + 1,
            spooled_at="2026-10-31T11:00:00.000Z",
            reason="busy",
        )

    def where(self, session_id: str = "S") -> tuple[str, str, str, str]:
        row = self.conn.execute(
            "SELECT opened_in, opened_host, opened_folder, host_session_id FROM sessions"
            " WHERE id = ?",
            (session_id,),
        ).fetchone()
        assert row is not None
        return tuple(row)  # type: ignore[return-value]


class PlaceStoreTests(PlaceStoreCase):
    def test_a_session_start_records_where_and_in_which_folder(self) -> None:
        self.write(session_start("2026-10-31T10:00:00.000Z", cwd="C:/demo/app", where=DESKTOP))
        self.assertEqual(("app", "claude-desktop", "C:/demo/app", DESKTOP_ID), self.where())

    def test_resume_in_another_client_changes_the_place(self) -> None:
        self.write(session_start("2026-10-31T10:00:00.000Z", cwd="C:/demo", where=DESKTOP))
        self.write(
            session_start(
                "2026-10-31T10:30:00.000Z",
                uid=UID_B,
                cwd="C:/demo/wt",
                where=VSCODE,
                source="resume",
            )
        )
        # Every column is replaced, the empty ones too: a Desktop id left behind
        # would send the session back to Desktop.
        self.assertEqual(("ide", "vscode", "C:/demo/wt", ""), self.where())
        self.write(
            session_start(
                "2026-10-31T11:00:00.000Z", uid=UID_C, where=place.Place(), source="resume"
            )
        )
        self.assertEqual(("", "", "C:/demo", ""), self.where())

    def test_a_compaction_moves_the_place_and_leaves_the_folder(self) -> None:
        # The agent's shell may stand anywhere by now, and `cwd` follows it; the session is
        # still the run it was, started where it was started.
        self.write(session_start("2026-10-31T10:00:00.000Z", cwd="C:/demo", where=VSCODE))
        self.write(
            session_start(
                "2026-10-31T10:30:00.000Z",
                uid=UID_B,
                cwd="C:/demo/services/api",
                where=DESKTOP,
                source="compact",
            )
        )
        self.assertEqual(("app", "claude-desktop", "C:/demo", DESKTOP_ID), self.where())

    def test_a_clear_is_the_same_run_too(self) -> None:
        self.write(session_start("2026-10-31T10:00:00.000Z", cwd="C:/demo", where=VSCODE))
        self.write(
            session_start(
                "2026-10-31T10:30:00.000Z",
                uid=UID_B,
                cwd="C:/demo/services/api",
                where=VSCODE,
                source="clear",
            )
        )
        self.assertEqual(("ide", "vscode", "C:/demo", ""), self.where())

    def test_a_compaction_of_a_session_with_no_folder_says_the_only_one_known(self) -> None:
        # A hook installed mid-session never heard the start; an empty folder would say less.
        self.write(
            session_start(
                "2026-10-31T10:00:00.000Z", cwd="C:/demo/api", where=VSCODE, source="compact"
            )
        )
        self.assertEqual(("ide", "vscode", "C:/demo/api", ""), self.where())

    def test_a_fork_is_a_start_of_its_own(self) -> None:
        self.write(session_start("2026-10-31T10:00:00.000Z", cwd="C:/demo", where=VSCODE))
        self.write(
            session_start(
                "2026-10-31T10:30:00.000Z",
                uid=UID_B,
                cwd="C:/other",
                where=VSCODE,
                source="fork",
            )
        )
        self.assertEqual(("ide", "vscode", "C:/other", ""), self.where())

    def test_an_old_spooled_start_does_not_overwrite_a_newer_place(self) -> None:
        self.spool_event(session_start("2026-10-31T10:00:00.000Z", cwd="C:/old", where=VSCODE))
        self.write(
            session_start("2026-10-31T10:30:00.000Z", uid=UID_B, cwd="C:/new", where=DESKTOP)
        )
        self.assertEqual(1, self.drain().files)
        self.assertEqual(("app", "claude-desktop", "C:/new", DESKTOP_ID), self.where())

    def test_a_late_start_still_places_a_session_that_has_no_place(self) -> None:
        # The start waited in the spool while a later event went in directly:
        # it is history, but nothing newer says where the session is.
        self.spool_event(session_start("2026-10-31T10:00:00.000Z", cwd="C:/demo", where=VSCODE))
        stop = normalize.lifecycle_event(
            "claude",
            "stop",
            {"session_id": "S", "cwd": "C:/demo/sub"},
            event_uid=UID_B,
            occurred_at="2026-10-31T10:05:00.000Z",
        )
        assert stop is not None
        self.write(stop)
        self.assertEqual(1, self.drain().files)
        self.assertEqual(("ide", "vscode", "C:/demo", ""), self.where())

    def test_a_start_without_a_place_leaves_the_place_alone(self) -> None:
        self.write(session_start("2026-10-31T10:00:00.000Z", where=DESKTOP))
        os.makedirs(self.spool, exist_ok=True)
        name = os.path.join(self.spool, f"{10**18:020d}-{UID_B}.jsonl")
        with open(name, "wb") as handle:
            line = json.loads(PRE_PLACE_LINE) | {
                "event_uid": UID_B,
                "occurred_at": "2026-10-31T10:30:00.000Z",
                "cwd": "C:/other",
            }
            handle.write(json.dumps(line).encode() + b"\n")
        self.assertEqual(1, self.drain().files)
        self.assertEqual(("app", "claude-desktop", "C:/demo", DESKTOP_ID), self.where())

    def test_the_place_is_not_written_into_the_event_log(self) -> None:
        self.write(session_start("2026-10-31T10:00:00.000Z", where=DESKTOP))
        row = self.conn.execute("SELECT * FROM execution_events").fetchone()
        self.assertNotIn(DESKTOP_ID, [value for value in tuple(row) if isinstance(value, str)])


class EntryPlaceTests(PlaceStoreCase):
    def run_hook(self, event: str, payload: dict, variables: dict[str, str]) -> None:
        cleared = dict.fromkeys(place.VARIABLES, "")
        with mock.patch.dict(os.environ, {**cleared, **variables}):
            status = entry.main(
                ["claude", event], io.BytesIO(json.dumps(payload).encode()), io.BytesIO()
            )
        self.assertEqual(0, status)

    def test_a_session_start_reads_the_variables_and_the_ancestors(self) -> None:
        with mock.patch.object(place, "ancestors", return_value=("claude.exe", "Cursor.exe")):
            self.run_hook(
                "session-start",
                {"session_id": "S", "cwd": "C:/demo", "hook_event_name": "SessionStart"},
                {"CLAUDE_CODE_ENTRYPOINT": "claude-vscode"},
            )
        self.assertEqual(("ide", "cursor", "C:/demo", ""), self.where())

    def test_other_events_read_no_ancestors_and_record_no_place(self) -> None:
        with mock.patch.object(place, "ancestors", side_effect=AssertionError("start only")):
            self.run_hook(
                "stop",
                {"session_id": "S", "cwd": "C:/demo", "hook_event_name": "Stop"},
                {"CLAUDE_CODE_ENTRYPOINT": "claude-desktop"},
            )
        self.assertEqual(("", "", "", ""), self.where())

    def test_ancestors_that_cannot_be_read_cost_only_the_host(self) -> None:
        with mock.patch.object(place, "ancestors", side_effect=OSError("snapshot refused")):
            self.run_hook(
                "session-start",
                {"session_id": "S", "cwd": "C:/demo", "hook_event_name": "SessionStart"},
                {"CLAUDE_CODE_ENTRYPOINT": "claude-vscode"},
            )
        self.assertEqual(("ide", "vscode", "C:/demo", ""), self.where())


if __name__ == "__main__":
    unittest.main()
