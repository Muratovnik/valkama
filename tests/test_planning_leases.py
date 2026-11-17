"""A claim is a lease held by a confirmed session.

The claim paths run through the real surfaces: the MCP stdio loop with the
`_meta` a Codex client sends, and the HTTP listener with the browser's
credential. Reads that must see a stale lease before anything releases it go
through `call_tool` and the HTTP listener, because starting the stdio loop runs
the start-up sweep that releases it.

The state rules under test, in order: no call or no confirmed session behind
the claim reads `unconfirmed`; a missing, ended or failed session, or one
quiet for longer than the lease period, reads `stale`; anything else is `live`.

A stale lease is not always released yet. An ended session has twelve hours to
come back, and until then only a caller who asks for that item takes it: the
start-up sweep and the take-next queue leave it alone.

The terms the tests hold the code to are the contract's, spelled out here: three
days of silence, twelve hours after an end, three days without an event on the
item for a hold no session proved, and no count of silence while an open
question to the owner stands on the item.
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
from server.hooks import ingest, normalize
from server.ops import tray
from server.planning import leases, requests, service, sweep, views

PROTOCOL = {"io.modelcontextprotocol/protocolVersion": mcp_surface.MODERN_PROTOCOL}
ONE = "019a3c2e-0001-7c11-9e0f-2f4b6d8a1c3e"
TWO = "019a3c2e-0002-7c11-9e0f-2f4b6d8a1c3e"
THREAD = "019a3c2e-0003-7c11-9e0f-2f4b6d8a1c3e"
THREE = "019a3c2e-0004-7c11-9e0f-2f4b6d8a1c3e"
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
        service.create_planning_space(self.conn, name="Lease", key="LSE")
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

    def read_everywhere(self) -> dict[str, object]:
        server = self.listener()
        _, item = self.http(server, "GET", f"/api/planning/work-item?id={self.reference}", None)
        _, listing = self.http(server, "GET", "/api/planning/work-items?space=LSE", None)
        mcp_item = mcp_surface.call_tool(
            self.conn, "get_work_item", {"id": self.reference, "parts": "claim"}
        )
        mcp_rows = mcp_surface.call_tool(self.conn, "list_work_items", {"space": "LSE"})
        assert isinstance(mcp_item, dict) and isinstance(mcp_rows, dict)
        return {
            "http item": item["work_item"]["claim"]["state"],
            "http list": item["work_item"]["claim_state"],
            "http rows": [row["claim_state"] for row in listing["work_items"]],
            "mcp item": mcp_item["claim"]["state"],
            "mcp rows": [row["claim_state"] for row in mcp_rows["work_items"]],
        }

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

    def test_a_claim_by_a_confirmed_session_reads_live_with_its_expiry(self) -> None:
        lease = self.item()["claim"]
        self.assertEqual("live", lease["state"])
        self.assertEqual("codex-meta", lease["source"])
        seen = datetime.strptime(lease["last_seen"], SECOND).replace(tzinfo=UTC)
        self.assertEqual(
            seen + timedelta(days=3),
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

    def test_the_lease_lapses_after_exactly_three_days_without_a_sign_of_life(self) -> None:
        now = datetime(2026, 10, 31, 12, 0, 0, tzinfo=UTC)
        boundary = now - timedelta(days=3)
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
            "apply_work_item_changes",
            {"id": self.reference, "update": {"title": "Renamed"}},
            codex(ONE),
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
            "apply_work_item_changes",
            {"id": other, "comment": {"body": "still here"}},
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
            "apply_work_item_changes",
            {"id": self.reference, "comment": {"body": "who am I"}},
            None,
            started=True,
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
        self.assertEqual(f"session-ended: {held(ONE)}", released[0]["detail"])
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
                ("released", f"session-ended: {held(ONE)}", "valkama", "valkama"),
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
            "apply_work_item_changes",
            {"id": self.reference, "author": "codex", "comment": {"body": "still here"}},
            codex(ONE),
            started=True,
        )
        self.assertEqual({"status": "active", "ended_at": None, "attention": ""}, self.session())
        self.assertEqual("live", self.item()["claim_state"])
        self.assertEqual(0, housekeeping.run(self.conn).expired_leases)
        self.assertEqual(held(ONE), self.item()["claim_ref"])

    def test_an_unconfirmed_write_revives_nothing(self) -> None:
        self.mcp(
            "apply_work_item_changes",
            {"id": self.reference, "author": "codex", "comment": {"body": "who am I"}},
            None,
            started=True,
        )
        self.assertEqual("ended", self.session()["status"])

    def test_a_failed_session_stays_failed(self) -> None:
        self.set_session(ONE, status="failed")
        self.mcp(
            "apply_work_item_changes",
            {"id": self.reference, "author": "codex", "comment": {"body": "after the failure"}},
            codex(ONE),
            started=True,
        )
        self.assertEqual("failed", self.session()["status"])

    def test_a_drained_event_after_the_end_never_revives_the_session(self) -> None:
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


class HookedLeaseTestCase(LeaseTestCase):
    """A store whose sessions move through the hook path, at times the events carry."""

    def setUp(self) -> None:
        super().setUp()
        self.events = 0

    def hook(self, event: str, at: datetime, **payload: str) -> None:
        """Deliver one lifecycle event of session ONE, as its hook would."""

        self.events += 1
        record = normalize.lifecycle_event(
            "codex",
            event,
            {"session_id": ONE, **payload},
            event_uid=f"00000000-0000-4000-8000-{self.events:012d}",
            occurred_at=at.strftime("%Y-%m-%dT%H:%M:%S.000Z"),
        )
        assert record is not None
        ingest.write(self.conn, [(record, None)], delivery="direct")

    def claimed_before(self, at: datetime, meta: dict) -> None:
        """A claim taken before `at`: the hook path ignores an event older than `last_seen`."""

        self.claim(meta, author="codex")
        self.set_session(ONE, last_seen=(at - timedelta(minutes=1)).strftime(SECOND))

    def clock(self, moment: datetime) -> mock._patch:
        return mock.patch.object(leases, "utc_now", return_value=moment)

    def start_server(self, moment: datetime) -> str:
        """Start an MCP server at this moment; what its start-up reported."""

        with self.clock(moment):
            self.mcp("list_work_items", {"space": "LSE"})
        return self.stderr.getvalue()

    def state_key(self) -> str:
        return str(self.item()["state"]["key"])

    def expiry_events(self) -> list[tuple[str, str]]:
        """What Valkama itself wrote: its releases and the moves they made."""

        return [
            (event["action"], event["detail"])
            for event in self.item()["events"]
            if event["author"] == "valkama"
        ]

    def abandoned(self, moment: datetime) -> list[str]:
        with self.clock(moment):
            return [claim["reference"] for claim in views.stale_claims(self.conn, space="LSE")]


END = datetime(2026, 10, 1, 20, 2, 23, tzinfo=UTC)
#: The contract's number, spelled out: this is what the tests hold the code to.
GRACE = timedelta(hours=12)
RELEASED = "valkama: released 1 expired Planning lease(s)\n"


class EndedSessionGraceTests(HookedLeaseTestCase):
    """A session that ended may come back for twelve hours, and its claim waits for it."""

    def setUp(self) -> None:
        super().setUp()
        self.claimed_before(END, codex(ONE))
        self.hook("session-end", END, reason="other")
        self.revision = self.item()["revision"]

    def assert_untouched(self, moment: datetime) -> None:
        with self.clock(moment):
            item = self.item()
        self.assertEqual(
            (held(ONE), self.revision, "dev", []),
            (item["claim_ref"], item["revision"], self.state_key(), self.expiry_events()),
        )

    def test_a_restart_with_a_resume_keeps_every_claim_without_one_write(self) -> None:
        # The order a client restart takes: the end, a server's start, the new start.
        self.assertEqual("", self.start_server(END + timedelta(seconds=4)))
        self.assert_untouched(END + timedelta(seconds=4))
        self.hook("session-start", END + timedelta(seconds=10), source="resume")
        with self.clock(END + timedelta(seconds=11)):
            self.assertEqual("live", self.item()["claim_state"])
        self.assert_untouched(END + timedelta(seconds=11))

    def test_a_confirmed_write_within_the_grace_brings_the_claim_back_too(self) -> None:
        self.assertEqual("", self.start_server(END + timedelta(hours=11)))
        with self.clock(END + timedelta(hours=11)):
            self.mcp(
                "apply_work_item_changes",
                {"id": self.reference, "comment": {"body": "back"}},
                codex(ONE),
            )
            self.assertEqual("live", self.item()["claim_state"])
        self.assertEqual([], self.expiry_events())

    def test_a_server_started_within_the_grace_leaves_the_claim_alone(self) -> None:
        self.assertEqual("", self.start_server(END + GRACE - timedelta(seconds=1)))
        self.assert_untouched(END + GRACE - timedelta(seconds=1))

    def test_a_server_started_after_the_grace_releases_it_and_says_why(self) -> None:
        self.assertEqual(RELEASED, self.start_server(END + GRACE + timedelta(hours=1)))
        self.assertEqual("", self.item()["claim_ref"])
        self.assertEqual("ready", self.state_key())
        self.assertEqual(
            [("released", f"session-ended: {held(ONE)}"), ("transitioned", "ready: session-ended")],
            self.expiry_events(),
        )

    def test_the_grace_is_over_at_exactly_twelve_hours(self) -> None:
        with self.clock(END + GRACE - timedelta(seconds=1)):
            self.assertEqual(0, housekeeping.run(self.conn).expired_leases)
        with self.clock(END + GRACE):
            self.assertEqual(1, housekeeping.run(self.conn).expired_leases)

    def test_an_end_with_no_time_on_it_has_no_grace(self) -> None:
        self.conn.execute("UPDATE sessions SET ended_at = NULL WHERE id = ?", (ONE,))
        self.conn.commit()
        self.assertEqual(RELEASED, self.start_server(END + timedelta(seconds=1)))
        self.assertEqual(
            [("released", f"session-ended: {held(ONE)}"), ("transitioned", "ready: session-ended")],
            self.expiry_events(),
        )

    def test_a_failed_session_has_no_grace(self) -> None:
        # It cannot come back by a write, only by an explicit start.
        self.set_session(ONE, status="failed")
        self.assertEqual(RELEASED, self.start_server(END + timedelta(seconds=1)))
        self.assertEqual(
            ("released", f"session-ended: {held(ONE)}"),
            self.expiry_events()[0],
        )

    def test_the_take_next_queue_neither_gives_nor_releases_it_within_the_grace(self) -> None:
        other = service.create_work_item(
            self.conn, space="LSE", title="Unheld", state="ready", acceptance="assignment"
        )["reference"]
        self.conn.commit()
        self.revision = self.item()["revision"]
        with self.clock(END + timedelta(hours=1)):
            picked = self.mcp(
                "claim_ready_work_item",
                {"space": "LSE", "author": "codex"},
                codex(TWO),
                started=True,
            )
        self.assertEqual(other, picked["work_item"]["reference"])
        self.assert_untouched(END + timedelta(hours=1))

    def test_the_take_next_queue_answers_nothing_when_only_a_grace_is_left(self) -> None:
        with self.clock(END + timedelta(hours=1)):
            picked = self.mcp(
                "claim_ready_work_item",
                {"space": "LSE", "author": "codex"},
                codex(TWO),
                started=True,
            )
        self.assertIsNone(picked["work_item"])
        self.assert_untouched(END + timedelta(hours=1))

    def test_the_take_next_queue_gives_it_after_the_grace(self) -> None:
        with self.clock(END + GRACE):
            picked = self.mcp(
                "claim_ready_work_item",
                {"space": "LSE", "author": "codex"},
                codex(TWO),
                started=True,
            )
        self.assertEqual(self.reference, picked["work_item"]["reference"])
        self.assertEqual(held(TWO), picked["work_item"]["claim_ref"])
        self.assertEqual(("released", f"session-ended: {held(ONE)}"), self.expiry_events()[0])

    def test_another_session_takes_it_within_the_grace_without_force(self) -> None:
        with self.clock(END + timedelta(seconds=30)):
            taken = self.claim(codex(TWO), author="codex", started=True)
        self.assertEqual((held(TWO), "live"), (taken["claim_ref"], taken["claim_state"]))
        self.assertEqual(
            [
                ("claimed", "", "codex", "codex-meta"),
                ("released", f"session-ended: {held(ONE)}", "valkama", "valkama"),
                ("claimed", "", "codex", "codex-meta"),
            ],
            self.history(),
        )

    def test_the_owner_takes_it_from_the_browser_within_the_grace_without_force(self) -> None:
        with self.clock(END + timedelta(seconds=30)):
            status, taken = self.http(
                self.listener(), "POST", "/api/planning/work-item/claim", {"id": self.reference}
            )
        self.assertEqual(200, status, taken)
        self.assertEqual("user", taken["claim_ref"])
        self.assertEqual(("released", f"session-ended: {held(ONE)}"), self.expiry_events()[0])

    def test_the_marks_say_stale_within_the_grace_and_a_resume_clears_them(self) -> None:
        moment = END + timedelta(minutes=5)
        with self.clock(moment):
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
        self.assertEqual([self.reference], self.abandoned(moment))

        self.hook("session-start", moment, source="resume")

        with self.clock(moment):
            self.assertEqual(
                {
                    "http item": "live",
                    "http list": "live",
                    "http rows": ["live"],
                    "mcp item": "live",
                    "mcp rows": ["live"],
                },
                self.read_everywhere(),
            )
        self.assertEqual([], self.abandoned(moment))

    def test_a_stale_lease_promises_no_release_time(self) -> None:
        # `expires_at` is the silence deadline of a live lease; the contract says
        # what an ended session gets instead.
        with self.clock(END + timedelta(minutes=5)):
            lease = self.item()["claim"]
        self.assertEqual(("stale", None), (lease["state"], lease["expires_at"]))


class ExpiryReasonTests(HookedLeaseTestCase):
    """The history names what actually happened to the session."""

    def setUp(self) -> None:
        super().setUp()
        self.claim(codex(ONE), author="codex")

    def test_quiet_days_keep_the_reason_they_always_had(self) -> None:
        self.age(ONE, 20)
        self.mcp("list_work_items", {"space": "LSE"})
        self.assertEqual("", self.item()["claim_ref"])
        self.assertEqual(
            [("released", f"lease-expired: {held(ONE)}"), ("transitioned", "ready: lease-expired")],
            self.expiry_events(),
        )

    def test_a_session_with_no_row_is_named_as_missing(self) -> None:
        self.conn.execute("DELETE FROM sessions WHERE id = ?", (ONE,))
        self.conn.commit()
        self.mcp("list_work_items", {"space": "LSE"})
        self.assertEqual(
            [
                ("released", f"session-missing: {held(ONE)}"),
                ("transitioned", "ready: session-missing"),
            ],
            self.expiry_events(),
        )

    def test_a_quiet_session_taken_over_is_still_named_as_quiet(self) -> None:
        self.age(ONE, 20)
        self.claim(codex(TWO), author="codex", started=True)
        self.assertEqual(("released", f"lease-expired: {held(ONE)}"), self.expiry_events()[0])


class SubagentHolderTests(HookedLeaseTestCase):
    """A subagent's claim lives and falls with its parent's session, not with the subagent."""

    HOLDER = f"codex agent {THREAD} (session {ONE})"

    def setUp(self) -> None:
        super().setUp()
        self.claimed_before(END, codex(ONE, THREAD))
        self.hook("subagent-stop", END - timedelta(seconds=30), agent_id=THREAD)

    def test_the_subagent_stopping_changes_nothing(self) -> None:
        self.assertEqual("", self.start_server(END))
        with self.clock(END):
            self.assertEqual(
                (self.HOLDER, "live"), (self.item()["claim_ref"], self.item()["claim_state"])
            )

    def test_it_waits_for_the_parent_within_the_grace_and_comes_back_with_it(self) -> None:
        self.hook("session-end", END, reason="other")
        self.assertEqual("", self.start_server(END + timedelta(seconds=4)))
        self.assertEqual(self.HOLDER, self.item()["claim_ref"])
        self.hook("session-start", END + timedelta(seconds=10), source="resume")
        with self.clock(END + timedelta(seconds=11)):
            self.assertEqual("live", self.item()["claim_state"])

    def test_it_falls_with_the_parent_after_the_grace(self) -> None:
        self.hook("session-end", END, reason="other")
        self.assertEqual(RELEASED, self.start_server(END + GRACE))
        self.assertEqual(("released", f"session-ended: {self.HOLDER}"), self.expiry_events()[0])


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
        failed = sweep.Pass(failures={sweep.LEASES: store.sqlite3.OperationalError("disk I/O")})
        with (
            mock.patch.object(
                housekeeping,
                "drain_spool",
                return_value=housekeeping.ingest.DrainResult(stopped="busy"),
            ),
            mock.patch.object(sweep, "run_pass", return_value=failed),
            mock.patch.object(housekeeping, "prune_quota_samples", return_value=0),
        ):
            self.assertEqual(
                [
                    "start-up maintenance: planning sweep leases: disk I/O",
                    "hook spool drain stopped: busy",
                ],
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

        def planning(conn: object, *, deadline: float) -> sweep.Pass:
            self.assertIs(connection, conn)
            # The pass shares the start-up budget.
            self.assertLessEqual(deadline, time.monotonic() + housekeeping.START_UP_SECONDS)
            steps.append("planning sweep")
            return sweep.Pass()

        with (
            mock.patch.object(housekeeping, "drain_spool", side_effect=drain),
            mock.patch.object(sweep, "run_pass", side_effect=planning),
            mock.patch.object(housekeeping, "prune_quota_samples", return_value=0),
            mock.patch.object(housekeeping.transcripts, "sweep") as transcripts,
        ):
            self.assertEqual([], housekeeping.start_up(connection))
        self.assertEqual(["drain", "planning sweep"], steps)
        transcripts.assert_not_called()

    def test_a_drain_that_spends_the_budget_leaves_the_sweep_to_its_next_pass(self) -> None:
        later = "no time left; it runs at the next pass"
        with (
            mock.patch.object(
                housekeeping,
                "drain_spool",
                return_value=housekeeping.ingest.DrainResult(),
            ),
            mock.patch.object(service, "expire_leases") as expire,
        ):
            report = housekeeping.run(mock.Mock(), seconds=-1.0)
        expire.assert_not_called()
        self.assertEqual(
            [
                f"planning sweep leases: {later}",
                f"planning sweep waiting: {later}",
                f"planning sweep subscriptions: {later}",
                f"planning sweep confirmations: {later}",
                "quota retention: no time left; it runs at the next start",
            ],
            report.failures,
        )

    def test_the_lease_expiry_gives_up_quickly_on_a_store_another_writer_holds(self) -> None:
        directory = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.addCleanup(directory.cleanup)
        path = os.path.join(directory.name, "valkama.sqlite3")
        with mock.patch.dict(
            os.environ, {"VALKAMA_DB": path, "HOME": directory.name, "USERPROFILE": directory.name}
        ):
            conn = store.connect()
            self.addCleanup(conn.close)
            # A hold no session proved, quiet for long enough: the lease step has work.
            service.create_planning_space(conn, name="Lease", key="LSE")
            reference = service.create_work_item(conn, space="LSE", title="Held")["reference"]
            service.claim_work_item(conn, reference, author="old")
            conn.execute("UPDATE work_item_events SET created_at = '2020-01-01T00:00:00Z'")
            conn.execute("UPDATE work_items SET updated_at = '2020-01-01T00:00:00Z'")
            conn.commit()
            holder = store.sqlite3.connect(path, isolation_level=None)
            self.addCleanup(holder.close)
            holder.execute("BEGIN EXCLUSIVE")
            started = time.monotonic()
            report = housekeeping.run(conn)
            elapsed = time.monotonic() - started
            holder.execute("ROLLBACK")
            busy = conn.execute("PRAGMA busy_timeout").fetchone()[0]
        self.assertLess(elapsed, housekeeping.START_UP_SECONDS)
        # Each step after the drain that has work gives the held store up on its own.
        self.assertEqual(2, len(report.failures), report.failures)
        self.assertEqual(
            "planning sweep leases: the store is busy; it runs at the next pass",
            report.failures[0],
        )
        self.assertIn("quota retention", report.failures[1])
        self.assertEqual("old", service.get_work_item(conn, reference)["claim_ref"])
        # The connection's own timeout is back for the requests that follow.
        self.assertEqual(5000, busy)


class AbandonedClaimTests(LeaseTestCase):
    """The space's list of claims nobody is behind any more."""

    def setUp(self) -> None:
        super().setUp()
        # Each test's claim starts the item: nothing is at work before somebody holds it.
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

    def test_the_owners_own_claim_is_called_abandoned_when_quiet_too(self) -> None:
        status, _ = self.http(
            self.listener(), "POST", "/api/planning/work-item/claim", {"id": self.reference}
        )
        self.assertEqual(200, status)
        self.assertEqual([], self.abandoned())
        self.conn.execute("UPDATE work_item_events SET created_at = '2020-01-01T00:00:00Z'")
        self.conn.execute("UPDATE work_items SET updated_at = '2020-01-01T00:00:00Z'")
        self.conn.commit()
        self.assertEqual([(self.reference, "unconfirmed")], self.abandoned())


class ExecutorGuardTests(LeaseTestCase):
    def start(self) -> list[str]:
        """Start the held item by hand, the path back to work from blocked still needs.

        A claim starts its item itself, so the item is blocked first, which keeps
        its holder, and then moved back to work.
        """

        service.transition_work_item(self.conn, self.reference, "blocked", reason="waits")
        moved = service.transition_work_item(self.conn, self.reference, "dev")
        self.conn.commit()
        return moved["warnings"]

    def test_an_unconfirmed_claim_starts_the_item_with_a_warning(self) -> None:
        warning = f"{self.reference} starts under a claim by old that no session confirmed"
        claimed = self.claim(None, author="old")
        self.assertEqual({"from": "triage", "to": "dev"}, claimed["started"])
        self.assertEqual([warning], claimed["warnings"])
        self.assertEqual([warning], self.start())

    def test_a_live_lease_starts_the_item_without_one(self) -> None:
        claimed = self.claim(codex(ONE), author="codex")
        self.assertEqual(
            ({"from": "triage", "to": "dev"}, None), (claimed["started"], claimed.get("warnings"))
        )
        self.assertEqual([], self.start())

    def test_a_stale_lease_still_counts_as_the_executor_but_says_so(self) -> None:
        self.claim(codex(ONE), author="codex")
        self.set_session(ONE, status="ended")
        self.assertEqual(
            [f"{self.reference} starts under a stale claim by {held(ONE)}: its session is gone"],
            self.start(),
        )


#: The contract's terms, spelled out: what the sweep tests hold the code to.
QUIET = timedelta(days=3)
MINUTE = timedelta(minutes=1)
FIELD = {"id": "answer", "label": "Answer", "type": "text", "required": True, "options": []}


class SweepTestCase(LeaseTestCase):
    """Holds on items, a clock, and the sweep as `service.expire_leases` runs it.

    Every call goes through a loop that is already running (`started`), so the
    sweep under test is the only one.
    """

    def setUp(self) -> None:
        super().setUp()
        service.set_checklist(self.conn, self.reference, ["one", "two", "three"])
        self.conn.commit()
        self.now = datetime.now(UTC).replace(microsecond=0) + timedelta(seconds=1)

    def at_now(self) -> mock._patch:
        return mock.patch.object(leases, "utc_now", return_value=self.now)

    def sweep(self) -> int:
        with self.at_now():
            released = service.expire_leases(self.conn)
        self.conn.commit()
        return released

    def read(self, reference: str | None = None) -> dict:
        with self.at_now():
            return service.get_work_item(self.conn, reference or self.reference)

    def new_item(self, title: str) -> str:
        reference = str(service.create_work_item(self.conn, space="LSE", title=title)["reference"])
        self.conn.commit()
        return reference

    def take(self, meta: dict | None, reference: str | None = None) -> None:
        answer = self.mcp(
            "claim_work_item",
            {"id": reference or self.reference, "author": "old"},
            meta,
            started=True,
        )
        self.assertNotIn("error", answer)

    def take_step(self, meta: dict | None, index: int, reference: str | None = None) -> None:
        reference = reference or self.reference
        step = service.get_work_item(self.conn, reference)["checklist"][index]
        answer = self.mcp(
            "claim_work_item_checklist_item",
            {"id": reference, "item_id": step["id"], "author": "old"},
            meta,
            started=True,
        )
        self.assertNotIn("error", answer)

    def write(self, meta: dict | None, reference: str | None = None, **groups: object) -> dict:
        """One `apply_work_item_changes` through a running loop; its payload or its error."""

        return self.mcp(
            "apply_work_item_changes",
            {"id": reference or self.reference, "author": "old", **groups},
            meta,
            started=True,
        )

    def tick(
        self, meta: dict | None, index: int, reference: str | None = None, *, done: bool = True
    ) -> None:
        step = service.get_work_item(self.conn, reference or self.reference)["checklist"][index]
        answer = self.write(
            meta, reference, checklist_ticks=[{"item_id": step["id"], "done": done}]
        )
        self.assertNotIn("error", answer)

    def flags(self, reference: str | None = None) -> list[bool]:
        return [step["by_previous_holder"] for step in self.read(reference)["checklist"]]

    def silent(self, session: str, quiet: timedelta) -> None:
        self.set_session(session, last_seen=(self.now - quiet).strftime(SECOND))

    def ended(self, session: str, ago: timedelta) -> None:
        self.set_session(session, status="ended", ended_at=(self.now - ago).strftime(SECOND))

    def quiet_item(self, reference: str, quiet: timedelta) -> None:
        """Date every event of the item, and its last write, `quiet` before the clock."""

        identity = service.get_work_item(self.conn, reference)["work_item_id"]
        moment = (self.now - quiet).strftime(SECOND)
        self.conn.execute(
            "UPDATE work_item_events SET created_at = ? WHERE work_item_id = ?", (moment, identity)
        )
        self.conn.execute(
            "UPDATE work_items SET updated_at = ? WHERE work_item_id = ?", (moment, identity)
        )
        self.conn.commit()

    def ask(self, reference: str | None = None) -> None:
        requests.create(
            self.conn, reference or self.reference, kind="question", prompt="Which?", fields=[FIELD]
        )
        self.conn.commit()

    def holders(self, reference: str | None = None) -> tuple[str, list[str], str]:
        """Who holds the item, who holds each of its steps, and its state."""

        item = self.read(reference)
        return (
            item["claim_ref"],
            [step["claimed_by"] for step in item["checklist"]],
            item["state"]["key"],
        )

    def by_valkama(self, reference: str | None = None) -> list[tuple[str, str]]:
        """What Valkama itself wrote: its releases and the moves they made."""

        return [
            (event["action"], event["detail"])
            for event in self.read(reference)["events"]
            if event["author"] == "valkama"
        ]


class SilenceTests(SweepTestCase):
    """The terms of a lease, read by the sweep."""

    def test_an_end_within_its_grace_waits_and_a_claim_by_number_takes_it_now(self) -> None:
        self.take(codex(ONE))
        self.ended(ONE, timedelta(hours=11, minutes=59))
        self.assertEqual(0, self.sweep())
        self.assertEqual((held(ONE), ["", "", ""], "dev"), self.holders())
        with self.at_now():
            taken = self.claim(codex(TWO), author="codex", started=True)
        self.assertEqual(held(TWO), taken["claim_ref"])
        self.assertEqual(("released", f"session-ended: {held(ONE)}"), self.by_valkama()[0])

    def test_three_days_and_a_minute_of_silence_lapse_and_a_minute_less_does_not(self) -> None:
        other = self.new_item("Still here")
        self.take(codex(ONE))
        self.take(codex(TWO), other)
        self.silent(ONE, QUIET + MINUTE)
        self.silent(TWO, QUIET - MINUTE)
        self.assertEqual(1, self.sweep())
        self.assertEqual(("", ["", "", ""], "ready"), self.holders())
        self.assertEqual(
            [("released", f"lease-expired: {held(ONE)}"), ("transitioned", "ready: lease-expired")],
            self.by_valkama(),
        )
        self.assertEqual((held(TWO), [], "dev"), self.holders(other))
        self.assertEqual("live", self.read(other)["claim_state"])
        self.assertEqual([], self.by_valkama(other))

    def test_an_open_question_stops_the_silence_and_an_end_still_counts(self) -> None:
        elsewhere = self.new_item("No question here")
        self.take(codex(ONE))
        self.take(codex(ONE), elsewhere)
        self.ask()
        self.silent(ONE, timedelta(days=4))
        # The pause is the item's: the same session loses the item nobody asked about.
        self.assertEqual(1, self.sweep())
        self.assertEqual("", self.read(elsewhere)["claim_ref"])
        lease = self.read()["claim"]
        self.assertEqual((held(ONE), "live"), (lease["holder"], lease["state"]))
        self.assertIsNone(lease["expires_at"])
        self.assertEqual([], self.by_valkama())

        self.ended(ONE, timedelta(hours=12, minutes=1))
        self.assertEqual(1, self.sweep())
        self.assertEqual(("", ["", "", ""], "ready"), self.holders())
        self.assertEqual(("released", f"session-ended: {held(ONE)}"), self.by_valkama()[0])

    def test_a_question_past_its_deadline_on_the_lease_clock_stops_nothing(self) -> None:
        # Read by the sweep, a question's deadline is judged by the clock every lease is read
        # against, the one the step takes its time from, not by a second one.
        deadline = datetime.now(UTC) + timedelta(days=1)
        self.now = deadline + timedelta(days=1)
        self.take(codex(ONE))
        requests.create(
            self.conn,
            self.reference,
            kind="question",
            prompt="Which?",
            fields=[FIELD],
            expires_at=deadline.isoformat(),
        )
        self.conn.commit()
        self.silent(ONE, timedelta(days=4))
        self.assertEqual(1, self.sweep())
        self.assertEqual(("", ["", "", ""], "ready"), self.holders())
        self.assertEqual(("released", f"lease-expired: {held(ONE)}"), self.by_valkama()[0])


class StepHoldTests(SweepTestCase):
    """A lease is the session's, and its steps lapse with it."""

    def test_an_item_held_only_by_steps_goes_back_to_the_queue_started(self) -> None:
        self.take_step(codex(ONE), 0)
        self.take_step(codex(ONE), 1)
        self.assertEqual(("", [held(ONE), held(ONE), ""], "dev"), self.holders())
        self.silent(ONE, QUIET + MINUTE)
        self.assertEqual(1, self.sweep())
        self.assertEqual(("", ["", "", ""], "ready"), self.holders())
        self.assertIsNotNone(self.read()["started_at"])
        self.assertEqual(
            [
                ("checklist_released", "one"),
                ("checklist_released", "two"),
                ("transitioned", "ready: lease-expired"),
            ],
            self.by_valkama(),
        )

    def test_a_live_step_of_another_session_keeps_the_item_at_work(self) -> None:
        self.take(codex(ONE))
        self.take_step(codex(TWO), 1)
        self.silent(ONE, timedelta(days=4))
        self.assertEqual(1, self.sweep())
        self.assertEqual(("", ["", held(TWO), ""], "dev"), self.holders())
        self.assertEqual([("released", f"lease-expired: {held(ONE)}")], self.by_valkama())

    def test_a_question_keeps_every_hold_until_a_holder_ends(self) -> None:
        self.take(codex(ONE))
        self.take_step(codex(TWO), 1)
        self.ask()
        self.silent(ONE, timedelta(days=4))
        self.silent(TWO, timedelta(days=4))
        self.assertEqual(0, self.sweep())
        self.assertEqual((held(ONE), ["", held(TWO), ""], "dev"), self.holders())

        self.ended(TWO, timedelta(hours=12, minutes=1))
        self.assertEqual(1, self.sweep())
        self.assertEqual((held(ONE), ["", "", ""], "dev"), self.holders())
        self.assertEqual([("checklist_released", "two")], self.by_valkama())

    def test_a_claim_by_number_releases_the_steps_of_the_lease_it_releases(self) -> None:
        self.take(codex(ONE))
        self.take_step(codex(ONE), 0)
        self.take_step(codex(TWO), 1)
        self.ended(ONE, timedelta(hours=1))
        with self.at_now():
            taken = self.claim(codex(THREE), author="codex", started=True)
        self.assertEqual(held(THREE), taken["claim_ref"])
        self.assertEqual((held(THREE), ["", held(TWO), ""], "dev"), self.holders())
        self.assertEqual(
            [("released", f"session-ended: {held(ONE)}"), ("checklist_released", "one")],
            self.by_valkama(),
        )


class UnprovedHoldTests(SweepTestCase):
    """A hold no session proved ages with its item, the owner's own as well."""

    def setUp(self) -> None:
        super().setUp()
        self.server = self.listener()

    def browser_claim(self, reference: str, **payload: str) -> None:
        status, answer = self.http(
            self.server, "POST", "/api/planning/work-item/claim", {"id": reference, **payload}
        )
        self.assertEqual(200, status, answer)

    def test_every_hold_no_session_proved_lapses_after_three_quiet_days(self) -> None:
        agent = self.reference
        owner, runner, recent, steps = (
            self.new_item(title) for title in ("Owner", "Runner", "Recent", "Steps")
        )
        service.set_checklist(self.conn, steps, ["only"])
        self.conn.commit()
        self.take(None, agent)
        self.browser_claim(owner)
        self.browser_claim(runner, author="codex:executor")
        self.browser_claim(recent)
        self.take_step(None, 0, steps)
        self.assertEqual(
            ["old", "user", "codex:executor", "user", ""],
            [self.read(ref)["claim_ref"] for ref in (agent, owner, runner, recent, steps)],
        )
        for reference in (agent, owner, runner, steps):
            self.quiet_item(reference, QUIET + MINUTE)
        self.quiet_item(recent, QUIET - MINUTE)

        self.assertEqual(4, self.sweep())

        for reference in (agent, owner, runner, steps):
            item = self.read(reference)
            self.assertEqual(
                ("", "ready", [""] * len(item["checklist"])),
                (
                    item["claim_ref"],
                    item["state"]["key"],
                    [step["claimed_by"] for step in item["checklist"]],
                ),
                reference,
            )
            self.assertIsNotNone(item["started_at"], reference)
        released = [e for e in self.read(owner)["events"] if e["action"] == "released"]
        self.assertEqual(
            [("lease-expired: user", "valkama", "valkama")],
            [(e["detail"], e["author"], e["identity"]["source"]) for e in released],
        )
        lapsed = self.read(owner)["lapsed_claim"]
        self.assertEqual(("user", "lease-expired"), (lapsed["holder"], lapsed["reason"]))
        # A release of a step names its text, not its holder: nothing to name here.
        self.assertIsNone(self.read(steps)["lapsed_claim"])
        self.assertEqual(("checklist_released", "only"), self.by_valkama(steps)[0])
        kept = self.read(recent)["claim"]
        self.assertEqual(("user", "unconfirmed"), (kept["holder"], kept["state"]))
        self.assertEqual((self.now + MINUTE).strftime(SECOND), kept["expires_at"])

    def test_an_open_question_stops_the_quiet_of_a_hold_no_session_proved(self) -> None:
        self.browser_claim(self.reference)
        self.ask()
        self.quiet_item(self.reference, timedelta(days=4))
        self.assertEqual(0, self.sweep())
        lease = self.read()["claim"]
        self.assertEqual(("user", "unconfirmed"), (lease["holder"], lease["state"]))
        self.assertIsNone(lease["expires_at"])

    def test_a_claim_by_number_takes_a_lapsed_unproved_claim_without_force(self) -> None:
        self.take(None)
        self.quiet_item(self.reference, QUIET + MINUTE)
        with self.at_now():
            taken = self.claim(codex(TWO), author="codex", started=True)
        self.assertEqual(held(TWO), taken["claim_ref"])
        self.assertEqual(("released", "lease-expired: old"), self.by_valkama()[0])


#: What the guard says of an item with one tick a lapsed holder made.
ONE_UNCONFIRMED = (
    "[previous_holder] LSE-1 has 1 step(s) ticked by a holder whose lease lapsed:"
    " tick them again to confirm them, or reopen them"
)
SUMMARY = {"done": "All three steps.", "next": "Nothing."}


class PreviousHolderTests(SweepTestCase):
    """A lapsed holder's ticks wait for a confirmation."""

    def refusal(self, answer: dict) -> str:
        """The guard refusal a batch's transition met, as the error names it."""

        error = json.loads(answer["error"])["error"]
        self.assertEqual(("workflow_guard", "transition"), (error["code"], error["step"]["group"]))
        return str(error["message"]).removeprefix("transition: ")

    def lapse_after_ticks(self) -> None:
        """The item: B ticked step 2 earlier, A holds the item and ticked step 1, then ended."""

        self.tick(codex(TWO), 1)
        self.take(codex(ONE))
        self.tick(codex(ONE), 0)
        self.ended(ONE, timedelta(hours=12, minutes=1))

    def test_the_sweep_marks_the_lapsed_holders_ticks_and_a_close_needs_them_again(
        self,
    ) -> None:
        self.lapse_after_ticks()
        self.assertEqual(1, self.sweep())
        item = self.read()
        self.assertEqual(("", "ready"), (item["claim_ref"], item["state"]["key"]))
        self.assertIsNotNone(item["started_at"])
        [release] = [e for e in item["events"] if e["action"] == "released"]
        self.assertEqual(
            (f"session-ended: {held(ONE)}", "valkama", "valkama"),
            (release["detail"], release["author"], release["identity"]["source"]),
        )
        self.assertEqual([True, False, False], self.flags())
        self.assertEqual([held(ONE), held(TWO), ""], [s["done_by"] for s in item["checklist"]])

        self.take(codex(THREE))
        self.tick(codex(THREE), 2)
        close = {"summary": SUMMARY, "transition": {"state": "completed"}}
        self.assertEqual(ONE_UNCONFIRMED, self.refusal(self.write(codex(THREE), **close)))
        self.assertEqual("dev", self.read()["state"]["key"])  # the refused batch wrote nothing

        self.tick(codex(THREE), 0)
        step = self.read()["checklist"][0]
        self.assertEqual((False, held(THREE)), (step["by_previous_holder"], step["done_by"]))
        self.assertNotIn("error", self.write(codex(THREE), **close))
        self.assertEqual("completed", self.read()["state"]["category"])

    def test_a_claim_by_number_in_the_grace_marks_the_same_ticks(self) -> None:
        self.lapse_after_ticks()
        self.ended(ONE, timedelta(hours=11, minutes=59))
        self.assertEqual(0, self.sweep())
        self.assertEqual([False, False, False], self.flags())
        with self.at_now():
            self.assertEqual(held(THREE), self.claim(codex(THREE), started=True)["claim_ref"])
        self.assertEqual([True, False, False], self.flags())

    def test_a_blocked_task_keeps_its_state_and_its_holders_ticks_are_marked(self) -> None:
        self.take(codex(ONE))
        self.tick(codex(ONE), 0)
        blocked = self.write(codex(ONE), transition={"state": "blocked", "reason": "Waiting."})
        self.assertNotIn("error", blocked)
        self.silent(ONE, QUIET + MINUTE)
        self.assertEqual(1, self.sweep())
        self.assertEqual(("", ["", "", ""], "blocked"), self.holders())
        self.assertEqual([True, False, False], self.flags())

    def test_a_live_step_holder_stays_and_the_lapsed_claims_ticks_are_marked(self) -> None:
        self.take(codex(ONE))
        self.tick(codex(ONE), 0)
        self.take_step(codex(TWO), 1)
        self.silent(ONE, timedelta(days=4))
        self.assertEqual(1, self.sweep())
        self.assertEqual(("", ["", held(TWO), ""], "dev"), self.holders())
        self.assertEqual([True, False, False], self.flags())

    def test_force_carries_review_past_the_guard_and_records_it(self) -> None:
        self.lapse_after_ticks()
        self.sweep()
        self.take(codex(THREE))
        self.tick(codex(THREE), 2)
        move = {"state": "review", "to_check": "All three steps hold."}
        review = {"summary": SUMMARY, "transition": move}
        self.assertEqual(ONE_UNCONFIRMED, self.refusal(self.write(codex(THREE), **review)))
        forced = self.write(codex(THREE), summary=SUMMARY, transition={**move, "force": True})
        self.assertEqual(["previous_holder"], forced["overridden"])
        item = self.read()
        self.assertEqual("review", item["state"]["category"])
        self.assertIn(
            ("overridden", "previous_holder"),
            [(event["action"], event["detail"]) for event in item["events"]],
        )
        self.assertEqual([True, False, False], self.flags())

    def test_a_cancelled_close_is_not_asked_to_confirm(self) -> None:
        self.lapse_after_ticks()
        self.sweep()
        cancel = {"summary": SUMMARY, "transition": {"state": "cancelled"}}
        self.assertNotIn("error", self.write(codex(THREE), **cancel))

    def test_setting_the_steps_again_keeps_the_mark_and_a_reopen_clears_it(self) -> None:
        self.lapse_after_ticks()
        self.sweep()
        before = self.read()["checklist"]
        kept = service.set_checklist(self.conn, self.reference, ["one", "two", "three", "four"])
        self.conn.commit()
        self.assertEqual(
            [(s["id"], s["by_previous_holder"]) for s in before],
            [(s["id"], s["by_previous_holder"]) for s in kept["checklist"][:3]],
        )
        self.assertFalse(kept["checklist"][3]["by_previous_holder"])
        self.tick(codex(THREE), 0, done=False)
        self.assertEqual([False, False, False, False], self.flags())

    def test_the_record_says_whose_claim_lapsed_until_the_next_claim(self) -> None:
        released = self.new_item("Released by its holder")
        self.take(codex(TWO), released)
        self.assertNotIn("error", self.claim(codex(TWO), id=released, release=True, started=True))
        self.lapse_after_ticks()
        self.sweep()
        item = self.read()
        [release] = [e for e in item["events"] if e["action"] == "released"]
        lapsed = {"holder": held(ONE), "reason": "session-ended", "at": release["at"]}
        self.assertEqual(lapsed, item["lapsed_claim"])
        with self.at_now():
            rows = {
                row["reference"]: row for row in service.list_work_items(self.conn, space="LSE")
            }
        self.assertEqual(lapsed, rows[self.reference]["lapsed_claim"])
        self.assertIsNone(rows[released]["lapsed_claim"])
        self.assertIsNone(self.read(released)["lapsed_claim"])

        self.take(codex(THREE))
        self.assertIsNone(self.read()["lapsed_claim"])
        self.assertNotIn("error", self.claim(codex(THREE), release=True, started=True))
        self.assertIsNone(self.read()["lapsed_claim"])

    def test_the_card_carries_the_lapsed_claim_the_marks_and_the_queue_and_project_fields(
        self,
    ) -> None:
        """The default read, the card, says what the record says of the queue, lease and projects."""

        self.lapse_after_ticks()
        self.sweep()
        with self.at_now():
            card = mcp_surface.call_tool(self.conn, "get_work_item", {"id": self.reference})
        item = self.read()
        self.assertIsNotNone(item["lapsed_claim"])
        for name in ("withheld", "projects", "lapsed_claim"):
            with self.subTest(field=name):
                self.assertEqual(item[name], card[name])
        # The mark stands on the card only where a previous holder ticked the step.
        self.assertEqual(
            [True, None, None], [step.get("by_previous_holder") for step in card["checklist"]]
        )

    def test_a_closed_item_names_no_lapsed_claim(self) -> None:
        self.lapse_after_ticks()
        self.sweep()
        self.assertIsNotNone(self.read()["lapsed_claim"])
        cancel = {"summary": SUMMARY, "transition": {"state": "cancelled"}}
        self.assertNotIn("error", self.write(codex(THREE), **cancel))
        self.assertIsNone(self.read()["lapsed_claim"])


if __name__ == "__main__":
    unittest.main()
