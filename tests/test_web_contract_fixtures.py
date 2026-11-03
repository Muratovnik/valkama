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
import sqlite3
import sys
import tempfile
import threading
import unittest
from collections.abc import Callable
from pathlib import Path
from unittest import mock
from urllib.parse import urlencode

from server import http_surface, mcp_surface, store
from server.planning import service
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
        for spelling in (str(self.root), self.root.as_posix()):
            value = value.replace(spelling, "/workspace")
        return _UUID.sub(self.uuid, value)

    def uuid(self, found: re.Match[str]) -> str:
        if found.group(0) not in self.uuids:
            self.uuids[found.group(0)] = f"00000000-0000-4000-8000-{len(self.uuids) + 1:012d}"
        return self.uuids[found.group(0)]


class _Scenario:
    """One store with threads and questions in every state a card shows."""

    def __init__(self, root: Path) -> None:
        self.root = root
        self.path = root / "store.sqlite3"
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

    def store(self, statement: str, parameters: tuple) -> None:
        conn = sqlite3.connect(self.path)
        try:
            conn.execute(statement, parameters)
            conn.commit()
        finally:
            conn.close()

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

    def answers(self) -> dict[str, object]:
        """Build the discussion and the questions, then read them as each reader does."""

        ref = self.reference
        agent_root = self.tool("comment_work_item", id=ref, body="The export leaves out claims.")
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
        # The resolve write is a later unit: the mark is set as the store holds it.
        self.store(
            "UPDATE work_item_comments SET resolved_at=?, resolved_by=?, resolution=? WHERE id=?",
            ("2026-01-02T03:04:05.000000Z", "codex", "Moved to MAIN-14", resolved["comment_id"]),
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
        return {
            "comment-reply": reply,
            "card": self.http(f"/api/modules/planning/work-item?{self.scope(reference=ref)}"),
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
        }


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
    """Refresh the committed fixtures from the server as it answers now."""

    FIXTURES.mkdir(parents=True, exist_ok=True)
    for stale in FIXTURES.glob("*.json"):
        stale.unlink()
    for name, text in generate().items():
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
