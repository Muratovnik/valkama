"""A card in an attached store an earlier build wrote: refused by a code, not by a crash.

An attached store is read as it is and never migrated, so a read this build asks
may name a column or a table the store does not have. The two schema-9 fixtures
are what real stores of that age hold: `schema9.LAST` is a store the last public
release wrote, `schema9.FIXTURE` one from before session identity.
"""

from __future__ import annotations

import contextlib
import hashlib
import http.client
import io
import json
import os
import sqlite3
import sys
import tempfile
import threading
import unittest
from pathlib import Path
from unittest import mock
from urllib.parse import urlencode

from server import http_surface, mcp_surface, store
from server.ops import tray
from server.planning import read_model, service
from server.projects import project_registry, scopes
from server.store_identity.metadata import read_store_metadata
from server.store_identity.refs import planning_space_entity
from tests import schema9
from tests.registry_fixtures import project_entry, registry_bytes

CODE = "store_schema_mismatch"
FIXTURES = {"first schema-9 build": schema9.FIXTURE, "last schema-9 build": schema9.LAST}
MODERN = {"io.modelcontextprotocol/protocolVersion": "2026-07-28"}
#: What a refusal must never carry: the store's own words reach no reader.
INTERNAL = ("no such", "sqlite", "OperationalError", "execution_events", "reply_to")


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


class _Stream:
    def __init__(self, payload: bytes = b"") -> None:
        self.buffer = io.BytesIO(payload)


class AttachedSchemaCase(unittest.TestCase):
    def setUp(self) -> None:
        directory = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)
        self.primary = self.root / "primary.sqlite3"
        self.registry = self.root / "projects.json"
        environment = mock.patch.dict(os.environ, {"VALKAMA_DB": str(self.primary)})
        environment.start()
        self.addCleanup(environment.stop)
        with contextlib.closing(store.connect()) as conn:
            service.create_planning_space(conn, project_id="own", name="Own", key="OWN")
            conn.commit()
        registry_patch = mock.patch.object(
            project_registry, "_read_registry_bytes", self.registry.read_bytes
        )
        registry_patch.start()
        self.addCleanup(registry_patch.stop)
        self.registry.write_bytes(registry_bytes([]))
        self.server = http_surface.PlatformHTTPServer(
            ("127.0.0.1", 0), http_surface.Handler, token_path=self.root / "installation-token"
        )
        thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(thread.join, 2)
        self.addCleanup(self.server.server_close)
        self.addCleanup(self.server.shutdown)
        self.stores = 0

    def attach(self, path: Path) -> dict:
        """Attach this file and bind the project to its KEEP space."""

        scopes.attach(str(self.primary), path.stem, str(path))
        with contextlib.closing(sqlite3.connect(path)) as conn:
            conn.row_factory = sqlite3.Row
            space_ref = {
                "data_scope_id": read_store_metadata(conn)["data_scope_id"],
                "space_key": "KEEP",
            }
        entry = project_entry("kept", self.root)
        entry["planning_binding"] = planning_space_entity(space_ref)
        self.registry.write_bytes(registry_bytes([entry]))
        return space_ref

    def older_store(self, fixture: Path) -> Path:
        self.stores += 1
        path = self.root / f"older-{self.stores}.sqlite3"
        schema9.build(
            str(path),
            fixture=fixture,
            data_scope_id=f"00000000-0000-4000-8000-{self.stores:012d}",
        )
        with contextlib.closing(sqlite3.connect(path)) as conn:
            schema9.populate(conn)
            conn.commit()
        return path

    def attached_older(self, fixture: Path) -> tuple[Path, dict]:
        path = self.older_store(fixture)
        return path, self.attach(path)

    def raw(self, path: str) -> http.client.HTTPResponse:
        client = http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=5)
        self.addCleanup(client.close)
        client.request(
            "GET",
            path,
            headers={
                "Origin": f"http://127.0.0.1:{self.server.server_port}",
                "Sec-Fetch-Site": "same-origin",
                "X-Valkama-Session": self.server.security_context.browser_session_token,
            },
        )
        return client.getresponse()

    def read(self, path: str) -> tuple[int, str]:
        response = self.raw(path)
        return response.status, response.read().decode("utf-8")

    def card(self, space_ref: dict, reference: str = "KEEP-1") -> tuple[int, str]:
        query = urlencode(
            {"scope_kind": "project", "project_id": "kept", "reference": reference, **space_ref}
        )
        return self.read(f"/api/modules/planning/work-item?{query}")

    def board(self, space_ref: dict) -> tuple[int, str]:
        return self.read(f"/api/planning?{urlencode({'project': 'kept', **space_ref})}")

    def assert_nothing_internal(self, body: str) -> None:
        for word in INTERNAL:
            self.assertNotIn(word, body)


class HttpTests(AttachedSchemaCase):
    def test_the_card_is_refused_by_a_code_the_page_can_word(self) -> None:
        for name, fixture in FIXTURES.items():
            with self.subTest(store=name):
                path, space_ref = self.attached_older(fixture)
                before = digest(path)
                status, body = self.card(space_ref)
                self.assertEqual(409, status, body)
                self.assertEqual(
                    {
                        "interface_version": "valkama-ui-state",
                        "status": "unavailable",
                        "reason": CODE,
                    },
                    json.loads(body),
                )
                self.assertEqual(before, digest(path))

    def test_an_item_the_store_does_not_hold_is_still_not_found(self) -> None:
        for name, fixture in FIXTURES.items():
            with self.subTest(store=name):
                _path, space_ref = self.attached_older(fixture)
                status, body = self.card(space_ref, "KEEP-99")
                self.assertEqual((404, "unavailable"), (status, json.loads(body)["status"]), body)

    def test_the_short_address_still_leads_to_the_card(self) -> None:
        """The link goes where the card is, and the card says why it cannot be read."""

        for name, fixture in FIXTURES.items():
            with self.subTest(store=name):
                self.attached_older(fixture)
                response = self.raw("/open/KEEP-1?in=browser")
                response.read()
                self.assertEqual(302, response.status)
                self.assertTrue(
                    (response.getheader("Location") or "").startswith(
                        "/modules/planning/project/kept?entity="
                    )
                )
                missing = self.raw("/open/KEEP-99?in=browser")
                missing.read()
                self.assertEqual(404, missing.status)

    def test_a_board_the_store_cannot_answer_is_refused_the_same_way(self) -> None:
        """The first build has no `execution_events`, so its board read cannot run either."""

        _path, space_ref = self.attached_older(schema9.FIXTURE)
        status, body = self.board(space_ref)
        self.assertEqual(409, status, body)
        self.assertEqual(CODE, json.loads(body)["error"]["code"])
        self.assert_nothing_internal(body)

    def test_what_the_store_can_answer_it_still_answers(self) -> None:
        """Refusing the card must not cost the listings that work on such a store."""

        for name, fixture in FIXTURES.items():
            with self.subTest(store=name):
                _path, space_ref = self.attached_older(fixture)
                query = urlencode({"scope_kind": "project", "project_id": "kept", **space_ref})
                status, body = self.read(f"/api/platform/planning?{query}")
                self.assertEqual(200, status, body)
                [space] = json.loads(body)["state"]["payload"]["planning_spaces"]
                self.assertEqual(2, len(space["work_items"]))

                status, body = self.read("/api/modules/planning/search?q=Held")
                self.assertEqual(200, status, body)
                found = json.loads(body)
                self.assertEqual(["KEEP-1"], [hit["item"]["reference"] for hit in found["items"]])
                self.assertEqual(["searched"], [source["status"] for source in found["coverage"]])

                status, body = self.read("/api/modules/planning/requests?scope_kind=global")
                self.assertEqual(200, status, body)
                self.assertEqual(
                    ["searched"], [source["status"] for source in json.loads(body)["coverage"]]
                )

    def test_the_last_public_release_s_store_keeps_its_board(self) -> None:
        _path, space_ref = self.attached_older(schema9.LAST)
        status, body = self.board(space_ref)
        self.assertEqual(200, status, body)
        self.assertEqual(2, len(json.loads(body)["work_items"]))

    def test_a_current_store_reads_its_card_as_it_always_did(self) -> None:
        """The control: the refusal is for a store that cannot answer, not for attached ones."""

        path = self.root / "current.sqlite3"
        with (
            mock.patch.dict(os.environ, {"VALKAMA_DB": str(path)}),
            contextlib.closing(store.connect()) as conn,
        ):
            service.create_planning_space(conn, project_id="kept", name="Kept", key="KEEP")
            service.create_work_item(conn, space="KEEP", title="Current item")
            conn.commit()
        space_ref = self.attach(path)
        status, body = self.card(space_ref)
        self.assertEqual(200, status, body)
        record = json.loads(body)["state"]["payload"]["work_item"]
        self.assertEqual(("KEEP-1", "Current item"), (record["reference"], record["title"]))
        status, body = self.board(space_ref)
        self.assertEqual(200, status, body)

    def test_a_store_at_this_stamp_missing_a_table_is_refused_too(self) -> None:
        """An added table does not raise the stamp, so the stamp cannot be what tells."""

        path = self.root / "same-stamp.sqlite3"
        with (
            mock.patch.dict(os.environ, {"VALKAMA_DB": str(path)}),
            contextlib.closing(store.connect()) as conn,
        ):
            service.create_planning_space(conn, project_id="kept", name="Kept", key="KEEP")
            service.create_work_item(conn, space="KEEP", title="Item")
            conn.execute("DROP TABLE work_item_refs")
            conn.commit()
        with contextlib.closing(sqlite3.connect(path)) as conn:
            stamp = conn.execute("PRAGMA user_version").fetchone()[0]
        self.assertEqual(store.STORE_SCHEMA_VERSION, stamp)
        status, body = self.card(self.attach(path))
        self.assertEqual((409, CODE), (status, json.loads(body)["reason"]), body)


class McpTests(AttachedSchemaCase):
    def converse(self, conn: sqlite3.Connection, name: str, arguments: dict) -> dict:
        """One call through the stdio loop, on the connection the loop is handed."""

        message = {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "tools/call",
            "params": {"_meta": MODERN, "name": name, "arguments": arguments},
        }
        stdout = _Stream()
        with (
            mock.patch.object(sys, "stdin", _Stream(json.dumps(message).encode("utf-8") + b"\n")),
            mock.patch.object(sys, "stdout", stdout),
            mock.patch.object(tray, "start", return_value=None),
        ):
            mcp_surface._mcp_loop(conn, mock.Mock(drifted=lambda: False), mcp_surface.catalogue())
        [answer] = [json.loads(line) for line in stdout.buffer.getvalue().splitlines()]
        return answer["result"]

    def test_the_tool_read_on_such_a_store_is_the_same_refusal(self) -> None:
        for name, fixture in FIXTURES.items():
            with self.subTest(store=name):
                path = self.older_store(fixture)
                with contextlib.closing(
                    scopes.open_readonly({"name": "older", "path": str(path)})
                ) as conn:
                    result = self.converse(conn, "get_work_item", {"id": "KEEP-1"})
                self.assertTrue(result["isError"], result)
                self.assertEqual(CODE, result["structuredContent"]["error"]["code"])
                self.assert_nothing_internal(result["content"][0]["text"])

    def test_an_agent_s_connection_is_the_primary_alone(self) -> None:
        """No tool opens an attached store: the item is simply not in the store it reads."""

        for name, fixture in FIXTURES.items():
            with self.subTest(store=name):
                path, _space_ref = self.attached_older(fixture)
                before = digest(path)
                with contextlib.closing(store.connect()) as conn:
                    result = self.converse(conn, "get_work_item", {"id": "KEEP-1"})
                self.assertTrue(result["isError"], result)
                self.assertEqual("not_found", result["structuredContent"]["error"]["code"])
                self.assertEqual(before, digest(path))


class WholeStoreReadTests(unittest.TestCase):
    def test_only_a_missing_table_or_column_is_this_refusal(self) -> None:
        """A store that is busy can answer in a moment: it must not read as the wrong version."""

        for text in ("database is locked", "disk I/O error", "unable to open database file"):
            with (
                self.subTest(text=text),
                self.assertRaisesRegex(sqlite3.OperationalError, text),
                read_model.whole_store_read(),
            ):
                raise sqlite3.OperationalError(text)


if __name__ == "__main__":
    unittest.main()
