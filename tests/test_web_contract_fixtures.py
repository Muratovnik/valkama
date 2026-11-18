"""The server's real answers, kept as fixtures the web's strict schemas read.

The browser suite runs against mocked routes, so it cannot see the server drift
from what the web accepts. This module builds a temporary store through the
real service, MCP and HTTP layers, reads it the way the web and an agent do,
and keeps those answers under `web/tests/fixtures/server/`.
`web/tests/serverFixtures.test.ts` validates each with the validators the
card and the question views use.

The test fails when the committed fixtures differ from what the server answers
now, so a change to an answer forces a fixture refresh, and the refresh is what
puts the change in front of the web's schemas:

    python -m tests.test_web_contract_fixtures --write

Every value that changes from run to run is normalized: each UUID becomes a
fixed one in the order it first appears, each timestamp one fixed instant in
the format it was written in, and the temporary directory a fixed path.
"""

from __future__ import annotations

import ast
import http.client
import json
import os
import re
import sqlite3
import sys
import tempfile
import threading
import unittest
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from functools import partial
from pathlib import Path
from unittest import mock
from urllib.parse import urlencode

from server import http_surface, mcp_surface, session_open, sessions, store
from server.analytics import quota as analytics_quota
from server.hooks import ingest, normalize
from server.ops import doctor, git_hook, url_schemes
from server.planning import calls, read_model, requests, service, subscriptions
from server.projects import project_registry
from server.quota import samples
from server.store_identity.metadata import read_store_metadata
from server.store_identity.refs import planning_space_entity
from tests.registry_fixtures import project_entry, registry_bytes
from tests.test_planning_questions import BOOLEAN, CHOICE, MULTI, TEXT

FIXTURES = Path(__file__).resolve().parents[1] / "web" / "tests" / "fixtures" / "server"
PROJECT = "example-project"
SPACE = "MAIN"
_UUID = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")
_ISO = re.compile(r"^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(\.\d+)?(Z|[+-]\d{2}:\d{2})$")
_INSTANT = "2026-01-02T03:04:05"
# A day alone, as a chain's series names today.
_DAY = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def _uri_path(root: Path) -> str:
    return root.as_uri().removeprefix("file:///")


class _Normalizer:
    """Rewrites what changes between runs into fixed values, the same across files."""

    def __init__(self, root: Path) -> None:
        self.root = root
        self.uuids: dict[str, str] = {}

    def __call__(self, value: object) -> object:
        if isinstance(value, dict):
            # A key can be an id too: the read model's live work is keyed by its items' ids.
            return {self.text(key): self(found) for key, found in value.items()}
        if isinstance(value, list):
            return [self(found) for found in value]
        if isinstance(value, str):
            return self.text(value)
        return value

    def text(self, value: str) -> str:
        found = _ISO.match(value)
        if found is not None:
            fraction = found.group(2) or ""
            return _INSTANT + ("." + "0" * (len(fraction) - 1) if fraction else "") + found.group(3)
        if _DAY.match(value):
            return _INSTANT[:10]
        # As a path and as a link encodes it; the plan names both.
        for spelling in (str(self.root), self.root.as_posix(), _uri_path(self.root)):
            value = value.replace(spelling, "/workspace")
        if value.startswith("/workspace"):
            value = value.replace("\\", "/")
        return _UUID.sub(self.uuid, value)

    def uuid(self, found: re.Match[str]) -> str:
        if found.group(0) not in self.uuids:
            self.uuids[found.group(0)] = f"00000000-0000-4000-8000-{len(self.uuids) + 1:012d}"
        return self.uuids[found.group(0)]


class _Scenario:
    """One store with threads and questions in every state a card shows."""

    def __init__(self, root: Path) -> None:
        self.root = root
        #: The goal, the stage and the task done under the goal that `tree` files.
        self.tree_refs: dict[str, str] = {}
        conn = store.connect()
        try:
            service.create_planning_space(conn, name="Contract", key=SPACE)
            self.reference = str(
                service.create_work_item(conn, space=SPACE, title="Contract card")["reference"]
            )
            conn.commit()
            self.space_ref = {
                "data_scope_id": read_store_metadata(conn)["data_scope_id"],
                "space_key": SPACE,
            }
        finally:
            conn.close()
        entry = project_entry(PROJECT, root)
        entry["planning_binding"] = planning_space_entity(self.space_ref)
        (root / "projects.json").write_bytes(registry_bytes([entry]))
        self.server = http_surface.PlatformHTTPServer(
            ("127.0.0.1", 0), http_surface.Handler, token_path=root / "installation-token"
        )
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def close(self) -> None:
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(2)

    def http(self, path: str, payload: dict | None = None) -> dict:
        """A call as the browser makes it, which binds the call to the interface."""

        client = http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=10)
        try:
            client.request(
                "GET" if payload is None else "POST",
                path,
                body=None if payload is None else json.dumps(payload),
                headers={
                    "Content-Type": "application/json",
                    "Origin": f"http://127.0.0.1:{self.server.server_port}",
                    "Sec-Fetch-Site": "same-origin",
                    "X-Valkama-Session": self.server.security_context.browser_session_token,
                },
            )
            response = client.getresponse()
            answer = json.loads(response.read())
        finally:
            client.close()
        if response.status != 200:
            raise AssertionError(f"{path} answered {response.status}: {answer}")
        return answer

    def refusal(self, path: str) -> dict:
        """A call the server must refuse, as the browser makes it."""

        client = http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=10)
        try:
            client.request(
                "GET",
                path,
                headers={
                    "Origin": f"http://127.0.0.1:{self.server.server_port}",
                    "Sec-Fetch-Site": "same-origin",
                },
            )
            response = client.getresponse()
            answer = json.loads(response.read())
        finally:
            client.close()
        if response.status < 400:
            raise AssertionError(f"{path} answered {response.status}: {answer}")
        return answer

    def documents(self) -> dict[str, dict]:
        """The document routes, with what a path in a text can come to."""

        (self.root / "docs").mkdir()
        (self.root / "docs" / "plan.md").write_bytes(b"# Plan\n")
        (self.root / "docs" / "a.ts").write_bytes(b"a\n")
        space = planning_space_entity(self.space_ref)["resource_id"]
        paths = ["docs/plan.md", "docs/a.ts", "docs", "docs/gone.md", "../outside.md", "CON"]
        asked = urlencode([("space", space), *(("path", path) for path in paths)])
        document = urlencode({"project": PROJECT, "path": "docs/plan.md"})
        return {
            "documents-resolve": self.http(f"/api/documents/resolve?{asked}"),
            "documents-resolve-unbound": self.http("/api/documents/resolve?path=docs%2Fplan.md"),
            "documents-read": self.http(f"/api/documents/read?{document}"),
            "documents-search": self.http(
                f"/api/documents/search?{urlencode({'space': space, 'q': 'plan'})}"
            ),
            "documents-refused": self.refusal(
                f"/api/documents/read?{urlencode({'project': 'no-such-project', 'path': 'a.md'})}"
            ),
        }

    def tool(self, name: str, **arguments: object) -> dict:
        """A call as an agent makes it, through the MCP surface."""

        conn = store.connect()
        try:
            answer = mcp_surface.call_tool(conn, name, arguments)
            conn.commit()
        finally:
            conn.close()
        assert isinstance(answer, dict)
        return answer

    def scope(self, **others: str) -> str:
        return urlencode(
            {
                "scope_kind": "space",
                "data_scope_id": self.space_ref["data_scope_id"],
                "space_key": SPACE,
                **others,
            }
        )

    def subscriber(self, ref: str) -> None:
        """An agent of another session follows the card it holds nothing of."""

        conn = store.connect()
        try:
            follower = calls.Identity(
                state=calls.CONFIRMED,
                source=calls.CODEX_META,
                session_id="6f1c2a8e-0000-4000-8000-0000000000f5",
                agent_id="c6f4e0a3b2d1c519",
                client="codex",
            )
            with calls.bind(follower, "apply_work_item_changes"):
                subscriptions.subscribe(conn, read_model.item_row(conn, ref), True)
            conn.commit()
        finally:
            conn.close()

    def goal_card(self) -> dict:
        """A goal's card naming who works on it: its creator, and a holder under a stage."""

        def who(identity: str, agent: str | None = None) -> calls.Identity:
            return calls.Identity(
                state=calls.CONFIRMED,
                source=calls.CLAUDE_HOOK,
                session_id=identity,
                agent_id=agent,
                tool_use_id="t",
                client="claude-code",
            )

        creator = "6f1c2a8e-0000-4000-8000-0000000000e1"
        holder = "6f1c2a8e-0000-4000-8000-0000000000e2"
        conn = store.connect()
        try:
            with calls.bind(who(creator, "a7c3e9f1d2b4a608"), "create_work_item"):
                goal = str(
                    service.create_work_item(
                        conn, space=SPACE, title="Goal with participants", kind="goal"
                    )["reference"]
                )
            stage = service.create_work_item(
                conn, space=SPACE, title="Its stage", kind="stage", parent=goal
            )["reference"]
            task = service.create_work_item(conn, space=SPACE, title="Its task", parent=stage)
            with calls.bind(who(holder), "claim_work_item"):
                service.claim_work_item(conn, str(task["reference"]))
            conn.commit()
        finally:
            conn.close()
        return self.http(f"/api/modules/planning/work-item?{self.scope(reference=goal)}")

    def session_gone(self) -> dict:
        """A request one session asked of another, read after the one asked ended."""

        def who(identity: str) -> calls.Identity:
            return calls.Identity(
                state=calls.CONFIRMED,
                source=calls.CLAUDE_HOOK,
                session_id=identity,
                tool_use_id="t",
                client="claude",
            )

        asker = "6f1c2a8e-0000-4000-8000-0000000000a1"
        asked = "6f1c2a8e-0000-4000-8000-0000000000a2"
        conn = store.connect()
        try:
            ref = str(
                service.create_work_item(conn, space=SPACE, title="Asked of a session")["reference"]
            )
            with calls.bind(who(asked), "claim_work_item"):
                service.claim_work_item(conn, ref)
            with calls.bind(who(asker), "create_work_item_request"):
                [request] = requests.ask_sessions(
                    conn, ref, sessions=[asked], prompt="May it be cancelled?", fields=[CHOICE]
                )
            conn.commit()
            sessions.op_ingest_session_event(
                conn, {"event": "session_end", "session_id": asked, "client": "claude"}
            )
            conn.commit()
        finally:
            conn.close()
        return self.http(f"/api/modules/planning/request?{self.scope(id=request['request_id'])}")

    def put_off(self) -> dict[str, dict]:
        """A card put off until another item, and one that came back when the item it
        waited on was deleted."""

        made = [
            str(self.tool("create_work_item", space=SPACE, title=title)["reference"])
            for title in ("Put off card", "Awaited card", "Came back card", "Dropped card")
        ]
        waiting, awaited, back, dropped = made
        for ref, until in ((waiting, awaited), (back, dropped)):
            self.http(
                "/api/planning/work-item/apply",
                {"id": ref, "defer": {"until": until, "reason": "Waits for the other card."}},
            )
        self.http("/api/planning/work-item/delete", {"id": dropped})
        return {
            "card-deferred": self.http(
                f"/api/modules/planning/work-item?{self.scope(reference=waiting)}"
            ),
            "card-returned": self.http(
                f"/api/modules/planning/work-item?{self.scope(reference=back)}"
            ),
        }

    def converted(self) -> dict[str, dict]:
        """A bug at work converted into a goal, read as the card reads the goal it became.

        The goal keeps the bug's steps and its kind as a label, and the work under way
        goes on in the task it left under it.
        """

        bug = str(
            self.tool(
                "create_work_item", space=SPACE, title="Converted card", kind="bug", claim=True
            )["reference"]
        )
        self.tool(
            "apply_work_item_changes", id=bug, checklist=[{"text": "Found", "done": True}, "Fix"]
        )
        self.tool("apply_work_item_changes", id=bug, convert={"to": "goal"})
        return {
            "card-converted": self.http(
                f"/api/modules/planning/work-item?{self.scope(reference=bug)}"
            )
        }

    def executor_card(self) -> dict:
        """A card whose claim, steps and agents each name an executor."""

        session = "6f1c2a8e-0000-4000-8000-000000000001"
        finished = "6f1c2a8e-0000-4000-8000-000000000002"

        def who(identity: str, agent: str | None = None) -> calls.Identity:
            return calls.Identity(
                state=calls.CONFIRMED,
                source=calls.CLAUDE_HOOK,
                session_id=identity,
                agent_id=agent,
                tool_use_id="t",
                client="claude",
            )

        conn = store.connect()
        try:
            ref = str(
                service.create_work_item(conn, space=SPACE, title="Card with executors")[
                    "reference"
                ]
            )
            service.set_checklist(conn, ref, ["An agent's", "A person's", "A digest's"])
            agent, person, digest = service.get_work_item(conn, ref)["checklist"]
            with calls.bind(who(session), "claim_work_item"):
                service.claim_work_item(conn, ref)
            with calls.bind(who(session, "a4d2c8f1e0b3a297"), "claim_work_item_checklist_item"):
                service.claim_checklist_item(conn, ref, agent["id"])
            service.claim_checklist_item(conn, ref, person["id"], author="the owner")
            with calls.bind(who("session-" + "x" * 50), "claim_work_item_checklist_item"):
                service.claim_checklist_item(conn, ref, digest["id"])
            with calls.bind(who(finished, "b5e3d9a2f1c4b308"), "comment_work_item"):
                service.comment_work_item(conn, ref, "From an agent of a finished session.")
            for identity, opened_in, opened_host in (
                (session, "ide", "vscode"),
                (finished, "app", "claude-desktop"),
            ):
                sessions.record_place(
                    conn,
                    identity,
                    opened_in=opened_in,
                    opened_host=opened_host,
                    opened_folder="",
                    host_session_id="",
                    current=True,
                )
            conn.execute("UPDATE sessions SET status = 'ended' WHERE id = ?", (finished,))
            conn.commit()
        finally:
            conn.close()
        # A person's comment here that tells the contract card, which then reads its record.
        self.http(
            "/api/planning/work-item/comment",
            {
                "id": ref,
                "body": "Decided to keep the old route; the contract card can drop it.",
                "author": "user",
                "mentions": [self.reference],
            },
        )
        return self.http(f"/api/modules/planning/work-item?{self.scope(reference=ref)}")

    def usage(self) -> dict[str, dict]:
        """The usage reads of the card: a priced row, a row of a model with no price, no item."""

        session = "sess-usage"
        conn = store.connect()
        try:
            item = str(read_model.item_row(conn, self.reference)["work_item_id"])
            runs = {}
            for agent in ("", "worker"):
                runs[agent] = conn.execute(
                    "INSERT INTO usage_runs(session_id, agent_id, client, path, first_at, last_at,"
                    " read_at) VALUES (?, ?, 'claude', 'transcript.jsonl', ?, ?, ?)",
                    (
                        session,
                        agent,
                        *("2026-11-10T10:00:00.000Z",) * 2,
                        "2026-11-10T11:00:00.000Z",
                    ),
                ).lastrowid
            for agent, model, work_item, signal, start, cost, tokens in (
                (
                    "",
                    "claude-opus-5-5",
                    item,
                    "next_write",
                    "10:00",
                    0.25,
                    (1000, 20000, 300, None, 400, None),
                ),
                (
                    "worker",
                    "claude-unknown-9",
                    item,
                    "held_step",
                    "10:05",
                    None,
                    (50, None, None, None, 7, 2),
                ),
                ("", "claude-opus-5-5", None, None, "10:20", 0.01, (10, None, None, None, 1, None)),
            ):
                conn.execute(
                    "INSERT INTO usage_segments(run_id, session_id, agent_id, model, started_at,"
                    " ended_at, seconds, work_item_id, signal, input_tokens, cached_read_tokens,"
                    " cache_write_5m_tokens, cache_write_1h_tokens, output_tokens, reasoning_tokens,"
                    " estimated_api_cost_usd, price_book, quality)"
                    " VALUES (?, ?, ?, ?, ?, ?, 600, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'observed')",
                    (
                        runs[agent],
                        session,
                        agent,
                        model,
                        f"2026-11-10T{start}:00.000Z",
                        f"2026-11-10T{start[:3]}{int(start[3:]) + 10:02d}:00.000Z",
                        work_item,
                        signal,
                        *tokens,
                        cost,
                        None if cost is None else "2026-11-10",
                    ),
                )
            self.seats(conn, item)
            conn.commit()
        finally:
            conn.close()
        return {
            "usage-item": self.http(
                f"/api/planning/work-item/usage?{urlencode({'id': self.reference, 'scope': 'item'})}"
            ),
            "usage-session": self.http(
                f"/api/planning/session/usage?{urlencode({'session_id': session})}"
            ),
            # The Analytics read of the same rows: two of the caller's days, by item and
            # model, beside the two days before.
            "analytics-usage": self.http(
                "/api/analytics/usage?"
                + urlencode(
                    {
                        "from": "2026-11-09",
                        "to": "2026-11-11",
                        "utc_offset": "180",
                        "group_by": "work_item,model",
                        "compare": "true",
                    }
                )
            ),
            # The day after, by the seat: an account, a seat no account names, unknown.
            "analytics-usage-seat": self.http(
                "/api/analytics/usage?"
                + urlencode(
                    {
                        "from": "2026-11-12",
                        "to": "2026-11-13",
                        "utc_offset": "180",
                        "group_by": "seat",
                    }
                )
            ),
        }

    @staticmethod
    def seats(conn: sqlite3.Connection, item: str) -> None:
        """A session's work on 2026-11-12, after the days the reads above cover: on the seat
        an account's poll names, then on one no account names, then for no organization.
        Its run's last record is the card's, so the reads above say the same. Its stretch on
        the account's seat is the card's, so the card's read has a week of quota."""

        session, organization = "sess-seat", "org-fixture"
        run = conn.execute(
            "INSERT INTO usage_runs(session_id, agent_id, client, path, first_at, last_at,"
            " read_at) VALUES (?, '', 'claude', 'seat.jsonl', ?, ?, ?)",
            (session, *("2026-11-10T10:00:00.000Z",) * 2, "2026-11-10T11:00:00.000Z"),
        ).lastrowid
        for start, end, held, work_item in (
            # What the session worked for, before the day read.
            ("2026-11-11T20:00:00.000Z", "2026-11-11T20:00:00.000Z", organization, None),
            ("2026-11-12T09:00:00.000Z", "2026-11-12T09:10:00.000Z", organization, item),
            ("2026-11-12T09:20:00.000Z", "2026-11-12T09:30:00.000Z", organization, None),
            ("2026-11-12T09:40:00.000Z", "2026-11-12T09:50:00.000Z", None, None),
        ):
            conn.execute(
                "INSERT INTO usage_segments(run_id, session_id, agent_id, model, started_at,"
                " ended_at, seconds, work_item_id, input_tokens, output_tokens,"
                " estimated_api_cost_usd, price_book, quality, organization)"
                " VALUES (?, ?, '', 'claude-opus-5-5', ?, ?, 600, ?, 10, 1, 0.01, '2026-11-10',"
                " 'observed', ?)",
                (run, session, start, end, work_item, held),
            )
        for at, source, owner, account, seat in (
            ("2026-11-12T08:00:00.000Z", "poll", organization, "acct-fixture", "week:2026-11-16T09:00Z"),
            ("2026-11-12T08:30:00.000Z", "mod", None, None, "week:2026-11-16T09:00Z"),
            ("2026-11-12T09:15:00.000Z", "mod", None, None, "week:2026-11-17T19:00Z"),
        ):  # fmt: skip
            conn.execute(
                "INSERT INTO quota_samples(at, source, organization, session_id, account_uuid,"
                " seat, kind, percent) VALUES (?, ?, ?, ?, ?, ?, 'week', 40)",
                (at, source, owner, None if owner else session, account, seat),
            )

    def quota(self) -> dict:
        """The quota read as of a fixed moment: every kind of window, no source, a seat.

        One account read by the poll: its five hours twice and fresh, its week and a
        model's week silent, and its usage credits. An organization that worked with no
        source, and a session's account known by its seat alone. The read is held at
        `moment`, which every reading is placed before, so its paces stay the same.
        """

        moment = datetime(2026, 11, 10, 10, 0, tzinfo=UTC)

        def ago(**span: float) -> str:
            return (moment - timedelta(**span)).isoformat()

        five_reset = (moment + timedelta(hours=2)).isoformat()
        week_reset = (moment + timedelta(days=3)).isoformat()
        week_seat = samples.seat_for_week(week_reset)
        seat_reset = (moment + timedelta(days=5)).isoformat()
        organization = "6f1c2a8e-0000-4000-8000-0000000000a1"
        account = "0b7d4e19-0000-4000-8000-0000000000a2"
        conn = store.connect()
        try:
            run = conn.execute(
                "INSERT INTO usage_runs(session_id, agent_id, client, path, first_at, last_at,"
                " read_at) VALUES ('sess-quota', '', 'claude', 'quota.jsonl', ?, ?, ?)",
                (ago(hours=3), ago(hours=1), ago(hours=1)),
            ).lastrowid
            for session, worked_for in (
                ("sess-quota", "6f1c2a8e-0000-4000-8000-0000000000b1"),
                ("sess-seat", "6f1c2a8e-0000-4000-8000-0000000000c1"),
            ):
                conn.execute(
                    "INSERT INTO usage_segments(run_id, session_id, agent_id, model, started_at,"
                    " ended_at, seconds, organization, quality)"
                    " VALUES (?, ?, '', 'model-a', ?, ?, 600, ?, 'observed')",
                    (run, session, ago(hours=3), ago(hours=1), worked_for),
                )
            readings = (
                samples.Reading(
                    "poll",
                    ago(hours=1),
                    (
                        samples.Window("five_hour", 20.0, five_reset),
                        samples.Window("week", 41.0, week_reset),
                        samples.Window("week_model", 12.5, week_reset, model="model-a"),
                        samples.Window("extra_usage", None, None, amount=4.0, currency="USD"),
                    ),
                    week_seat,
                    organization=organization,
                    account_uuid=account,
                    plan="Max",
                ),
                samples.Reading(
                    "poll",
                    ago(minutes=5),
                    (samples.Window("five_hour", 50.0, five_reset),),
                    week_seat,
                    organization=organization,
                    account_uuid=account,
                    plan="Max",
                ),
                samples.Reading(
                    "statusline",
                    ago(minutes=2),
                    (samples.Window("week", 64.0, seat_reset),),
                    samples.seat_for_week(seat_reset),
                    session_id="sess-seat",
                ),
            )
            for reading in readings:
                samples.record(conn, reading, now=moment)
            conn.commit()
        finally:
            conn.close()
        with mock.patch.object(analytics_quota, "read", partial(analytics_quota.read, now=moment)):
            return self.http("/api/analytics/quota?utc_offset=180")

    def live_frame(self) -> dict:
        """The frame a pin answers with: the pinned card, a waiting row, a quiet one under a goal."""

        quiet = "6f1c2a8e-0000-4000-8000-000000000004"
        conn = store.connect()
        try:
            goal = str(
                service.create_work_item(conn, space=SPACE, title="Live goal", kind="goal")[
                    "reference"
                ]
            )
            task = str(
                service.create_work_item(conn, space=SPACE, title="Quiet task", parent=goal)[
                    "reference"
                ]
            )
            with calls.bind(
                calls.Identity(
                    state=calls.CONFIRMED,
                    source=calls.CLAUDE_HOOK,
                    session_id=quiet,
                    tool_use_id="t",
                    client="claude",
                ),
                "claim_work_item",
            ):
                service.claim_work_item(conn, task)
            sessions.record_place(
                conn,
                quiet,
                opened_in="terminal",
                opened_host="",
                opened_folder="",
                host_session_id="",
                current=True,
            )
            # Silent for two days: past the day that makes a row quiet, within the lease.
            conn.execute(
                "UPDATE sessions SET last_seen = strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '-2 days')"
                " WHERE id = ?",
                (quiet,),
            )
            # A session on no item, waiting since its turn ended, named by its transcript.
            apart = "6f1c2a8e-0000-4000-8000-000000000005"
            transcript = self.root / "apart.jsonl"
            transcript.write_bytes(b'{"type":"ai-title","aiTitle":"Contract session"}\n')
            for number, event in enumerate(("session-start", "user-prompt-submit", "stop")):
                record = normalize.lifecycle_event(
                    "claude",
                    event,
                    {
                        "session_id": apart,
                        "cwd": str(self.root / "checkout"),
                        "transcript_path": str(transcript),
                    },
                    event_uid=f"6f1c2a8e-0000-4000-8000-00000000010{number}",
                    occurred_at=datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%S.000Z"),
                )
                assert record is not None
                ingest.record(conn, record, delivery="direct")
            conn.commit()
        finally:
            conn.close()
        return self.http("/api/planning/work-item/pin", {"id": self.reference, "pinned": True})

    def tree(self) -> dict[str, object]:
        """Goals and stages with work under them, read as the board, the chain and the finder read.

        An accepted open goal and the stages filed under it stand in no state and derive one
        from the work under them; a goal and a stage not yet accepted stand in triage. The
        board reads the whole space, the chain the goal's tree, and the finder the search.
        """

        conn = store.connect()
        try:

            def item(title: str, **fields: object) -> str:
                return str(
                    service.create_work_item(conn, space=SPACE, title=title, **fields)["reference"]
                )

            goal = item("Tree goal", kind="goal", acceptance="assignment")
            stage = item("Tree stage", kind="stage", parent=goal)
            nested = item("Tree nested stage", kind="stage", parent=stage)
            # The goal and both stages above it read this project from it.
            item("Tree work in the nested stage", parent=nested, projects=[PROJECT])
            item("Tree work under the stage", parent=stage)
            finished = item("Tree work finished under the goal", parent=goal)
            service.set_summary(conn, finished, {"done": "Finished.", "next": "Nothing."})
            service.transition_work_item(conn, finished, "done", acceptance="assignment")
            self.tree_refs = {"goal": goal, "stage": stage, "finished": finished}
            waiting = item("Tree goal not accepted yet", kind="goal")
            loose = item("Tree stage not accepted yet", kind="stage", parent=waiting)
            item("Tree work under the stage not accepted", parent=loose)
            conn.commit()
        finally:
            conn.close()
        # The board reads the whole space: narrowed by its project, it would keep only the
        # items naming it.
        model = self.http(f"/api/planning?{urlencode(self.space_ref)}")
        # A digest of the whole answer, ids and instants included, which change run to run.
        model["revision"] = "0" * 64
        # The workflow's moves stand in the order of their states' ids; put them in the states'.
        position = {state["state_id"]: state["position"] for state in model["workflow"]["states"]}
        model["workflow"]["transitions"].sort(
            key=lambda move: (position[move["from"]], position[move["to"]])
        )
        found = self.http(f"/api/modules/planning/search?{urlencode({'q': 'Tree', 'limit': '50'})}")
        # Equal matches stand in the order of their ids, which change run to run.
        found["items"].sort(key=lambda hit: int(hit["item"]["reference"].split("-")[1]))
        return {
            "planning-read-model": model,
            "planning-chain-tree": self.http(
                f"/api/planning/work-item/chain?{urlencode({'id': goal, 'scope': 'tree'})}"
            ),
            "planning-search": found,
        }

    def volumes(self) -> dict[str, object]:
        """What stands in the space, in its project and in the space filtered to its tasks
        with a label, over the days around today, and what the tree's goal and stage took:
        work on the goal, on a task done and on one cancelled under it, and on a task under
        the stage, one of its rows of no known price."""

        conn = store.connect()
        try:
            goal = self.tree_refs["goal"]
            cancelled = str(
                service.create_work_item(
                    conn, space=SPACE, title="Tree work cancelled under the goal", parent=goal
                )["reference"]
            )
            service.set_summary(conn, cancelled, {"done": "Not needed.", "next": "Nothing."})
            service.transition_work_item(conn, cancelled, "cancelled", acceptance="assignment")
            # Outside goals, a task of the project with a label; and a commit on no card, made
            # now, so the flow's period around today holds it whatever the day.
            service.create_work_item(
                conn,
                space=SPACE,
                title="Work of the project outside goals",
                labels=["ui"],
                projects=[PROJECT],
            )
            made = datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")
            conn.execute(
                "INSERT INTO commits(project_id, hash, subject, committed_at, session_id, client,"
                " reported_at) VALUES (?, ?, 'feat: on no card', ?, 'sess-goal', 'claude', ?)",
                (PROJECT, "c" * 40, made, made),
            )
            under_stage = conn.execute(
                "SELECT work_item_id FROM work_items WHERE title = 'Tree work under the stage'"
            ).fetchone()[0]
            run = conn.execute(
                "INSERT INTO usage_runs(session_id, agent_id, client, path, first_at, last_at,"
                " read_at) VALUES ('sess-goal', '', 'claude', 'goal.jsonl', ?, ?, ?)",
                ("2026-11-14T10:00:00.000Z",) * 3,
            ).lastrowid
            for start, work_item, cost in (
                ("10:00", read_model.item_row(conn, goal)["work_item_id"], 0.5),
                (
                    "10:10",
                    read_model.item_row(conn, self.tree_refs["finished"])["work_item_id"],
                    1.0,
                ),
                ("10:20", read_model.item_row(conn, cancelled)["work_item_id"], 0.25),
                ("10:30", under_stage, None),
            ):
                conn.execute(
                    "INSERT INTO usage_segments(run_id, session_id, model, started_at, ended_at,"
                    " seconds, work_item_id, input_tokens, output_tokens, estimated_api_cost_usd,"
                    " quality) VALUES (?, 'sess-goal', 'claude-opus-5-5', ?, ?, 300, ?, 40, 8, ?,"
                    " 'observed')",
                    (
                        run,
                        f"2026-11-14T{start}:00.000Z",
                        f"2026-11-14T{start[:3]}{int(start[3:]) + 5:02d}:00.000Z",
                        work_item,
                        cost,
                    ),
                )
            conn.commit()
        finally:
            conn.close()
        # Today on the caller's clock, so the work made now falls on the same day of the flow
        # whatever the hour.
        today = (datetime.now(UTC) + timedelta(minutes=180)).date()
        period = {
            "from": (today - timedelta(days=7)).isoformat(),
            "to": (today + timedelta(days=2)).isoformat(),
            "utc_offset": "180",
        }
        return {
            "volumes-space": self.http(f"/api/planning/volumes?{self.scope(**period)}"),
            "volumes-project": self.http(
                f"/api/planning/volumes?{self.scope(project_id=PROJECT, **period)}"
            ),
            # The space's tasks with the label `ui`, of either of two kinds.
            "volumes-filtered": self.http(
                f"/api/planning/volumes?{self.scope(**period)}&"
                + urlencode([("kind", "task"), ("kind", "bug"), ("label", "ui")])
            ),
            "goal-volumes": self.http(
                "/api/planning/goal-volumes?"
                + urlencode([("id", self.tree_refs["goal"]), ("id", self.tree_refs["stage"])])
            ),
        }

    def open_plans(self) -> dict[str, object]:
        """What a click is told to do: each form of a plan, for the files `documents` wrote."""

        session = "6f1c2a8e-0000-4000-8000-000000000001"
        finished = "6f1c2a8e-0000-4000-8000-000000000002"
        silent = "6f1c2a8e-0000-4000-8000-000000000003"
        conn = store.connect()
        try:
            sessions.record_place(
                conn,
                session,
                opened_in="ide",
                opened_host="vscode",
                opened_folder=str(self.root),
                host_session_id="",
                current=True,
            )
            # A client that crashed long ago: its row still says it runs.
            conn.execute(
                "INSERT INTO sessions(id, client, status, opened_in, opened_folder, cwd, last_seen)"
                " VALUES (?, 'claude', 'active', 'terminal', ?, ?, '2020-01-02T03:04:05Z')",
                (silent, str(self.root), str(self.root)),
            )
            conn.commit()
        finally:
            conn.close()

        def plan(**query: str) -> dict:
            return self.http(f"/api/open-plan?{urlencode(query)}")

        where = {"project": PROJECT}
        note = {**where, "target": "file", "path": "docs/a.ts", "line": "4"}
        return {
            "open-places": self.http("/api/open-places"),
            "open-plan-session": plan(target="session", session=session, surface="browser"),
            "open-plan-session-desktop": plan(target="session", session=session, surface="desktop"),
            "open-plan-copy": plan(target="session", session=finished, surface="browser"),
            "open-plan-silent": plan(target="session", session=silent, surface="browser"),
            "open-plan-silent-desktop": plan(target="session", session=silent, surface="desktop"),
            "open-plan-no-session": plan(target="session", session="absent", surface="browser"),
            "open-plan-file": plan(**note, surface="browser"),
            "open-plan-file-desktop": plan(**note, surface="desktop"),
            "open-plan-folder": plan(**where, target="folder", path="docs", surface="browser"),
            "open-plan-refused": plan(**where, target="file", path="../x.md", surface="browser"),
            "open-vocabulary": {
                "places": session_open.OPEN_PLACES,
                "reasons": session_open.REASONS,
                "path_refusals": session_open.PATH_REFUSALS,
                "states": session_open.STATES,
                "steps": session_open.STEP_KINDS,
            },
        }

    def answers(self) -> dict[str, object]:
        """Build the discussion and the questions, then read them as each reader does."""

        ref = self.reference
        told = self.tool("create_work_item", space=SPACE, title="Told card")["reference"]
        agent_root = self.tool(
            "apply_work_item_changes",
            id=ref,
            comment={"body": "The export leaves out claims.", "awaits_reply": True},
        )
        # A person's reply that tells another card, and that card's description telling this one.
        reply = self.http(
            "/api/planning/work-item/comment",
            {
                "id": ref,
                "body": f"Only the claims, the steps are there; {told} has them.",
                "author": "user",
                "reply_to": agent_root["applied"]["comment"]["comment_id"],
                "mentions": [told],
            },
        )
        described = self.http(
            "/api/planning/work-item/update",
            {"id": told, "description": f"Waits on {ref} first.", "mentions": [ref]},
        )
        self.tool(
            "apply_work_item_changes",
            id=ref,
            comment={"body": "Then the claims go in next.", "reply_to": reply["comment_id"]},
        )
        resolved = self.http(
            "/api/planning/work-item/comment",
            {"id": ref, "body": "Is the old route still served?", "author": "user"},
        )
        mark = self.http(
            "/api/planning/work-item/comment/resolve",
            {
                "id": ref,
                "comment_id": resolved["comment_id"],
                "resolution": "Moved to MAIN-14",
                "author": "user",
            },
        )
        asked = self.tool(
            "create_work_item_request",
            id=ref,
            kind="decision",
            prompt="Which path do the comments take?",
            fields=[CHOICE, MULTI, BOOLEAN],
            author="asking-agent",
        )
        first = self.http(
            "/api/planning/request/answer",
            {
                "id": asked["request_id"],
                "expected_revision": asked["revision"],
                "author": "user",
                "answers": {"path": "drop", "areas": ["api"]},
                "note": "For now.",
            },
        )
        self.tool(
            "answer_work_item_request",
            id=asked["request_id"],
            change=True,
            expected_revision=first["revision"],
            author="codex",
            answers={"path": "keep", "areas": ["api", "web"]},
            own={"sure": "Once the export carries them"},
            field_notes={"path": "It costs nothing now"},
            note="The owner asked for the change.",
        )
        self.tool(
            "apply_work_item_changes",
            id=ref,
            comment={
                "body": "Does the second option include the docs?",
                "reply_to_request": asked["request_id"],
            },
        )
        self.http(
            "/api/planning/work-item/comment",
            {
                "id": ref,
                "body": "Yes, the docs too.",
                "author": "user",
                "reply_to_request": asked["request_id"],
            },
        )
        pending = self.tool(
            "create_work_item_request",
            id=ref,
            kind="question",
            prompt="Why does the card read flat?",
            fields=[TEXT],
            author="asking-agent",
        )
        # A list under an agent's comment: a question with the comment it stands under.
        self.tool(
            "apply_work_item_changes",
            id=ref,
            comment={
                "body": "Two places misfire.",
                "list": {
                    "label": "What to take on",
                    "options": [
                        {"id": "a", "label": "Widen the check", "recommended": True},
                        {"id": "b", "label": "Fix the docs", "description": "The two pages."},
                    ],
                },
            },
        )
        self.subscriber(ref)
        executors = self.executor_card()
        return {
            "comment-reply": reply,
            "comment-resolved": mark,
            "description-told": described,
            "card": self.http(f"/api/modules/planning/work-item?{self.scope(reference=ref)}"),
            "card-executors": executors,
            "card-goal": self.goal_card(),
            "card-brief": self.http(
                f"/api/modules/planning/work-item?{self.scope(reference=ref, brief='true')}"
            ),
            "requests": self.http(
                f"/api/modules/planning/requests?{self.scope(reference=ref, limit='100')}"
            ),
            "request-answered": self.http(
                f"/api/modules/planning/request?{self.scope(id=asked['request_id'])}"
            ),
            "request-pending": self.http(
                f"/api/modules/planning/request?{self.scope(id=pending['request_id'])}"
            ),
            "mcp-get-work-item": self.tool("get_work_item", id=ref),
            "mcp-get-work-item-thread": self.tool(
                "get_work_item", id=ref, thread=agent_root["applied"]["comment"]["comment_id"]
            ),
            "mcp-get-work-item-unresolved": self.tool("get_work_item", id=ref, unresolved=True),
            **self.documents(),
            **self.open_plans(),
            "live-frame": self.live_frame(),
            **self.usage(),
            "doctor-vocabulary": {"quota": _doctor_quota_codes(), "commit": _doctor_commit_codes()},
            "analytics-quota": self.quota(),
            # Last, so the references the answers above name stay theirs.
            **self.tree(),
            "request-session-gone": self.session_gone(),
            **self.put_off(),
            **self.converted(),
            # After every item above, so it counts the space as the answers left it.
            **self.volumes(),
        }


_QUOTA_CHECK = re.compile(r"quota-(?:statusline|mod|poll)")
_QUOTA_CODE = re.compile(r"quota-(?:statusline|mod|poll)(?:-[a-z]+)+")


def _doctor_quota_codes() -> list[str]:
    """Every presentation code a quota check of `valkama doctor` reports, read from its source.

    Each code is written out whole in `server/ops/doctor.py`, in its check or in the table
    of the poll's states, and the web holds its texts to this list. A `quota-` string there
    that is neither a check id nor a whole code is the start of a code built at run time,
    which a reading of the source would miss, so it stops the generation instead.
    """

    tree = ast.parse(Path(doctor.__file__).read_text(encoding="utf-8"))
    texts = {
        node.value
        for node in ast.walk(tree)
        if isinstance(node, ast.Constant)
        and isinstance(node.value, str)
        and node.value.startswith("quota-")
    }
    built = sorted(
        text for text in texts if not (_QUOTA_CHECK.fullmatch(text) or _QUOTA_CODE.fullmatch(text))
    )
    if built:
        raise ValueError(f"doctor.py builds a quota presentation code at run time: {built}")
    return sorted(text for text in texts if _QUOTA_CODE.fullmatch(text))


_RECORDS_CODE = re.compile(r"commit-records-[a-z]+(?:-[a-z]+)*")


def _doctor_commit_codes() -> list[str]:
    """Every presentation code the commit-hook and commit-records checks of `valkama doctor` report.

    The records' codes are written out whole in `server/ops/doctor.py`, and read from it. The
    hook's is built from the state the hook reads as, `commit-hook-{state}`, and every such
    state is one of `git_hook.STATES`, so those are the hook's codes.
    """

    tree = ast.parse(Path(doctor.__file__).read_text(encoding="utf-8"))
    records = {
        node.value
        for node in ast.walk(tree)
        if isinstance(node, ast.Constant)
        and isinstance(node.value, str)
        and _RECORDS_CODE.fullmatch(node.value)
    }
    if not records:
        raise ValueError("doctor.py writes no commit-records presentation code")
    return sorted([*(f"commit-hook-{state}" for state in git_hook.STATES), *records])


def _everything_but_cursor() -> url_schemes.Installed:
    """A plan reads the machine, and a fixture must not depend on which one wrote it."""

    return url_schemes.Installed(
        schemes=frozenset(url_schemes.SCHEMES) - {"cursor"},
        extensions=frozenset(
            (editor, extension)
            for editor in url_schemes.EDITOR_HOMES
            for extension in (url_schemes.CLAUDE_EXTENSION, url_schemes.CODEX_EXTENSION)
        ),
        terminal=True,
    )


def generate() -> dict[str, str]:
    """Every fixture as the server answers now, by file name, as the file's text."""

    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as directory:
        root = Path(directory)
        environment = {
            "VALKAMA_DB": str(root / "store.sqlite3"),
            "HOME": str(root),
            "USERPROFILE": str(root),
            # The address an answer carries names the port; a machine may set another.
            "VALKAMA_PORT": "8642",
        }
        registry = root / "projects.json"
        with (
            mock.patch.dict(os.environ, environment),
            mock.patch.object(project_registry, "_read_registry_bytes", registry.read_bytes),
            mock.patch.object(url_schemes, "detect", _everything_but_cursor),
        ):
            scenario = _Scenario(root)
            try:
                answers = scenario.answers()
            finally:
                scenario.close()
        normalize: Callable[[object], object] = _Normalizer(root)
        return {
            f"{name}.json": json.dumps(normalize(answer), indent=2, ensure_ascii=False) + "\n"
            for name, answer in answers.items()
        }


def write() -> None:
    """Refresh the committed fixtures; a generation that fails leaves them as they are."""

    fresh = generate()
    FIXTURES.mkdir(parents=True, exist_ok=True)
    for stale in FIXTURES.glob("*.json"):
        stale.unlink()
    for name, text in fresh.items():
        (FIXTURES / name).write_bytes(text.encode())


class ServerFixtureTests(unittest.TestCase):
    def test_the_committed_fixtures_are_what_the_server_answers(self) -> None:
        fresh = generate()
        committed = {
            path.name: path.read_bytes().decode().replace("\r\n", "\n")
            for path in FIXTURES.glob("*.json")
        }
        self.assertEqual(
            sorted(fresh),
            sorted(committed),
            "refresh with: python -m tests.test_web_contract_fixtures --write",
        )
        for name, text in fresh.items():
            with self.subTest(fixture=name):
                self.assertEqual(
                    json.loads(text),
                    json.loads(committed[name]),
                    "the server answers differently; refresh with:"
                    " python -m tests.test_web_contract_fixtures --write",
                )

    def test_generating_twice_gives_the_same_text(self) -> None:
        self.assertEqual(generate(), generate())

    def test_the_analytics_answer_has_the_shape_its_page_reads(self) -> None:
        # The page's strict schema reads this fixture too (`web/tests/serverFixtures.test.ts`);
        # the shape is held here as well, so a change of the answer fails on this side first.
        answer = json.loads((FIXTURES / "analytics-usage.json").read_text(encoding="utf-8"))
        self.assertEqual({"interface_version", "usage"}, set(answer))
        self.assertEqual("valkama-analytics-api", answer["interface_version"])
        usage = answer["usage"]
        measures = {
            "agent_seconds",
            "estimated_seconds",
            "quality",
            "tokens",
            "estimated_api_cost_usd",
            "unpriced_tokens",
        }
        self.assertEqual(
            {
                "period",
                "group_by",
                "cost_basis",
                "last_event_at",
                "total",
                "rows",
                "series",
                "comparison",
            },
            set(usage),
        )
        self.assertEqual({"from", "to", "step", "utc_offset"}, set(usage["period"]))
        self.assertEqual(["work_item", "model"], usage["group_by"])
        self.assertEqual(measures | {"unpriced_models"}, set(usage["total"]))
        self.assertEqual(3, len(usage["rows"]))
        for row in usage["rows"]:
            self.assertEqual(measures | {"group"}, set(row))
            self.assertEqual(
                {"id", "unknown", "reference", "title"}, set(row["group"]["work_item"])
            )
            self.assertEqual({"id", "unknown"}, set(row["group"]["model"]))
        self.assertEqual(2, len(usage["series"]))
        for point in usage["series"]:
            self.assertEqual(measures | {"start", "end", "groups"}, set(point))
            for group in point["groups"]:
                self.assertEqual({"work_item", "model"}, set(group["group"]))
        self.assertEqual({"period", "total", "rows"}, set(usage["comparison"]))
        self.assertNotIn("quota", json.dumps(answer))


if __name__ == "__main__":
    if sys.argv[1:] == ["--write"]:
        write()
    else:
        unittest.main()
