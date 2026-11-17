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
import time
import unittest
from pathlib import Path
from unittest import mock
from urllib.parse import urlencode

from server import http_surface, store
from server.hooks import ingest, normalize
from server.planning import calls, requests, service, tools
from server.planning.routing import PlanningRouting
from server.projects import project_registry, scopes
from server.store_identity.metadata import read_store_metadata
from server.store_identity.refs import planning_space_entity
from tests.planning_fixtures import bulk_items, item_ids, standing_in
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
                    service.create_planning_space(conn, name="Shared name", key="SAME")
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

    def where(self, space_ref: dict) -> str:
        """Which store's which space a target or a source names, as a test reads it."""

        store_name = (
            "primary"
            if space_ref["data_scope_id"] == self.refs["primary"]["data_scope_id"]
            else "attached"
            if space_ref["data_scope_id"] == self.refs["attached"]["data_scope_id"]
            else space_ref["data_scope_id"]
        )
        return f"{store_name}:{space_ref['space_key']}"

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
                    "Sec-Fetch-Site": "same-origin",
                    "X-Valkama-Session": self.server.security_context.browser_session_token,
                },
            )
            response = client.getresponse()
            return response.status, json.loads(response.read())
        finally:
            client.close()

    def test_the_usage_reads_answer_a_real_listener_where_the_interface_reads_them(self) -> None:
        """`web/src/shared/api/planningUsageApi.ts` reads these paths with no data scope."""

        status, item = self.request("/api/planning/work-item/usage?id=SAME-1&scope=tree")
        self.assertEqual(200, status, item)
        self.assertEqual("valkama-planning-api", item["interface_version"])
        self.assertEqual(("SAME-1", "tree"), (item["usage"]["reference"], item["usage"]["scope"]))
        self.assertEqual("primary-only", item["usage"]["title"])
        self.assertIsNone(item["usage"]["tokens"]["input"])
        self.assertEqual(["SAME-1"], [line["reference"] for line in item["usage"]["by_item"]])

        status, session = self.request("/api/planning/session/usage?session_id=no-such-session")
        self.assertEqual(200, status, session)
        self.assertEqual("no-such-session", session["usage"]["session_id"])
        self.assertEqual([], session["usage"]["by_item"])

    def test_the_usage_read_refuses_a_scope_it_does_not_read(self) -> None:
        """It answers for the primary store: naming another must not read as an answer for it."""

        scope = urlencode(self.refs["attached"])
        status, refusal = self.request(f"/api/planning/work-item/usage?id=SAME-1&{scope}")
        self.assertEqual(400, status, refusal)
        self.assertEqual("invalid_request", refusal["error"]["code"])

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

    def test_global_search_reads_every_space_of_every_store_and_names_each_target(self) -> None:
        """No binding decides what is searched: the attached store's space is read unbound."""

        status, answer = self.request("/api/modules/planning/search?q=attached&limit=1")
        self.assertEqual(200, status, answer)
        self.assertEqual("valkama-planning-search", answer["interface_version"])
        self.assertEqual(
            [("primary:SAME", "searched"), ("attached:SAME", "searched")],
            [(self.where(entry["space_ref"]), entry["status"]) for entry in answer["coverage"]],
        )
        self.assertNotIn("project_id", answer["coverage"][0])
        self.assertNotIn("project_id", answer["items"][0]["target"])
        self.assertEqual("attached-only", answer["items"][0]["item"]["title"])
        self.assertEqual(self.refs["attached"], answer["items"][0]["target"]["space_ref"])
        self.assertFalse(answer["items"][0]["target"]["writable"])
        self.assertFalse(answer["has_more"])

    def test_global_search_marks_each_result_with_kind_priority_and_state(self) -> None:
        """A result row draws its kind, priority and state tone from the result itself."""

        conn = store.connect()
        try:
            closed = service.create_work_item(
                conn, space="SAME", title="closed only", kind="bug", priority="urgent"
            )
            service.set_summary(conn, closed["reference"], {"done": "d", "next": "n"})
            service.transition_work_item(conn, closed["reference"], "done", acceptance="assignment")
            conn.commit()
        finally:
            conn.close()
        status, answer = self.request("/api/modules/planning/search?q=only")
        self.assertEqual(200, status, answer)
        self.assertEqual(
            {
                ("attached:SAME", "SAME-1"): ("task", "medium", "Triage", "triage", False),
                ("primary:SAME", "SAME-1"): ("task", "medium", "Triage", "triage", False),
                ("primary:SAME", "SAME-2"): ("bug", "urgent", "Done", "completed", True),
            },
            {
                (self.where(entry["target"]["space_ref"]), entry["item"]["reference"]): (
                    entry["item"]["kind"],
                    entry["item"]["priority"],
                    entry["item"]["state"]["name"],
                    entry["item"]["state"]["category"],
                    entry["item"]["state"]["is_terminal"],
                )
                for entry in answer["items"]
            },
        )

    def test_an_attached_item_says_the_state_of_its_links_other_end(self) -> None:
        """The inspector's read of an attached store names a closed blocker as closed."""

        with mock.patch.dict(os.environ, {"VALKAMA_DB": str(self.attached)}):
            conn = store.connect()
            try:
                blocker = service.create_work_item(conn, space="SAME", title="attached blocker")
                service.link_work_items(conn, blocker["reference"], "SAME-1", "blocks")
                service.set_summary(conn, blocker["reference"], {"done": "d", "next": "n"})
                service.transition_work_item(
                    conn, blocker["reference"], "done", acceptance="assignment"
                )
                conn.commit()
            finally:
                conn.close()
        self.bind("attached")
        inspector = "/api/modules/planning/work-item?" + urlencode(
            {
                "scope_kind": "space",
                **self.refs["attached"],
                "reference": "SAME-1",
            }
        )
        status, answer = self.request(inspector)
        self.assertEqual(200, status, answer)
        (link,) = answer["state"]["payload"]["work_item"]["links"]
        self.assertEqual(
            ("incoming", "SAME-2", "completed", True, None),
            (
                link["direction"],
                link["reference"],
                link["state_category"],
                link["is_terminal"],
                link["state_unavailable"],
            ),
        )

    def test_request_platform_create_answer_and_detail_share_exact_envelope(self) -> None:
        body = {
            **self.refs["primary"],
            "id": "SAME-1",
            "kind": "question",
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
                "scope_kind": "space",
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
                "scope_kind": "space",
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

    def test_an_answer_through_the_browser_is_a_persons_and_its_read_stays_strict(self) -> None:
        conn = store.connect()
        self.addCleanup(conn.close)
        field = {
            "id": "path",
            "label": "Which path",
            "type": "choice",
            "required": True,
            "options": [
                {
                    "id": "keep",
                    "label": "Keep it",
                    "description": "Costs nothing.",
                    "recommended": True,
                }
            ],
        }
        created = requests.create(
            conn, "SAME-1", kind="question", prompt="Which way?", fields=[field], author="agent"
        )
        conn.commit()
        status, answered = self.request(
            "/api/modules/planning/request/answer",
            {
                **self.refs["primary"],
                "id": created["request_id"],
                "expected_revision": 0,
                "answers": {"path": "keep"},
                "note": "In my own words",
            },
        )
        self.assertEqual(200, status, answered)
        self.assertEqual(
            ({"path": "keep"}, "In my own words", "user"),
            (
                answered["request"]["answers"],
                answered["request"]["note"],
                answered["request"]["answered_by"],
            ),
        )
        self.assertIs(True, answered["request"]["by_person"])
        status, listed = self.request(
            "/api/modules/planning/requests?scope_kind=global&status=answered"
        )
        self.assertEqual(200, status, listed)
        self.assertIs(True, listed["items"][0]["request"]["by_person"])
        self.assertEqual([field], listed["items"][0]["request"]["fields"])
        # What an agent reads afterwards says who answered, from the call itself.
        self.assertIs(
            True,
            tools.OPS["get_work_item_request"](conn, {"id": created["request_id"]})["by_person"],
        )
        [row] = tools.OPS["get_work_item"](conn, {"id": "SAME-1", "parts": "questions"})[
            "questions"
        ]["items"]
        self.assertEqual(
            (True, [{"field": "path", "value": "keep", "label": "Keep it"}], "In my own words"),
            (row["by_person"], row["answer"], row["note"]),
        )
        # The owner changes it in the card, through the same route as the answer.
        status, changed = self.request(
            "/api/modules/planning/request/change",
            {
                **self.refs["primary"],
                "id": created["request_id"],
                "expected_revision": answered["request"]["revision"],
                "answers": {},
                "own": {"path": "Neither, for now"},
            },
        )
        self.assertEqual(200, status, changed)
        self.assertEqual(
            ({}, {"path": "Neither, for now"}, 2, True),
            (
                changed["request"]["answers"],
                changed["request"]["own"],
                changed["request"]["answer_version"],
                changed["request"]["by_person"],
            ),
        )
        self.assertEqual(
            [("In my own words", True)],
            [(v["note"], v["by_person"]) for v in changed["request"]["history"]],
        )
        # The card reads the versions and not the thread, which it takes from the item.
        query = urlencode(
            {
                "scope_kind": "space",
                **self.refs["primary"],
                "id": created["request_id"],
            }
        )
        status, detail = self.request("/api/modules/planning/request?" + query)
        self.assertEqual(200, status, detail)
        self.assertEqual(
            (2, 1, False),
            (
                detail["request"]["answer_version"],
                len(detail["request"]["history"]),
                "replies" in detail["request"],
            ),
        )
        status, same = self.request(
            "/api/modules/planning/request/change",
            {
                **self.refs["primary"],
                "id": created["request_id"],
                "expected_revision": changed["request"]["revision"],
                "answers": {},
                "own": {"path": "Neither, for now"},
            },
        )
        self.assertEqual((400, "invalid_request"), (status, same["error"]["code"]))
        self.assertIn("[unchanged]", same["error"]["message"])

    def test_a_person_cannot_be_named_by_the_write_itself(self) -> None:
        conn = store.connect()
        self.addCleanup(conn.close)
        created = requests.create(
            conn,
            "SAME-1",
            kind="question",
            prompt="Which way?",
            fields=[
                {"id": "why", "label": "Why", "type": "text", "required": False, "options": []}
            ],
        )
        conn.commit()
        status, refused = self.request(
            "/api/modules/planning/request/answer",
            {
                **self.refs["primary"],
                "id": created["request_id"],
                "expected_revision": 0,
                "answers": {},
                "by_person": False,
            },
        )
        self.assertEqual(400, status, refused)

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
        self.assertEqual(
            {"primary:SAME"},
            {self.where(entry["target"]["space_ref"]) for entry in missing["items"]},
        )
        # The attached store is still listed but cannot be opened, and an
        # unopened store names no identity, so this is all the read can say of
        # the space the registry binds there.
        self.assertEqual(
            [
                ("primary:SAME", "searched", None),
                ("attached:SAME", "unavailable", "store_unreadable"),
            ],
            [
                (self.where(entry["space_ref"]), entry["status"], entry["reason"])
                for entry in missing["coverage"]
            ],
        )
        self.assertNotIn(str(self.root), json.dumps(missing))

    def bind_projects(self, bindings: dict[str, dict]) -> None:
        """Bind several projects at once, each to the space ref it is given."""

        entries = []
        for project_id, space_ref in bindings.items():
            entry = project_entry(project_id, self.root / project_id)
            entry["planning_binding"] = planning_space_entity(space_ref)
            entries.append(entry)
        self.registry.write_bytes(registry_bytes(entries))

    def test_global_search_puts_the_item_a_reference_names_first(self) -> None:
        """The exact item leads: the primary's, then an attached one's, then mentions.

        Sources are read space by space, so an earlier space's item that only
        mentions the reference used to lead, and with a page of one the item
        itself was cut off.
        """

        conn = store.connect()
        service.create_planning_space(conn, name="Alpha", key="AAA")
        service.create_work_item(
            conn, space="AAA", title="Mentions the other", description="See SAME-1 first."
        )
        conn.commit()
        conn.close()
        status, answer = self.request("/api/modules/planning/search?q=%20same-1%20")
        self.assertEqual(200, status, answer)
        self.assertEqual(
            [
                ("primary:SAME", "SAME-1", True),
                ("attached:SAME", "SAME-1", False),
                ("primary:AAA", "AAA-1", True),
            ],
            [
                (
                    self.where(entry["target"]["space_ref"]),
                    entry["item"]["reference"],
                    entry["target"]["writable"],
                )
                for entry in answer["items"]
            ],
        )
        status, page = self.request("/api/modules/planning/search?q=SAME-1&limit=1")
        self.assertEqual(200, status, page)
        self.assertEqual(
            [("primary:SAME", "SAME-1")],
            [
                (self.where(entry["target"]["space_ref"]), entry["item"]["reference"])
                for entry in page["items"]
            ],
        )
        self.assertTrue(page["has_more"])
        # A query that is not a reference keeps the order sources are read in: the
        # primary store's spaces by key, then the attached store's.
        status, plain = self.request("/api/modules/planning/search?q=SAME")
        self.assertEqual(200, status, plain)
        self.assertEqual(
            ["primary:AAA", "primary:SAME", "attached:SAME"],
            [self.where(entry["target"]["space_ref"]) for entry in plain["items"]],
        )

    def test_global_search_puts_each_source_item_a_number_names_first(self) -> None:
        """`1` names each source's item 1, ahead of an earlier source's newer matches.

        Each source answers its own item 1 first; the sources are read space by
        space, so without the merge keeping them first a later source's item
        came after every match of an earlier one, and a short page cut it off.
        """

        conn = store.connect()
        service.create_planning_space(conn, name="Alpha", key="AAA")
        for number in range(1, 12):
            service.create_work_item(conn, space="AAA", title=f"Alpha {number}")
        for number, updated in ((1, "2020"), (10, "2021"), (11, "2022")):
            conn.execute(
                "UPDATE work_items SET updated_at = ? WHERE number = ? AND planning_space_id ="
                " (SELECT planning_space_id FROM planning_spaces WHERE key = 'AAA')",
                (f"{updated}-01-01T00:00:00Z", number),
            )
        conn.commit()
        conn.close()
        status, answer = self.request("/api/modules/planning/search?q=1")
        self.assertEqual(200, status, answer)
        self.assertEqual(
            [
                ("primary:AAA", "AAA-1"),
                ("primary:SAME", "SAME-1"),
                ("attached:SAME", "SAME-1"),
                ("primary:AAA", "AAA-11"),
                ("primary:AAA", "AAA-10"),
            ],
            [
                (self.where(entry["target"]["space_ref"]), entry["item"]["reference"])
                for entry in answer["items"]
            ],
        )
        status, page = self.request("/api/modules/planning/search?q=1&limit=2")
        self.assertEqual(200, status, page)
        self.assertEqual(
            [("primary:AAA", "AAA-1"), ("primary:SAME", "SAME-1")],
            [
                (self.where(entry["target"]["space_ref"]), entry["item"]["reference"])
                for entry in page["items"]
            ],
        )

    def test_global_search_names_why_each_source_was_not_searched(self) -> None:
        """Each unsearched source carries a code saying what stood in the way."""

        foreign = {"data_scope_id": "99999999-9999-4999-8999-999999999999", "space_key": "AWAY"}
        no_space = {"data_scope_id": self.refs["primary"]["data_scope_id"], "space_key": "NONE"}
        self.bind_projects(
            {
                "example-project": self.refs["primary"],
                "foreign-project": foreign,
                "gone-project": no_space,
            }
        )
        status, answer = self.request("/api/modules/planning/search?q=only")
        self.assertEqual(200, status, answer)
        expected = {
            "primary:SAME": ("searched", None),
            "attached:SAME": ("searched", None),
            # A space the registry binds a project to that no store here holds.
            self.where(foreign): ("unavailable", "store_not_attached"),
            "primary:NONE": ("unavailable", "space_missing"),
        }
        self.assertEqual(
            expected,
            {
                self.where(entry["space_ref"]): (entry["status"], entry["reason"])
                for entry in answer["coverage"]
            },
        )
        self.assertEqual(4, len(answer["coverage"]))
        self.assertEqual(
            ["attached-only", "primary-only"],
            sorted(entry["item"]["title"] for entry in answer["items"]),
        )
        status, questions = self.request(
            "/api/modules/planning/requests?scope_kind=global&status=pending"
        )
        self.assertEqual(200, status, questions)
        self.assertEqual(
            {key: reason for key, (_status, reason) in expected.items()},
            {self.where(entry["space_ref"]): entry["reason"] for entry in questions["coverage"]},
        )
        # An attached store that answers no search this build can ask fails that
        # source alone, and says the search failed rather than the store vanished.
        conn = sqlite3.connect(self.attached)
        conn.execute("DROP TABLE work_item_comments")
        conn.commit()
        conn.close()
        self.bind_projects({"b-project": self.refs["attached"]})
        status, failed = self.request("/api/modules/planning/search?q=only")
        self.assertEqual(200, status, failed)
        self.assertEqual(
            [("primary:SAME", "searched", None), ("attached:SAME", "unavailable", "search_failed")],
            [
                (self.where(entry["space_ref"]), entry["status"], entry["reason"])
                for entry in failed["coverage"]
            ],
        )
        # A list of attached stores that cannot be read is named as such.
        Path(scopes.registry_path(str(self.primary))).write_text("{", encoding="utf-8")
        status, unlisted = self.request("/api/modules/planning/search?q=only")
        self.assertEqual(200, status, unlisted)
        self.assertEqual(
            [
                ("primary:SAME", "searched", None),
                ("attached:SAME", "unavailable", "attached_list_unreadable"),
            ],
            [
                (self.where(entry["space_ref"]), entry["status"], entry["reason"])
                for entry in unlisted["coverage"]
            ],
        )

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
        self.assertEqual(
            {"primary:SAME": None, "attached:SAME": "requests_unavailable"},
            {self.where(entry["space_ref"]): entry["reason"] for entry in answer["coverage"]},
        )
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
        service.create_planning_space(conn, name="Other space", key="ELSE")
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
                "scope_kind": "space",
                **self.refs["primary"],
                "id": other["request_id"],
            }
        )
        self.assertEqual(409, self.request("/api/modules/planning/request?" + query)[0])
        status, refusal = self.request(
            "/api/modules/planning/request/decline",
            {
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
                "scope_kind": "space",
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

    def model_path(self, source: str, project: str | None = None) -> str:
        narrowed = {} if project is None else {"project": project}
        return "/api/planning?" + urlencode({**self.refs[source], **narrowed})

    def unregister(self) -> None:
        """Leave no project in the registry, so nothing narrows a read by one.

        An item of the space still naming the project keeps it narrowing that space's
        read wherever the registry binds it, so moving the binding no longer ends a
        stream narrowed by it; a project that is not registered narrows nothing.
        """

        self.registry.write_bytes(registry_bytes([]))

    def name_project(self, source: str) -> None:
        """Make every item of one store name the project its space's stream is narrowed by."""

        with contextlib.closing(
            sqlite3.connect(self.attached if source == "attached" else self.primary)
        ) as changed:
            changed.execute(
                "INSERT INTO work_item_projects(work_item_id, project_id, source)"
                " SELECT work_item_id, 'example-project', 'named' FROM work_items"
            )
            changed.commit()

    def stream_path(self, source: str, project: str | None = None) -> str:
        narrowed = {} if project is None else {"project": project}
        return "/api/events?" + urlencode({"view": "planning", **narrowed, **self.refs[source]})

    def read_frame(self, response: http.client.HTTPResponse, event: str = "message") -> dict:
        """The next event of this name, as `EventSource` tells them apart: unnamed is `message`."""

        name = "message"
        for _ in range(40):
            line = response.readline()
            if line.startswith(b"event: "):
                name = line[7:].decode().strip()
            elif line.startswith(b"data: "):
                if name == event:
                    return json.loads(line[6:])
                name = "message"
            if line == b"":
                raise AssertionError("Planning stream closed before its next snapshot")
        raise AssertionError("Planning stream did not publish the changed model")

    def test_exact_stream_reads_and_observes_attached_store_without_primary_fallback(self) -> None:
        self.bind("attached")
        self.name_project("attached")
        for path in (self.primary, self.attached):
            with mock.patch.dict(os.environ, {"VALKAMA_DB": str(path)}):
                conn = store.connect()
                try:
                    service.pin_work_item(conn, "SAME-1", True)
                    conn.commit()
                finally:
                    conn.close()
        before = hashlib.sha256(self.attached.read_bytes()).digest()
        client = http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=3)
        self.addCleanup(client.close)
        client.request("GET", self.stream_path("attached", "example-project"))
        response = client.getresponse()
        self.addCleanup(response.close)
        self.assertEqual(200, response.status)
        first = self.read_frame(response)
        self.assertEqual(["attached-only"], [item["title"] for item in first["work_items"]])
        self.assertEqual(before, hashlib.sha256(self.attached.read_bytes()).digest())
        # The live-work frame is the primary store's, whichever store the stream follows.
        live = self.read_frame(response, "live")
        self.assertEqual(["primary-only"], [row["title"] for row in live["spaces"][0]["rows"]])
        with contextlib.closing(sqlite3.connect(self.attached)) as changed:
            changed.execute("UPDATE work_items SET title='External update'")
            changed.commit()
        updated = self.read_frame(response)
        self.assertEqual(["External update"], [item["title"] for item in updated["work_items"]])
        self.unregister()
        http_surface.watchers.WATCHERS.publish("changed")
        for _ in range(20):
            if response.readline() == b"":
                break
        else:
            self.fail("Stream stayed open after its project was unregistered")

    def test_the_card_and_only_the_card_reads_the_agents_of_the_store_it_is_bound_to(self) -> None:
        self.bind("attached")
        with mock.patch.dict(os.environ, {"VALKAMA_DB": str(self.attached)}):
            conn = store.connect()
            try:
                with calls.bind(
                    calls.Identity(
                        state=calls.CONFIRMED,
                        source=calls.CLAUDE_HOOK,
                        session_id="parent",
                        tool_use_id="t",
                        client="claude",
                    ),
                    "claim_work_item",
                ):
                    service.claim_work_item(conn, "SAME-1")
                now = normalize.timestamp(time.time_ns())
                for uid, event, payload in (
                    (1, "subagent-start", {"agent_id": "agent-1", "agent_type": "Explore"}),
                    (
                        2,
                        "post-tool-use",
                        {
                            "tool_name": "Agent",
                            "tool_input": {"description": "named"},
                            "tool_response": {"agentId": "agent-1"},
                        },
                    ),
                ):
                    record = normalize.lifecycle_event(
                        "claude",
                        event,
                        {"session_id": "parent", **payload},
                        event_uid=f"00000000-0000-4000-8000-{uid:012d}",
                        occurred_at=now,
                    )
                    assert record is not None
                    ingest.record(conn, record, delivery="direct")
                conn.commit()
            finally:
                conn.close()
        inspector = "/api/modules/planning/work-item?" + urlencode(
            {
                "scope_kind": "space",
                **self.refs["attached"],
                "reference": "SAME-1",
            }
        )
        status, answer = self.request(inspector)
        self.assertEqual(200, status, answer)
        (agent,) = answer["state"]["payload"]["work_item"]["agents"]
        self.assertEqual(
            ("named", "claim", 1), (agent["label"], agent["link"], agent["coordinator_items"])
        )

    def test_the_stream_says_when_an_agent_changed_without_resending_the_model(self) -> None:
        self.bind("attached")
        self.name_project("attached")
        client = http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=3)
        self.addCleanup(client.close)
        client.request("GET", self.stream_path("attached", "example-project"))
        response = client.getresponse()
        self.addCleanup(response.close)
        self.read_frame(response)
        with contextlib.closing(sqlite3.connect(self.attached)) as changed:
            record = normalize.lifecycle_event(
                "claude",
                "subagent-start",
                {"session_id": "parent", "agent_id": "agent-1", "agent_type": "Explore"},
                event_uid="00000000-0000-4000-8000-000000000001",
                occurred_at=normalize.timestamp(time.time_ns()),
            )
            assert record is not None
            ingest.record(changed, record, delivery="direct")
            changed.commit()
        for _ in range(20):
            if response.readline() == b"event: agents\n":
                break
        else:
            self.fail("The stream did not say that an agent changed")
        line = response.readline()
        self.assertTrue(line.startswith(b"data: "))
        self.assertNotIn(b"work_items", line)
        self.unregister()
        http_surface.watchers.WATCHERS.publish("changed")
        for _ in range(20):
            if response.readline() == b"":
                break

    def open_stream(
        self, path: str, headers: dict[str, str] | None = None
    ) -> http.client.HTTPResponse:
        client = http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=3)
        client.request("GET", path, headers=headers or {})
        response = client.getresponse()

        def hang_up() -> None:
            # The handler lets go of the store at its next keep-alive after the socket
            # closes, and the store's directory cannot be removed while it holds it.
            response.close()
            client.close()
            deadline = time.monotonic() + 3
            while http_surface.watchers.WATCHERS._queues and time.monotonic() < deadline:
                time.sleep(0.05)

        self.addCleanup(hang_up)
        self.assertEqual(200, response.status)
        return response

    def read_event(self, response: http.client.HTTPResponse) -> tuple[str, str | None, str]:
        """The next event as `EventSource` dispatches it: its name, its id and its data."""

        name, event_id, data = "message", None, None
        for _ in range(40):
            line = response.readline()
            if line == b"":
                raise AssertionError("Planning stream closed before its next event")
            field, _, value = line.decode().rstrip("\n").partition(": ")
            if field == "event":
                name = value
            elif field == "id":
                event_id = value
            elif field == "data":
                data = value
            elif line == b"\n" and data is not None:
                return name, event_id, data
        raise AssertionError("Planning stream sent no complete event")

    def opening(self, response: http.client.HTTPResponse) -> list[tuple[str, str | None, str]]:
        """What the stream sent before the live-work frame, which it sends right after."""

        events = []
        while (event := self.read_event(response))[0] != "live":
            events.append(event)
        return events

    def rename_primary_item(self, title: str) -> None:
        with contextlib.closing(sqlite3.connect(self.primary)) as changed:
            changed.execute("UPDATE work_items SET title=?", (title,))
            changed.commit()

    def test_a_stream_given_the_reads_revision_does_not_send_that_model_again(self) -> None:
        status, read = self.request(self.model_path("primary"))
        self.assertEqual(200, status, read)
        revision = read["revision"]
        response = self.open_stream(f"{self.stream_path('primary')}&since={revision}")
        self.assertEqual([("current", revision, revision)], self.opening(response))
        # The model it did not send is still the one it compares with, and news still comes.
        self.rename_primary_item("Renamed after the stream opened")
        name, event_id, data = self.read_event(response)
        changed = json.loads(data)
        self.assertEqual("message", name)
        self.assertEqual(
            ["Renamed after the stream opened"], [i["title"] for i in changed["work_items"]]
        )
        self.assertNotEqual(revision, changed["revision"])
        self.assertEqual(changed["revision"], event_id)

    def test_a_change_between_the_read_and_the_stream_is_sent(self) -> None:
        status, read = self.request(self.model_path("primary"))
        self.assertEqual(200, status, read)
        self.rename_primary_item("Renamed between the read and the stream")
        response = self.open_stream(f"{self.stream_path('primary')}&since={read['revision']}")
        ((name, event_id, data),) = self.opening(response)
        first = json.loads(data)
        self.assertEqual("message", name)
        self.assertEqual(
            ["Renamed between the read and the stream"], [i["title"] for i in first["work_items"]]
        )
        self.assertNotEqual(read["revision"], first["revision"])
        self.assertEqual(first["revision"], event_id)

    def test_a_browser_coming_back_is_sent_the_model_whatever_its_address_says(self) -> None:
        status, read = self.request(self.model_path("primary"))
        self.assertEqual(200, status, read)
        revision = read["revision"]
        response = self.open_stream(
            f"{self.stream_path('primary')}&since={revision}", {"Last-Event-ID": revision}
        )
        ((name, event_id, data),) = self.opening(response)
        # The same model the read answered, revision and all: the two agree on what it is.
        self.assertEqual(("message", revision), (name, event_id))
        self.assertEqual(read, json.loads(data))

    def test_exact_stream_refuses_invalid_or_stale_scope_before_streaming(self) -> None:
        self.bind("attached")
        self.assertEqual(409, self.request(self.stream_path("primary", "example-project"))[0])
        path = self.stream_path("attached", "example-project")
        for suffix in (
            "&space=OTHER",
            "&space_key=SAME",
            "&extra=1",
            "&view=planning",
            "&since=",
            "&since=a&since=b",
        ):
            with self.subTest(suffix=suffix):
                self.assertEqual(400, self.request(path + suffix)[0])
        self.assertEqual(400, self.request(path.replace("view=planning", "view=spaces"))[0])
        # A revision is a space model's: no other view has one to compare.
        for view in ("spaces", "activity", "live"):
            with self.subTest(view=view):
                self.assertEqual(400, self.request(f"/api/events?view={view}&since=x")[0])
        for query in ("project=", "project=&data_scope_id=&space_key=", "project=&project=x"):
            with self.subTest(query=query):
                self.assertEqual(400, self.request("/api/events?view=planning&" + query)[0])

    def test_context_lists_every_space_of_every_store_with_its_projects(self) -> None:
        status, context = self.request("/api/platform/context?scope_kind=global")
        self.assertEqual(200, status)
        spaces = context["state"]["payload"]["spaces"]
        self.assertEqual(["primary:SAME", "attached:SAME"], [self.where(space) for space in spaces])
        self.assertEqual(
            {
                "data_scope_id",
                "space_key",
                "name",
                "default_project",
                "projects",
                "other_space_projects",
            },
            set(spaces[0]),
        )
        self.assertEqual(
            ("Shared name", "example-project", ["example-project"]),
            (
                spaces[0]["name"],
                spaces[0]["default_project"],
                [project["project_id"] for project in spaces[0]["projects"]],
            ),
        )
        self.assertEqual((None, []), (spaces[1]["default_project"], spaces[1]["projects"]))

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
                "scope_kind": "space",
                **self.refs["attached"],
                "reference": "SAME-1",
            }
        )
        status, item = self.request(inspector)
        self.assertEqual(200, status)
        self.assertEqual("attached-only", item["state"]["payload"]["work_item"]["title"])
        self.assertEqual(before, hashlib.sha256(self.attached.read_bytes()).digest())
        # The project now lives in the attached store's space, and narrows no other.
        self.assertEqual(200, self.request(self.model_path("primary"))[0])
        self.assertEqual(409, self.request(self.model_path("primary", "example-project"))[0])
        self.assertEqual(200, self.request(self.model_path("attached", "example-project"))[0])

    def test_a_project_narrows_the_read_of_an_attached_store_as_of_the_primary(self) -> None:
        """The read and its stream keep the items naming the project, in whichever store."""

        self.bind("attached")
        with mock.patch.dict(os.environ, {"VALKAMA_DB": str(self.attached)}):
            conn = store.connect()
            try:
                named = service.create_work_item(conn, space="SAME", title="names the project")
                conn.execute(
                    "INSERT INTO work_item_projects(work_item_id, project_id, source)"
                    " VALUES (?, 'example-project', 'named')",
                    (named["work_item_id"],),
                )
                conn.commit()
            finally:
                conn.close()
        whole = self.request(self.model_path("attached"))[1]
        self.assertEqual(
            ["attached-only", "names the project"], sorted(i["title"] for i in whole["work_items"])
        )
        status, narrowed = self.request(self.model_path("attached", "example-project"))
        self.assertEqual(200, status, narrowed)
        self.assertEqual(["names the project"], [i["title"] for i in narrowed["work_items"]])
        response = self.open_stream(self.stream_path("attached", "example-project"))
        ((_name, _event_id, data),) = self.opening(response)
        self.assertEqual(
            ["names the project"], [i["title"] for i in json.loads(data)["work_items"]]
        )

    def test_exact_http_model_keeps_work_after_a_thousand_backlog_items(self) -> None:
        conn = store.connect()
        self.addCleanup(conn.close)
        for number in range(999):
            service.create_work_item(conn, space="SAME", title=f"Triage {number}")
        review = standing_in(conn, "review", space="SAME", title="Review me")
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

    def test_a_moved_project_or_a_detached_store_refuses_without_primary_fallback(self) -> None:
        self.bind("attached")
        self.assertEqual(200, self.request(self.model_path("attached", "example-project"))[0])
        self.bind("primary")
        # The space reads without its project; narrowed to a project it no longer has, it refuses.
        self.assertEqual(200, self.request(self.model_path("attached"))[0])
        status, refused = self.request(self.model_path("attached", "example-project"))
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
        for query in ("project=example-project&space_key=SAME", "space_key=SAME"):
            with self.subTest(query=query):
                self.assertEqual(400, self.request(f"/api/planning?{query}")[0])
        self.assertEqual(409, self.request(path.replace("SAME", "NONE"))[0])

    def test_attached_loader_is_readonly_and_primary_mutation_stays_primary(self) -> None:
        self.bind("attached")
        conn = store.connect()
        self.addCleanup(conn.close)
        routing = PlanningRouting(conn, str(self.primary))

        def attempted_write(selected: sqlite3.Connection, _key: str, _project: str | None) -> dict:
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
        exact = {"scope_kind": "space", **self.refs[source]}
        request_id = self.pending_request(source)
        return {
            "request detail": "/api/modules/planning/request?"
            + urlencode({**exact, "id": request_id}),
            "modules": "/api/modules",
            "context global": "/api/platform/context?scope_kind=global",
            "context space": "/api/platform/context?" + urlencode(exact),
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
        self.name_project("attached")
        observer = self.observe_primary()
        self.assertEqual(200, self.request("/api/modules")[0])
        before = self.data_version(observer)
        client = http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=3)
        self.addCleanup(client.close)
        client.request("GET", self.stream_path("attached", "example-project"))
        response = client.getresponse()
        self.addCleanup(response.close)
        self.addCleanup(self.end_stream, response)
        self.assertEqual(200, response.status)
        first = self.read_frame(response)
        self.assertEqual(["attached-only"], [item["title"] for item in first["work_items"]])
        self.assertEqual(before, self.data_version(observer))

    def end_stream(self, response: http.client.HTTPResponse) -> None:
        """Unregister the project so the server ends the stream and lets go of the store."""

        self.unregister()
        http_surface.watchers.WATCHERS.publish("changed")
        for _ in range(20):
            if response.readline() == b"":
                return
