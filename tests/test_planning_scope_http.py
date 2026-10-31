"""Real HTTP reads must distinguish stores with identical Planning references.

They must also leave the store exactly as they found it: a read that commits
wakes every live stream as though the data had changed.
"""

from __future__ import annotations

import contextlib
import hashlib
import http.client
import json
import os
import sqlite3
import tempfile
import threading
import unittest
from pathlib import Path
from unittest import mock
from urllib.parse import urlencode

from server import http_surface, store
from server.planning import requests, service
from server.planning.routing import PlanningRouting
from server.projects import project_registry, scopes
from server.store_identity.metadata import read_store_metadata
from server.store_identity.refs import planning_space_entity
from tests.planning_fixtures import bulk_items, item_ids
from tests.registry_fixtures import project_entry, registry_bytes


class PlanningScopeHttpTests(unittest.TestCase):
    def setUp(self) -> None:
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)
        self.primary = self.root / "primary.sqlite3"
        self.attached = self.root / "attached.sqlite3"
        self.registry = self.root / "projects.json"
        environment = mock.patch.dict(os.environ, {"VALKAMA_DB": str(self.primary)})
        environment.start()
        self.addCleanup(environment.stop)
        self.refs = {}
        for name, path in (("primary", self.primary), ("attached", self.attached)):
            with mock.patch.dict(os.environ, {"VALKAMA_DB": str(path)}):
                conn = store.connect()
                try:
                    service.create_planning_space(
                        conn, project_id="example-project", name="Shared name", key="SAME"
                    )
                    service.create_work_item(conn, space="SAME", title=f"{name}-only")
                    conn.commit()
                    self.refs[name] = {
                        "data_scope_id": read_store_metadata(conn)["data_scope_id"],
                        "space_key": "SAME",
                    }
                finally:
                    conn.close()
        scopes.attach(str(self.primary), "attached", str(self.attached))
        self.bind("primary")
        registry_patch = mock.patch.object(
            project_registry, "_read_registry_bytes", self.registry.read_bytes
        )
        registry_patch.start()
        self.addCleanup(registry_patch.stop)
        self.server = http_surface.PlatformHTTPServer(
            ("127.0.0.1", 0), http_surface.Handler, token_path=self.root / "installation-token"
        )
        thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(thread.join, 2)
        self.addCleanup(self.server.server_close)
        self.addCleanup(self.server.shutdown)

    def bind(self, source: str) -> None:
        entry = project_entry("example-project", self.root)
        entry["planning_binding"] = planning_space_entity(self.refs[source])
        self.registry.write_bytes(registry_bytes([entry]))

    def request(self, path: str, payload: dict | None = None) -> tuple[int, dict]:
        client = http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=5)
        try:
            client.request(
                "GET" if payload is None else "POST",
                path,
                body=None if payload is None else json.dumps(payload),
                headers={
                    "Content-Type": "application/json",
                    "Origin": f"http://127.0.0.1:{self.server.server_port}",
                    "X-Valkama-Session": self.server.security_context.browser_session_token,
                },
            )
            response = client.getresponse()
            return response.status, json.loads(response.read())
        finally:
            client.close()

    def test_the_work_item_list_pages_honestly_over_http(self) -> None:
        """A space past one page: the cut is reported and paging reaches every item once."""

        conn = store.connect()
        try:
            bulk_items(conn, "SAME", service.MAX_LIST_PAGE)
            stored = item_ids(conn, "SAME")
        finally:
            conn.close()
        cap = service.MAX_LIST_PAGE
        self.assertEqual(cap + 1, len(stored))
        status, first = self.request(f"/api/planning/work-items?space=SAME&limit={cap}")
        self.assertEqual(200, status, first)
        self.assertEqual(
            (cap, True, cap), (len(first["work_items"]), first["truncated"], first["next_offset"])
        )
        seen = [item["work_item_id"] for item in first["work_items"]]
        status, rest = self.request(f"/api/planning/work-items?space=SAME&limit={cap}&offset={cap}")
        self.assertEqual(200, status, rest)
        self.assertEqual(
            (1, False, None), (len(rest["work_items"]), rest["truncated"], rest["next_offset"])
        )
        seen.extend(item["work_item_id"] for item in rest["work_items"])
        self.assertEqual(len(seen), len(set(seen)))
        self.assertEqual(stored, set(seen))
        # Without offset the answer is the one it always was, plus the two fields.
        status, plain = self.request("/api/planning/work-items?space=SAME")
        self.assertEqual(200, status, plain)
        self.assertEqual(
            [item["work_item_id"] for item in first["work_items"][:200]],
            [item["work_item_id"] for item in plain["work_items"]],
        )
        self.assertEqual((True, 200), (plain["truncated"], plain["next_offset"]))
        for offset in ("-1", "two", "1.5"):
            with self.subTest(offset=offset):
                status, refused = self.request(
                    f"/api/planning/work-items?space=SAME&offset={offset}"
                )
                self.assertEqual(400, status, refused)
                self.assertEqual("invalid_request", refused["error"]["code"])

    def test_mapped_global_search_uses_verified_attached_target(self) -> None:
        self.bind("attached")
        status, answer = self.request("/api/modules/planning/search?q=only&limit=1")
        self.assertEqual(200, status, answer)
        self.assertEqual("valkama-planning-search", answer["interface_version"])
        self.assertEqual("searched", answer["coverage"][0]["status"])
        self.assertEqual("attached-only", answer["items"][0]["item"]["title"])
        self.assertEqual(self.refs["attached"], answer["items"][0]["target"]["space_ref"])
        self.assertFalse(answer["items"][0]["target"]["writable"])
        self.assertFalse(answer["has_more"])

    def test_request_platform_create_answer_and_detail_share_exact_envelope(self) -> None:
        body = {
            "project_id": "example-project",
            **self.refs["primary"],
            "id": "SAME-1",
            "kind": "decision",
            "prompt": "May this proceed?",
            "fields": [
                {
                    "id": "proceed",
                    "label": "Proceed",
                    "type": "boolean",
                    "required": True,
                    "options": [],
                }
            ],
        }
        status, created = self.request("/api/modules/planning/request", body)
        self.assertEqual(200, status, created)
        self.assertEqual("valkama-planning-requests", created["interface_version"])
        identity = created["request"]["request_id"]
        status, listed = self.request(
            "/api/modules/planning/requests?scope_kind=global&status=pending&limit=100"
        )
        self.assertEqual(200, status, listed)
        self.assertEqual(identity, listed["items"][0]["request"]["request_id"])
        self.assertTrue(listed["items"][0]["target"]["writable"])
        status, answered = self.request(
            "/api/modules/planning/request/answer",
            {
                "project_id": "example-project",
                **self.refs["primary"],
                "id": identity,
                "answers": {"proceed": False},
                "expected_revision": 0,
                "author": "owner",
            },
        )
        self.assertEqual(200, status, answered)
        self.assertEqual(
            ("answered", {"proceed": False}, 1),
            (
                answered["request"]["status"],
                answered["request"]["answers"],
                answered["request"]["revision"],
            ),
        )
        query = urlencode(
            {
                "scope_kind": "project",
                "project_id": "example-project",
                **self.refs["primary"],
                "id": identity,
            }
        )
        status, detail = self.request("/api/modules/planning/request?" + query)
        self.assertEqual(200, status, detail)
        self.assertEqual(answered, detail)
        status, refusal = self.request(
            "/api/modules/planning/request/decline",
            {
                "project_id": "example-project",
                **self.refs["primary"],
                "id": identity,
                "expected_revision": 0,
            },
        )
        self.assertEqual(409, status, refusal)
        self.assertEqual("revision_conflict", refusal["error"]["code"])

    def test_request_exact_attached_reads_are_readonly_and_mutations_never_hit_primary(
        self,
    ) -> None:
        with mock.patch.dict(os.environ, {"VALKAMA_DB": str(self.attached)}):
            conn = store.connect()
            created = requests.create(
                conn,
                "SAME-1",
                kind="question",
                prompt="Attached question",
                fields=[
                    {
                        "id": "reply",
                        "label": "Reply",
                        "type": "text",
                        "required": True,
                        "options": [],
                    }
                ],
            )
            conn.commit()
            conn.execute("UPDATE work_item_requests SET expires_at='2020-01-01T00:00:00.000000Z'")
            conn.commit()
            conn.close()
        self.bind("attached")
        before = hashlib.sha256(self.attached.read_bytes()).hexdigest()
        identity = created["request_id"]
        query = urlencode(
            {
                "scope_kind": "project",
                "project_id": "example-project",
                **self.refs["attached"],
                "id": identity,
            }
        )
        status, detail = self.request("/api/modules/planning/request?" + query)
        self.assertEqual(200, status, detail)
        self.assertEqual("deadline", detail["request"]["expired_reason"])
        self.assertFalse(detail["target"]["writable"])
        status, refused = self.request(
            "/api/modules/planning/request/answer",
            {
                "project_id": "example-project",
                **self.refs["attached"],
                "id": identity,
                "expected_revision": 0,
                "answers": {"reply": "No write"},
            },
        )
        self.assertEqual(409, status, refused)
        self.assertEqual("attached_store_readonly", refused["error"]["message"])
        self.assertEqual(before, hashlib.sha256(self.attached.read_bytes()).hexdigest())
        conn = store.connect()
        self.addCleanup(conn.close)
        self.assertEqual(0, conn.execute("SELECT COUNT(*) FROM work_item_requests").fetchone()[0])

    def test_global_search_reports_unavailable_and_extra_matches_honestly(self) -> None:
        conn = store.connect()
        service.create_work_item(conn, space="SAME", title="second only")
        service.report_work_item(conn, "SAME-1", {"done": "historical needle", "next": "retain"})
        conn.commit()
        conn.close()
        status, bounded = self.request("/api/modules/planning/search?q=only&limit=1")
        self.assertEqual(200, status, bounded)
        self.assertTrue(bounded["has_more"])
        status, history = self.request("/api/modules/planning/search?q=needle")
        self.assertEqual(200, status, history)
        self.assertEqual("SAME-1", history["items"][0]["item"]["reference"])
        self.bind("attached")
        self.attached.rename(self.root / "unavailable.sqlite3")
        status, missing = self.request("/api/modules/planning/search?q=only")
        self.assertEqual(200, status, missing)
        self.assertEqual([], missing["items"])
        self.assertEqual("unavailable", missing["coverage"][0]["status"])
        self.assertNotIn(str(self.root), json.dumps(missing))

    def test_global_new_reads_refuse_malformed_queries_and_read_every_source(self) -> None:
        for path in (
            "/api/modules/planning/search?q=only&q=other",
            "/api/modules/planning/search?q=only&limit=101",
            "/api/modules/planning/search?q=only&project=guessed",
            "/api/modules/planning/requests?scope_kind=global&extra=bad",
            "/api/modules/planning/requests?scope_kind=global&limit=0",
        ):
            with self.subTest(path=path):
                status, answer = self.request(path)
                self.assertEqual(400, status, answer)
        # A well-formed read searches every source; one that cannot be read is
        # the next test's subject.
        for path in (
            "/api/modules/planning/search?q=only",
            "/api/modules/planning/requests?scope_kind=global&status=pending",
        ):
            with self.subTest(path=path):
                status, answer = self.request(path)
                self.assertEqual(200, status, answer)
                self.assertTrue(answer["coverage"], answer)
                self.assertEqual(
                    ["searched"], sorted({entry["status"] for entry in answer["coverage"]})
                )

    def test_old_attached_request_capability_is_explicitly_unavailable(self) -> None:
        conn = sqlite3.connect(self.attached)
        conn.execute("DROP TABLE work_item_requests")
        conn.commit()
        conn.close()
        self.bind("attached")
        before = hashlib.sha256(self.attached.read_bytes()).hexdigest()
        status, answer = self.request(
            "/api/modules/planning/requests?scope_kind=global&status=pending"
        )
        self.assertEqual(200, status, answer)
        self.assertEqual([], answer["items"])
        self.assertEqual("requests_unavailable", answer["coverage"][0]["reason"])
        self.assertEqual(before, hashlib.sha256(self.attached.read_bytes()).hexdigest())

    def test_request_uuid_collision_and_other_space_never_escape_exact_target(self) -> None:
        conn = store.connect()
        first = requests.create(
            conn,
            "SAME-1",
            kind="question",
            prompt="Primary question",
            fields=[
                {"id": "reply", "label": "Reply", "type": "text", "required": True, "options": []}
            ],
        )
        service.create_planning_space(conn, project_id="other", name="Other space", key="ELSE")
        service.create_work_item(conn, space="ELSE", title="Other item")
        other = requests.create(
            conn,
            "ELSE-1",
            kind="question",
            prompt="Outside bound space",
            fields=[
                {"id": "reply", "label": "Reply", "type": "text", "required": True, "options": []}
            ],
        )
        conn.commit()
        conn.close()
        query = urlencode(
            {
                "scope_kind": "project",
                "project_id": "example-project",
                **self.refs["primary"],
                "id": other["request_id"],
            }
        )
        self.assertEqual(409, self.request("/api/modules/planning/request?" + query)[0])
        status, refusal = self.request(
            "/api/modules/planning/request/decline",
            {
                "project_id": "example-project",
                **self.refs["primary"],
                "id": other["request_id"],
                "expected_revision": 0,
            },
        )
        self.assertEqual(409, status, refusal)
        with mock.patch.dict(os.environ, {"VALKAMA_DB": str(self.attached)}):
            conn = store.connect()
            attached = requests.create(
                conn,
                "SAME-1",
                kind="question",
                prompt="Attached UUID collision",
                fields=[
                    {
                        "id": "reply",
                        "label": "Reply",
                        "type": "text",
                        "required": True,
                        "options": [],
                    }
                ],
            )
            conn.execute(
                "UPDATE work_item_requests SET request_id=? WHERE request_id=?",
                (first["request_id"], attached["request_id"]),
            )
            conn.commit()
            conn.close()
        self.bind("attached")
        query = urlencode(
            {
                "scope_kind": "project",
                "project_id": "example-project",
                **self.refs["attached"],
                "id": first["request_id"],
            }
        )
        status, detail = self.request("/api/modules/planning/request?" + query)
        self.assertEqual(200, status, detail)
        self.assertEqual("Attached UUID collision", detail["request"]["prompt"])
        status, refusal = self.request(
            "/api/modules/planning/request/decline",
            {
                "project_id": "example-project",
                **self.refs["attached"],
                "id": first["request_id"],
                "expected_revision": 0,
            },
        )
        self.assertEqual(409, status, refusal)
        conn = store.connect()
        self.addCleanup(conn.close)
        self.assertEqual("pending", requests.get(conn, first["request_id"])["status"])
        self.assertEqual("pending", requests.get(conn, other["request_id"])["status"])

    def model_path(self, source: str) -> str:
        return "/api/planning?" + urlencode({"project": "example-project", **self.refs[source]})

    def stream_path(self, source: str) -> str:
        return "/api/events?" + urlencode(
            {"view": "planning", "project": "example-project", **self.refs[source]}
        )

    def read_frame(self, response: http.client.HTTPResponse) -> dict:
        for _ in range(20):
            line = response.readline()
            if line.startswith(b"data: "):
                return json.loads(line[6:])
            if line == b"":
                raise AssertionError("Planning stream closed before its next snapshot")
        raise AssertionError("Planning stream did not publish the changed model")

    def test_exact_stream_reads_and_observes_attached_store_without_primary_fallback(self) -> None:
        self.bind("attached")
        before = hashlib.sha256(self.attached.read_bytes()).digest()
        client = http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=3)
        self.addCleanup(client.close)
        client.request("GET", self.stream_path("attached"))
        response = client.getresponse()
        self.addCleanup(response.close)
        self.assertEqual(200, response.status)
        first = self.read_frame(response)
        self.assertEqual(["attached-only"], [item["title"] for item in first["work_items"]])
        self.assertEqual(before, hashlib.sha256(self.attached.read_bytes()).digest())
        with contextlib.closing(sqlite3.connect(self.attached)) as changed:
            changed.execute("UPDATE work_items SET title='External update'")
            changed.commit()
        updated = self.read_frame(response)
        self.assertEqual(["External update"], [item["title"] for item in updated["work_items"]])
        self.bind("primary")
        http_surface.watchers.WATCHERS.publish("changed")
        for _ in range(20):
            if response.readline() == b"":
                break
        else:
            self.fail("Stream stayed open after its exact binding was revoked")

    def test_exact_stream_refuses_invalid_or_stale_scope_before_streaming(self) -> None:
        self.bind("attached")
        self.assertEqual(409, self.request(self.stream_path("primary"))[0])
        path = self.stream_path("attached")
        for suffix in ("&space=OTHER", "&space_key=SAME", "&extra=1", "&view=planning"):
            with self.subTest(suffix=suffix):
                self.assertEqual(400, self.request(path + suffix)[0])
        self.assertEqual(400, self.request(path.replace("view=planning", "view=spaces"))[0])
        for query in ("project=", "project=&data_scope_id=&space_key=", "project=&project=x"):
            with self.subTest(query=query):
                self.assertEqual(400, self.request("/api/events?view=planning&" + query)[0])

    def test_context_directory_matches_the_current_project_contract(self) -> None:
        status, context = self.request("/api/platform/context?scope_kind=global")
        self.assertEqual(200, status)
        project = context["state"]["payload"]["projects"][0]
        self.assertEqual({"project_id", "title", "binding_state", "resources"}, set(project))
        self.assertEqual("mapped", project["binding_state"])
        self.assertEqual(
            planning_space_entity(self.refs["primary"]), project["resources"][0]["resource_ref"]
        )

    def test_exact_model_and_inspector_read_attached_without_changing_it(self) -> None:
        status, primary = self.request(self.model_path("primary"))
        self.assertEqual(200, status)
        self.assertEqual(["primary-only"], [item["title"] for item in primary["work_items"]])
        self.bind("attached")
        before = hashlib.sha256(self.attached.read_bytes()).digest()
        status, attached = self.request(self.model_path("attached"))
        self.assertEqual(200, status)
        self.assertEqual(["attached-only"], [item["title"] for item in attached["work_items"]])
        self.assertEqual("SAME-1", attached["work_items"][0]["reference"])
        inspector = "/api/modules/planning/work-item?" + urlencode(
            {
                "scope_kind": "project",
                "project_id": "example-project",
                **self.refs["attached"],
                "reference": "SAME-1",
            }
        )
        status, item = self.request(inspector)
        self.assertEqual(200, status)
        self.assertEqual("attached-only", item["state"]["payload"]["work_item"]["title"])
        self.assertEqual(before, hashlib.sha256(self.attached.read_bytes()).digest())
        self.assertEqual(409, self.request(self.model_path("primary"))[0])

    def test_exact_http_model_keeps_work_after_a_thousand_backlog_items(self) -> None:
        conn = store.connect()
        self.addCleanup(conn.close)
        for number in range(999):
            service.create_work_item(conn, space="SAME", title=f"Backlog {number}")
        review = service.create_work_item(conn, space="SAME", title="Review me", state="review")
        conn.commit()

        status, payload = self.request(self.model_path("primary"))
        self.assertEqual(200, status)
        self.assertEqual(1001, len(payload["work_items"]))
        self.assertEqual(
            [review["reference"]],
            [
                item["reference"]
                for item in payload["work_items"]
                if item["state"]["category"] == "review"
            ],
        )

    def test_changed_binding_and_detached_store_refuse_without_primary_fallback(self) -> None:
        self.bind("attached")
        self.assertEqual(200, self.request(self.model_path("attached"))[0])
        self.bind("primary")
        status, refused = self.request(self.model_path("attached"))
        self.assertEqual(409, status)
        self.assertEqual("unavailable", refused["status"])
        self.assertNotIn("work_items", refused)
        self.bind("attached")
        scopes.save(str(self.primary), [])
        self.assertEqual(409, self.request(self.model_path("attached"))[0])

    def test_partial_or_unknown_exact_identity_never_uses_legacy_project_lookup(self) -> None:
        path = self.model_path("primary")
        for suffix in ("&space=OTHER", "&space_key=SAME", "&extra=1"):
            with self.subTest(suffix=suffix):
                self.assertEqual(400, self.request(path + suffix)[0])
        self.assertEqual(
            400, self.request("/api/planning?project=example-project&space_key=SAME")[0]
        )
        self.assertEqual(409, self.request(path.replace("SAME", "NONE"))[0])

    def test_attached_loader_is_readonly_and_primary_mutation_stays_primary(self) -> None:
        self.bind("attached")
        conn = store.connect()
        self.addCleanup(conn.close)
        routing = PlanningRouting(conn, str(self.primary))

        def attempted_write(selected: sqlite3.Connection, _key: str) -> dict:
            selected.execute("UPDATE work_items SET title='forbidden'")
            return {}

        with self.assertRaisesRegex(sqlite3.OperationalError, "readonly"):
            routing.planning_read_model(
                {
                    key: [value]
                    for key, value in {
                        "project": "example-project",
                        **self.refs["attached"],
                    }.items()
                },
                attempted_write,
            )
        status, _ = self.request(
            "/api/planning/work-item/update", {"id": "SAME-1", "title": "primary-updated"}
        )
        self.assertEqual(200, status)
        self.assertEqual("primary-updated", service.get_work_item(conn, "SAME-1")["title"])
        _, attached = self.request(self.model_path("attached"))
        self.assertEqual("attached-only", attached["work_items"][0]["title"])

    # -- reads write nothing ---------------------------------------------------
    #
    # `PRAGMA data_version` on a second connection moves exactly when another
    # connection commits a change, which is what an SSE consumer and every other
    # reader of this store see. A read that commits, even a row it only touched,
    # makes every viewer believe the store changed.

    def observe_primary(self) -> sqlite3.Connection:
        observer = sqlite3.connect(self.primary)
        self.addCleanup(observer.close)
        return observer

    @staticmethod
    def data_version(observer: sqlite3.Connection) -> int:
        return int(observer.execute("PRAGMA data_version").fetchone()[0])

    def pending_request(self, source: str) -> str:
        path = self.primary if source == "primary" else self.attached
        with mock.patch.dict(os.environ, {"VALKAMA_DB": str(path)}):
            conn = store.connect()
            try:
                created = requests.create(
                    conn,
                    "SAME-1",
                    kind="question",
                    prompt="Still open?",
                    fields=[
                        {
                            "id": "reply",
                            "label": "Reply",
                            "type": "text",
                            "required": True,
                            "options": [],
                        }
                    ],
                )
                conn.commit()
            finally:
                conn.close()
        return str(created["request_id"])

    def exact_read_paths(self, source: str) -> dict[str, str]:
        exact = {"scope_kind": "project", "project_id": "example-project", **self.refs[source]}
        request_id = self.pending_request(source)
        return {
            "request detail": "/api/modules/planning/request?"
            + urlencode({**exact, "id": request_id}),
            "modules": "/api/modules",
            "context global": "/api/platform/context?scope_kind=global",
            "context project": "/api/platform/context?"
            + urlencode({"scope_kind": "project", "project_id": "example-project"}),
            "portfolio global": "/api/platform/planning?scope_kind=global",
            "portfolio directory": "/api/platform/planning?scope_kind=global&directory_only=true",
            "portfolio exact": "/api/platform/planning?" + urlencode(exact),
            "work item": "/api/modules/planning/work-item?"
            + urlencode({**exact, "reference": "SAME-1"}),
            "search": "/api/modules/planning/search?q=only",
            "requests global": "/api/modules/planning/requests?scope_kind=global",
            "requests exact": "/api/modules/planning/requests?" + urlencode(exact),
            "planning model": self.model_path(source),
        }

    def assert_reads_leave_store_unchanged(self, source: str, paths: dict[str, str]) -> None:
        self.bind(source)
        observer = self.observe_primary()
        # The first request after a binding or an attach may record the store
        # inventory once; what is measured is every read after that.
        self.assertEqual(200, self.request("/api/modules")[0])
        for name, path in paths.items():
            with self.subTest(source=source, read=name):
                before = self.data_version(observer)
                status, answer = self.request(path)
                self.assertEqual(200, status, answer)
                self.assertEqual(before, self.data_version(observer), path)

    def test_exact_reads_of_the_primary_store_write_nothing(self) -> None:
        self.assert_reads_leave_store_unchanged("primary", self.exact_read_paths("primary"))

    def test_exact_reads_of_an_attached_store_write_nothing(self) -> None:
        paths = self.exact_read_paths("attached")
        before = hashlib.sha256(self.attached.read_bytes()).digest()
        self.assert_reads_leave_store_unchanged("attached", paths)
        self.assertEqual(before, hashlib.sha256(self.attached.read_bytes()).digest())

    def test_exact_stream_snapshot_writes_nothing(self) -> None:
        self.bind("attached")
        observer = self.observe_primary()
        self.assertEqual(200, self.request("/api/modules")[0])
        before = self.data_version(observer)
        client = http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=3)
        self.addCleanup(client.close)
        client.request("GET", self.stream_path("attached"))
        response = client.getresponse()
        self.addCleanup(response.close)
        self.addCleanup(self.end_stream, response)
        self.assertEqual(200, response.status)
        first = self.read_frame(response)
        self.assertEqual(["attached-only"], [item["title"] for item in first["work_items"]])
        self.assertEqual(before, self.data_version(observer))

    def end_stream(self, response: http.client.HTTPResponse) -> None:
        """Revoke the binding so the server ends the stream and lets go of the store."""

        self.bind("primary")
        http_surface.watchers.WATCHERS.publish("changed")
        for _ in range(20):
            if response.readline() == b"":
                return
