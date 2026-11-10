"""What a segment ran under: the organization, the client, the effort and the advisor.

Every value comes from the transcript and is kept only as an id or a short label; where
the transcript says nothing the column stays NULL. A change of any of them ends a row.
"""

from __future__ import annotations

import json
import unittest
from unittest import mock

from server.telemetry import usage_collect
from server.telemetry.usage_steps import environment, launch_class
from tests.usage_fixtures import HOUR, ORG_A, ORG_B, Case, ClaudeRun, advised, stamp

SETTINGS = ("organization", "environment", "effort", "advisor", "advisor_model")


class OrganizationTests(Case):
    def test_each_attachment_starts_its_organization_at_its_row(self) -> None:
        run = self.session()
        self.ticks((0, HOUR))
        run.prompt(0)
        run.credential(1, ORG_A)
        run.reply(10, tools=(("t1", "Bash"),))
        run.result(20, "t1")
        run.credential(30, ORG_B)
        run.end_turn(40)
        self.read()
        self.assertEqual(
            [
                (None, stamp(0), stamp(1), None),
                (ORG_A, stamp(1), stamp(30), 5),
                (ORG_B, stamp(30), stamp(40), 5),
            ],
            [
                (row["organization"], row["started_at"], row["ended_at"], row["output_tokens"])
                for row in self.segments()
            ],
        )

    def test_the_same_organization_written_again_ends_nothing(self) -> None:
        run = self.session()
        self.ticks((0, HOUR))
        run.prompt(0)
        run.credential(1, ORG_A)
        run.reply(10, tools=(("t1", "Bash"),))
        run.result(20, "t1")
        run.credential(30, ORG_A)
        run.end_turn(40)
        self.read()
        self.assertEqual(
            [(None, 1.0), (ORG_A, 39.0)],
            [(row["organization"], row["seconds"]) for row in self.segments()],
        )

    def test_an_attachment_split_from_its_request_by_a_read_still_holds(self) -> None:
        run = self.session()
        self.ticks((0, HOUR))
        run.prompt(0)
        run.credential(1, ORG_A)
        self.read()
        run.end_turn(10)
        self.read()
        self.assertEqual(ORG_A, self.segments()[-1]["organization"])


class EffortTests(Case):
    def test_a_turn_that_overrides_the_effort_ends_the_row(self) -> None:
        run = self.session()
        self.ticks((0, HOUR))
        run.prompt(0)
        run.reply(10, tools=(("t1", "Bash"),), effort="high")
        run.result(20, "t1")
        run.end_turn(30, effort="high", perTurnEffort="low")
        # A turn whose override is gone runs at the session's effort again.
        run.prompt(100)
        run.end_turn(110, effort="high", perTurnEffort=None)
        self.read()
        self.assertEqual(
            [("high", 20.0), ("low", 10.0), ("high", 10.0)],
            [(row["effort"], row["seconds"]) for row in self.segments()],
        )


class AdvisorTests(Case):
    def test_an_advisor_call_on_the_executors_model_is_a_flagged_row_of_its_own(self) -> None:
        run = self.session()
        self.ticks((0, HOUR))
        run.prompt(0)
        run.end_turn(10, spent=advised(run.model), advisorModel=run.model)
        self.read()
        self.assertEqual(
            [
                (0, run.model, run.model, 4, 6, 10.0),
                (1, run.model, run.model, 100, 20, 0.0),
            ],
            [
                (
                    row["advisor"],
                    row["model"],
                    row["advisor_model"],
                    row["input_tokens"],
                    row["output_tokens"],
                    row["seconds"],
                )
                for row in self.segments()
            ],
        )

    def test_the_advisor_model_is_the_one_configured_and_the_one_that_ran(self) -> None:
        run = self.session()
        self.ticks((0, HOUR))
        run.prompt(0)
        run.reply(10, tools=(("t1", "Bash"),))
        run.result(20, "t1")
        run.end_turn(30, spent=advised("claude-fable-5-1"), advisorModel="claude-fable-5-1")
        self.read()
        self.assertEqual(
            [
                (0, run.model, None),
                (0, run.model, "claude-fable-5-1"),
                (1, "claude-fable-5-1", "claude-fable-5-1"),
            ],
            [(row["advisor"], row["model"], row["advisor_model"]) for row in self.segments()],
        )


class EnvironmentTests(Case):
    def test_the_entrypoint_names_how_the_client_ran(self) -> None:
        self.ticks((0, HOUR))
        cases = (
            ("claude-vscode", "ide"),
            ("claude-desktop", "app"),
            ("sdk-cli", "headless"),
            ("cli", "terminal"),
            ("claude-in-slack", None),
        )
        for number, (entrypoint, expected) in enumerate(cases):
            with self.subTest(entrypoint=entrypoint):
                run = self.session(f"place-{number}")
                run.entrypoint = entrypoint
                run.prompt(0)
                run.end_turn(10)
                self.read()
                self.assertEqual([expected], [r["environment"] for r in self.segments(run.session)])

    def test_a_session_resumed_in_another_client_changes_its_environment(self) -> None:
        run = self.session()
        self.ticks((0, HOUR))
        run.entrypoint = "claude-vscode"
        run.prompt(0)
        run.reply(10, tools=(("t1", "Bash"),))
        run.result(20, "t1")
        run.entrypoint = "cli"
        run.end_turn(30)
        self.read()
        self.assertEqual(
            [("ide", 20.0), ("terminal", 10.0)],
            [(row["environment"], row["seconds"]) for row in self.segments()],
        )

    def test_a_transcript_in_a_wsl_distribution_names_it(self) -> None:
        reported = "\\\\wsl.localhost\\Ubuntu-24.04\\home\\someone\\.claude\\projects\\w.jsonl"
        local = self.root / "projects" / "sess-w.jsonl"
        self.conn.execute(
            "INSERT INTO sessions(id, client, transcript_path, status, started_at, last_seen)"
            " VALUES ('sess-w', 'claude', ?, 'active', ?, ?)",
            (reported, stamp(0), stamp(0)),
        )
        self.conn.commit()
        run = ClaudeRun(local, "sess-w")
        run.entrypoint = "cli"
        self.ticks((0, HOUR))
        run.prompt(0)
        run.end_turn(10)
        # The share is not there in a test, so the bytes come from a file of its own.
        with mock.patch.object(usage_collect, "source", lambda _target: str(local)):
            self.read()
        self.assertEqual(
            ["terminal@wsl:Ubuntu-24.04"], [r["environment"] for r in self.segments("sess-w")]
        )

    def test_only_a_known_client_and_a_distribution_share_make_a_label(self) -> None:
        cases = (
            ("ide", "//wsl$/Debian/home/someone/.claude/projects/x.jsonl", "ide@wsl:Debian"),
            ("app", "D:\\work\\.claude\\projects\\x.jsonl", "app"),
            (None, "\\\\wsl.localhost\\Debian\\home\\x.jsonl", None),
            ("terminal", "\\\\server\\wsl.localhost\\Debian\\x.jsonl", "terminal"),
        )
        for surface, path, expected in cases:
            with self.subTest(path=path):
                self.assertEqual(expected, environment(surface, path))


class LaunchClassTests(Case):
    def test_a_subagent_run_takes_the_class_its_launch_declared(self) -> None:
        main = self.session()
        self.ticks((0, HOUR))
        main.prompt(0)
        main.end_turn(5)
        labelled = self.subagent("sess-1", "aaa1", label="rex: review the diff")
        described = self.subagent("sess-1", "bbb2", label="Something else")
        described.path.with_name("agent-bbb2.meta.json").write_text(
            json.dumps({"agentType": "general-purpose", "description": "ovi: build it"}),
            encoding="utf-8",
        )
        plain = self.subagent("sess-1", "ccc3", label="Review the diff, then report")
        for run in (labelled, described, plain):
            run.prompt(10)
            run.end_turn(20)
        self.read()
        self.assertEqual(
            {"": None, "aaa1": "rex", "bbb2": "ovi", "ccc3": None},
            {
                agent: self.run_row("sess-1", agent)["launch_class"]
                for agent in ("", "aaa1", "bbb2", "ccc3")
            },
        )

    def test_a_class_is_a_word_in_front_of_a_colon(self) -> None:
        cases = (
            ("ovi: implement", "ovi"),
            ("  code-review: diff", "code-review"),
            ("Fix the bug: now", None),
            (":nothing", None),
            (None, None),
        )
        for description, expected in cases:
            with self.subTest(description=description):
                self.assertEqual(expected, launch_class(description))


class NothingSaidTests(Case):
    def test_a_transcript_that_says_none_of_it_leaves_every_column_empty(self) -> None:
        run = self.session()
        self.ticks((0, HOUR))
        run.prompt(0)
        run.reply(10, tools=(("t1", "Bash"),))
        run.result(20, "t1")
        run.end_turn(30)
        agent = self.subagent("sess-1", "ddd4")
        agent.prompt(5)
        agent.end_turn(15)
        self.read()
        for session, name in (("sess-1", ""), ("sess-1", "ddd4")):
            rows = self.segments(session, name)
            self.assertTrue(rows)
            for row in rows:
                self.assertEqual((None, None, None, 0, None), tuple(row[k] for k in SETTINGS))
            self.assertIsNone(self.run_row(session, name)["launch_class"])


if __name__ == "__main__":
    unittest.main()
