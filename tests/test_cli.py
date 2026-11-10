"""What the command line does with each of its commands.

This surface had no coverage at all. It is reached in production only through
a subprocess -- the desktop app and the gate both run `valkama.py` rather than
importing it -- so a whole-suite pass said nothing about the
hundred and thirty statements here, and neither did the green board it printed.

Every case runs against a throwaway store in a temporary home. The owner's
board is never a subject: this repository can destroy it.
"""

from __future__ import annotations

import contextlib
import io
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
from server import cli, store, store_backups
from server.hooks import ingest
from server.ops import configuration
from server.planning import service
from server.projects import scopes
from server.telemetry import liveness, usage_collect
from tests import usage_fixtures

SPACE_NAME = "Command Line"
SPACE_KEY = "COM"


class CliTestCase(unittest.TestCase):
    def setUp(self) -> None:
        # Each command opens its own connection and never closes it, because
        # the process it normally runs in is about to exit. In-process that
        # leaves a handle Windows will not let the cleanup delete.
        self.home = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.addCleanup(self.home.cleanup)
        self.database = os.path.join(self.home.name, "valkama.sqlite3")
        patch = mock.patch.dict(
            os.environ,
            {
                "VALKAMA_DB": self.database,
                "USERPROFILE": self.home.name,
                "HOME": self.home.name,
            },
        )
        patch.start()
        self.addCleanup(patch.stop)
        self.conn = store.connect()
        self.addCleanup(self.conn.close)
        service.create_planning_space(self.conn, project_id="cli", name=SPACE_NAME, key=SPACE_KEY)
        self.conn.commit()

    def item(self, title: str, **fields) -> str:
        """One work item, returning the reference a command would name."""

        created = service.create_work_item(self.conn, space=SPACE_KEY, title=title, **fields)
        self.conn.commit()
        return str(created["reference"])

    def invoke(self, *argv: str) -> str:
        """One command line, with whatever it printed."""
        stream = io.StringIO()
        with contextlib.redirect_stdout(stream):
            cli.main(list(argv))
        return stream.getvalue()


class SpaceReportingTests(CliTestCase):
    def test_summary_names_the_space_its_states_and_what_is_ready(self) -> None:
        self.item("a queued item")
        started = self.item("an item in flight")
        service.claim_work_item(self.conn, started, author="agent-one")
        self.conn.commit()
        output = self.invoke("summary", "--space", SPACE_KEY)
        self.assertIn(f"space '{SPACE_NAME}'", output)
        # Claiming starts an item, so one is in the backlog and one under way.
        self.assertIn("Backlog 1, Dev 1", output)
        self.assertIn("a queued item", output)

    def test_summary_reports_an_epic(self) -> None:
        epic = self.item("an umbrella", kind="epic")
        self.item("a child", parent=epic)
        output = self.invoke("summary", "--space", SPACE_KEY)
        self.assertIn("epics:", output)
        self.assertIn("an umbrella", output)

    def test_summary_reports_who_holds_what(self) -> None:
        held = self.item("claimed and quiet")
        service.claim_work_item(self.conn, held, author="agent-one")
        self.conn.commit()
        output = self.invoke("summary", "--space", SPACE_KEY)
        self.assertIn("held:", output)
        self.assertIn("agent-one", output)

    def test_summary_says_so_when_there_is_no_space_at_all(self) -> None:
        self.conn.execute("DELETE FROM planning_spaces")
        self.conn.commit()
        self.assertIn("no planning space", self.invoke("summary"))


class ScopeTests(CliTestCase):
    def second_store(self) -> str:
        path = os.path.join(self.home.name, "other.sqlite3")
        with mock.patch.dict(os.environ, {"VALKAMA_DB": path}):
            connection = store.connect()
            service.create_planning_space(connection, project_id="elsewhere", name="Elsewhere")
            connection.commit()
            connection.close()
        return path

    def test_scopes_lists_the_primary_store_as_text_and_as_json(self) -> None:
        text = self.invoke("scopes")
        self.assertIn(scopes.PRIMARY_SCOPE, text)
        payload = json.loads(self.invoke("scopes", "--json"))
        self.assertEqual([scopes.PRIMARY_SCOPE], [scope["name"] for scope in payload["scopes"]])

    def test_attaching_a_store_adds_it_and_detaching_takes_it_away(self) -> None:
        path = self.second_store()
        self.assertEqual(
            [scopes.PRIMARY_SCOPE, "other"], json.loads(self.invoke("attach", "other", path))
        )
        # The listing names a space by its key, which is what stays stable.
        self.assertIn("other#ELS", self.invoke("scopes"))
        self.assertEqual([scopes.PRIMARY_SCOPE], json.loads(self.invoke("detach", "other")))


class ConfigurationReportTests(CliTestCase):
    """The report names the author in use, not only the layer it came from."""

    def author_row(self) -> dict:
        reading = json.loads(self.invoke("config", "--json"))
        return next(item for item in reading["settings"] if item["key"] == "author")

    def test_with_nothing_set_the_author_in_use_is_the_planning_default(self) -> None:
        with mock.patch.dict(os.environ, {}, clear=False):
            os.environ.pop("VALKAMA_AUTHOR", None)
            row = self.author_row()
        self.assertEqual(("agent", "default"), (row["effective"], row["source"]))

    def test_the_environment_author_is_the_one_in_use(self) -> None:
        with mock.patch.dict(os.environ, {"VALKAMA_AUTHOR": "codex"}):
            row = self.author_row()
        self.assertEqual(("codex", "environment"), (row["effective"], row["source"]))


class ConsoleEncodingTests(CliTestCase):
    def test_output_stays_utf8_when_the_console_says_otherwise(self) -> None:
        # Card #292: `summary` printed an arrow out of a title and raised
        # UnicodeEncodeError whenever a CP1251 console had its stdout
        # redirected -- which is exactly how the session hooks run it. A real
        # child process, because the defect is in what the encoder does at the
        # stream, and nothing in-process reproduces that.
        self.item("переход → готово")
        finished = subprocess.run(
            [sys.executable, os.path.join(ROOT, "valkama.py"), "summary", "--space", SPACE_KEY],
            capture_output=True,
            env={**os.environ, "PYTHONIOENCODING": "cp1251"},
            check=False,
        )
        self.assertEqual(0, finished.returncode, finished.stderr[:400])
        self.assertIn("переход → готово", finished.stdout.decode("utf-8"))


class ExportTests(CliTestCase):
    def setUp(self) -> None:
        super().setUp()
        service.create_planning_space(self.conn, project_id="cli", name="Other", key="OTH")
        service.create_work_item(self.conn, space="OTH", title="not in the narrowed export")
        self.item("in the narrowed export")
        self.target = os.path.join(self.home.name, "export.json")

    def test_without_output_the_export_goes_to_stdout_as_before(self) -> None:
        payload = json.loads(self.invoke("export"))
        self.assertEqual(
            {"COM", "OTH"}, {space["key"] for space in payload["planning"]["planning_spaces"]}
        )
        self.assertNotIn("space_filter", payload)

    def test_one_space_to_a_file_prints_only_a_summary(self) -> None:
        output = self.invoke("export", "--space", SPACE_KEY, "--output", self.target)
        self.assertEqual(
            f"wrote {os.path.abspath(self.target)}: 1 planning space(s) ({SPACE_KEY}),"
            " 1 work item(s)\n",
            output,
        )
        with open(self.target, encoding="utf-8") as handle:
            payload = json.load(handle)
        self.assertEqual([SPACE_KEY], payload["space_filter"])
        self.assertEqual(
            ["in the narrowed export"],
            [item["title"] for item in payload["planning"]["work_items"]],
        )

    def test_the_space_option_repeats(self) -> None:
        payload = json.loads(self.invoke("export", "--space", SPACE_KEY, "--space", "OTH"))
        self.assertEqual(["COM", "OTH"], sorted(payload["space_filter"]))
        self.assertEqual(2, len(payload["planning"]["work_items"]))

    def test_an_unknown_space_exits_non_zero_and_writes_nothing(self) -> None:
        with self.assertRaises(SystemExit) as stopped:
            self.invoke("export", "--space", "NOPE", "--output", self.target)
        self.assertIn("no planning space named NOPE", str(stopped.exception.code))
        self.assertFalse(os.path.exists(self.target))

    def test_an_unwritable_output_exits_non_zero(self) -> None:
        missing = os.path.join(self.home.name, "absent", "export.json")
        with self.assertRaises(SystemExit) as stopped:
            self.invoke("export", "--output", missing)
        self.assertIn("cannot write", str(stopped.exception.code))


class RoutingTests(CliTestCase):
    def test_capabilities_advertises_only_commands_the_parser_implements(self) -> None:
        payload = json.loads(self.invoke("capabilities"))
        for command in payload["commands"]:
            with self.subTest(command=command), self.assertRaises(SystemExit) as stopped:
                self.invoke(command, "--help")
            self.assertEqual(0, stopped.exception.code)

    def test_capabilities_names_the_port_and_the_address_to_register_the_display_hook_on(
        self,
    ) -> None:
        with mock.patch.dict(os.environ, {"VALKAMA_PORT": "9123"}):
            http = json.loads(self.invoke("capabilities"))["interfaces"]["http"]
        self.assertEqual(9123, http["port"])
        self.assertEqual(
            "http://127.0.0.1:9123/api/hooks/message-display",
            http["hooks"]["claude"]["MessageDisplay"],
        )

    def test_runtime_prints_the_identity_a_new_server_would_expose(self) -> None:
        identity = json.loads(self.invoke("runtime"))
        self.assertIn("backend", identity)

    def test_no_command_starts_the_mcp_surface(self) -> None:
        # The default route, and the one the MCP registrations rely on.
        with mock.patch.object(cli, "mcp_main") as started:
            self.invoke()
        started.assert_called_once_with()

    def test_serve_passes_the_port_it_was_given(self) -> None:
        with mock.patch.object(cli, "serve_main") as served:
            self.invoke("serve", "--port", "9999")
        served.assert_called_once_with(9999, development_origin=None)

    def test_serve_listens_where_a_work_item_address_points_by_default(self) -> None:
        with mock.patch.object(cli, "serve_main") as served:
            self.invoke("serve")
        served.assert_called_once_with(configuration.DEFAULT_LISTENER_PORT, development_origin=None)


class UsageRebuildTests(CliTestCase):
    """`usage rebuild` over one session the reader has read: a prompt, a script, an answer."""

    def setUp(self) -> None:
        super().setUp()
        transcript = Path(self.home.name) / "projects" / "sess-cli.jsonl"
        self.conn.execute(
            "INSERT INTO sessions(id, client, transcript_path, status, started_at, last_seen)"
            " VALUES ('sess-cli', 'claude', ?, 'active', ?, ?)",
            (str(transcript), usage_fixtures.stamp(0), usage_fixtures.stamp(0)),
        )
        self.conn.commit()
        for minute in range(61):
            liveness.tick(self.database, usage_fixtures.epoch(minute * 60))
        run = usage_fixtures.ClaudeRun(transcript, "sess-cli")
        run.prompt(0)
        run.reply(10, tools=(("t1", "Bash"),))
        run.result(610, "t1")
        run.end_turn(620)
        reader = ingest.open_light(self.database, store.STORE_SCHEMA_VERSION)
        self.addCleanup(reader.close)
        usage_collect.Collector(reader, self.database).run_pass(print, 30.0)
        self.backups = os.path.join(self.home.name, "backups")

    def counted(self) -> list:
        return [
            tuple(row)
            for row in self.conn.execute(
                "SELECT id, work_item_id, seconds, output_tokens FROM usage_segments ORDER BY id"
            )
        ]

    def late_attention(self) -> None:
        """A permission request the reader never saw, which takes the call's wait off the work."""

        self.conn.execute(
            "INSERT INTO execution_events(event_uid, kind, identity_state, identity_source,"
            " session_id, received_at) VALUES ('a1', 'attention', 'confirmed', 'hook', ?, ?)",
            ("sess-cli", usage_fixtures.stamp(20)),
        )
        self.conn.commit()

    def test_one_run_with_nothing_changed_reports_its_totals_unchanged(self) -> None:
        before = self.counted()
        output = self.invoke("usage", "rebuild", "--session", "sess-cli")
        self.assertIn("usage rebuild: rebuilt 1 run(s), refused 0", output)
        self.assertIn("sess-cli: rebuilt, totals unchanged", output)
        self.assertEqual([row[1:] for row in before], [row[1:] for row in self.counted()])
        self.assertFalse(os.path.isdir(self.backups))

    def test_a_dry_run_prints_the_differences_and_writes_nothing(self) -> None:
        self.late_attention()
        before = self.counted()
        output = self.invoke("usage", "rebuild", "--session", "sess-cli", "--dry-run")
        self.assertIn("would rebuild 1 run(s)", output)
        self.assertIn("seconds 620.0 -> 30.0", output)
        self.assertIn("human_seconds 0.0 -> 590.0", output)
        self.assertIn("dry run: nothing was written", output)
        self.assertEqual(before, self.counted())
        payload = json.loads(
            self.invoke("usage", "rebuild", "--session", "sess-cli", "--dry-run", "--json")
        )
        (run,) = payload["runs"]
        self.assertEqual((620.0, 30.0), (run["before"]["seconds"], run["after"]["seconds"]))
        self.assertEqual(before, self.counted())

    def test_every_run_takes_a_snapshot_with_the_liveness_file_first(self) -> None:
        self.late_attention()
        output = self.invoke("usage", "rebuild", "--all")
        self.assertIn("rebuilt 1 run(s), refused 0", output)
        (snapshot,) = [name for name in os.listdir(self.backups) if name.endswith(".sqlite3")]
        self.assertIn(f"snapshot: {os.path.join(self.backups, snapshot)}", output)
        self.assertTrue(os.path.isfile(os.path.join(self.backups, f"{snapshot}.liveness")))
        self.assertEqual(30.0, sum(row[2] for row in self.counted()))

    def test_a_refusal_is_printed_and_exits_non_zero(self) -> None:
        os.remove(liveness.path_for(self.database))
        before = self.counted()
        stream = io.StringIO()
        with contextlib.redirect_stdout(stream), self.assertRaises(SystemExit) as stopped:
            cli.main(["usage", "rebuild", "--all"])
        self.assertEqual(1, stopped.exception.code)
        self.assertIn("refused (no-liveness)", stream.getvalue())
        self.assertEqual(before, self.counted())
        self.assertFalse(os.path.isdir(self.backups))

    def test_a_snapshot_that_cannot_be_taken_stops_the_rebuild_before_any_run(self) -> None:
        self.late_attention()
        before = self.counted()
        with (
            mock.patch.object(
                store_backups, "snapshot_identity", side_effect=RuntimeError("torn copy")
            ),
            self.assertRaises(SystemExit) as stopped,
        ):
            self.invoke("usage", "rebuild", "--all")
        self.assertEqual("usage rebuild: torn copy", stopped.exception.code)
        self.assertEqual(before, self.counted())

    def test_one_run_or_all_and_an_agent_only_with_its_session(self) -> None:
        for argv in (
            ["usage", "rebuild"],
            ["usage", "rebuild", "--all", "--session", "sess-cli"],
            ["usage", "rebuild", "--all", "--agent", "worker"],
        ):
            with (
                self.subTest(argv=argv),
                mock.patch.object(sys, "stderr", io.StringIO()),
                self.assertRaises(SystemExit) as stopped,
            ):
                cli.main(argv)
            self.assertEqual(2, stopped.exception.code)


if __name__ == "__main__":
    unittest.main()
