"""A claim is a lease held by a confirmed session.

The claim paths run through the real surfaces: the MCP stdio loop with the
`_meta` a Codex client sends, and the HTTP listener with the browser's
credential. Reads that must see a stale lease before anything releases it go
through `call_tool` and the HTTP listener, because starting the stdio loop runs
the start-up sweep that releases it.

The state rules under test, in order: no call or no confirmed session behind
the claim reads `unconfirmed`; a missing, ended or failed session, or one
quiet for longer than the lease period, reads `stale`; anything else is `live`.
"""

from __future__ import annotations

import contextlib
import http.client
import io
import json
import os
import sys
import tempfile
import threading
import time
import unittest
from datetime import UTC, datetime, timedelta
from pathlib import Path
from unittest import mock

from server import housekeeping, http_surface, mcp_surface, store
from server.ops import tray
from server.planning import leases, service, views

PROTOCOL = {"io.modelcontextprotocol/protocolVersion": mcp_surface.MODERN_PROTOCOL}
ONE = "019a3c2e-0001-7c11-9e0f-2f4b6d8a1c3e"
TWO = "019a3c2e-0002-7c11-9e0f-2f4b6d8a1c3e"
THREAD = "019a3c2e-0003-7c11-9e0f-2f4b6d8a1c3e"
SECOND = "%Y-%m-%dT%H:%M:%SZ"


def codex(session: str, thread: str | None = None) -> dict:
    """The `_meta` Codex sends on every tool call."""

    return {"sessionId": session, "threadId": thread or session, "callId": f"call_{session[-4:]}"}


def held(session: str) -> str:
    """The holder a claim records for a Codex session that proved itself."""

    return f"codex (session {session})"


class _Bytes:
    def __init__(self, payload: bytes = b"") -> None:
        self.buffer = io.BytesIO(payload)


class LeaseTestCase(unittest.TestCase):
    """A throwaway store, its MCP loop and its HTTP listener."""

    def setUp(self) -> None:
        directory = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)
        environment = mock.patch.dict(
            os.environ,
            {
                "VALKAMA_DB": str(self.root / "valkama.sqlite3"),
                "HOME": str(self.root),
                "USERPROFILE": str(self.root),
            },
        )
        environment.start()
        self.addCleanup(environment.stop)
        self.conn = store.connect()
        self.addCleanup(self.conn.close)
        service.create_planning_space(self.conn, project_id="lease", name="Lease", key="LSE")
        self.reference = service.create_work_item(self.conn, space="LSE", title="Held")["reference"]
        self.conn.commit()

    # -- the MCP loop --------------------------------------------------------

    def mcp(
        self, name: str, arguments: dict, meta: dict | None = None, *, started: bool = False
    ) -> dict:
        """One `tools/call` through the stdio loop; the decoded payload or the error text.

        Each call starts the loop, and starting it runs the start-up sweep.
        `started` stands for a process that was already running when the lease
        went stale, so that the call itself is what meets the lease.
        """

        message = {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "tools/call",
            "params": {"_meta": {**PROTOCOL, **(meta or {})}, "name": name, "arguments": arguments},
        }
        stdout = _Bytes()
        self.stderr = io.StringIO()
        with (
            mock.patch.object(sys, "stdin", _Bytes(json.dumps(message).encode() + b"\n")),
            mock.patch.object(sys, "stdout", stdout),
            mock.patch.object(sys, "stderr", self.stderr),
            mock.patch.object(tray, "start", return_value=None),
            (
                mock.patch.object(housekeeping, "start_up", return_value=[])
                if started
                else contextlib.nullcontext()
            ),
        ):
            mcp_surface.mcp_main()
        [answer] = [json.loads(line) for line in stdout.buffer.getvalue().splitlines()]
        result = answer["result"]
        text = result["content"][0]["text"]
        return {"error": text} if result["isError"] else json.loads(text)

    def claim(
        self, meta: dict | None = None, *, started: bool = False, **arguments: object
    ) -> dict:
        return self.mcp(
            "claim_work_item", {"id": self.reference, **arguments}, meta, started=started
        )

    # -- the HTTP listener ---------------------------------------------------

    def listener(self) -> http_surface.PlatformHTTPServer:
        server = http_surface.PlatformHTTPServer(
            ("127.0.0.1", 0), http_surface.Handler, token_path=self.root / "installation-token"
        )
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(thread.join, 2)
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        return server

    def http(
        self, server: http_surface.PlatformHTTPServer, method: str, path: str, payload: dict | None
    ) -> tuple[int, dict]:
        client = http.client.HTTPConnection("127.0.0.1", server.server_port, timeout=5)
        headers = {}
        body = None
        if payload is not None:
            body = json.dumps(payload)
            headers = {
                "Content-Type": "application/json",
                "Origin": f"http://127.0.0.1:{server.server_port}",
                "Sec-Fetch-Site": "same-origin",
                "X-Valkama-Session": server.security_context.browser_session_token,
            }
        try:
            client.request(method, path, body=body, headers=headers)
            response = client.getresponse()
            return response.status, json.loads(response.read())
        finally:
            client.close()

    # -- reading the store ---------------------------------------------------

    def item(self) -> dict:
        return service.get_work_item(self.conn, self.reference)

    def history(self) -> list[tuple[str, str, str, str | None]]:
        return [
            (event["action"], event["detail"], event["author"], event["identity"]["source"])
            for event in self.item()["events"]
            if event["action"] in ("claimed", "released", "taken_over")
        ]

    def set_session(self, session: str, **columns: str) -> None:
        for column, value in columns.items():
            self.conn.execute(
                f"UPDATE sessions SET {column} = ? WHERE id = ?",
                (value, session),
            )
        self.conn.commit()

    def age(self, session: str, days: float) -> None:
        """Make a session's last sign of life `days` old, by the real clock."""

        moment = datetime.now(UTC) - timedelta(days=days)
        self.set_session(session, last_seen=moment.strftime(SECOND))


class TwoSessionsTests(LeaseTestCase):
    """Two sessions that sign with the same author are still two holders."""

    def test_a_second_session_under_the_same_author_cannot_release_the_claim(self) -> None:
        self.assertEqual("live", self.claim(codex(ONE), author="codex")["claim_state"])
        refused = self.claim(codex(TWO), author="codex", release=True)
        self.assertIn(f"held by {held(ONE)}, not by you", refused["error"])
        taken = self.claim(codex(TWO), author="codex")
        self.assertIn(f"already held by {held(ONE)}; pass force", taken["error"])
        lease = self.item()["claim"]
        self.assertEqual(
            (held(ONE), "live", ONE), (lease["holder"], lease["state"], lease["session_id"])
        )
        self.assertEqual([("claimed", "", "codex", "codex-meta")], self.history())

    def test_the_holding_session_releases_whatever_author_it_signs_with(self) -> None:
        self.claim(codex(ONE), author="codex")
        released = self.claim(codex(ONE), author="someone-else", release=True)
        self.assertEqual(("", None), (released["claim_ref"], released["claim_state"]))

    def test_a_subagent_of_the_holding_session_is_the_holder(self) -> None:
        self.claim(codex(ONE), author="codex")
        again = self.claim(codex(ONE, THREAD), author="codex-worker")
        self.assertEqual("live", again["claim_state"])
        self.assertNotIn("taken_over", [action for action, *_ in self.history()])
        lease = self.item()["claim"]
        self.assertEqual((ONE, THREAD), (lease["session_id"], lease["agent_id"]))

    def test_force_still_takes_a_live_lease_over_and_records_it(self) -> None:
        self.claim(codex(ONE), author="codex")
        taken = self.claim(codex(TWO), author="codex", force=True)
        self.assertEqual("live", taken["claim_state"])
        self.assertEqual(TWO, self.item()["claim"]["session_id"])
        self.assertEqual("taken_over", self.history()[-1][0])

    def test_a_caller_without_a_session_needs_force_against_a_live_lease(self) -> None:
        self.claim(codex(ONE), author="codex")
        refused = self.claim(None, author="codex", release=True)
        self.assertIn("not by you", refused["error"])

    def test_an_unconfirmed_holder_is_still_compared_by_author(self) -> None:
        self.assertEqual("unconfirmed", self.claim(None, author="old")["claim_state"])
        released = self.claim(codex(TWO), author="old", release=True)
        self.assertEqual("", released["claim_ref"])


class LeaseStateTests(LeaseTestCase):
    """What a read reports, without anything being written by the read."""

    def setUp(self) -> None:
        super().setUp()
        self.claim(codex(ONE), author="codex")

    def read_everywhere(self) -> dict[str, object]:
        server = self.listener()
        _, item = self.http(server, "GET", f"/api/planning/work-item?id={self.reference}", None)
        _, listing = self.http(server, "GET", "/api/planning/work-items?space=LSE", None)
        mcp_item = mcp_surface.call_tool(self.conn, "get_work_item", {"id": self.reference})
        mcp_rows = mcp_surface.call_tool(self.conn, "list_work_items", {"space": "LSE"})
        assert isinstance(mcp_item, dict) and isinstance(mcp_rows, dict)
        return {
            "http item": item["work_item"]["claim"]["state"],
            "http list": item["work_item"]["claim_state"],
            "http rows": [row["claim_state"] for row in listing["work_items"]],
            "mcp item": mcp_item["claim"]["state"],
            "mcp rows": [row["claim_state"] for row in mcp_rows["work_items"]],
        }

    def test_a_claim_by_a_confirmed_session_reads_live_with_its_expiry(self) -> None:
        lease = self.item()["claim"]
        self.assertEqual("live", lease["state"])
        self.assertEqual("codex-meta", lease["source"])
        seen = datetime.strptime(lease["last_seen"], SECOND).replace(tzinfo=UTC)
        self.assertEqual(
            seen + timedelta(days=14),
            datetime.strptime(lease["expires_at"], SECOND).replace(tzinfo=UTC),
        )
        self.assertTrue(lease["acquired_at"])

    def test_after_the_session_ends_the_claim_reads_stale_in_the_item_and_the_list(self) -> None:
        self.set_session(ONE, status="ended")
        revision = self.item()["revision"]
        self.assertEqual(
            {
                "http item": "stale",
                "http list": "stale",
                "http rows": ["stale"],
                "mcp item": "stale",
                "mcp rows": ["stale"],
            },
            self.read_everywhere(),
        )
        # Reads never write: the claim and the revision are where they were.
        self.assertEqual((held(ONE), revision), (self.item()["claim_ref"], self.item()["revision"]))
        self.assertIsNone(self.item()["claim"]["expires_at"])

    def test_a_failed_session_and_a_missing_session_row_read_stale(self) -> None:
        self.set_session(ONE, status="failed")
        self.assertEqual("stale", self.item()["claim_state"])
        self.conn.execute("DELETE FROM sessions WHERE id = ?", (ONE,))
        self.conn.commit()
        self.assertEqual("stale", self.item()["claim_state"])
        self.assertIsNone(self.item()["claim"]["last_seen"])

    def test_the_lease_lapses_after_exactly_fourteen_days_without_a_sign_of_life(self) -> None:
        now = datetime(2026, 10, 31, 12, 0, 0, tzinfo=UTC)
        boundary = now - timedelta(days=14)
        with mock.patch.object(leases, "utc_now", return_value=now):
            self.set_session(ONE, last_seen=boundary.strftime(SECOND))
            self.assertEqual("live", self.item()["claim_state"])
            self.assertEqual(now.strftime(SECOND), self.item()["claim"]["expires_at"])
            self.set_session(ONE, last_seen=(boundary - timedelta(seconds=1)).strftime(SECOND))
            self.assertEqual("stale", self.item()["claim_state"])

    def test_a_claim_ref_written_by_an_older_build_reads_unconfirmed(self) -> None:
        # An older build writes the holder alone. The store's trigger drops the
        # call link, so the new holder is not mistaken for the old lease.
        self.conn.execute(
            "UPDATE work_items SET claim_ref = 'old-build', revision = revision + 1"
            " WHERE work_item_id = ?",
            (self.item()["work_item_id"],),
        )
        self.conn.commit()
        lease = self.item()["claim"]
        self.assertEqual(
            ("old-build", "unconfirmed", None),
            (lease["holder"], lease["state"], lease["session_id"]),
        )

    def test_the_acknowledgement_names_the_lease_state(self) -> None:
        answer = self.mcp(
            "update_work_item", {"id": self.reference, "title": "Renamed"}, codex(ONE)
        )
        self.assertEqual((held(ONE), "live"), (answer["claim_ref"], answer["claim_state"]))


class HeartbeatTests(LeaseTestCase):
    def test_a_confirmed_call_keeps_a_session_whose_hooks_are_silent_live(self) -> None:
        self.claim(codex(ONE), author="codex")
        other = service.create_work_item(self.conn, space="LSE", title="Elsewhere")["reference"]
        self.conn.commit()
        self.age(ONE, 20)
        self.assertEqual("stale", self.item()["claim_state"])
        self.mcp(
            "comment_work_item",
            {"id": other, "body": "still here"},
            codex(ONE, THREAD),
            started=True,
        )
        self.assertEqual("live", self.item()["claim_state"])
        # The subagent's call moved the top-level session, which the lease follows.
        rows = self.conn.execute("SELECT id FROM sessions ORDER BY id").fetchall()
        self.assertEqual([ONE], [row[0] for row in rows])

    def test_an_unconfirmed_call_is_not_a_heartbeat(self) -> None:
        self.claim(codex(ONE), author="codex")
        self.age(ONE, 20)
        self.mcp(
            "comment_work_item", {"id": self.reference, "body": "who am I"}, None, started=True
        )
        self.assertEqual("stale", self.item()["claim_state"])


class ExpiryTests(LeaseTestCase):
    def setUp(self) -> None:
        super().setUp()
        self.claim(codex(ONE), author="codex")
        self.set_session(ONE, status="ended")

    def assert_expired_by_valkama(self) -> None:
        released = [event for event in self.item()["events"] if event["action"] == "released"]
        self.assertEqual(1, len(released))
        self.assertEqual(f"lease-expired: {held(ONE)}", released[0]["detail"])
        self.assertEqual("valkama", released[0]["author"])
        self.assertEqual(
            {"state": "confirmed", "source": "valkama", "session_id": None, "agent_id": None},
            released[0]["identity"],
        )
        [call] = self.conn.execute(
            "SELECT tool, client FROM execution_events WHERE identity_source = 'valkama'"
        ).fetchall()
        self.assertEqual(("lease-expiry", "valkama"), (call["tool"], call["client"]))

    def test_a_stale_lease_is_taken_over_without_force(self) -> None:
        taken = self.claim(codex(TWO), author="codex", started=True)
        self.assertEqual((held(TWO), "live"), (taken["claim_ref"], taken["claim_state"]))
        self.assertEqual(
            [
                ("claimed", "", "codex", "codex-meta"),
                ("released", f"lease-expired: {held(ONE)}", "valkama", "valkama"),
                ("claimed", "", "codex", "codex-meta"),
            ],
            self.history(),
        )
        self.assertEqual(TWO, self.item()["claim"]["session_id"])
        self.assert_expired_by_valkama()

    def test_the_owner_takes_a_stale_lease_from_the_browser_without_force(self) -> None:
        server = self.listener()
        status, taken = self.http(
            server, "POST", "/api/planning/work-item/claim", {"id": self.reference}
        )
        self.assertEqual(200, status, taken)
        self.assertEqual(("user", "unconfirmed"), (taken["claim_ref"], taken["claim"]["state"]))
        self.assertEqual("browser", taken["claim"]["source"])
        self.assertEqual(["claimed", "released", "claimed"], [a for a, *_ in self.history()])
        self.assert_expired_by_valkama()

    def test_a_release_that_meets_a_stale_lease_records_only_the_expiry(self) -> None:
        answer = self.claim(codex(TWO), author="codex", release=True, started=True)
        self.assertEqual("", answer["claim_ref"])
        self.assert_expired_by_valkama()

    def test_the_take_next_queue_releases_expired_leases_first(self) -> None:
        picked = self.mcp(
            "claim_ready_work_item", {"space": "LSE", "author": "codex"}, codex(TWO), started=True
        )
        self.assertEqual(self.reference, picked["work_item"]["reference"])
        self.assertEqual("live", picked["work_item"]["claim_state"])
        self.assert_expired_by_valkama()

    def test_start_up_releases_every_expired_lease_once(self) -> None:
        live = service.create_work_item(self.conn, space="LSE", title="Live")["reference"]
        self.conn.commit()
        self.mcp("claim_work_item", {"id": live, "author": "codex"}, codex(TWO))
        # The call above started the loop, and the loop swept on its way in.
        self.assertEqual("", self.item()["claim_ref"])
        self.assertEqual("valkama: released 1 expired Planning lease(s)\n", self.stderr.getvalue())
        self.assert_expired_by_valkama()
        self.assertEqual(0, housekeeping.run(self.conn).expired_leases)
        self.assertEqual("live", service.get_work_item(self.conn, live)["claim_state"])

    def test_the_holding_session_itself_keeps_its_stale_lease(self) -> None:
        self.set_session(ONE, status="active")
        self.age(ONE, 20)
        kept = self.claim(codex(ONE), author="codex", started=True)
        # Its own call was the heartbeat, and the lease was never released.
        self.assertEqual("live", kept["claim_state"])
        self.assertNotIn("released", [action for action, *_ in self.history()])


class ResumedSessionTests(LeaseTestCase):
    """A client may resume an ended session without a new `SessionStart` and keep writing."""

    def setUp(self) -> None:
        super().setUp()
        self.claim(codex(ONE), author="codex")
        ended = (datetime.now(UTC) - timedelta(minutes=5)).strftime(SECOND)
        self.set_session(ONE, status="ended", ended_at=ended, last_seen=ended)
        self.assertEqual("stale", self.item()["claim_state"])

    def session(self) -> dict:
        row = self.conn.execute(
            "SELECT status, ended_at, attention FROM sessions WHERE id = ?", (ONE,)
        ).fetchone()
        return dict(row)

    def test_a_confirmed_write_after_the_end_makes_the_session_active_and_keeps_its_claim(
        self,
    ) -> None:
        self.mcp(
            "comment_work_item",
            {"id": self.reference, "body": "still here", "author": "codex"},
            codex(ONE),
            started=True,
        )
        self.assertEqual({"status": "active", "ended_at": None, "attention": ""}, self.session())
        self.assertEqual("live", self.item()["claim_state"])
        self.assertEqual(0, housekeeping.run(self.conn).expired_leases)
        self.assertEqual(held(ONE), self.item()["claim_ref"])

    def test_an_unconfirmed_write_revives_nothing(self) -> None:
        self.mcp(
            "comment_work_item",
            {"id": self.reference, "body": "who am I", "author": "codex"},
            None,
            started=True,
        )
        self.assertEqual("ended", self.session()["status"])

    def test_a_failed_session_stays_failed(self) -> None:
        self.set_session(ONE, status="failed")
        self.mcp(
            "comment_work_item",
            {"id": self.reference, "body": "after the failure", "author": "codex"},
            codex(ONE),
            started=True,
        )
        self.assertEqual("failed", self.session()["status"])

    def test_a_drained_event_after_the_end_never_revives_the_session(self) -> None:
        from server.hooks import ingest, normalize

        later = (datetime.now(UTC) - timedelta(minutes=1)).strftime("%Y-%m-%dT%H:%M:%S.000Z")
        record = normalize.lifecycle_event(
            "codex",
            "stop",
            {"session_id": ONE},
            event_uid="00000000-0000-4000-8000-0000000000e1",
            occurred_at=later,
        )
        assert record is not None
        ingest.write(self.conn, [(record, later)], delivery="spooled")
        self.assertEqual("ended", self.session()["status"])


class StartUpTests(unittest.TestCase):
    def test_a_store_that_cannot_be_written_does_not_stop_a_surface(self) -> None:
        connection = mock.Mock()
        with mock.patch.object(
            housekeeping, "run", side_effect=store.sqlite3.OperationalError("locked")
        ):
            self.assertEqual(
                ["start-up maintenance did not finish: locked"], housekeeping.start_up(connection)
            )

    def test_a_failed_lease_sweep_is_reported_and_the_drain_still_counts(self) -> None:
        with (
            mock.patch.object(
                housekeeping,
                "drain_spool",
                return_value=housekeeping.ingest.DrainResult(stopped="busy"),
            ),
            mock.patch.object(
                housekeeping, "expire_leases", side_effect=store.sqlite3.OperationalError("locked")
            ),
        ):
            self.assertEqual(
                ["start-up maintenance: lease expiry: locked", "hook spool drain stopped: busy"],
                housekeeping.start_up(mock.Mock()),
            )

    def test_the_drain_runs_first_within_the_budget_and_the_sweep_does_not_run(self) -> None:
        steps: list[str] = []
        connection = mock.Mock()

        def drain(conn: object, *, seconds: float) -> object:
            self.assertIs(connection, conn)
            self.assertLess(seconds, housekeeping.START_UP_SECONDS)
            steps.append("drain")
            return housekeeping.ingest.DrainResult()

        with (
            mock.patch.object(housekeeping, "drain_spool", side_effect=drain),
            mock.patch.object(
                housekeeping, "expire_leases", side_effect=lambda _conn: steps.append("leases") or 0
            ),
            mock.patch.object(housekeeping.transcripts, "sweep") as sweep,
        ):
            self.assertEqual([], housekeeping.start_up(connection))
        self.assertEqual(["drain", "leases"], steps)
        sweep.assert_not_called()

    def test_a_drain_that_spends_the_budget_leaves_the_leases_to_the_next_start(self) -> None:
        with (
            mock.patch.object(
                housekeeping,
                "drain_spool",
                return_value=housekeeping.ingest.DrainResult(),
            ),
            mock.patch.object(housekeeping, "expire_leases") as expire,
        ):
            report = housekeeping.run(mock.Mock(), seconds=-1.0)
        expire.assert_not_called()
        self.assertEqual(["lease expiry: no time left; it runs at the next start"], report.failures)

    def test_the_lease_expiry_gives_up_quickly_on_a_store_another_writer_holds(self) -> None:
        directory = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.addCleanup(directory.cleanup)
        path = os.path.join(directory.name, "valkama.sqlite3")
        with mock.patch.dict(
            os.environ, {"VALKAMA_DB": path, "HOME": directory.name, "USERPROFILE": directory.name}
        ):
            conn = store.connect()
            self.addCleanup(conn.close)
            holder = store.sqlite3.connect(path, isolation_level=None)
            self.addCleanup(holder.close)
            holder.execute("BEGIN EXCLUSIVE")
            started = time.monotonic()
            report = housekeeping.run(conn)
            elapsed = time.monotonic() - started
            holder.execute("ROLLBACK")
            busy = conn.execute("PRAGMA busy_timeout").fetchone()[0]
        self.assertLess(elapsed, housekeeping.START_UP_SECONDS)
        self.assertEqual(1, len(report.failures), report.failures)
        self.assertIn("lease expiry", report.failures[0])
        # The connection's own timeout is back for the requests that follow.
        self.assertEqual(5000, busy)


class AbandonedClaimTests(LeaseTestCase):
    """The space's list of claims nobody is behind any more."""

    def setUp(self) -> None:
        super().setUp()
        service.transition_work_item(self.conn, self.reference, "dev", force=True)
        self.conn.commit()

    def abandoned(self) -> list[tuple[str, str | None]]:
        return [
            (claim["reference"], claim["claim_state"])
            for claim in views.stale_claims(self.conn, space="LSE")
        ]

    def test_a_lease_is_judged_by_its_session_not_by_quiet(self) -> None:
        self.claim(codex(ONE), author="codex")
        self.assertEqual([], self.abandoned())
        self.set_session(ONE, status="ended")
        self.assertEqual([(self.reference, "stale")], self.abandoned())

    def test_an_unconfirmed_claim_is_abandoned_after_three_quiet_days(self) -> None:
        self.claim(None, author="old")
        self.assertEqual([], self.abandoned())
        self.conn.execute("UPDATE work_item_events SET created_at = '2020-01-01T00:00:00Z'")
        self.conn.execute("UPDATE work_items SET updated_at = '2020-01-01T00:00:00Z'")
        self.conn.commit()
        self.assertEqual([(self.reference, "unconfirmed")], self.abandoned())

    def test_a_launched_runner_claim_is_still_called_abandoned_when_quiet(self) -> None:
        # A launch claims inside the browser's call, but for its runner.
        status, _ = self.http(
            self.listener(),
            "POST",
            "/api/planning/work-item/claim",
            {"id": self.reference, "author": "codex:executor"},
        )
        self.assertEqual(200, status)
        self.conn.execute("UPDATE work_item_events SET created_at = '2020-01-01T00:00:00Z'")
        self.conn.execute("UPDATE work_items SET updated_at = '2020-01-01T00:00:00Z'")
        self.conn.commit()
        self.assertEqual([(self.reference, "unconfirmed")], self.abandoned())

    def test_the_owners_own_claim_is_never_called_abandoned(self) -> None:
        status, _ = self.http(
            self.listener(), "POST", "/api/planning/work-item/claim", {"id": self.reference}
        )
        self.assertEqual(200, status)
        self.conn.execute("UPDATE work_item_events SET created_at = '2020-01-01T00:00:00Z'")
        self.conn.execute("UPDATE work_items SET updated_at = '2020-01-01T00:00:00Z'")
        self.conn.commit()
        self.assertEqual([], self.abandoned())


class ExecutorGuardTests(LeaseTestCase):
    def start(self) -> list[str]:
        """Start the held item by hand, the path a claim an earlier build took still needs.

        A claim starts its item itself, so the item is put back first.
        """

        service.transition_work_item(self.conn, self.reference, "backlog")
        moved = service.transition_work_item(self.conn, self.reference, "dev")
        self.conn.commit()
        return moved["warnings"]

    def test_an_unconfirmed_claim_starts_the_item_with_a_warning(self) -> None:
        warning = f"{self.reference} starts under a claim by old that no session confirmed"
        claimed = self.claim(None, author="old")
        self.assertEqual({"from": "backlog", "to": "dev"}, claimed["started"])
        self.assertEqual([warning], claimed["warnings"])
        self.assertEqual([warning], self.start())

    def test_a_live_lease_starts_the_item_without_one(self) -> None:
        claimed = self.claim(codex(ONE), author="codex")
        self.assertEqual(
            ({"from": "backlog", "to": "dev"}, None), (claimed["started"], claimed.get("warnings"))
        )
        self.assertEqual([], self.start())

    def test_a_stale_lease_still_counts_as_the_executor_but_says_so(self) -> None:
        self.claim(codex(ONE), author="codex")
        self.set_session(ONE, status="ended")
        self.assertEqual(
            [f"{self.reference} starts under a stale claim by {held(ONE)}: its session is gone"],
            self.start(),
        )


if __name__ == "__main__":
    unittest.main()
