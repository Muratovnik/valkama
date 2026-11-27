"""The commits on no card over HTTP, and the attachment the interface makes from that list.

`GET /api/planning/commits/unattached` lists a session's commits that no item holds
and no rewrite replaced, by a project, by the projects the registry binds to a space
or of the whole store. `POST /api/planning/work-item/commit` attaches one, or detaches
it with `remove`. Both are asked of a real server, as the browser asks, so the write
is the person's: signed `manual`, by the person, from a call of the interface.
"""

from __future__ import annotations

import http.client
import json
import threading
from urllib.parse import urlencode

from server import http_surface
from server.store_identity.metadata import read_store_metadata
from server.store_identity.refs import planning_space_entity

from .commit_fixtures import CLAUDE, CODEX, PROJECT
from .registry_fixtures import project_entry, registry_bytes
from .test_commits_pickup import DEFAULT, UNBOUND, RuleCase

LIST = "/api/planning/commits/unattached"
WRITE = "/api/planning/work-item/commit"
#: What each commit on the list carries, in this order.
FIELDS = (
    "repository",
    "display_name",
    "hash",
    "subject",
    "committed_at",
    "session",
    "agent",
    "client",
    "reported_at",
)


class ApiCase(RuleCase):
    def setUp(self) -> None:
        super().setUp()
        self.server = http_surface.PlatformHTTPServer(
            ("127.0.0.1", 0),
            http_surface.Handler,
            token_path=self.place.base / "installation-token",
        )
        thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        thread.start()

        def stop() -> None:
            self.server.shutdown()
            self.server.server_close()
            thread.join(2)

        self.addCleanup(stop)

    def http(self, path: str, payload: dict | None = None) -> tuple[int, dict]:
        """A call as the browser makes it, with the interface's credential."""

        port = self.server.server_port
        client = http.client.HTTPConnection("127.0.0.1", port, timeout=10)
        try:
            client.request(
                "GET" if payload is None else "POST",
                path,
                body=None if payload is None else json.dumps(payload),
                headers={
                    "Content-Type": "application/json",
                    "Origin": f"http://127.0.0.1:{port}",
                    "Sec-Fetch-Site": "same-origin",
                    "X-Valkama-Session": self.server.security_context.browser_session_token,
                },
            )
            response = client.getresponse()
            return response.status, json.loads(response.read())
        finally:
            client.close()

    def listed(self, **query: object) -> dict:
        status, answer = self.http(f"{LIST}?{urlencode(query)}")
        self.assertEqual(200, status, answer)
        return answer

    def refused(self, path: str, payload: dict | None = None) -> str:
        """The message of a refusal, which is `invalid_request` with the status 400."""

        status, answer = self.http(path, payload)
        self.assertEqual(400, status, answer)
        self.assertEqual("invalid_request", answer["error"]["code"])
        return str(answer["error"]["message"])

    def hashes(self, **query: object) -> list[str]:
        return [entry["hash"] for entry in self.listed(**query)["items"]]

    def stored(
        self,
        project: str,
        digit: str,
        *,
        session: str | None = CLAUDE,
        committed_at: str | None = "2026-11-20T10:00:00+03:00",
    ) -> str:
        """A commit row as the client hook leaves one; its hash is `digit` forty times."""

        whole = digit * 40
        self.conn.execute(
            "INSERT INTO commits(project_id, hash, subject, committed_at, session_id, client,"
            " reported_at) VALUES (?,?,?,?,?,?,strftime('%Y-%m-%dT%H:%M:%fZ','now'))",
            (project, whole, f"feat: {digit}", committed_at, session, "claude"),
        )
        self.conn.commit()
        return whole


class ListAndAttachTests(ApiCase):
    def test_the_list_names_the_commits_on_no_card_and_an_attachment_takes_one_off(
        self,
    ) -> None:
        held = self.task("Held")
        self.claim(held)
        attached, _line = self.commit()
        self.tool("claim_work_item", id=held, release=True)
        first, _line = self.commit()
        second, _line = self.commit(agent_id="agent-1")
        self.assertEqual([(held, attached, "server", "valkama")], self.attached())

        answer = self.listed(project=PROJECT)
        self.assertEqual(2, answer["total"])
        self.assertEqual([second, first], [entry["hash"] for entry in answer["items"]])
        self.assertEqual(list(FIELDS), list(answer["items"][0]))
        newest = answer["items"][0]
        self.assertEqual(
            {
                "repository": PROJECT,
                "display_name": PROJECT,
                "hash": second,
                "session": CLAUDE,
                "agent": "agent-1",
                "client": "claude",
            },
            {name: newest[name] for name in FIELDS[:3] + FIELDS[5:8]},
        )
        self.assertRegex(newest["subject"], r"^feat: c\d+$")
        # Git prints the zone of UTC as Z, and any other as +hh:mm.
        self.assertRegex(
            newest["committed_at"], r"^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(Z|[+-]\d\d:\d\d)$"
        )
        self.assertRegex(newest["reported_at"], r"^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d")

        task = self.task("Takes it")
        status, written = self.http(
            WRITE, {"reference": task, "repository": PROJECT, "hash": first[:9]}
        )
        self.assertEqual(200, status, written)
        self.assertEqual(["reference", "revision", "commit", "changed"], list(written))
        self.assertEqual(task, written["reference"])
        self.assertIsInstance(written["revision"], int)
        self.assertTrue(written["changed"])
        self.assertEqual(
            (first, "manual", CLAUDE, None),
            (
                written["commit"]["hash"],
                written["commit"]["attached_by"],
                written["commit"]["session"],
                written["commit"]["agent"],
            ),
        )
        self.assertIn((task, first, "manual", "user"), self.attached())
        self.assertEqual([second], self.hashes(project=PROJECT))
        self.assertEqual(1, self.listed(project=PROJECT)["total"])

        message = self.refused(f"{LIST}?{urlencode({'project': 'nobody'})}")
        self.assertTrue(
            message.startswith("[commit] nobody is not a registered project: "), message
        )

    def test_a_write_from_the_window_is_the_person_s_and_gives_manual(self) -> None:
        task = self.task("By the person")
        commit, _line = self.commit()
        _status, written = self.http(
            WRITE, {"reference": task, "repository": PROJECT, "hash": commit}
        )
        self.assertTrue(written["changed"])
        [event] = self.conn.execute(
            "SELECT e.detail, e.author, c.identity_source, c.tool FROM work_item_events e"
            " JOIN execution_events c ON c.id = e.call_id"
            " WHERE e.action = 'commit_attached' AND e.work_item_id = ?",
            (self.identity(task),),
        ).fetchall()
        self.assertEqual((f"{PROJECT} {commit}", "user", "browser", WRITE), tuple(event))
        self.assertEqual([(task, commit, "manual", "user")], self.attached())
        self.assertEqual([(PROJECT, "commits")], self.projects(task))

        _status, again = self.http(
            WRITE, {"reference": task, "repository": PROJECT, "hash": commit}
        )
        self.assertFalse(again["changed"], "a commit attached already changes nothing")
        self.assertEqual("manual", again["commit"]["attached_by"])

        _status, removed = self.http(
            WRITE, {"reference": task, "repository": PROJECT, "hash": commit[:9], "remove": True}
        )
        self.assertTrue(removed["changed"])
        self.assertEqual(
            (commit, "manual"), (removed["commit"]["hash"], removed["commit"]["attached_by"])
        )
        self.assertEqual([], self.attached())
        self.assertEqual([commit], self.hashes(project=PROJECT), "detached, it is on no card again")
        [detached] = self.conn.execute(
            "SELECT e.author, c.identity_source FROM work_item_events e"
            " JOIN execution_events c ON c.id = e.call_id WHERE e.action = 'commit_detached'"
        ).fetchall()
        self.assertEqual(("user", "browser"), tuple(detached))

    def test_a_write_is_refused_with_the_commit_refusal_and_writes_nothing(self) -> None:
        task = self.task("Refused")
        commit, _line = self.commit()
        cases = (
            (
                {"reference": task, "repository": PROJECT, "hash": "0" * 40},
                f"[commit] {'0' * 40} is not a commit in {PROJECT}",
            ),
            (
                {"reference": task, "repository": PROJECT, "hash": commit[:9], "remove": True},
                f"[commit] {PROJECT} {commit[:9]} is not attached to {task}",
            ),
            (
                {"reference": task, "repository": PROJECT, "hash": commit, "label": "x"},
                "request has unknown fields",
            ),
        )
        for payload, message in cases:
            with self.subTest(payload=payload):
                self.assertEqual(message, self.refused(WRITE, payload))
        self.assertEqual([], self.attached())
        self.assertEqual([commit], self.hashes(project=PROJECT))


class ScopeTests(ApiCase):
    def test_a_space_reads_the_projects_the_registry_binds_to_it(self) -> None:
        own = self.stored(PROJECT, "a")
        default = self.stored(DEFAULT, "b")
        elsewhere = self.stored(UNBOUND, "c")
        # Never on the list: a commit no session reported, and one a rewrite replaced.
        self.stored(PROJECT, "d", session=None)
        self.stored(PROJECT, "e")
        self.conn.execute(
            "UPDATE commits SET rewritten_to = (SELECT commit_id FROM commits WHERE hash = ?)"
            " WHERE hash = ?",
            (own, "e" * 40),
        )
        self.conn.commit()

        self.assertEqual({own, default}, set(self.hashes(space="MAIN")))
        self.assertEqual(2, self.listed(space="MAIN")["total"])
        self.assertEqual([elsewhere], self.hashes(project=UNBOUND))
        self.assertEqual([own], self.hashes(project=PROJECT))

        # The binding is the registry's: unbind R, and the space's list loses its commits.
        scope = str(read_store_metadata(self.conn)["data_scope_id"])
        space = planning_space_entity({"data_scope_id": scope, "space_key": "MAIN"})
        bound = project_entry(DEFAULT, self.place.base / DEFAULT)
        bound["planning_binding"] = {**space, "default": True}
        (self.place.local / "Valkama" / "projects.json").write_bytes(
            registry_bytes([project_entry(PROJECT, self.place.repository), bound])
        )
        self.assertEqual([default], self.hashes(space="MAIN"))
        self.assertEqual([own], self.hashes(project=PROJECT))

    def test_without_a_space_or_a_project_the_whole_store_is_read(self) -> None:
        own = self.stored(PROJECT, "a")
        default = self.stored(DEFAULT, "b")
        elsewhere = self.stored(UNBOUND, "c")
        # Never on the list: a commit no session reported, and one a rewrite replaced.
        self.stored(UNBOUND, "d", session=None)
        self.stored(UNBOUND, "e")
        self.conn.execute(
            "UPDATE commits SET rewritten_to = (SELECT commit_id FROM commits WHERE hash = ?)"
            " WHERE hash = ?",
            (elsewhere, "e" * 40),
        )
        self.conn.commit()

        answer = self.listed()
        self.assertEqual(3, answer["total"])
        self.assertEqual({own, default, elsewhere}, {e["hash"] for e in answer["items"]})
        self.assertNotEqual({None}, {entry["display_name"] for entry in answer["items"]})
        limited = self.listed(limit=1)
        self.assertEqual((3, 1), (limited["total"], len(limited["items"])))

        # The whole store asks the registry only for the names: unreadable, it names none.
        (self.place.local / "Valkama" / "projects.json").write_bytes(b"{")
        answer = self.listed()
        self.assertEqual(3, answer["total"])
        self.assertEqual({None}, {entry["display_name"] for entry in answer["items"]})

    def test_a_space_and_a_project_together_are_refused(self) -> None:
        self.assertEqual(
            "[commit] the commits on no card are read by a space or by a project, not both",
            self.refused(f"{LIST}?{urlencode({'space': 'MAIN', 'project': PROJECT})}"),
        )
        self.assertEqual(
            "no planning space named NOPE", self.refused(f"{LIST}?{urlencode({'space': 'NOPE'})}")
        )

    def test_since_keeps_the_commits_made_from_that_time_on(self) -> None:
        # 07:00 in UTC, written with its offset as Git gives it; then 08:00 and 09:00 UTC.
        early = self.stored(PROJECT, "a", committed_at="2026-11-20T10:00:00+03:00")
        middle = self.stored(PROJECT, "b", committed_at="2026-11-20T08:00:00Z")
        late = self.stored(PROJECT, "c", committed_at="2026-11-20T09:00:00+00:00")
        self.assertEqual([late, middle, early], self.hashes(project=PROJECT))
        answer = self.listed(project=PROJECT, since="2026-11-20T08:00:00Z")
        self.assertEqual(
            (2, [late, middle]), (answer["total"], [e["hash"] for e in answer["items"]])
        )
        self.assertEqual([late], self.hashes(project=PROJECT, since="2026-11-20T11:30:00+03:00"))
        self.assertEqual(
            "since must include a timezone",
            self.refused(
                f"{LIST}?{urlencode({'project': PROJECT, 'since': '2026-11-20T08:00:00'})}"
            ),
        )
        self.assertEqual(
            "since must be an ISO timestamp",
            self.refused(f"{LIST}?{urlencode({'project': PROJECT, 'since': 'yesterday'})}"),
        )

    def test_limit_is_a_hundred_unasked_and_five_hundred_at_most_and_total_counts_all(
        self,
    ) -> None:
        for index in range(101):
            self.conn.execute(
                "INSERT INTO commits(project_id, hash, subject, committed_at, session_id,"
                " client, reported_at) VALUES (?,?,'',?,?,'codex','2026-11-20T08:00:00Z')",
                (
                    PROJECT,
                    f"{index:040x}",
                    f"2026-11-20T08:{index // 60:02d}:{index % 60:02d}Z",
                    CODEX,
                ),
            )
        self.conn.commit()
        unasked = self.listed(project=PROJECT)
        self.assertEqual(101, unasked["total"])
        self.assertEqual(
            [f"{index:040x}" for index in range(100, 0, -1)],
            [entry["hash"] for entry in unasked["items"]],
        )
        two = self.listed(project=PROJECT, limit=2)
        self.assertEqual(
            (101, [f"{100:040x}", f"{99:040x}"]), (two["total"], [e["hash"] for e in two["items"]])
        )
        self.assertEqual(101, len(self.listed(project=PROJECT, limit=500)["items"]))
        self.assertEqual((101, []), tuple(self.listed(project=PROJECT, limit=0).values()))
        self.assertEqual(
            "limit must be between 0 and 500",
            self.refused(f"{LIST}?{urlencode({'project': PROJECT, 'limit': 501})}"),
        )
        self.assertEqual(
            "limit must be a non-negative integer",
            self.refused(f"{LIST}?{urlencode({'project': PROJECT, 'limit': -1})}"),
        )
