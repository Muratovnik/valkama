"""What `tests/agent_probes.py judge` owes: a verdict per probe from the cards, the record and the files.

A run of the fake client (`tests/agent_probes/fake_client.py`) on the scenario in
`tests/agent_probes/judged/` records a session of each client in that client's
own output format, with a store the session wrote through this checkout's
server. The judge reads it back; each test names the requirement it holds.
"""

from __future__ import annotations

import contextlib
import io
import json
import sqlite3
import subprocess
import tempfile
import unittest
from pathlib import Path
from typing import Any, ClassVar
from unittest import mock

from tests import agent_probes, agent_probes_judge
from tests.test_agent_probes import SAMPLES, RunCase

PASSED, FAILED = agent_probes_judge.PASSED, agent_probes_judge.FAILED

JUDGED = SAMPLES / "judged"
#: A word only the session's record carries: the query of its search.
RECORD_ONLY = "marker-only-in-the-record"


def report_of(out: Path) -> dict[str, Any]:
    return json.loads((out / agent_probes_judge.REPORT).read_text(encoding="utf-8"))


def probe_of(report: dict[str, Any], client: str, probe: str) -> dict[str, Any]:
    session = next(item for item in report["sessions"] if item["client"] == client)
    return next(item for item in session["probes"] if item["probe"] == probe)


class JudgedRunTests(RunCase):
    """One scenario on both clients, judged."""

    report: ClassVar[dict[str, Any]]
    judged: ClassVar[int]
    printed: ClassVar[str]

    @classmethod
    def setUpClass(cls) -> None:
        # The last --cases wins: the scenario this module judges, not the runner's samples.
        cls.run_probes("--client", "both", "--store-copy", "--cases", str(JUDGED))
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            cls.judged = agent_probes.main(["judge", "--out", str(cls.out)])
        cls.printed = output.getvalue()
        cls.report = report_of(cls.out)

    def probe(self, client: str, probe: str) -> dict[str, Any]:
        return probe_of(self.report, client, probe)

    def failing(self, client: str, probe: str) -> list[tuple[str, str]]:
        return [
            (check["check"], check["evidence"])
            for check in self.probe(client, probe)["checks"]
            if check["result"] != agent_probes_judge.PASSED
        ]

    def test_the_run_records_both_sessions_without_an_environment_failure(self) -> None:
        self.assertEqual(0, self.code, self.said)
        self.assertEqual({"claude", "codex"}, {s["client"] for s in self.report["sessions"]})

    # Requirement 1: the checks of cards read the store copy through the read tools.
    def test_card_checks_read_items_questions_comments_spaces_writes_and_the_registry(
        self,
    ) -> None:
        for client in agent_probes.CLIENTS:
            with self.subTest(client=client):
                self.assertEqual([], self.failing(client, "cards"))
                self.assertEqual(agent_probes_judge.PASSED, self.probe(client, "cards")["verdict"])

    def test_a_card_that_does_not_hold_fails_its_probe_with_what_it_holds(self) -> None:
        for client in agent_probes.CLIENTS:
            with self.subTest(client=client):
                probe = self.probe(client, "fails")
                self.assertEqual(agent_probes_judge.FAILED, probe["verdict"])
                ((kind, evidence),) = self.failing(client, "fails")[:1]
                self.assertEqual("item", kind)
                self.assertIn('"category": "active"', evidence)

    # Requirement 2: the checks of each client's own record.
    def test_record_checks_read_calls_order_edits_answer_and_subagents_of_both_clients(
        self,
    ) -> None:
        for client in agent_probes.CLIENTS:
            with self.subTest(client=client):
                self.assertEqual([], self.failing(client, "record"))
                self.assertEqual(agent_probes_judge.PASSED, self.probe(client, "files")["verdict"])
                self.assertEqual([], self.failing(client, "files"))

    def test_the_skill_load_is_recorded_and_never_decides(self) -> None:
        for client in agent_probes.CLIENTS:
            with self.subTest(client=client):
                (loaded,) = [
                    check
                    for check in self.probe(client, "record")["checks"]
                    if check["check"] == "skill_loaded"
                ]
                self.assertEqual(
                    (agent_probes_judge.PASSED, False), (loaded["result"], loaded["decides"])
                )
                # Without record_only it still only records: the second turn loaded nothing
                # before the item check that fails, and only that check decides.
                (unflagged,) = [
                    check
                    for check in self.probe(client, "fails")["checks"]
                    if check["check"] == "skill_loaded"
                ]
                self.assertFalse(unflagged["decides"])

    # Requirement 3: the reviewer's file holds the rubric and what it shows, not the record.
    def test_the_reviewers_file_shows_the_card_and_answer_and_nothing_of_the_record(
        self,
    ) -> None:
        for client in agent_probes.CLIENTS:
            with self.subTest(client=client):
                probe = self.probe(client, "reviewed")
                self.assertEqual(agent_probes_judge.NOT_CONFIRMED, probe["verdict"])
                asked = self.out / agent_probes_judge.REVIEW / "gamma" / client / "reviewed.md"
                text = asked.read_text(encoding="utf-8")
                self.assertIn("The checklist holds one condition of the result.", text)
                self.assertIn("README says when", text)
                self.assertIn("Finished ", text)
                self.assertIn("Another session read this.", text)
                # A question shows what the owner reads: each option with its meaning
                # and whether it is recommended, and why.
                self.assertIn("Keep the word the docs use.", text)
                self.assertIn("The docs already say greeting.", text)
                for word in (
                    RECORD_ONLY,
                    "claim_work_item",
                    "SKILL.md",
                    "tool_use",
                    "mcp_tool_call",
                ):
                    self.assertNotIn(word, text)

    def test_the_reviewers_answer_decides_the_rubric(self) -> None:
        directory = self.out / agent_probes_judge.REVIEW / "gamma" / "claude"
        answer = directory / "reviewed.answer.json"
        try:
            answer.write_text(
                json.dumps({"lines": [{"met": True, "quote": "a"}, {"met": False, "quote": "b"}]}),
                encoding="utf-8",
            )
            with contextlib.redirect_stdout(io.StringIO()):
                agent_probes.main(["judge", "--out", str(self.out)])
            self.assertEqual(
                agent_probes_judge.FAILED,
                probe_of(report_of(self.out), "claude", "reviewed")["verdict"],
            )
            answer.write_text(
                json.dumps({"lines": [{"met": True, "quote": "a"}, {"met": True, "quote": "b"}]}),
                encoding="utf-8",
            )
            with contextlib.redirect_stdout(io.StringIO()):
                agent_probes.main(["judge", "--out", str(self.out)])
            self.assertEqual(
                agent_probes_judge.PASSED,
                probe_of(report_of(self.out), "claude", "reviewed")["verdict"],
            )
        finally:
            answer.unlink(missing_ok=True)

    # Requirement 4: a report per probe, with its evidence and the session's tokens.
    def test_the_report_gives_each_probe_its_verdict_evidence_and_tokens(self) -> None:
        self.assertEqual(1, self.judged)
        expected = {
            "claude": {
                "input": 2206,
                "cached_input": 2000,
                "cache_write": 200,
                "output": 100,
                "reasoning": 40,
            },
            "codex": {
                "input": 2400,
                "cached_input": 2000,
                "cache_write": 0,
                "output": 120,
                "reasoning": 20,
            },
        }
        for session in self.report["sessions"]:
            client = session["client"]
            with self.subTest(client=client):
                self.assertEqual(expected[client], session["tokens"])
                self.assertEqual("fake-client 1", session["version"])
                self.assertEqual(
                    ["cards", "record", "files", "fails", "reviewed"],
                    [probe["probe"] for probe in session["probes"]],
                )
                for probe in session["probes"]:
                    self.assertEqual(expected[client], probe["tokens"])
                    self.assertTrue(all(check["evidence"] for check in probe["checks"]))
                    self.assertIn(f"G1 {client} {probe['probe']}: {probe['verdict']}", self.printed)
        self.assertEqual({"passed": 6, "failed": 2, "not confirmed": 2}, self.report["totals"])


class FormatTests(unittest.TestCase):
    """Requirement 5: the judge knows each kind of check the format names, and no other."""

    def test_the_judge_judges_every_kind_the_loader_takes(self) -> None:
        self.assertEqual(set(agent_probes.CHECK_KINDS), set(agent_probes_judge.CHECKS))

    def test_the_kinds_are_read_from_the_formats_table(self) -> None:
        text = (
            "| Key | Value |\n|---|---|\n| `id` | the number |\n\nChecks:\n\n"
            "| Check | Reads | Keys |\n|---|---|---|\n| `item` | a card | `item` |\n"
            "| `answer` | the answer | `matches` |\n| `call`, `no_call` | the calls | `tool` |\n"
        )
        self.assertEqual(
            {"item", "answer", "call", "no_call"}, agent_probes_judge.format_kinds(text)
        )

    def test_the_judge_and_the_scenario_format_name_the_same_kinds(self) -> None:
        # The format is a document of the scenarios' owner, found where this
        # checkout's private documents are; a clone without them has nothing to compare.
        root = (
            subprocess.run(
                ["git", "config", "--get", "releasekit.privateRoot"],
                cwd=agent_probes.ROOT,
                capture_output=True,
                check=False,
            )
            .stdout.decode("utf-8", errors="replace")
            .strip()
        )
        document = Path(root) / "probes" / "README.md" if root else None
        if document is None or not document.is_file():
            self.skipTest("no scenario format beside this checkout")
        named = agent_probes_judge.format_kinds(document.read_text(encoding="utf-8"))
        self.assertEqual(set(agent_probes_judge.CHECKS), named)

    def test_a_kind_the_judge_does_not_know_is_refused_by_its_name(self) -> None:
        with self.assertRaisesRegex(agent_probes.ProbeError, "'grep_all'"):
            agent_probes_judge.evaluate(None, {"check": "grep_all"})  # type: ignore[arg-type]

    def test_a_run_whose_scenarios_name_an_unknown_kind_is_refused_before_judging(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            cases = base / "cases"
            cases.mkdir()
            scenario = json.loads((JUDGED / "gamma.json").read_text(encoding="utf-8"))
            scenario["workspace"] = str(SAMPLES / "workspace")
            scenario["overlay"] = None
            scenario["expect"]["record"].append({"check": "grep_all", "pattern": "x"})
            (cases / "gamma.json").write_text(json.dumps(scenario), encoding="utf-8")
            (base / "run.json").write_text(
                json.dumps({"cases": str(cases), "sessions": []}), encoding="utf-8"
            )
            output = io.StringIO()
            with contextlib.redirect_stdout(output):
                code = agent_probes.main(["judge", "--out", str(base)])
        self.assertEqual(2, code)
        self.assertIn("unknown kind of check 'grep_all'", output.getvalue())


class SkillOnCodexTests(unittest.TestCase):
    """A Codex session that never read the skill's file: not confirmed, and the probe still passes."""

    def test_codex_without_a_read_of_the_skill_is_not_confirmed_and_does_not_decide(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory)
            (folder / "turn-1.jsonl").write_text(
                json.dumps({"type": "thread.started", "thread_id": "t-1"})
                + "\n"
                + json.dumps(
                    {
                        "type": "item.completed",
                        "item": {"type": "command_execution", "command": "git status"},
                    }
                )
                + "\n",
                encoding="utf-8",
            )
            session = {
                "client": "codex",
                "session_id": "t-1",
                "turns": [{"output": "turn-1.jsonl"}],
            }
            record = agent_probes_judge.Record(folder, session)
            transcript = agent_probes_judge.read_transcript(record)
            view = agent_probes_judge.View(
                record=record,
                scenario=None,  # type: ignore[arg-type]
                transcript=transcript,
                names={},
                store=None,
                boundary=agent_probes_judge._parse_time("2026-01-01T00:00:00Z"),  # type: ignore[arg-type]
                children=set(),
                work=folder,
            )
            check = {"check": "skill_loaded", "before": {"tool": "create_work_item"}}
            outcome = agent_probes_judge.evaluate(view, check)
        self.assertEqual(agent_probes_judge.NOT_CONFIRMED, outcome.result)
        self.assertFalse(agent_probes_judge.decides(check))
        results = [
            {"result": outcome.result, "decides": False},
            {"result": "passed", "decides": True},
        ]
        self.assertEqual(agent_probes_judge.PASSED, agent_probes_judge._verdict(results))


class FinalReplyTests(unittest.TestCase):
    """The answer is the whole final reply: the main agent's texts after its last tool call.

    A hook that stops a turn can send the agent back for one more message, such as
    a report table the owner's skills ask for, so the reply the owner reads may be
    two messages, of which the client's own result names only the last.
    """

    def transcript(self, client: str, lines: list[dict[str, Any]]) -> str | None:
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory)
            (folder / "turn-1.jsonl").write_text(
                "".join(json.dumps(line) + "\n" for line in lines), encoding="utf-8"
            )
            session = {"client": client, "session_id": "s-1", "turns": [{"output": "turn-1.jsonl"}]}
            record = agent_probes_judge.Record(folder, session)
            return agent_probes_judge.read_transcript(record).answer

    @staticmethod
    def claude(*parts: dict[str, Any], parent: str | None = None) -> dict[str, Any]:
        return {
            "type": "assistant",
            "parent_tool_use_id": parent,
            "message": {"content": list(parts)},
        }

    def test_claude_answers_with_every_text_after_its_last_tool_call(self) -> None:
        answer = self.transcript(
            "claude",
            [
                self.claude({"type": "text", "text": "Looking at PRB-1 first."}),
                self.claude({"type": "tool_use", "id": "u1", "name": "Bash", "input": {}}),
                self.claude({"type": "text", "text": "Inside the subagent."}, parent="u0"),
                self.claude({"type": "text", "text": "Done: PRB-1 closed, the typo is PRB-2."}),
                {"type": "system", "subtype": "hook_response", "hook_event": "Stop"},
                self.claude({"type": "text", "text": "| Status | Check | Result |"}),
                {"type": "result", "subtype": "success", "result": "| Status | Check | Result |"},
            ],
        )
        self.assertEqual(
            "Done: PRB-1 closed, the typo is PRB-2.\n\n| Status | Check | Result |", answer
        )

    def test_claude_without_texts_answers_with_its_result(self) -> None:
        answer = self.transcript("claude", [{"type": "result", "result": "Only the result."}])
        self.assertEqual("Only the result.", answer)

    def test_codex_answers_with_every_message_after_its_last_action(self) -> None:
        def message(text: str) -> dict[str, Any]:
            return {"type": "item.completed", "item": {"type": "agent_message", "text": text}}

        answer = self.transcript(
            "codex",
            [
                message("I will look first."),
                {
                    "type": "item.completed",
                    "item": {"type": "command_execution", "command": "rg x"},
                },
                message("Which directory should I delete? data-old (Recommended) or data-legacy."),
                {"type": "item.completed", "item": {"type": "reasoning", "text": "..."}},
                message("Nothing deleted yet."),
            ],
        )
        self.assertEqual(
            "Which directory should I delete? data-old (Recommended) or data-legacy."
            "\n\nNothing deleted yet.",
            answer,
        )


class ConditionTests(unittest.TestCase):
    def test_probe_stands_for_the_main_agent_and_its_subagents(self) -> None:
        main, subagent, setup = (
            agent_probes_judge.Who(name) for name in ("main", "subagent", "setup")
        )
        self.assertTrue(agent_probes_judge.holds(main, "probe"))
        self.assertTrue(agent_probes_judge.holds([setup, subagent], {"includes": "probe"}))
        self.assertFalse(agent_probes_judge.holds(setup, "probe"))
        self.assertFalse(agent_probes_judge.holds("main", "probe"))

    def test_operators_and_fields(self) -> None:
        holds = agent_probes_judge.holds
        item = {
            "labels": ["a"],
            "parent": None,
            "text": "Sort by date",
            "links": [{"kind": "blocks", "to": "X-1"}],
        }
        self.assertTrue(holds(item, {"parent": None, "labels": {"count": {"min": 1}}}))
        self.assertTrue(
            holds(item, {"missing": {"in": [None, False]}, "text": {"matches": "(?i)date"}})
        )
        self.assertTrue(holds(item, {"links": {"includes": {"kind": "blocks", "to": "X-1"}}}))
        self.assertFalse(holds(item, {"links": {"excludes": {"kind": "blocks"}}}))
        self.assertTrue(holds(item, {"labels": ["a"], "text": {"not_matches": "name"}}))
        self.assertFalse(holds(item, {"labels": ["a", "b"]}))
        self.assertTrue(holds(["x.md", "y.py"], {"excludes": {"matches": r"\.txt$"}, "count": 2}))
        self.assertFalse(holds(None, {"present": True}))


class FirstCallTests(unittest.TestCase):
    """`first_call` judges the session's first write: the store records no read."""

    CHECK: ClassVar[dict[str, str]] = {"check": "first_call", "identity": "confirmed"}

    def judge(
        self, events: list[tuple[str, str, str]], tools: list[str]
    ) -> agent_probes_judge.Outcome:
        conn = sqlite3.connect(":memory:")
        conn.execute(
            "CREATE TABLE execution_events(id INTEGER PRIMARY KEY, tool TEXT,"
            " identity_state TEXT, session_id TEXT)"
        )
        # Event 1 is setup's; the session's own come after it.
        conn.execute("INSERT INTO execution_events VALUES(1, 'create_work_item', 'confirmed', 'x')")
        conn.executemany(
            "INSERT INTO execution_events(tool, identity_state, session_id) VALUES(?, ?, ?)", events
        )
        record = mock.Mock(session={"session_id": "own", "setup_last_event": 1})
        record.store.return_value = conn
        calls = [
            agent_probes_judge.Call(index, tool, True, False, agent_probes_judge.Who("main"), {})
            for index, tool in enumerate(tools)
        ]
        view = mock.Mock(record=record, transcript=agent_probes_judge.Transcript(calls=calls))
        return agent_probes_judge.CHECKS["first_call"](view, self.CHECK)

    def test_the_first_write_must_be_the_sessions_own_and_confirmed(self) -> None:
        reads = ["list_planning_spaces", "search_work_items"]
        own = ("create_work_item", "confirmed", "own")
        self.assertEqual(PASSED, self.judge([own], [*reads, "create_work_item"]).result)
        for first in (
            ("create_work_item", "unconfirmed", "own"),
            ("claim_work_item", "confirmed", "x"),
        ):
            with self.subTest(first=first):
                self.assertEqual(FAILED, self.judge([first, own], ["create_work_item"]).result)

    def test_a_session_that_only_read_has_nothing_to_confirm(self) -> None:
        for tools in ([], ["list_planning_spaces", "search_work_items", "get_work_item"]):
            with self.subTest(tools=tools):
                outcome = self.judge([], tools)
                self.assertEqual(PASSED, outcome.result)
                self.assertIn("no Valkama write", outcome.evidence)

    def test_a_write_the_store_did_not_record_fails(self) -> None:
        outcome = self.judge([], ["search_work_items", "create_work_item"])
        self.assertEqual(FAILED, outcome.result)
        self.assertIn("create_work_item", outcome.evidence)


if __name__ == "__main__":
    unittest.main()
