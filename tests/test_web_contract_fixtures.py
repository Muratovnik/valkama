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

import http.client
import json
import os
import re
import sys
import tempfile
import threading
import unittest
from collections.abc import Callable
from pathlib import Path
from unittest import mock
from urllib.parse import urlencode

from server import http_surface, mcp_surface, session_open, sessions, store
from server.ops import url_schemes
from server.planning import calls, read_model, service, subscriptions
from server.projects import project_registry
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


def _uri_path(root: Path) -> str:
    return root.as_uri().removeprefix("file:///")


class _Normalizer:
    """Rewrites what changes between runs into fixed values, the same across files."""

    def __init__(self, root: Path) -> None:
        self.root = root
        self.uuids: dict[str, str] = {}

    def __call__(self, value: object) -> object:
        if isinstance(value, dict):
            return {key: self(found) for key, found in value.items()}
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
        conn = store.connect()
        try:
            service.create_planning_space(conn, project_id=PROJECT, name="Contract", key=SPACE)
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
                "scope_kind": "project",
                "project_id": PROJECT,
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
                service.claim_work_item(conn, ref, move_state=False)
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

    def live_frame(self) -> dict:
        """The frame a pin answers with: the pinned card, a waiting row, a quiet one under an epic."""

        quiet = "6f1c2a8e-0000-4000-8000-000000000004"
        conn = store.connect()
        try:
            epic = str(
                service.create_work_item(conn, space=SPACE, title="Live epic", kind="epic")[
                    "reference"
                ]
            )
            task = str(
                service.create_work_item(conn, space=SPACE, title="Quiet task", parent=epic)[
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
                service.claim_work_item(conn, task, move_state=False)
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
            conn.commit()
        finally:
            conn.close()
        return self.http("/api/planning/work-item/pin", {"id": self.reference, "pinned": True})

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
        agent_root = self.tool(
            "comment_work_item", id=ref, body="The export leaves out claims.", awaits_reply=True
        )
        reply = self.http(
            "/api/planning/work-item/comment",
            {
                "id": ref,
                "body": "Only the claims, the steps are there.",
                "author": "user",
                "reply_to": agent_root["comment_id"],
            },
        )
        self.tool(
            "comment_work_item",
            id=ref,
            body="Then the claims go in next.",
            reply_to=reply["comment_id"],
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
            "comment_work_item",
            id=ref,
            body="Does the second option include the docs?",
            reply_to_request=asked["request_id"],
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
            "comment_work_item",
            id=ref,
            body="Two places misfire.",
            list={
                "label": "What to take on",
                "options": [
                    {"id": "a", "label": "Widen the check", "recommended": True},
                    {"id": "b", "label": "Fix the docs", "description": "The two pages."},
                ],
            },
        )
        self.subscriber(ref)
        executors = self.executor_card()
        return {
            "comment-reply": reply,
            "comment-resolved": mark,
            "card": self.http(f"/api/modules/planning/work-item?{self.scope(reference=ref)}"),
            "card-executors": executors,
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
                "get_work_item", id=ref, thread=agent_root["comment_id"]
            ),
            "mcp-get-work-item-unresolved": self.tool("get_work_item", id=ref, unresolved=True),
            **self.documents(),
            **self.open_plans(),
            "live-frame": self.live_frame(),
        }


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


if __name__ == "__main__":
    if sys.argv[1:] == ["--write"]:
        write()
    else:
        unittest.main()
