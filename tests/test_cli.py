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
from unittest import mock

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
from server import cli, store
from server.planning import service
from server.projects import scopes

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
        # Claiming does not move an item, so both are still in the backlog.
        self.assertIn("Backlog 2", output)
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


class SessionStreamTests(CliTestCase):
    def stream_event(self, session: str, klass: str) -> None:
        self.conn.execute(
            "INSERT OR IGNORE INTO sessions(id, client, status) VALUES (?, 'claude', 'ended')",
            (session,),
        )
        self.conn.execute(
            "INSERT INTO session_events(session_id, klass, kind) VALUES (?,?,'tick')",
            (session, klass),
        )
        self.conn.commit()

    def test_purging_a_stream_leaves_the_analytics_history(self) -> None:
        self.stream_event("session-1", "stream")
        self.stream_event("session-1", "analytics")
        json.loads(self.invoke("purge-stream"))
        remaining = self.conn.execute("SELECT klass FROM session_events ORDER BY id").fetchall()
        self.assertEqual(["analytics"], [row["klass"] for row in remaining])


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


class RoutingTests(CliTestCase):
    def test_capabilities_advertises_only_commands_the_parser_implements(self) -> None:
        payload = json.loads(self.invoke("capabilities"))
        for command in payload["commands"]:
            with self.subTest(command=command), self.assertRaises(SystemExit) as stopped:
                self.invoke(command, "--help")
            self.assertEqual(0, stopped.exception.code)

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


if __name__ == "__main__":
    unittest.main()
