"""A client hook takes the commit records of its session into the store.

The records are left by the Git hook of a real commit (`commit_fixtures`), and the
client hook is `valkama hook <client> <event>` itself, run in this process with the
input the client sends.
"""

from __future__ import annotations

import io
import json
import os
import sqlite3
import statistics
import time
import unittest
from pathlib import Path
from unittest import mock

from server import mcp_surface, store
from server.hooks import commit_records, entry, git_hook, light, notify
from server.planning import api, calls, commits, service
from server.store_identity.metadata import read_store_metadata
from server.store_identity.refs import planning_space_entity

from .commit_fixtures import CALL, CLAUDE, CODEX, PROJECT, CommitPlace
from .registry_fixtures import project_entry, registry_bytes

SUBAGENT = "019a3c2e-aaaa-7c11-9e0f-2f4b6d8a1c3e"
OTHER_AGENT = "019a3c2e-bbbb-7c11-9e0f-2f4b6d8a1c3e"
#: The default project of the space, and a project bound to no space.
DEFAULT = "beta"
UNBOUND = "gamma"
#: How many runs each cost figure is the median of.
RUNS = 200


def context(stdout: bytes) -> str:
    """The text a hook answer adds to the model's context; it is the answer's only field."""

    answer = json.loads(stdout)
    output = answer["hookSpecificOutput"]
    assert set(answer) == {"hookSpecificOutput"}, answer
    return str(output["additionalContext"])


class PickupCase(unittest.TestCase):
    def setUp(self) -> None:
        self.place = CommitPlace(self)
        patch = mock.patch.dict(
            os.environ,
            {
                "VALKAMA_DB": str(self.place.store),
                "LOCALAPPDATA": str(self.place.local),
                "HOME": str(self.place.home),
                "USERPROFILE": str(self.place.home),
                "VALKAMA_NOTIFY": "on",
            },
        )
        patch.start()
        self.addCleanup(patch.stop)

    def committed(self, **variables: str) -> list[Path]:
        """A commit in R from a shell with these client variables, through the Git hook."""

        self.place.commit(
            self.place.repository, f"c{time.time_ns()}", environ=self.place.sessions(**variables)
        )
        return self.place.everywhere()

    def hook(self, client: str, event: str = "post-tool-use", **payload: object) -> tuple:
        """One client hook: its stdout and stderr."""

        stdout = io.BytesIO()
        stderr = io.StringIO()
        with mock.patch("sys.stderr", stderr):
            status = entry.main(
                [client, event], io.BytesIO(json.dumps(payload).encode("utf-8")), stdout
            )
        self.assertEqual(0, status)
        return stdout.getvalue(), stderr.getvalue()

    def rows(self) -> list[tuple]:
        conn = sqlite3.connect(self.place.store)
        try:
            return conn.execute(
                "SELECT project_id, hash, subject, session_id, agent_id, client FROM commits"
                " ORDER BY commit_id"
            ).fetchall()
        finally:
            conn.close()

    def claude(self, session: str = CLAUDE, **extra: object) -> tuple:
        return self.hook(
            "claude", **{"session_id": session, "tool_name": "Bash", "duration_ms": 60_000, **extra}
        )


class FirstSliceTests(PickupCase):
    def test_the_first_slice_reaches_the_store(self) -> None:
        place = self.place
        place.commit(
            place.space,
            "nested",
            environ=place.sessions(CLAUDE_CODE_SESSION_ID=CLAUDE),
            git_c="R",
        )
        [record] = place.beside_the_store()
        stdout, stderr = self.claude()
        self.assertEqual("", stderr)
        self.assertIn(f"Your commit {PROJECT} {place.head()[:9]}", context(stdout))
        self.assertEqual(
            [(PROJECT, place.head(), "feat: nested", CLAUDE, None, "claude")], self.rows()
        )
        self.assertFalse(record.exists(), "the record is deleted once the store has it")

    def test_a_record_waiting_in_the_git_directory_is_taken_too(self) -> None:
        place = self.place
        place.commit(
            place.repository,
            "fallback",
            environ=place.sessions(
                CLAUDE_CODE_SESSION_ID=CLAUDE, VALKAMA_DB=str(place.base / "no" / "v.sqlite3")
            ),
        )
        [record] = place.in_the_git_directory()
        self.claude()
        self.assertEqual([place.head()], [row[1] for row in self.rows()])
        self.assertFalse(record.exists())

    def test_a_record_taken_twice_is_recorded_once(self) -> None:
        [record] = self.committed(CLAUDE_CODE_SESSION_ID=CLAUDE)
        content = record.read_bytes()
        self.claude()
        record.write_bytes(content)
        self.claude()
        self.assertEqual(1, len(self.rows()))
        self.assertFalse(record.exists(), "worked off, and deleted")


class ClaudeWindowTests(PickupCase):
    def aged(self, path: Path, seconds: float) -> Path:
        """The same record, named as if it were written `seconds` ago."""

        key, _, rest = path.name.partition("--")
        at, _, tail = rest.partition("-")
        older = path.with_name(f"{key}--{int(at) - int(seconds * 1e9)}-{tail}")
        path.rename(older)
        return older

    def test_the_window_is_the_call_s_duration_and_its_slack(self) -> None:
        [record] = self.committed(CLAUDE_CODE_SESSION_ID=CLAUDE)
        record = self.aged(record, 5)
        self.claude(duration_ms=1_000)
        self.assertEqual([], self.rows(), "written before the call began")
        self.assertTrue(record.exists())
        self.claude(duration_ms=4_000)
        self.assertEqual(1, len(self.rows()), "within the duration and two seconds")

    def test_without_a_duration_the_window_is_ten_minutes(self) -> None:
        [record] = self.committed(CLAUDE_CODE_SESSION_ID=CLAUDE)
        record = self.aged(record, 11 * 60)
        self.hook("claude", session_id=CLAUDE, tool_name="Bash")
        self.assertEqual([], self.rows())
        self.assertTrue(record.exists(), "it waits for the leftovers")
        self.aged(record, -2 * 60)
        self.hook("claude", session_id=CLAUDE, tool_name="PowerShell")
        self.assertEqual(1, len(self.rows()))

    def test_only_a_shell_tool_of_the_session_takes_it(self) -> None:
        [record] = self.committed(CLAUDE_CODE_SESSION_ID=CLAUDE)
        self.hook("claude", session_id=CLAUDE, tool_name="Read", duration_ms=60_000)
        self.claude(session=SUBAGENT)
        self.assertEqual([], self.rows())
        self.assertTrue(record.exists())

    def test_a_subagent_s_commit_names_its_agent(self) -> None:
        self.committed(CLAUDE_CODE_SESSION_ID=CLAUDE)
        self.claude(agent_id=SUBAGENT)
        [row] = self.rows()
        self.assertEqual((CLAUDE, SUBAGENT, "claude"), row[3:])


class CodexCallTests(PickupCase):
    def test_codex_takes_the_record_of_its_own_call_only(self) -> None:
        [record] = self.committed(
            CODEX_SESSION_ID=CODEX, CODEX_THREAD_ID=CODEX, CODEX_TOOL_CALL_ID=CALL
        )
        self.hook("codex", session_id=CODEX, tool_use_id="call_another")
        self.assertEqual([], self.rows())
        self.assertTrue(record.exists())
        stdout, _stderr = self.hook("codex", session_id=CODEX, tool_use_id=CALL)
        self.assertIn("is on no card", context(stdout))
        self.assertEqual(
            [(PROJECT, self.place.head(), CODEX, None, "codex")],
            [(row[0], row[1], row[3], row[4], row[5]) for row in self.rows()],
        )
        self.assertFalse(record.exists())

    def test_a_codex_subagent_is_its_thread_or_its_agent_id(self) -> None:
        self.committed(CODEX_SESSION_ID=CODEX, CODEX_THREAD_ID=SUBAGENT, CODEX_TOOL_CALL_ID=CALL)
        self.hook("codex", session_id=CODEX, tool_use_id=CALL)
        self.committed(CODEX_SESSION_ID=CODEX, CODEX_THREAD_ID=SUBAGENT, CODEX_TOOL_CALL_ID="c2")
        self.hook("codex", session_id=CODEX, tool_use_id="c2", agent_id="agent-from-input")
        self.assertEqual([SUBAGENT, "agent-from-input"], [row[4] for row in self.rows()])


class NestedClientTests(PickupCase):
    def test_the_first_client_hook_takes_a_nested_record(self) -> None:
        files = self.committed(
            CLAUDE_CODE_SESSION_ID=CLAUDE,
            CODEX_SESSION_ID=CODEX,
            CODEX_THREAD_ID=CODEX,
            CODEX_TOOL_CALL_ID=CALL,
        )
        by_key = {path.name.split("--")[0]: path for path in files}
        self.assertEqual({CLAUDE, CODEX}, set(by_key))
        self.claude()
        self.assertEqual([(CLAUDE, None, "claude")], [row[3:] for row in self.rows()])
        self.assertFalse(by_key[CLAUDE].exists())
        self.assertTrue(by_key[CODEX].exists())
        conn = sqlite3.connect(self.place.store)
        self.addCleanup(conn.close)
        before = conn.execute("PRAGMA data_version").fetchone()[0]
        self.assertEqual((b"", ""), self.hook("codex", session_id=CODEX, tool_use_id=CALL))
        self.assertEqual(1, len(self.rows()), "the outer hook writes nothing")
        self.assertEqual(before, conn.execute("PRAGMA data_version").fetchone()[0])
        self.assertFalse(by_key[CODEX].exists(), "its worked-off file is deleted")


class StoreAccessTests(PickupCase):
    def test_without_records_the_store_is_not_opened_for_writing(self) -> None:
        refused = mock.patch.object(light, "open_light", side_effect=AssertionError("opened"))
        with refused as opened:
            self.assertEqual((b"", ""), self.claude())
            self.assertEqual((b"", ""), self.hook("codex", session_id=CODEX, tool_use_id=CALL))
            self.assertEqual(
                (b"", ""), self.hook("claude", "post-tool-use-failure", session_id=CLAUDE)
            )
        opened.assert_not_called()

    def test_a_busy_store_keeps_the_record(self) -> None:
        [record] = self.committed(CLAUDE_CODE_SESSION_ID=CLAUDE)
        writer = sqlite3.connect(self.place.store, isolation_level=None)
        self.addCleanup(writer.close)
        writer.execute("BEGIN IMMEDIATE")
        self.assertEqual((b"", ""), self.claude(), "nothing said about the commit")
        writer.execute("ROLLBACK")
        self.assertTrue(record.exists())
        self.assertEqual([], self.rows())
        self.claude()
        self.assertEqual(1, len(self.rows()), "the next hook takes it")
        self.assertFalse(record.exists())

    def test_a_store_of_another_schema_keeps_the_record(self) -> None:
        [record] = self.committed(CLAUDE_CODE_SESSION_ID=CLAUDE)
        with mock.patch("server.store.STORE_SCHEMA_VERSION", 0):
            self.claude()
        self.assertTrue(record.exists())
        self.assertEqual([], self.rows())


class CostTests(PickupCase):
    def median_ms(self, payload: dict) -> float:
        times = []
        for _run in range(RUNS):
            started = time.perf_counter_ns()
            entry._commits("claude", payload)
            times.append(time.perf_counter_ns() - started)
        return statistics.median(times) / 1e6

    def test_with_no_record_the_look_costs_at_most_two_milliseconds(self) -> None:
        """What the look for records adds to a hook that finds none: the directory listings
        and the registry, read as a file."""

        payload = {"session_id": CLAUDE, "tool_name": "Bash", "duration_ms": 1}
        # Records of another session lie in both places and are not read.
        self.committed(CLAUDE_CODE_SESSION_ID=SUBAGENT)
        self.place.commit(
            self.place.repository,
            "fallback",
            environ=self.place.sessions(
                CLAUDE_CODE_SESSION_ID=SUBAGENT,
                VALKAMA_DB=str(self.place.base / "no" / "v.sqlite3"),
            ),
        )
        self.assertEqual(2, len(self.place.everywhere()))
        self.assertLessEqual(self.median_ms(payload), 2.0)
        self.assertEqual([], self.rows())


class RuleCase(PickupCase):
    """A space WRK whose default project is `beta`, with `alpha` (R) bound to it too and
    `gamma` bound nowhere; the session's holds taken as Codex takes them, by `_meta`."""

    def setUp(self) -> None:
        super().setUp()
        self.conn = store.connect()
        self.addCleanup(self.conn.close)
        self.registry(DEFAULT)
        service.create_planning_space(self.conn, name="Work", key="WRK")
        self.conn.commit()

    def registry(self, default: str) -> None:
        scope = str(read_store_metadata(self.conn)["data_scope_id"])
        space = planning_space_entity({"data_scope_id": scope, "space_key": "WRK"})
        entries = []
        for project, root, bound in (
            (PROJECT, self.place.repository, True),
            (DEFAULT, self.place.base / DEFAULT, True),
            (UNBOUND, self.place.base / UNBOUND, False),
        ):
            Path(root).mkdir(exist_ok=True)
            entry = project_entry(project, root)
            if bound:
                entry["planning_binding"] = {**space, "default": project == default}
            entries.append(entry)
        (self.place.local / "Valkama" / "projects.json").write_bytes(registry_bytes(entries))

    def task(self, title: str, *projects: str) -> str:
        made = service.create_work_item(
            self.conn, space="WRK", title=title, projects=list(projects) or None
        )
        self.conn.commit()
        return str(made["reference"])

    def tool(self, name: str, agent: str | None = None, **arguments: object) -> dict:
        meta = {"sessionId": CLAUDE, "threadId": agent or CLAUDE}
        answer = mcp_surface.call_tool(self.conn, name, arguments, meta=meta)
        self.conn.commit()
        assert isinstance(answer, dict)
        return answer

    def claim(self, reference: str, agent: str | None = None) -> None:
        self.tool("claim_work_item", agent, id=reference)

    def closed(self, reference: str, minutes: int) -> None:
        """Claimed, then moved into review by the session `minutes` ago."""

        self.claim(reference)
        self.tool("apply_work_item_changes", id=reference, transition={"state": "review"})
        self.conn.execute(
            "UPDATE work_item_events SET created_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', ?)"
            " WHERE action = 'transitioned' AND work_item_id = ?",
            (f"-{minutes} minutes", self.identity(reference)),
        )
        self.conn.commit()

    def identity(self, reference: str) -> str:
        return str(service.get_work_item(self.conn, reference)["work_item_id"])

    def commit(self, **extra: object) -> tuple[str, str]:
        """A commit in R by the session, and the text its client hook answers with."""

        self.committed(CLAUDE_CODE_SESSION_ID=CLAUDE)
        stdout, stderr = self.claude(**extra)
        self.assertEqual("", stderr)
        return self.place.head(), context(stdout)

    def attached(self) -> list[tuple[str, str, str, str]]:
        return [
            (self.reference(str(row[0])), str(row[1]), str(row[2]), str(row[3]))
            for row in self.conn.execute(
                "SELECT a.work_item_id, c.hash, a.attached_by, a.author FROM work_item_commits a"
                " JOIN commits c ON c.commit_id = a.commit_id ORDER BY a.rowid"
            )
        ]

    def reference(self, identity: str) -> str:
        key, number = self.conn.execute(
            "SELECT p.key, w.number FROM work_items w JOIN planning_spaces p"
            " ON p.planning_space_id = w.planning_space_id WHERE w.work_item_id = ?",
            (identity,),
        ).fetchone()
        return f"{key}-{number}"

    def projects(self, reference: str) -> list[tuple[str, str]]:
        return [
            (str(row[0]), str(row[1]))
            for row in self.conn.execute(
                "SELECT project_id, source FROM work_item_projects WHERE work_item_id = ?"
                " ORDER BY project_id",
                (self.identity(reference),),
            )
        ]

    def waiting(self) -> list[tuple[str, ...]]:
        """The commits on no card: a session's, attached nowhere, not rewritten."""

        return [
            tuple(str(value) for value in row)
            for row in self.conn.execute(
                "SELECT c.project_id, c.hash, c.session_id, c.committed_at, c.subject"
                " FROM commits c WHERE c.session_id IS NOT NULL AND c.rewritten_to IS NULL"
                " AND NOT EXISTS (SELECT 1 FROM work_item_commits a"
                " WHERE a.commit_id = c.commit_id)"
            )
        ]

    def short(self, commit: str) -> str:
        """How a line names the commit: project, nine digits, subject."""

        subject = self.conn.execute("SELECT subject FROM commits WHERE hash = ?", (commit,))
        return f'{PROJECT} {commit[:9]} "{subject.fetchone()[0]}"'


class HeldTaskTests(RuleCase):
    def test_a_commit_goes_to_the_one_task_the_agent_holds(self) -> None:
        t1 = self.task("One")
        self.claim(t1)
        [record] = self.committed(CLAUDE_CODE_SESSION_ID=CLAUDE)
        stdout, stderr = self.claude()
        commit = self.place.head()
        self.assertEqual("", stderr)
        self.assertEqual(
            f"Valkama attached your commit {self.short(commit)} to {t1}.", context(stdout)
        )
        self.assertEqual([(t1, commit, "server", "valkama")], self.attached())
        self.assertEqual([(PROJECT, "commits")], self.projects(t1))
        [event] = self.conn.execute(
            "SELECT e.detail, e.author, c.identity_source, c.tool FROM work_item_events e"
            " JOIN execution_events c ON c.id = e.call_id"
            " WHERE e.action = 'commit_attached' AND e.work_item_id = ?",
            (self.identity(t1),),
        ).fetchall()
        self.assertEqual((f"{PROJECT} {commit}", "valkama", "valkama", "commit-hook"), tuple(event))
        self.assertFalse(record.exists())

    def test_a_project_the_task_names_stays_named(self) -> None:
        t1 = self.task("Named", PROJECT)
        self.claim(t1)
        self.commit()
        self.assertEqual([(PROJECT, "named")], self.projects(t1))
        self.assertEqual(1, len(self.attached()))

    def test_the_task_whose_project_is_the_repository_takes_the_commit(self) -> None:
        t1, t2 = self.task("Mine", PROJECT), self.task("Other", DEFAULT)
        self.claim(t1)
        self.claim(t2)
        commit, line = self.commit()
        self.assertEqual(f"Valkama attached your commit {self.short(commit)} to {t1}.", line)
        self.assertEqual([(t1, commit, "server", "valkama")], self.attached())
        self.assertEqual([(DEFAULT, "named")], self.projects(t2))

    def test_a_task_naming_no_project_fits_its_space_s_default(self) -> None:
        self.registry(PROJECT)
        t1, t2 = self.task("Default"), self.task("Elsewhere", UNBOUND)
        self.claim(t1)
        self.claim(t2)
        commit, line = self.commit()
        self.assertEqual(f"Valkama attached your commit {self.short(commit)} to {t1}.", line)

    def test_two_matching_tasks_are_named_and_the_commit_waits(self) -> None:
        t1, t2 = self.task("First", PROJECT), self.task("Second", PROJECT)
        self.claim(t1)
        self.claim(t2)
        commit, line = self.commit()
        self.assertEqual(
            f"Your commit {self.short(commit)} fits {t1} and {t2}, which you hold. Attach it"
            ' to the right one: apply_work_item_changes {"id": "<REF>", "commits":'
            f' [{{"repository": "{PROJECT}", "hash": "{commit[:9]}"}}]}}.',
            line,
        )
        self.assertEqual([], self.attached())
        self.assertEqual([(PROJECT, commit)], [row[:2] for row in self.waiting()])

    def test_no_matching_task_names_every_held_task(self) -> None:
        t1, t2 = self.task("Beta", DEFAULT), self.task("Gamma", UNBOUND)
        self.claim(t1)
        self.claim(t2)
        commit, line = self.commit()
        self.assertTrue(line.startswith(f"Your commit {self.short(commit)} fits {t1} and {t2},"))
        self.assertEqual([], self.attached())

    def test_an_agent_holding_nothing_commits_to_its_coordinators_task(self) -> None:
        t1 = self.task("Coordinator's", PROJECT)
        self.claim(t1)
        commit, line = self.commit(agent_id=SUBAGENT)
        self.assertEqual(
            f"Valkama attached your commit {self.short(commit)} to {t1}, which your session holds.",
            line,
        )
        self.assertEqual([(t1, commit, "server", "valkama")], self.attached())

    def test_an_agent_s_own_task_comes_before_its_coordinators(self) -> None:
        mine, theirs = self.task("Agent's", PROJECT), self.task("Coordinator's", PROJECT)
        self.claim(theirs)
        self.claim(mine, SUBAGENT)
        commit, line = self.commit(agent_id=SUBAGENT)
        self.assertEqual(f"Valkama attached your commit {self.short(commit)} to {mine}.", line)

    def test_an_agent_holding_nothing_does_not_take_another_agent_s_task(self) -> None:
        self.claim(self.task("Another agent's", PROJECT), OTHER_AGENT)
        _commit, line = self.commit(agent_id=SUBAGENT)
        self.assertIn("is on no card", line)
        self.assertEqual([], self.attached())

    def test_the_coordinator_holding_nothing_commits_to_its_agent_s_task(self) -> None:
        t1 = self.task("Agent's", PROJECT)
        self.claim(t1, SUBAGENT)
        self.committed(CLAUDE_CODE_SESSION_ID=CLAUDE)
        stdout, _stderr = self.claude()
        commit = self.place.head()
        # The agent's claim is news to its orchestrator, and comes after the line.
        text = json.loads(stdout)["hookSpecificOutput"]["additionalContext"]
        self.assertEqual(
            f"Valkama attached your commit {self.short(commit)} to {t1}, which your session holds.",
            text.split("\n\n", 1)[0],
        )


class RecentCloseTests(RuleCase):
    def test_a_task_closed_within_the_window_takes_the_commit(self) -> None:
        t1 = self.task("Reviewed", PROJECT)
        self.closed(t1, 10)
        commit, line = self.commit()
        self.assertEqual(
            f"Valkama attached your commit {self.short(commit)} to {t1}, which you closed 10 min"
            " ago. If it belongs elsewhere, move it with the commits group of"
            " apply_work_item_changes.",
            line,
        )
        self.assertEqual([(t1, commit, "server", "valkama")], self.attached())

    def test_a_task_closed_before_the_window_does_not(self) -> None:
        self.closed(self.task("Reviewed long ago", PROJECT), 31)
        commit, line = self.commit()
        self.assertEqual(
            f"Your commit {self.short(commit)} is on no card: you hold no task it fits. Claim"
            " the task before the work; to attach this commit, use the commits group of"
            " apply_work_item_changes on its card.",
            line,
        )
        self.assertEqual([], self.attached())
        [(project, found, session, committed_at, subject)] = self.waiting()
        self.assertEqual((PROJECT, commit, CLAUDE), (project, found, session))
        self.assertRegex(committed_at, r"^\d{4}-\d\d-\d\dT")
        self.assertTrue(subject.startswith("feat: c"))

    def test_a_recent_task_of_another_project_does_not(self) -> None:
        self.closed(self.task("Reviewed elsewhere", DEFAULT), 10)
        _commit, line = self.commit()
        self.assertIn("is on no card", line)
        self.assertEqual([], self.attached())

    def test_a_held_task_comes_before_a_recent_one(self) -> None:
        self.closed(self.task("Reviewed", PROJECT), 5)
        now = self.task("Held", PROJECT)
        self.claim(now)
        _commit, line = self.commit()
        self.assertTrue(line.endswith(f"to {now}."), line)


class AnswerTests(RuleCase):
    def says(self, reference: str, body: str) -> None:
        with calls.bind(calls.browser(), "/api/planning/work-item/comment"):
            api.handle_post(
                self.conn, "/api/planning/work-item/comment", {"id": reference, "body": body}
            )
        self.conn.commit()

    def lifecycle_events(self) -> int:
        found = self.conn.execute(
            "SELECT COUNT(*) FROM execution_events WHERE kind <> ?", (calls.KIND,)
        )
        return int(found.fetchone()[0])

    def test_a_failed_command_answers_with_its_commits(self) -> None:
        t1 = self.task("Held", PROJECT)
        self.claim(t1)
        self.says(t1, "words a notice would carry")
        self.committed(CLAUDE_CODE_SESSION_ID=CLAUDE)
        events = self.lifecycle_events()
        stdout, stderr = self.hook(
            "claude",
            "post-tool-use-failure",
            session_id=CLAUDE,
            tool_name="Bash",
            duration_ms=60_000,
            error="exit 1",
        )
        self.assertEqual("", stderr)
        self.assertEqual(
            {
                "hookSpecificOutput": {
                    "hookEventName": "PostToolUseFailure",
                    "additionalContext": (
                        f"Valkama attached your commit {self.short(self.place.head())} to {t1}."
                    ),
                }
            },
            json.loads(stdout),
        )
        self.assertEqual(events, self.lifecycle_events(), "no lifecycle event")
        stdout, _stderr = self.hook("claude", session_id=CLAUDE, tool_name="Read")
        self.assertIn("words a notice would carry", stdout.decode("utf-8"), "it waits")

    def test_the_lines_go_first_in_the_notice_s_answer(self) -> None:
        t1 = self.task("Held", PROJECT)
        self.claim(t1)
        self.says(t1, "a person's words")
        self.committed(CLAUDE_CODE_SESSION_ID=CLAUDE)
        stdout, _stderr = self.claude()
        text = json.loads(stdout)["hookSpecificOutput"]["additionalContext"]
        first, rest = text.split("\n\n", 1)
        self.assertEqual(
            f"Valkama attached your commit {self.short(self.place.head())} to {t1}.", first
        )
        self.assertIn("a person's words", rest)
        self.assertLessEqual(len(text), notify.MOST_CHARACTERS)

    def test_a_codex_subagent_gets_its_lines_and_no_notice(self) -> None:
        t1 = self.task("Held", PROJECT)
        self.claim(t1)
        self.says(t1, "a person's words")
        self.committed(CODEX_SESSION_ID=CLAUDE, CODEX_THREAD_ID=SUBAGENT, CODEX_TOOL_CALL_ID=CALL)
        stdout, _stderr = self.hook("codex", session_id=CLAUDE, tool_use_id=CALL, agent_id=SUBAGENT)
        self.assertEqual(
            f"Valkama attached your commit {self.short(self.place.head())} to {t1}, which your"
            " session holds.",
            context(stdout),
        )
        stdout, _stderr = self.hook("codex", session_id=CLAUDE, tool_use_id="call_next")
        self.assertIn("a person's words", stdout.decode("utf-8"), "the orchestrator's next call")

    def test_past_five_commits_one_line_counts_the_rest(self) -> None:
        for _commit in range(7):
            self.committed(CLAUDE_CODE_SESSION_ID=CLAUDE)
        lines = context(self.claude()[0]).split("\n")
        self.assertEqual(6, len(lines))
        self.assertEqual("And 2 more commits: see the cards.", lines[-1])
        self.assertEqual(7, len(self.rows()))

    def test_a_long_subject_is_cut_to_its_limit(self) -> None:
        made = commits._Commit(1, PROJECT, "a" * 40, "x" * 100)
        self.assertEqual(f'{PROJECT} {"a" * 9} "{"x" * 71}…"', made.named())


class RecordFileTests(unittest.TestCase):
    def test_a_file_of_another_shape_is_not_a_record(self) -> None:
        key = commit_records.file_key(CLAUDE)
        good = f"{key}--1763000000000000000-0123456789abcdef.json"
        self.assertEqual(1763000000000000000, commit_records.occurred_ns(good, key))
        for name in (
            f"{key}--x-0123456789abcdef.json",
            f"{key}--1-0123456789ABCDEF.json",
            f"{key}--1-0123.json",
            f".{good}.4242.tmp",
            f"{key}--other--1-0123456789abcdef.json",
        ):
            with self.subTest(name=name):
                self.assertIsNone(commit_records.occurred_ns(name, key))

    def test_a_record_is_written_as_the_json_it_reads_back_as(self) -> None:
        record = {
            "commits": [{"hash": "a" * 40, "parents": [], "subject": 'fix: «ключ» "q"\\\n'}],
            "rewrite": None,
            "version": 1,
            "flag": True,
        }
        encoded = commit_records.encode(record)
        self.assertEqual(record, json.loads(encoded.decode("ascii")))
        self.assertEqual(record, notify.loads(encoded.decode("ascii")), "as the hook reads it")
        with self.assertRaises(TypeError):
            commit_records.encode({"at": 1.5})

    def test_the_hook_command_name_follows_the_event(self) -> None:
        self.assertEqual(
            {
                "post-commit": "valkama-commit",
                "post-rewrite": "valkama-rewrite",
                "post-merge": "valkama-merge",
            },
            git_hook.NAMES,
        )


if __name__ == "__main__":
    unittest.main()
