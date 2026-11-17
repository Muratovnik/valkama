"""No surface shows the service state of an accepted open goal or stage.

An accepted open goal or stage stands in a service state that is the store's own:
no reader is shown its key, its category or its name. Each surface answers on one
tree with accepted goals and stages at every depth (`tests.planning_tree.oracle`),
and every answer is read whole: no value in it is `container`, no text in it holds
the service state's name, and a record of an accepted open goal or stage shows no
state and the `container_state` the work model gives it, while every other record
shows its state.

The surfaces are taken from the registries that publish them: the MCP tools, the
Planning reads and writes over HTTP, the Exact Project routes and the views the
event stream pushes. A new entry in one of them that this file neither calls nor
names fails it. What reaches a reader by no registry is listed by hand: the hook's
events, the summary, the release check, the federated search, the export and the
Mermaid graph.

Each write runs on its own copy of the tree. A write that changes which goals and
stages stand accepted and open says so (`_Accepting`): one that accepts a goal or a
stage, confirms one, creates one already accepted, opens a closed one again, files
work under a stage, moves an accepted one out or converts a task into one and back is read
against the tree as that write leaves it, and `ACCEPTING` names the eight. The Planning routes write as the owner's interface
does, bound as the person's writes; the MCP tools as an agent's.
"""

from __future__ import annotations

import contextlib
import importlib
import inspect
import io
import json
import os
import re
import shutil
import sqlite3
import sys
import tempfile
import unittest
import uuid
from collections.abc import Callable, Iterator
from datetime import UTC, datetime, timedelta
from pathlib import Path
from unittest import mock

from server import cli, federation, http_surface, mcp_surface, processes, released, store
from server.hooks import notify
from server.ops import export
from server.planning import (
    api,
    calls,
    exact_api,
    held,
    item_tree,
    leases,
    live_frame,
    person_events,
    service,
    states,
    views,
)
from server.planning import model as planning_model
from server.store_identity.metadata import read_store_metadata
from server.store_identity.refs import planning_space_entity
from tests.planning_tree import ORACLE_DERIVED, oracle
from tests.registry_fixtures import project_binding, project_entry, registry_bytes

#: The service state's name in this store: no answer may hold it.
MARKER = "Marker-of-the-service-state"
KEY = "OR"
PROJECT = "or"
SESSION = "019a3c2e-7777-7c11-9e0f-2f4b6d8a1c3e"
#: Days around the hours the tree's facts are placed at, for a read over a period.
VOLUMES_PERIOD = {"from": "2026-11-19", "to": "2026-11-22", "utc_offset": "0"}

#: The writes that change which goals and stages stand accepted and open.
ACCEPTING = frozenset(
    {
        "a goal or stage accepted: moved from triage to the service state",
        "a goal or stage confirmed: moved from the service state to completed",
        "a goal created that stands accepted at once",
        "a closed goal or stage opened again by a move to ready",
        "an item filed under a stage",
        "an accepted stage moved out: from the service state to triage, a goal",
        "an accepted task converted into a goal: from ready to the service state",
        "an accepted goal with nothing under it converted into a task: to ready",
    }
)
#: The name `_Accepting` gives the item its write creates.
NEW = "new"

Args = Callable[["Surfaces"], dict]


class _Accepting:
    """A write's arguments, and what the goals and stages it changes then derive.

    `derived` maps a name of the tree, or `NEW` for the item the write creates, to
    what that item derives once the write is made, or to None when it stands
    accepted and open no more.
    """

    def __init__(self, write: str, build: Args, **derived: str | None) -> None:
        assert write in ACCEPTING, write
        self.write = write
        self.build = build
        self.derived = derived

    def __call__(self, case: Surfaces) -> dict:
        return self.build(case)


def _ids(**names: str) -> Args:
    """Arguments that name items of the tree by their names in it."""

    def build(case: Surfaces) -> dict:
        return {key: case.refs[value] for key, value in names.items()}

    return build


def _with(base: Args, **extra: object) -> Args:
    def build(case: Surfaces) -> dict:
        found = base(case)
        for key, value in extra.items():
            found[key] = value(case) if callable(value) else value
        return found

    return build


def _none(_case: Surfaces) -> dict:
    return {}


SUMMARY = {"done": "Placed the tree", "next": "Nothing"}
FIELDS = [{"id": "go", "label": "Go on", "type": "boolean", "required": True, "options": []}]

#: Every MCP tool, by the arguments it is called with; a list calls it once for each.
MCP_READS: dict[str, list[Args]] = {
    "list_planning_spaces": [_none],
    "get_planning_space": [lambda _case: {"space": KEY}],
    "get_work_item": [_ids(id=name) for name in ("G", "S", "S2", "H", "K", "y", "X")],
    "list_work_items": [
        lambda _case: {"space": KEY},
        lambda _case: {"space": KEY, "kind": "goal"},
        lambda case: {"space": KEY, "parent": case.refs["G"]},
    ],
    "get_work_item_chain": [
        _ids(id="G"),
        _with(_ids(id="G"), scope="tree"),
        _with(_ids(id="S"), scope="tree"),
        _ids(id="y"),
    ],
    "search_work_items": [lambda _case: {"query": "item", "space": KEY}],
    "get_work_item_request": [lambda case: {"id": case.pending}],
    "list_work_item_requests": [_none, lambda _case: {"space": KEY}],
    "list_platform_modules": [_none],
}
MCP_WRITES: dict[str, list[Args]] = {
    "create_planning_space": [lambda _case: {"name": "Other", "key": "OX"}],
    "create_work_item": [
        lambda case: {"space": KEY, "title": "Under the goal", "parent": case.refs["G"]},
        _Accepting(
            "an item filed under a stage",
            lambda case: {
                "space": KEY,
                "title": "A stage under a stage",
                "kind": "stage",
                "parent": case.refs["S2"],
            },
            new="not_started",
        ),
        _Accepting(
            "a goal created that stands accepted at once",
            lambda _case: {
                "space": KEY,
                "title": "A goal asked of an agent",
                "kind": "goal",
                "acceptance": "assignment",
            },
            new="not_started",
        ),
    ],
    "claim_work_item": [_ids(id="b")],
    "claim_ready_work_item": [lambda _case: {"space": KEY}],
    "claim_work_item_checklist_item": [_with(_ids(id="b"), item_id=lambda case: case.step)],
    "merge_work_items": [lambda case: {"id": case.refs["y"], "items": [case.refs["u"]]}],
    "apply_work_item_changes": [
        _with(_ids(id="G"), comment={"body": "A note on the goal"}),
        _with(_ids(id="S"), summary=SUMMARY, update={"labels_add": ["stage"]}),
        _with(_ids(id="b"), claim=True, checklist=[{"text": "One step"}]),
        _with(_ids(id="z"), transition={"state": "blocked", "reason": "waits"}),
        _Accepting(
            "a goal or stage accepted: moved from triage to the service state",
            _with(_ids(id="E"), transition={"state": "ready", "acceptance": "assignment"}),
            E="not_started",
        ),
        _Accepting(
            "a goal or stage confirmed: moved from the service state to completed",
            _with(_ids(id="K"), summary=SUMMARY, transition={"state": "done"}),
            K=None,
        ),
        _Accepting(
            "a closed goal or stage opened again by a move to ready",
            _with(_ids(id="D"), transition={"state": "ready"}),
            D="awaiting_confirmation",
        ),
        _Accepting(
            "an accepted stage moved out: from the service state to triage, a goal",
            _with(_ids(id="S2"), move_out={"reason": "It is a goal of its own"}),
            S2=None,
        ),
        _Accepting(
            "an accepted task converted into a goal: from ready to the service state",
            _with(_ids(id="y"), convert={"to": "goal"}),
            y="not_started",
        ),
        _Accepting(
            "an accepted goal with nothing under it converted into a task: to ready",
            _with(_ids(id="H"), convert={"to": "task"}),
            H=None,
        ),
    ],
    "delete_work_item": [_ids(id="u")],
    "create_work_item_request": [
        _with(_ids(id="S"), kind="question", prompt="Go on?", fields=FIELDS)
    ],
    "answer_work_item_request": [
        lambda case: {"id": case.pending, "answers": {"go": True}, "expected_revision": 0}
    ],
    "expire_work_item_request": [lambda case: {"id": case.pending, "expected_revision": 0}],
}
#: The tools that read no state, and what each reads instead.
MCP_WITHOUT_STATE = {"read_work_item_image": "an image's bytes, by its hash"}


def _query(**values: str) -> dict[str, list[str]]:
    return {key: [value] for key, value in values.items()}


def _q(build: Callable[[Surfaces], dict[str, str]]) -> Callable[[Surfaces], dict]:
    return lambda case: _query(**build(case))


HTTP_READS: dict[str, list[Args]] = {
    "/api/planning": [_none, _q(lambda _case: {"space": KEY})],
    "/api/planning/spaces": [_none],
    "/api/planning/graph": [_q(lambda _case: {"space": KEY})],
    "/api/planning/activity": [_none],
    "/api/planning/work-items": [_q(lambda _case: {"space": KEY})],
    "/api/planning/work-item": [_q(_ids(id=name)) for name in ("G", "y")],
    "/api/planning/work-item/chain": [
        _q(lambda case: {"id": case.refs["G"], "scope": "tree"}),
        _q(lambda case: {"id": case.refs["y"]}),
    ],
    "/api/planning/work-item/usage": [_q(lambda case: {"id": case.refs["G"]})],
    "/api/planning/session/usage": [_q(lambda _case: {"session_id": SESSION})],
    "/api/planning/search": [_q(lambda _case: {"q": "item", "space": KEY})],
    "/api/planning/requests": [_none],
    "/api/planning/request": [_q(lambda case: {"id": case.pending})],
    "/api/planning/held": [_q(lambda _case: {"session": SESSION})],
    "/api/planning/commits/unattached": [
        _q(lambda _case: {"space": KEY}),
        _q(lambda _case: {"project": PROJECT}),
    ],
    "/api/planning/volumes": [
        _q(lambda _case: {"scope_kind": "global", **VOLUMES_PERIOD}),
        lambda case: _exact_read(case, **VOLUMES_PERIOD),
    ],
    "/api/planning/goal-volumes": [_q(_ids(id=name)) for name in ("G", "S")],
}
HTTP_WRITES: dict[str, list[Args]] = {
    "/api/planning/spaces": [lambda _case: {"name": "Other", "key": "OX"}],
    "/api/planning/space/settings": [lambda _case: {"space": KEY, "launch_place": "item_project"}],
    "/api/planning/work-items": [
        lambda case: {"space": KEY, "title": "Under the goal", "parent": case.refs["G"]},
        _Accepting(
            "an item filed under a stage",
            lambda case: {
                "space": KEY,
                "title": "A stage under a stage",
                "kind": "stage",
                "parent": case.refs["S2"],
            },
            new="not_started",
        ),
        _Accepting(
            "a goal created that stands accepted at once",
            lambda _case: {"space": KEY, "title": "The owner's goal", "kind": "goal"},
            new="not_started",
        ),
    ],
    "/api/planning/work-item/update": [
        _with(_ids(id="G"), title="The goal, renamed"),
        _with(_ids(id="S2"), priority="high"),
    ],
    "/api/planning/work-item/delete": [_ids(id="u")],
    "/api/planning/work-item/transition": [
        _with(_ids(id="z"), state="blocked", reason="waits"),
        _Accepting(
            "a goal or stage accepted: moved from triage to the service state",
            _with(_ids(id="E"), state="ready"),
            E="not_started",
        ),
        _Accepting(
            "a closed goal or stage opened again by a move to ready",
            _with(_ids(id="D"), state="ready"),
            D="awaiting_confirmation",
        ),
    ],
    "/api/planning/work-item/defer": [
        _with(_ids(id="z"), until="2099-01-01", reason="waits for the vendor"),
    ],
    "/api/planning/work-item/move-out": [
        _with(_ids(id="e"), reason="It belongs to no stage"),
        _Accepting(
            "an accepted stage moved out: from the service state to triage, a goal",
            _with(_ids(id="S2"), reason="It is a goal of its own"),
            S2=None,
        ),
    ],
    "/api/planning/work-item/convert": [
        _Accepting(
            "an accepted task converted into a goal: from ready to the service state",
            _with(_ids(id="y"), to="goal"),
            y="not_started",
        ),
        _Accepting(
            "an accepted goal with nothing under it converted into a task: to ready",
            _with(_ids(id="H"), to="task"),
            H=None,
        ),
    ],
    "/api/planning/work-item/claim": [_ids(id="b")],
    "/api/planning/work-item/claim-ready": [lambda _case: {"space": KEY}],
    "/api/planning/work-item/checklist": [_with(_ids(id="b"), items=[{"text": "Another"}])],
    "/api/planning/work-item/checklist/claim": [
        _with(_ids(id="b"), item_id=lambda case: case.step)
    ],
    "/api/planning/work-item/checklist/tick": [_with(_ids(id="b"), item_id=lambda case: case.step)],
    "/api/planning/work-item/link": [
        _with(_ids(id="X", other="S"), kind="relates-to"),
        _with(_ids(id="H", other="z"), kind="blocks"),
    ],
    "/api/planning/work-item/merge": [
        lambda case: {"id": case.refs["y"], "items": [case.refs["u"]]}
    ],
    "/api/planning/work-item/pin": [_with(_ids(id="G"), pinned=True)],
    "/api/planning/work-item/summary": [_with(_ids(id="K"), summary=SUMMARY)],
    "/api/planning/work-item/comment": [_with(_ids(id="S"), body="A note on the stage")],
    "/api/planning/work-item/comment/resolve": [
        _with(_ids(id="G"), comment_id=lambda case: case.comment, resolution="Settled")
    ],
    "/api/planning/work-item/report": [_with(_ids(id="H"), report=SUMMARY)],
    "/api/planning/work-item/summary/select": [
        _with(
            _ids(id="G"),
            comment_id=lambda case: case.report,
            expected_revision=lambda case: case.revision,
        )
    ],
    "/api/planning/work-item/ref": [
        _with(_ids(id="S"), kind="url", value="https://example.invalid/stage")
    ],
    "/api/planning/work-item/commit": [
        _with(_ids(reference="S"), repository=PROJECT, hash=lambda case: case.commits["b"]),
        _with(_ids(reference="G"), repository=PROJECT, hash=lambda case: case.commits["G"]),
    ],
    "/api/planning/work-item/apply": [
        _with(_ids(id="G"), comment={"body": "A note"}, summary=SUMMARY),
        _Accepting(
            "a goal or stage confirmed: moved from the service state to completed",
            _with(_ids(id="K"), summary=SUMMARY, transition={"state": "done"}),
            K=None,
        ),
    ],
    "/api/planning/work-item/request": [
        _with(_ids(id="G"), kind="question", prompt="Go on?", fields=FIELDS)
    ],
    "/api/planning/request/answer": [
        lambda case: {"id": case.pending, "answers": {"go": True}, "expected_revision": 0}
    ],
    "/api/planning/request/change": [
        lambda case: {"id": case.answered, "answers": {"go": False}, "expected_revision": 1}
    ],
    "/api/planning/request/decline": [lambda case: {"id": case.pending, "expected_revision": 0}],
    "/api/planning/request/expire": [lambda case: {"id": case.pending, "expected_revision": 0}],
}


def _exact(case: Surfaces, **extra: str) -> dict:
    """The fields that name the space exactly: a read's, and a write's with no kind."""

    return {"data_scope_id": case.data_scope_id, "space_key": KEY, **extra}


def _exact_read(case: Surfaces, **extra: str) -> dict[str, list[str]]:
    return _query(scope_kind="space", **_exact(case, **extra))


EXACT_READS: dict[str, list[Args]] = {
    "/api/platform/planning": [
        _exact_read,
        lambda _case: _query(scope_kind="global"),
    ],
    "/api/modules/planning/work-item": [
        lambda case, name=name: _exact_read(case, reference=case.refs[name])
        for name in ("G", "S2", "y")
    ],
    "/api/modules/planning/search": [lambda _case: _query(q="item")],
    "/api/modules/planning/requests": [_exact_read],
    "/api/modules/planning/request": [lambda case: _exact_read(case, id=case.pending)],
}
EXACT_WRITES: dict[str, list[Args]] = {
    "/api/modules/planning/request": [
        lambda case: {
            **_exact(case),
            "id": case.refs["S"],
            "kind": "question",
            "prompt": "Go on?",
            "fields": FIELDS,
        }
    ],
    "/api/modules/planning/request/answer": [
        lambda case: {
            **_exact(case),
            "id": case.pending,
            "answers": {"go": True},
            "expected_revision": 0,
        }
    ],
    "/api/modules/planning/request/change": [
        lambda case: {
            **_exact(case),
            "id": case.answered,
            "answers": {"go": False},
            "expected_revision": 1,
        }
    ],
    "/api/modules/planning/request/decline": [
        lambda case: {**_exact(case), "id": case.pending, "expected_revision": 0}
    ],
    "/api/modules/planning/request/expire": [
        lambda case: {**_exact(case), "id": case.pending, "expected_revision": 0}
    ],
}

#: What the event stream pushes for each of its views.
STREAMED: dict[str, Callable[[sqlite3.Connection], object]] = {
    "planning": lambda conn: views.planning_payload(conn, space=KEY),
    "spaces": lambda conn: {"planning_spaces": service.list_planning_spaces(conn)},
    "activity": views.activity_feed,
    "live": live_frame.frame,
}
#: What a view holds that its check reads, by the last key of where it is and its value.
STREAMED_HOLDS: dict[str, tuple[Callable[[Surfaces], tuple[str, object]], ...]] = {
    "activity": (lambda _case: ("action", "opened"),),
    "live": tuple(
        lambda case, name=name: ("reference", case.refs[name]) for name in ("G", "S", "S2")
    ),
}


#: Every place a state leaves the server, by how it gives it: 13 build it through
#: `states.public_state`, 15 read the record that function published and 4 read the
#: history. Each names what its source holds for that: a builder its call of the
#: boundary or what carries the boundary's answer on, a reader of a record the
#: field it reads instead of the state, a reader of the history the entry it tells.
PLACES: tuple[tuple[str, str, str, str], ...] = (
    ("builds", "server.planning.read_model", "_record", "states.public_state("),
    ("builds", "server.planning.read_model", "end_state", "states.public_state("),
    ("builds", "server.planning.chain", "chain", "states.public_state("),
    ("builds", "server.planning.exact_api", "_space_view", "states.public_state("),
    ("builds", "server.planning.held", "_item", "states.public_state("),
    ("builds", "server.planning.live_frame", "_item", "states.public_state("),
    ("builds", "server.planning.live_frame", "_Item", "accepted_open"),
    ("builds", "server.planning.live_frame", "_row", "container_state"),
    ("builds", "server.released", "_open_commits", "s.key, s.name, s.category, s.is_terminal"),
    ("builds", "server.released", "released_items", "states.public_state("),
    ("builds", "server.released", "render", "item['state']"),
    ("builds", "server.planning.views", "stale_claims", "states.public_state("),
    ("builds", "server.planning.service", "_fold", "states.public_state("),
    ("reads the record", "server.planning.chain", "_counts", "by_container_state"),
    ("reads the record", "server.planning.chain", "_origins", 'member["open"]'),
    ("reads the record", "server.planning.views", "graph_mermaid", 'node["container_state"]'),
    ("reads the record", "server.planning.views", "MERMAID_SHAPES", "awaiting_confirmation"),
    ("reads the record", "server.planning.acknowledgements", "_base", 'item["open"]'),
    ("reads the record", "server.planning.api", "_apply_step", "container_state"),
    ("reads the record", "server.planning.api", "_apply", 'answer["open"]'),
    ("reads the record", "server.planning.tools", "_compact_row", "container_state"),
    ("reads the record", "server.planning.tools", "_chain", 'member["open"]'),
    ("reads the record", "server.planning.tools", "_open_rank", 'member["state"] is not None'),
    ("reads the record", "server.planning.interactions", "search", 'item["container_state"]'),
    ("reads the record", "server.cli", "summary_main", "_shown_state"),
    ("reads the record", "server.executions.lifecycle", "_launch_reserved", '("goal", "stage")'),
    ("reads the record", "server.planning.read_model", "card", 'record["state"]'),
    ("reads the record", "server.hooks.held_note", "_task_line", 'item["state"]'),
    ("reads the history", "server.planning.views", "activity_feed", "('created', 'transitioned')"),
    ("reads the history", "server.planning.person_events", "_BLOCKER_CHANGES", "'opened'"),
    ("reads the history", "server.planning.person_events", "_event_entry", "OPENED"),
    ("reads the history", "server.hooks.notify", "_thread", "blocker_changed"),
)


def _every_stale_claim(conn: sqlite3.Connection) -> list[dict]:
    """The abandoned claims of the space a decade on, when every claim in it has lapsed."""

    later = datetime.now(UTC) + timedelta(days=3650)
    with mock.patch.object(leases, "utc_now", return_value=later):
        return views.stale_claims(conn, space=KEY)


def _walk(value: object, path: str = "") -> Iterator[tuple[str, object]]:
    yield path, value
    if isinstance(value, dict):
        for key, inner in value.items():
            yield from _walk(inner, f"{path}.{key}")
    elif isinstance(value, list | tuple):
        for index, inner in enumerate(value):
            yield from _walk(inner, f"{path}[{index}]")


class Surfaces(unittest.TestCase):
    refs: dict[str, str]
    accepted: dict[str, str]
    pending: str
    answered: str
    step: str
    comment: int
    report: int
    revision: int
    data_scope_id: str
    commits: dict[str, str]

    @classmethod
    def setUpClass(cls) -> None:
        cls.home = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        root = Path(cls.home.name)
        cls.template = root / "tree.sqlite3"
        cls.repository = str(root / "product")
        environment = {
            "VALKAMA_DB": str(cls.template),
            "USERPROFILE": cls.home.name,
            "HOME": cls.home.name,
            "LOCALAPPDATA": cls.home.name,
            "GIT_CONFIG_NOSYSTEM": "1",
            "GIT_CONFIG_GLOBAL": os.devnull,
        }
        cls.environment = mock.patch.dict(os.environ, environment)
        cls.environment.start()
        conn = store.connect()
        try:
            cls._place(conn)
        finally:
            conn.close()

    @classmethod
    def tearDownClass(cls) -> None:
        cls.environment.stop()
        cls.home.cleanup()

    @classmethod
    def _place(cls, conn: sqlite3.Connection) -> None:
        tree = oracle(conn, KEY)
        cls.refs = dict(tree.refs)
        cls.accepted = {tree.refs[name]: state for name, state in ORACLE_DERIVED.items()}
        checklist = service.set_checklist(conn, tree.refs["b"], [{"text": "Read the parser"}])
        cls.step = str(checklist["checklist"][0]["id"])
        cls.comment = int(service.comment_work_item(conn, tree.refs["G"], "A word")["comment_id"])
        reported = service.report_work_item(conn, tree.refs["G"], SUMMARY)
        cls.report = int(reported["comments"][-1]["id"])
        asked = {"kind": "question", "prompt": "Go on?", "fields": FIELDS}
        cls.pending = api.handle_post(
            conn, "/api/planning/work-item/request", {"id": tree.refs["G"], **asked}
        )[1]["request_id"]
        cls.answered = api.handle_post(
            conn, "/api/planning/work-item/request", {"id": tree.refs["K"], **asked}
        )[1]["request_id"]
        api.handle_post(
            conn,
            "/api/planning/request/answer",
            {"id": cls.answered, "answers": {"go": True}, "expected_revision": 0},
        )
        # Each goal and stage names a commit of the release, as a task does.
        os.makedirs(cls.repository)
        commits = {}
        cls._git("init", "-b", "main")
        cls._git("commit", "--allow-empty", "-m", "chore: before the release")
        cls._git("tag", "start")
        for name in ("G", "S2", "H", "b"):
            cls._git("commit", "--allow-empty", "-m", f"feat: the work of {name}")
            commits[name] = cls._git("rev-parse", "HEAD")
            # Attached as the project the registry places at the repository.
            commit_id = conn.execute(
                "INSERT INTO commits(project_id, hash, subject, reported_at)"
                " VALUES (?, ?, ?, '2026-01-02T03:04:05Z')",
                (PROJECT, commits[name], f"feat: the work of {name}"),
            ).lastrowid
            conn.execute(
                "INSERT INTO work_item_commits(work_item_id, commit_id, attached_by)"
                " VALUES (?, ?, 'manual')",
                (tree.ids[name], commit_id),
            )
        cls.commits = commits
        # The live frame shows what holds live work and what is pinned, and no session
        # holds anything here: pinned, the goal and its stages are its rows.
        for name in ("G", "S", "S2"):
            service.pin_work_item(conn, tree.refs[name], True)
        cls._told(conn, tree.ids)
        # Its name is in no answer: it is the one text an answer cannot hold by chance.
        conn.execute(
            "UPDATE workflow_states SET name = ? WHERE category = ?",
            (MARKER, planning_model.SERVICE_CATEGORY),
        )
        conn.commit()
        cls.revision = int(service.get_work_item(conn, tree.refs["G"])["revision"])
        cls.data_scope_id = str(read_store_metadata(conn)["data_scope_id"])
        entry = project_entry(
            PROJECT,
            cls.repository,
            board="Oracle board",
            bindings=[
                project_binding(
                    PROJECT,
                    planning_space_entity({"data_scope_id": cls.data_scope_id, "space_key": KEY}),
                )
            ],
        )
        cls.registry = registry_bytes([entry])

    @staticmethod
    def _told(conn: sqlite3.Connection, ids: dict[str, str]) -> None:
        """A history every reader of it tells something of: an agent's write, then a person's.

        The tree is placed in SQL, so no call made its events. These are written as a
        call writes them, each beside the call row that proved who made it: S, which
        blocks y, and G come to stand accepted and open by an agent's write, which
        also moves X, which blocks G, and claims a; then the person moves y and a and
        opens G.
        """

        def call(source: str, tool: str) -> int:
            return int(
                conn.execute(
                    "INSERT INTO execution_events(event_uid, kind, identity_state,"
                    " identity_source, tool, session_id) VALUES (?, 'tool_call', 'confirmed',"
                    " ?, ?, ?)",
                    (str(uuid.uuid4()), source, tool, SESSION if source == "mcp" else None),
                ).lastrowid
            )

        def event(name: str, action: str, detail: str, made: int) -> None:
            conn.execute(
                "INSERT INTO work_item_events(work_item_id, action, detail, author, call_id)"
                " VALUES (?, ?, ?, 'history', ?)",
                (ids[name], action, detail, made),
            )

        agent = call("mcp", "apply_work_item_changes")
        event("S", "opened", "", agent)
        event("G", "opened", "accepted as asked", agent)
        event("X", "transitioned", "triage: put back", agent)
        event("a", "claimed", "worker of a", agent)
        person = call("browser", "/api/planning/work-item/transition")
        event("y", "transitioned", "ready", person)
        event("a", "transitioned", "dev", person)
        event("G", "opened", "confirmed by the owner", person)

    @classmethod
    def _git(cls, *args: str) -> str:
        done = processes.run_text(
            [
                "git",
                "-C",
                cls.repository,
                "-c",
                "user.name=Test User",
                "-c",
                "user.email=test@example.invalid",
                *args,
            ]
        )
        assert done.returncode == 0, done.stderr
        return done.stdout.strip()

    @contextlib.contextmanager
    def copy(self) -> Iterator[sqlite3.Connection]:
        """A store of its own holding the tree, open as the server opens its store."""

        directory = Path(self.home.name) / uuid.uuid4().hex
        directory.mkdir()
        path = directory / "valkama.sqlite3"
        source = sqlite3.connect(self.template)
        target = sqlite3.connect(path)
        try:
            source.backup(target)
        finally:
            target.close()
            source.close()
        registry = mock.patch(
            "server.projects.project_registry._read_registry_bytes", return_value=self.registry
        )
        with mock.patch.dict(os.environ, {"VALKAMA_DB": str(path)}), registry:
            conn = store.connect()
            try:
                yield conn
            finally:
                conn.close()
                shutil.rmtree(directory, ignore_errors=True)

    def shows_no_service_state(self, answer: object, where: str) -> None:
        text = answer if isinstance(answer, str) else json.dumps(answer, default=str)
        self.assertNotIn(MARKER, text, where)
        self.assertNotIn("search_failed", text, where)
        for path, value in _walk(answer):
            self.assertNotEqual("container", value, f"{where}: {path}")
            if isinstance(value, dict):
                self._record(value, f"{where}: {path}")

    def _record(self, record: dict, where: str) -> None:
        if "event_id" in record:
            # An event of the history: the category its detail names, not the item's state.
            return
        names = ("state", "state_name", "state_category", "state_key")
        reference = record.get("reference")
        exact = reference is None and isinstance(record.get("work_item_ref"), dict)
        if exact:
            # Exact Project names its item by a ref; its `state` is the answer's envelope.
            reference = record["work_item_ref"].get("reference")
            names = ("state_name", "state_category", "state_key")
        shown = [key for key in names if key in record]
        if reference not in self.accepted or not shown:
            if reference in self.refs.values() and "title" in record:
                # Any other item of the tree shows the state it stands in.
                key = "state_key" if exact else "state"
                if key in shown:
                    self.assertNotIn(
                        record[key], (None, ""), f"{where}: {reference} shows its state"
                    )
            return
        derived = self.accepted[reference]
        if "container_state" not in record:
            # A line for a person: it names the state the goal or stage derives.
            self.assertEqual([derived], [record[key] for key in shown], f"{where}: {reference}")
            return
        for key in shown:
            self.assertIn(record[key], (None, ""), f"{where}: {reference} shows no {key}")
        self.assertEqual(derived, record["container_state"], f"{where}: {reference}")

    def each(
        self, calls: dict[str, list[Args]], run: Callable[[sqlite3.Connection, str, dict], object]
    ) -> None:
        for name, arguments in calls.items():
            for index, build in enumerate(arguments):
                where = f"{name} #{index}"
                with self.subTest(surface=where), self.copy() as conn:
                    answer = run(conn, name, build(self))
                    self.accepted = self.after(build, answer, where)
                    try:
                        self.shows_no_service_state(answer, where)
                    finally:
                        del self.accepted

    def after(self, build: Args, answer: object, where: str) -> dict[str, str]:
        """What the accepted open goals and stages derive once the write `build` names is made."""

        accepted = dict(type(self).accepted)
        if not isinstance(build, _Accepting):
            return accepted
        for name, derived in build.derived.items():
            reference = (
                planning_model.human_id(KEY, len(self.refs) + 1) if name == NEW else self.refs[name]
            )
            # The item the write changed is in its answer, or the check reads nothing of it.
            self.assertIn(f'"{reference}"', json.dumps(answer, default=str), where)
            if derived is None:
                accepted.pop(reference)
            else:
                accepted[reference] = derived
        return accepted

    # -- the registries ---------------------------------------------------------

    def test_every_mcp_tool_is_called_or_named(self) -> None:
        self.assertEqual(
            set(mcp_surface._OPS),
            set(MCP_READS) | set(MCP_WRITES) | set(MCP_WITHOUT_STATE),
        )
        self.assertFalse(set(MCP_READS) & set(MCP_WRITES))

    def test_every_planning_http_path_is_called(self) -> None:
        self.assertEqual(set(api.READ_PATHS), set(HTTP_READS))
        self.assertEqual(set(api.WRITE_PATHS), set(HTTP_WRITES))

    def test_every_exact_space_path_is_called(self) -> None:
        self.assertEqual(set(exact_api.READ_PATHS), set(EXACT_READS))
        self.assertEqual(set(exact_api.WRITE_PATHS), set(EXACT_WRITES))

    def test_every_streamed_view_is_called(self) -> None:
        self.assertEqual(set(http_surface._SSE_VIEWS), set(STREAMED))

    # -- the answers ------------------------------------------------------------

    def test_the_mcp_tools_show_no_service_state(self) -> None:
        def run(conn: sqlite3.Connection, name: str, arguments: dict) -> object:
            return mcp_surface.call_tool(conn, name, arguments)

        self.each(MCP_READS, run)
        self.each(MCP_WRITES, run)

    def test_planning_over_http_shows_no_service_state(self) -> None:
        self.each(HTTP_READS, lambda conn, path, query: api.handle_get(conn, path, query))

        def write(conn: sqlite3.Connection, path: str, payload: dict) -> object:
            with calls.bind(calls.browser(), path):
                return api.handle_post(conn, path, payload)

        self.each(HTTP_WRITES, write)

    def test_the_exact_space_routes_show_no_service_state(self) -> None:
        def read(conn: sqlite3.Connection, path: str, query: dict) -> object:
            return exact_api.handle_get(
                conn,
                os.environ["VALKAMA_DB"],
                path,
                query,
                item_loader=service.get_work_item,
                registry_reader=lambda: self.registry,
            )

        def write(conn: sqlite3.Connection, path: str, payload: dict) -> object:
            return exact_api.handle_post(
                conn, os.environ["VALKAMA_DB"], path, payload, registry_reader=lambda: self.registry
            )

        self.each(EXACT_READS, read)
        self.each(EXACT_WRITES, write)

    def test_the_streamed_views_show_no_service_state(self) -> None:
        for view, compute in STREAMED.items():
            with self.subTest(view=view), self.copy() as conn:
                answer = compute(conn)
                self.shows_no_service_state(answer, view)
                found = [(path.rsplit(".", 1)[-1], value) for path, value in _walk(answer)]
                for held in STREAMED_HOLDS.get(view, ()):
                    self.assertIn(held(self), found, view)

    def test_what_reaches_a_reader_by_no_registry_shows_no_service_state(self) -> None:
        with self.copy() as conn:
            graph = views.graph_payload(conn, space=KEY)
            outside: dict[str, object] = {
                "graph": graph,
                "mermaid": views.graph_mermaid(graph),
                "stale claims": _every_stale_claim(conn),
                "export": export.export_installation(conn),
                "federated search": federation.federated_search("item"),
            }
            report = released.released_items(
                conn, space=KEY, repository=self.repository, revisions="start..main"
            )
            outside["release check"] = report
            outside["release check, as text"] = released.render(report)
            telling: set[tuple[str, str]] = set()
            for name in ("y", "a", "G"):
                identity = conn.execute(
                    "SELECT work_item_id FROM work_items WHERE planning_space_id ="
                    " (SELECT planning_space_id FROM planning_spaces WHERE key = ?) AND number = ?",
                    (KEY, int(self.refs[name].rsplit("-", 1)[1])),
                ).fetchone()[0]
                for reader, entries in (
                    ("blocker", person_events.blocker_changes(conn, identity, 0)),
                    ("agents", person_events.agents_since(conn, identity, 0)),
                    (
                        "person",
                        [
                            (0, entry)
                            for entry in person_events.since_last_agent_write(conn, identity)
                        ],
                    ),
                ):
                    told = [entry for _call, entry in entries]
                    if told:
                        telling.add((reader, name))
                    outside[f"{reader} events of {name}"] = told
                    outside[f"{reader} events of {name}, as the hook prints them"] = [
                        notify._thread(entry) for entry in told
                    ]
            printed = io.StringIO()
            with contextlib.redirect_stdout(printed):
                cli.summary_main(KEY)
            outside["summary"] = printed.getvalue()
        self.assertEqual(
            sorted(self.refs[name] for name in ("G", "S2", "H")),
            sorted(
                item["reference"] for item in report["items"] if item["reference"] in self.accepted
            ),
            "the goals and stages that name a commit are in the release check",
        )
        self.assertEqual(
            {
                ("blocker", "y"),
                ("blocker", "G"),
                ("agents", "a"),
                ("agents", "G"),
                ("person", "y"),
                ("person", "a"),
                ("person", "G"),
            },
            telling,
            "each reader of the history tells what it has to",
        )
        # S opened, and it blocks y: the blocker reader tells that opening by the word
        # the person reader tells one by, as the state the blocker reached.
        self.assertIn(
            (self.refs["S"], person_events.OPENED),
            [(entry["blocker"], entry["state"]) for entry in outside["blocker events of y"]],
        )
        for name, answer in outside.items():
            with self.subTest(surface=name):
                self.shows_no_service_state(answer, name)

    def test_the_summary_counts_goals_and_stages_by_what_they_derive(self) -> None:
        with self.copy():
            printed = io.StringIO()
            with contextlib.redirect_stdout(printed):
                cli.summary_main(KEY)
        text = printed.getvalue()
        self.assertIn("in_progress 3", text)
        self.assertIn("not_started 1", text)
        self.assertIn("awaiting_confirmation 1", text)

    # -- the places a state leaves by ---------------------------------------------

    def test_each_place_says_how_it_gives_its_state(self) -> None:
        ways = [way for way, _module, _name, _token in PLACES]
        self.assertEqual(
            (13, 15, 4),
            (ways.count("builds"), ways.count("reads the record"), ways.count("reads the history")),
        )
        for way, module, name, token in PLACES:
            with self.subTest(place=f"{module}.{name}"):
                found = getattr(importlib.import_module(module), name)
                if isinstance(found, str):
                    text = found
                elif isinstance(found, dict):
                    text = " ".join(found)
                else:
                    text = inspect.getsource(found)
                self.assertIn(token, text, f"{module}.{name} {way}")

    def test_every_place_that_builds_a_state_asks_the_boundary_for_it(self) -> None:
        """Each builder is seen calling `states.public_state` while the tree is read."""

        asked: set[str] = set()
        boundary = states.public_state

        def spy(state: object) -> dict | None:
            caller = sys._getframe(1)
            while caller.f_code.co_name.startswith("<"):
                # A comprehension runs in a frame of its own; the place is the one around it.
                caller = caller.f_back  # type: ignore[assignment]
            asked.add(f"{caller.f_globals['__name__']}.{caller.f_code.co_name}")
            return boundary(state)  # type: ignore[arg-type]

        with self.copy() as conn, mock.patch.object(states, "public_state", spy):
            conn.execute(
                "UPDATE work_items SET claim_ref = ? WHERE work_item_id = ?",
                (f"codex (session {SESSION})", self.ids("a", conn)),
            )
            service.get_work_item(conn, self.refs["y"])
            chain_arguments = {"id": self.refs["G"], "scope": "tree"}
            mcp_surface.call_tool(conn, "get_work_item_chain", chain_arguments)
            views.graph_payload(conn, space=KEY)
            exact_api.handle_get(
                conn,
                os.environ["VALKAMA_DB"],
                "/api/platform/planning",
                _exact_read(self),
                registry_reader=lambda: self.registry,
            )
            held.held_by_session(conn, SESSION)
            live_frame.frame(conn)
            released.released_items(
                conn, space=KEY, repository=self.repository, revisions="start..main"
            )
            _every_stale_claim(conn)
            service.merge_work_items(conn, self.refs["y"], [self.refs["u"]])
        builders = {
            f"{module}.{name}"
            for way, module, name, mark in PLACES
            if way == "builds" and mark == "states.public_state("
        }
        self.assertEqual(set(), builders - asked)

    def test_the_mermaid_graph_draws_each_derived_state(self) -> None:
        self.assertLessEqual(set(item_tree.CONTAINER_STATES), set(views.MERMAID_SHAPES))

    def ids(self, name: str, conn: sqlite3.Connection) -> str:
        number = int(self.refs[name].rsplit("-", 1)[1])
        return str(
            conn.execute(
                "SELECT i.work_item_id FROM work_items i JOIN planning_spaces p"
                " ON p.planning_space_id = i.planning_space_id WHERE p.key = ? AND i.number = ?",
                (KEY, number),
            ).fetchone()[0]
        )

    def test_each_write_that_accepts_is_called_through_the_mcp_tools_and_over_http(self) -> None:
        for registry in (MCP_WRITES, HTTP_WRITES):
            called = {
                build.write
                for arguments in registry.values()
                for build in arguments
                if isinstance(build, _Accepting)
            }
            self.assertEqual(ACCEPTING, called)


#: Every word a list of categories may hold, a retired one included, so that a list
#: of the earlier model is found and refused rather than passed over.
CATEGORY_WORDS = frozenset(
    {*planning_model.PUBLIC_CATEGORIES, "backlog", "queued", "todo", "container"}
)
#: A list in prose: words in parentheses, separated by commas.
LISTED = re.compile(r"\(([a-z_]+(?:, [a-z_]+)+)\)")


def _category_lists(text: str) -> list[list[str]]:
    """The lists in a text that name categories: two or more of their words."""

    found = []
    for listed in LISTED.finditer(text):
        words = listed.group(1).split(", ")
        if len(CATEGORY_WORDS.intersection(words)) >= 2:
            found.append(words)
    return found


class PublishedCategoriesTests(unittest.TestCase):
    """What an agent reads of the categories, in prose and in the schemas, is the eight.

    The tool descriptions and the handshake text are prose a client sends a model
    whole, and no constant guards a sentence: a list written there once stayed the
    earlier model's after the model changed.
    """

    def published_texts(self) -> dict[str, str]:
        texts = {"handshake": mcp_surface.PLANNING_INSTRUCTIONS}
        for tool in mcp_surface.catalogue():
            for path, value in _walk(tool):
                if isinstance(value, str) and path.endswith((".description", ".title")):
                    texts[f"{tool['name']}{path}"] = value
        return texts

    def test_every_list_of_categories_in_the_prose_is_the_eight(self) -> None:
        named = set()
        for where, text in self.published_texts().items():
            for words in _category_lists(text):
                with self.subTest(text=where):
                    self.assertEqual(sorted(planning_model.PUBLIC_CATEGORIES), sorted(words))
                    named.add(where)
        self.assertIn("handshake", named, "the handshake names the eight categories")
        self.assertTrue(
            any(where.endswith(".state.description") for where in named),
            "a state argument names the categories it takes",
        )

    def test_every_enumeration_of_categories_in_the_schemas_is_the_eight(self) -> None:
        listed = 0
        for tool in mcp_surface.catalogue():
            for path, value in _walk(tool):
                if path.endswith(".enum") and CATEGORY_WORDS.intersection(value):
                    with self.subTest(argument=f"{tool['name']}{path}"):
                        self.assertEqual(list(planning_model.PUBLIC_CATEGORIES), value)
                        listed += 1
        self.assertGreater(listed, 0)


if __name__ == "__main__":
    unittest.main()
