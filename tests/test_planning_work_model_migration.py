"""The migration that carries a store Valkama 2.9 left to the work model.

Every store here is built as 2.9 left one -- the captured schema-17 catalog with
its word index, rows written as plain SQL in the shapes that build wrote them --
in a temporary directory, beside a registry of format 4 binding each space's
project to it and a file of item projects that names none, so every task takes its
space's project. The expectations are written out by hand from the rules
of the migration, item by item, rather than read back from the oracle the
migration computes, so a rule both readings got wrong still fails here.
"""

from __future__ import annotations

import contextlib
import hashlib
import io
import json
import os
import re
import shutil
import sqlite3
import sys
import tempfile
import unittest
from collections.abc import Callable, Iterator
from unittest import mock

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
from server import cli, store, store_backups, store_steps
from server.planning import images as planning_images
from server.planning import store as planning_store
from server.planning import words
from server.planning import work_model_migration as migration
from server.store_identity.refs import planning_space_entity
from tests import registry_fixtures, schema9, schema17

T0 = "2026-07-26T00:00:00Z"
T1 = "2026-08-01T10:00:00Z"
T2 = "2026-08-02T10:00:00Z"
T3 = "2026-08-03T10:00:00Z"
T4 = "2026-08-04T10:00:00Z"
T5 = "2026-08-05T10:00:00Z"
PICTURE = b"\x89PNG one picture"
#: The steps a migration of a 2.9 store reports, in the order it takes them.
STEP_NAMES = [f"M{number}" for number in range(17)]
#: Its postconditions in the order it checks them: a second run, then the fault check, last.
POSTCONDITION_NAMES = [
    *(f"P{number}" for number in range(1, 16)),
    *(f"P{number}" for number in range(18, 31)),
    "second-run",
    "recovery-point",
]

#: The work items of the space `WM`, by number: kind, state key, parent number,
#: holder, the step its holder claimed, labels, and the history, as (action,
#: detail, time). Every item was created at T0.
ITEMS: dict[int, tuple] = {
    1: ("epic", "backlog", None, "agent-a", "Plan it", [], [("created", "backlog", T1)]),
    2: (
        "task",
        "todo",
        1,
        "",
        None,
        [],
        [("created", "backlog", T2), ("transitioned", "todo: moved backlog -> todo", T3)],
    ),
    3: (
        "epic",
        "done",
        None,
        "stale-e3",
        None,
        [],
        [("created", "backlog", T1), ("transitioned", "dev", T2), ("transitioned", "done", T4)],
    ),
    4: ("task", "backlog", 3, "", "Look", [], [("created", "backlog", T2)]),
    5: (
        "task",
        "done",
        3,
        "stale-t5",
        None,
        [],
        [
            ("created", "backlog", T1),
            ("claimed", "", T2),
            ("transitioned", "dev", T3),
            ("transitioned", "done", T5),
        ],
    ),
    6: (
        "bug",
        "review",
        None,
        "",
        None,
        ["ui"],
        [("created", "backlog", T1), ("transitioned", "dev -> review", T3)],
    ),
    7: (
        "task",
        "dev",
        6,
        "agent-c",
        None,
        [],
        [("created", "backlog", T2), ("claimed", "", T3), ("transitioned", "dev", T3)],
    ),
    8: (
        "task",
        "dev",
        None,
        "",
        None,
        [],
        [("created", "backlog", T1), ("transitioned", "dev", T4)],
    ),
    9: (
        "task",
        "backlog",
        None,
        "",
        None,
        [],
        [
            ("created", "backlog", T1),
            ("transitioned", "todo", T2),
            ("transitioned", "todo -> backlog", T3),
        ],
    ),
    10: (
        "task",
        "cancelled",
        None,
        "",
        None,
        [],
        [("created", "backlog", T1), ("transitioned", "cancelled: not needed", T2)],
    ),
    11: (
        "task",
        "cancelled",
        None,
        "",
        None,
        [],
        [
            ("created", "backlog", T1),
            ("transitioned", "todo", T2),
            ("transitioned", "cancelled", T3),
        ],
    ),
    12: ("task", "done", None, "", None, [], []),
    13: ("epic", "backlog", None, "", None, [], [("created", "backlog", T1)]),
    14: (
        "task",
        "blocked",
        None,
        "agent-d",
        None,
        [],
        [
            ("created", "backlog", T1),
            ("claimed", "", T2),
            ("transitioned", "dev", T2),
            ("transitioned", "blocked: waits on the vendor", T3),
        ],
    ),
    15: (
        "epic",
        "dev",
        None,
        "",
        None,
        [],
        [("created", "backlog", T1), ("transitioned", "dev", T2)],
    ),
    16: ("epic", "backlog", 15, "", None, [], [("created", "backlog", T1)]),
    17: (
        "task",
        "dev",
        16,
        "agent-e",
        None,
        [],
        [("created", "backlog", T1), ("claimed", "", T3), ("transitioned", "dev", T3)],
    ),
    18: ("epic", "todo", None, "", None, [], [("created", "todo", T1)]),
    19: (
        "task",
        "done",
        18,
        "",
        None,
        [],
        [("created", "backlog", T1), ("transitioned", "done", T4)],
    ),
    20: ("task", "todo", 3, "", None, [], [("created", "todo", T2)]),
    21: (
        "task",
        "review",
        None,
        "stale-t21",
        None,
        [],
        [("created", "backlog", T1), ("transitioned", "review", T3)],
    ),
}

#: What each item of `WM` is after the migration: kind, the category it stands in,
#: when it was accepted (None when it is not), and when it started.
EXPECTED: dict[int, tuple[str, str, str | None, str | None]] = {
    1: ("container", "container", T3, None),
    2: ("task", "ready", T3, None),
    3: ("container", "completed", T2, None),
    4: ("task", "triage", None, None),
    5: ("task", "completed", T3, T2),
    6: ("container", "container", T3, None),
    7: ("task", "active", T3, T3),
    8: ("task", "ready", T4, T4),
    9: ("task", "triage", None, None),
    10: ("task", "cancelled", None, None),
    11: ("task", "cancelled", T2, None),
    12: ("task", "completed", T0, T0),
    13: ("container", "triage", None, None),
    14: ("task", "blocked", T2, T2),
    15: ("container", "container", T2, None),
    16: ("container", "container", T3, None),
    17: ("task", "active", T3, T3),
    18: ("container", "container", T1, None),
    19: ("task", "completed", T4, T4),
    20: ("task", "triage", None, None),
    21: ("task", "review", T3, T3),
}

#: A workflow someone shaped differently, key, name and category in position order.
OTHER_STATES = (
    ("inbox", "Inbox", "backlog"),
    ("next", "Next", "queued"),
    ("doing", "Doing", "active"),
    ("check", "Check", "review"),
    ("shipped", "Shipped", "completed"),
    ("stuck", "Stuck", "blocked"),
    ("dropped", "Dropped", "cancelled"),
)


def _step(text: str, holder: str) -> dict:
    return {"claimed_by": holder, "done": False, "done_by": "", "id": f"step-{text}", "text": text}


def populate(conn: sqlite3.Connection) -> dict[str, str]:
    """The rows of the store, as 2.9 wrote them; the ids by reference."""

    conn.row_factory = sqlite3.Row
    schema9.populate(conn)
    space = schema9.old_space(conn, project_id="work-model", name="Work model", key="WM")
    ids = {f"WM-{number}": f"00000000-0000-4000-8000-{number:012d}" for number in ITEMS}
    for number, (kind, state, parent, holder, step, labels, history) in ITEMS.items():
        identity = ids[f"WM-{number}"]
        checklist = [_step(step, holder or "agent-b")] if step else []
        conn.execute(
            "INSERT INTO work_items(work_item_id,planning_space_id,number,workflow_id,state_id,"
            "kind,parent_id,claim_ref,title,checklist,labels,position,revision,created_at,"
            "updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,1,?,?)",
            (
                identity,
                space["planning_space_id"],
                number,
                space["workflow_id"],
                space["states"][state],
                kind,
                ids[f"WM-{parent}"] if parent else None,
                holder,
                f"Searchable item {number} about migration",
                json.dumps(checklist, sort_keys=True, separators=(",", ":")),
                json.dumps(labels),
                float(number),
                T0,
                T0,
            ),
        )
        for action, detail, at in history:
            conn.execute(
                "INSERT INTO work_item_events(work_item_id,action,detail,author,created_at)"
                " VALUES(?,?,?,'agent',?)",
                (identity, action, detail, at),
            )
    conn.execute(
        "UPDATE planning_spaces SET next_number = 22 WHERE planning_space_id = ?",
        (space["planning_space_id"],),
    )
    other = _other_space(conn)
    for number, (state, history) in enumerate(
        (
            ("inbox", [("created", "inbox", T1)]),
            ("next", [("created", "inbox", T1), ("transitioned", "next", T2)]),
        ),
        start=1,
    ):
        identity = f"00000000-0000-4000-9000-{number:012d}"
        ids[f"ALT-{number}"] = identity
        conn.execute(
            "INSERT INTO work_items(work_item_id,planning_space_id,number,workflow_id,state_id,"
            "title,position,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)",
            (
                identity,
                other["planning_space_id"],
                number,
                other["workflow_id"],
                other["states"][state],
                f"Other item {number}",
                float(number),
                T0,
                T0,
            ),
        )
        for action, detail, at in history:
            conn.execute(
                "INSERT INTO work_item_events(work_item_id,action,detail,author,created_at)"
                " VALUES(?,?,?,'agent',?)",
                (identity, action, detail, at),
            )
    digest = hashlib.sha256(PICTURE).hexdigest()
    conn.execute(
        "INSERT INTO work_item_images(work_item_id,sha256,media_type,size) VALUES(?,?,?,?)",
        (ids["WM-1"], digest, "image/png", len(PICTURE)),
    )
    ids["space"] = str(space["planning_space_id"])
    ids["workflow"] = str(space["workflow_id"])
    ids["backlog"] = str(space["states"]["backlog"])
    ids["other_workflow"] = str(other["workflow_id"])
    return ids


def _other_space(conn: sqlite3.Connection) -> dict:
    space, workflow = "other-space", "other-workflow"
    states = {key: f"other-{key}" for key, _, _ in OTHER_STATES}
    conn.execute(
        "INSERT INTO planning_spaces(planning_space_id,project_id,name,key) VALUES(?,?,?,?)",
        (space, "other", "Other", "ALT"),
    )
    conn.execute(
        "INSERT INTO workflows(workflow_id,planning_space_id,name,initial_state_id)"
        " VALUES(?,?,'Shaped',?)",
        (workflow, space, states["inbox"]),
    )
    for position, (key, name, category) in enumerate(OTHER_STATES):
        conn.execute(
            "INSERT INTO workflow_states(state_id,workflow_id,key,name,category,position,"
            "is_terminal) VALUES(?,?,?,?,?,?,?)",
            (
                states[key],
                workflow,
                key,
                name,
                category,
                position,
                int(key in ("shipped", "dropped")),
            ),
        )
    conn.executemany(
        "INSERT INTO workflow_transitions(workflow_id,from_state_id,to_state_id) VALUES(?,?,?)",
        [(workflow, a, b) for a in states.values() for b in states.values() if a != b],
    )
    conn.execute("UPDATE planning_spaces SET next_number = 3 WHERE planning_space_id = ?", (space,))
    return {"planning_space_id": space, "workflow_id": workflow, "states": states}


def build(path: str) -> dict[str, str]:
    """A populated store as 2.9 leaves it, its picture beside it; the ids by reference."""

    schema17.build_2_9(path)
    conn = sqlite3.connect(path)
    try:
        ids = populate(conn)
        with schema17.words_as_2_9():
            words.bring_current(conn)
        conn.commit()
    finally:
        conn.close()
    folder = planning_images.directory_beside(path)
    os.makedirs(folder, exist_ok=True)
    with open(os.path.join(folder, hashlib.sha256(PICTURE).hexdigest()), "wb") as handle:
        handle.write(PICTURE)
    return ids


#: The store identity `schema17.build_2_9` writes, and the project of each space it holds.
DATA_SCOPE = "00000000-0000-4000-8000-000000000029"
SPACE_PROJECTS = {"KEEP": "kept", "WM": "work-model", "ALT": "other"}


def registry(
    case: unittest.TestCase,
    directory: str,
    bound: dict[str, str] | None = None,
    unbound: tuple[str, ...] = (),
    raw: bytes | None = None,
) -> str:
    """A registry of format 4 in a directory of its own, which `LOCALAPPDATA` names for
    the rest of the test: each project in `bound` bound to its space, by key, those in
    `unbound` to none. `raw` writes those bytes instead."""

    folder = os.path.join(directory, "localappdata")
    os.makedirs(os.path.join(folder, "Valkama"), exist_ok=True)
    entries = [
        {
            "project_id": project,
            "display_name": project.title(),
            "canonical_root": os.path.join(directory, "roots", project),
            "planning_binding": planning_space_entity(
                {"data_scope_id": DATA_SCOPE, "space_key": key}
            ),
        }
        for key, project in sorted((SPACE_PROJECTS if bound is None else bound).items())
    ] + [
        {
            "project_id": project,
            "display_name": project.title(),
            "canonical_root": os.path.join(directory, "roots", project),
            "planning_binding": None,
        }
        for project in unbound
    ]
    with open(os.path.join(folder, "Valkama", "projects.json"), "wb") as handle:
        handle.write(registry_fixtures.registry_bytes(entries) if raw is None else raw)
    patcher = mock.patch.dict(os.environ, {"LOCALAPPDATA": folder})
    patcher.start()
    case.addCleanup(patcher.stop)
    return folder


def items_digest(path: str) -> str:
    """The contract's fingerprint of a store's items, read here from its rows: SHA-256
    of every item id, sorted, one a line."""

    conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    try:
        identities = sorted(
            str(row[0]) for row in conn.execute("SELECT work_item_id FROM work_items")
        )
    finally:
        conn.close()
    return hashlib.sha256("".join(f"{value}\n" for value in identities).encode()).hexdigest()


def item_projects_file(
    store_path: str,
    directory: str,
    items: dict | None = None,
    labels: dict | None = None,
    **overrides: object,
) -> str:
    """The file `projects map-items` writes, written out here: by default it names no
    project, so every task takes its space's."""

    document = {
        "data_scope_id": DATA_SCOPE,
        "format": "valkama-item-projects",
        "items": items or {},
        "items_digest": items_digest(store_path),
        "labels": labels or {},
        "version": 1,
        **overrides,
    }
    path = os.path.join(directory, "item-projects.json")
    with open(path, "w", encoding="utf-8", newline="\n") as handle:
        json.dump(document, handle, sort_keys=True)
    return path


def identity(path: str) -> tuple[int, str]:
    """The store's schema number and what it logically holds."""

    conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    try:
        return int(
            conn.execute("PRAGMA user_version").fetchone()[0]
        ), store_backups.logical_identity(conn)
    finally:
        conn.close()


def listed(directory: str) -> list[str]:
    """The directory without SQLite's own journal files, which a reader of a store in
    WAL mode leaves beside it and which hold none of its rows."""

    return sorted(name for name in os.listdir(directory) if not name.endswith(("-wal", "-shm")))


def file_digest(path: str) -> str:
    with open(path, "rb") as handle:
        return hashlib.sha256(handle.read()).hexdigest()


class StoreCase(unittest.TestCase):
    """A 2.9 store of its own in a temporary directory."""

    def setUp(self) -> None:
        self.directory = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.addCleanup(self.directory.cleanup)
        self.path = os.path.join(self.directory.name, "valkama.sqlite3")
        self.ids = build(self.path)
        registry(self, self.directory.name)
        self.file = item_projects_file(self.path, self.directory.name)

    def read(self, sql: str, parameters: tuple = ()) -> list[sqlite3.Row]:
        conn = sqlite3.connect(self.path)
        conn.row_factory = sqlite3.Row
        try:
            return conn.execute(sql, parameters).fetchall()
        finally:
            conn.close()

    def item(self, reference: str) -> sqlite3.Row:
        return self.read(
            "SELECT w.*, s.key AS state_key, s.category FROM work_items w"
            " JOIN workflow_states s ON s.state_id = w.state_id WHERE w.work_item_id = ?",
            (self.ids[reference],),
        )[0]

    def events(self, reference: str, *actions: str) -> list[tuple[str, str, str]]:
        return [
            (str(row[0]), str(row[1]), str(row[2]))
            for row in self.read(
                "SELECT action, detail, author FROM work_item_events WHERE work_item_id = ?"
                f" AND action IN ({','.join('?' * len(actions))}) ORDER BY id",
                (self.ids[reference], *actions),
            )
        ]

    def migrate(self) -> dict:
        return store.migrate_work_model(self.path, item_projects=self.file)


class MigratedStoreTests(StoreCase):
    """One migration of the populated store, read back step by step."""

    def setUp(self) -> None:
        super().setUp()
        self.report = self.migrate()

    def test_the_run_is_reported_and_every_postcondition_holds(self) -> None:
        self.assertEqual("migrated", self.report["status"])
        self.assertEqual({"from": 17, "to": store.STORE_SCHEMA_VERSION}, self.report["schema"])
        self.assertEqual(STEP_NAMES, [step["name"] for step in self.report["steps"]])
        self.assertEqual(
            [(name, True) for name in POSTCONDITION_NAMES],
            [(entry["name"], entry["passed"]) for entry in self.report["postconditions"]],
        )
        phases = [phase["name"] for phase in self.report["phases"]]
        for name in (
            "recovery_point",
            "recovery_point.source_identity",
            "recovery_point.vacuum_into",
            "recovery_point.snapshot_identity",
            "commit",
            "bring_current",
            "total",
        ):
            self.assertIn(name, phases)
        for entry in self.report["steps"] + self.report["postconditions"]:
            self.assertGreaterEqual(entry["seconds"], 0)
        self.assertTrue(self.report["environment"]["sqlite"])
        json.dumps(self.report)

    def test_the_store_opens_at_the_new_schema_afterwards(self) -> None:
        self.assertEqual(store.STORE_SCHEMA_VERSION, identity(self.path)[0])
        conn = store.connect(self.path)
        conn.close()

    def test_the_recovery_point_holds_the_store_as_it_was_with_its_picture(self) -> None:
        point = self.report["recovery_point"]
        self.assertIn("-pre3.0-", os.path.basename(point))
        self.assertEqual(os.path.join(self.directory.name, "backups"), os.path.dirname(point))
        digest = hashlib.sha256(PICTURE).hexdigest()
        self.assertTrue(os.path.isfile(os.path.join(store_backups.images_beside(point), digest)))
        # Restored as README says: the copy in the store's place opens as the store 2.9
        # left, which this build refuses until the migration runs again.
        restored = os.path.join(self.directory.name, "restored", "valkama.sqlite3")
        os.makedirs(os.path.dirname(restored))
        shutil.copyfile(point, restored)
        self.assertEqual(17, identity(restored)[0])
        self.assertEqual("2.9", store.store_generation(restored))
        with self.assertRaises(store.WorkModelMigrationRequiredError):
            store.connect(restored)

    def test_states_gives_the_default_workflow_the_eight_categories_and_the_service_state(
        self,
    ) -> None:
        states = [
            tuple(row)
            for row in self.read(
                "SELECT key, name, category, position, is_terminal FROM workflow_states"
                " WHERE workflow_id = ? ORDER BY position",
                (self.ids["workflow"],),
            )
        ]
        self.assertEqual(
            [
                ("triage", "Triage", "triage", 0, 0),
                ("deferred", "Deferred", "deferred", 1, 0),
                ("ready", "Ready", "ready", 2, 0),
                ("dev", "Dev", "active", 3, 0),
                ("review", "Review", "review", 4, 0),
                ("done", "Done", "completed", 5, 1),
                ("blocked", "Blocked", "blocked", 6, 0),
                ("cancelled", "Cancelled", "cancelled", 7, 1),
                ("container", "Accepted", "container", 8, 0),
            ],
            states,
        )
        moves = self.read(
            "SELECT COUNT(*) FROM workflow_transitions WHERE workflow_id = ?",
            (self.ids["workflow"],),
        )[0][0]
        self.assertEqual(72, moves)
        initial = self.read(
            "SELECT initial_state_id FROM workflows WHERE workflow_id = ?", (self.ids["workflow"],)
        )[0][0]
        self.assertEqual(self.ids["backlog"], initial)

    def test_states_keeps_the_keys_of_a_workflow_shaped_differently(self) -> None:
        states = [
            tuple(row)
            for row in self.read(
                "SELECT key, category FROM workflow_states WHERE workflow_id = ? ORDER BY position",
                (self.ids["other_workflow"],),
            )
        ]
        self.assertEqual(
            [
                ("inbox", "triage"),
                ("deferred", "deferred"),
                ("next", "ready"),
                ("doing", "active"),
                ("check", "review"),
                ("shipped", "completed"),
                ("stuck", "blocked"),
                ("dropped", "cancelled"),
                ("container", "container"),
            ],
            states,
        )

    def test_history_renames_a_key_only_where_a_key_stands(self) -> None:
        self.assertEqual(
            [
                ("created", "triage", "agent"),
                ("transitioned", "ready: moved backlog -> todo", "agent"),
            ],
            self.events("WM-2", "created", "transitioned"),
        )
        self.assertEqual(
            [
                ("created", "triage", "agent"),
                ("transitioned", "ready", "agent"),
                ("transitioned", "ready -> triage", "agent"),
            ],
            self.events("WM-9", "created", "transitioned"),
        )
        self.assertEqual(
            [("created", "inbox", "agent"), ("transitioned", "next", "agent")],
            self.events("ALT-2", "created", "transitioned"),
        )

    def test_items_gives_each_item_its_kind_acceptance_and_start(self) -> None:
        for number, (kind, category, accepted_at, started_at) in EXPECTED.items():
            with self.subTest(item=number):
                row = self.item(f"WM-{number}")
                self.assertEqual(
                    (kind, category, "migrated" if accepted_at else None, accepted_at, started_at),
                    (
                        row["kind"],
                        row["category"],
                        row["acceptance"],
                        row["accepted_at"],
                        row["started_at"],
                    ),
                )
        self.assertNotIn("owner_ref", self.item("WM-1").keys())
        self.assertEqual(["ui", "bug"], json.loads(self.item("WM-6")["labels"]))
        self.assertEqual([], json.loads(self.item("WM-1")["labels"]))
        other = self.item("ALT-2")
        self.assertEqual(
            ("ready", "migrated", T2),
            (other["category"], other["acceptance"], other["accepted_at"]),
        )
        self.assertIsNone(self.item("ALT-1")["acceptance"])

    def test_items_drops_the_order_set_by_hand_and_indexes_a_state_without_it(self) -> None:
        fresh = os.path.join(self.directory.name, "fresh", "valkama.sqlite3")
        os.makedirs(os.path.dirname(fresh))
        store.connect(fresh).close()
        for path in (self.path, fresh):
            with self.subTest(store=os.path.basename(os.path.dirname(path))):
                conn = sqlite3.connect(path)
                try:
                    columns = {str(row[1]) for row in conn.execute("PRAGMA table_info(work_items)")}
                    indexed = [
                        str(row[2]) for row in conn.execute("PRAGMA index_info(work_items_state)")
                    ]
                finally:
                    conn.close()
                self.assertNotIn("position", columns)
                self.assertEqual(["planning_space_id", "state_id"], indexed)
        [items] = [step for step in self.report["steps"] if step["name"] == "items"]
        self.assertIn("work_items_state", items["result"]["indexes_and_triggers_recreated"])

    def test_containers_releases_every_container_and_opens_the_accepted_ones(self) -> None:
        first = self.item("WM-1")
        self.assertEqual(("", None), (first["claim_ref"], first["claim_call_id"]))
        self.assertEqual("", json.loads(first["checklist"])[0]["claimed_by"])
        author = migration.AUTHOR
        self.assertEqual(
            [
                ("released", "agent-a", author),
                ("checklist_released", "Plan it", author),
                ("opened", "3.0 migration", author),
            ],
            self.events("WM-1", "released", "checklist_released", "opened"),
        )
        self.assertEqual(
            [("released", "stale-e3", author)], self.events("WM-3", "released", "opened")
        )
        for number in (6, 15, 16, 18):
            self.assertEqual(
                [("opened", "3.0 migration", author)], self.events(f"WM-{number}", "opened")
            )
        self.assertEqual([], self.events("WM-13", "opened", "accepted"))
        accepted = self.read("SELECT COUNT(*) FROM work_item_events WHERE action = 'accepted'")
        self.assertEqual(0, accepted[0][0])

    def test_task_holders_leaves_holders_only_on_work_and_readies_a_task_nobody_holds(self) -> None:
        author = migration.AUTHOR
        self.assertEqual("", self.item("WM-5")["claim_ref"])
        self.assertEqual([("released", "stale-t5", author)], self.events("WM-5", "released"))
        self.assertEqual([("released", "stale-t21", author)], self.events("WM-21", "released"))
        for reference, holder in (("WM-7", "agent-c"), ("WM-14", "agent-d"), ("WM-17", "agent-e")):
            self.assertEqual(holder, self.item(reference)["claim_ref"])
        self.assertEqual(
            [("transitioned", "dev", "agent"), ("transitioned", "ready: 3.0 migration", author)],
            self.events("WM-8", "transitioned"),
        )
        self.assertEqual("ready", self.item("WM-8")["state_key"])

    def test_children_left_takes_the_open_children_out_of_a_closed_container(self) -> None:
        author = migration.AUTHOR
        for reference in ("WM-4", "WM-20"):
            row = self.item(reference)
            self.assertEqual(
                (None, "triage", None), (row["parent_id"], row["state_key"], row["acceptance"])
            )
        self.assertEqual(self.ids["WM-3"], self.item("WM-5")["parent_id"])
        self.assertEqual(
            [
                ("child_left", "WM-20: closed before 3.0", author),
                ("child_left", "WM-4: closed before 3.0", author),
            ],
            sorted(self.events("WM-3", "child_left")),
        )
        self.assertEqual(
            [("transitioned", "triage: 3.0 migration", author)],
            self.events("WM-20", "transitioned"),
        )
        self.assertEqual(
            [("checklist_released", "Look", author)], self.events("WM-4", "checklist_released")
        )
        moved = self.report["postconditions"][14]["detail"]["taken_out_of_closed_containers"]
        self.assertEqual(
            [{"reference": "WM-20", "from": "WM-3"}, {"reference": "WM-4", "from": "WM-3"}], moved
        )

    def test_checks_makes_the_store_keep_each_kind_in_its_states(self) -> None:
        conn = store.connect(self.path)
        self.addCleanup(conn.close)
        service = conn.execute(
            "SELECT state_id FROM workflow_states WHERE workflow_id = ? AND key = 'container'",
            (self.ids["workflow"],),
        ).fetchone()[0]
        with self.assertRaisesRegex(sqlite3.IntegrityError, "service state"):
            conn.execute(
                "UPDATE work_items SET state_id = ? WHERE work_item_id = ?",
                (service, self.ids["WM-9"]),
            )
        conn.rollback()

    def test_addressee_lets_a_request_name_a_session_and_leaves_each_one_asking_the_owner(
        self,
    ) -> None:
        columns = [row[1] for row in self.read("PRAGMA table_info(work_item_requests)")]
        self.assertEqual(
            ["addressee", "purpose"], columns[-2:], "in the order a fresh store declares them"
        )
        [index] = self.read(
            "SELECT sql FROM sqlite_master WHERE name = 'work_item_requests_addressee'"
        )
        self.assertIn("(addressee, status) WHERE addressee IS NOT NULL", index[0])
        self.assertEqual(
            [("kept-request", None)],
            [
                tuple(row)
                for row in self.read("SELECT request_id, addressee FROM work_item_requests")
            ],
        )
        [step] = [step for step in self.report["steps"] if step["name"] == "addressee"]
        self.assertEqual((True, {"column_added": True}), (step["needed"], step["result"]))
        [entry] = [
            entry for entry in self.report["postconditions"] if entry["name"] == "requests-asked"
        ]
        self.assertEqual({"requests": 1}, entry["detail"])

    def test_waiting_words_creates_the_waiting_words_empty_and_shaped_as_a_fresh_store(
        self,
    ) -> None:
        names = {
            str(row[0])
            for row in self.read(
                "SELECT name FROM sqlite_master WHERE tbl_name = 'work_item_waiting_notices'"
            )
        }
        self.assertLessEqual(
            {
                "work_item_waiting_notices",
                "work_item_waiting_notices_open",
                "work_item_waiting_notices_delivered",
            },
            names,
        )
        [(rows,)] = self.read("SELECT COUNT(*) FROM work_item_waiting_notices")
        self.assertEqual(0, rows, "nothing waits from before 3.0")
        [step] = [step for step in self.report["steps"] if step["name"] == "waiting-words"]
        self.assertEqual((True, {"table_created": True}), (step["needed"], step["result"]))
        details = {
            entry["name"]: entry["detail"]
            for entry in self.report["postconditions"]
            if entry["name"] in ("no-old-waiting", "request-shapes", "fresh-tables")
        }
        self.assertEqual(
            {
                "no-old-waiting": {"rows": 0},
                "request-shapes": {"refused": ["scope 'other'", "delivered_call without delivered_at"]},
                "fresh-tables": {"added": ["work_item_waiting_notices"]},
            },
            details,
        )

    def test_m15_gives_a_row_to_each_goal_or_stage_awaiting_confirmation(self) -> None:
        """Every child of WM-18 is done: it awaits, since the migration, with no call."""

        rows = self.read(
            "SELECT work_item_id, since, call_id, request_id, left_at FROM work_item_confirmations"
        )
        self.assertEqual(
            [(self.ids["WM-18"], None, None, None)],
            [(row[0], row[2], row[3], row[4]) for row in rows],
        )
        # The moment every record of the migration carries.
        [(moment,)] = self.read(
            "SELECT DISTINCT created_at FROM work_item_events WHERE author = ?",
            (migration.AUTHOR,),
        )
        self.assertEqual(moment, rows[0][1])
        self.assertEqual([], self.events("WM-18", "awaiting_confirmation"), "no event, no call")
        [follows] = self.read("SELECT COUNT(*) FROM work_item_subscriptions")
        self.assertEqual(0, follows[0], "no session follows it")
        steps = {step["name"]: step for step in self.report["steps"]}
        self.assertEqual(
            (True, {"table_created": True, "awaiting": ["WM-18"]}),
            (steps["confirmations"]["needed"], steps["confirmations"]["result"]),
        )
        # `items` widened the CHECK with every action this build declares.
        self.assertFalse(steps["history-actions"]["needed"])
        [p30] = [entry for entry in self.report["postconditions"] if entry["name"] == "awaiting-rows"]
        self.assertEqual({"rows": 1}, p30["detail"])
        [p26] = [entry for entry in self.report["postconditions"] if entry["name"] == "fresh-tables"]
        self.assertNotIn("work_item_confirmations", p26["detail"]["added"])

    def test_m8_gives_every_task_its_space_project_and_shapes_the_table_as_a_fresh_one(
        self,
    ) -> None:
        tasks = [number for number, expected in EXPECTED.items() if expected[0] == "task"]
        step = next(entry for entry in self.report["steps"] if entry["name"] == "item-projects")
        conn = store.connect(self.path)
        self.addCleanup(conn.close)
        held = {
            (str(row[0]), str(row[1]), str(row[2]))
            for row in conn.execute(
                "SELECT work_item_id, project_id, source FROM work_item_projects"
            )
        }
        # Nothing in the file names a project, so each task takes its space's former
        # one; a container none.
        expected = {(self.ids[f"WM-{number}"], "work-model", "migrated") for number in tasks}
        expected |= {(self.ids[f"ALT-{number}"], "other", "migrated") for number in (1, 2)}
        self.assertEqual(expected, {row for row in held if row[1] != "kept"})
        self.assertEqual({"migrated"}, {row[2] for row in held})
        self.assertEqual({"rows": len(held), "migrated": len(held)}, step["result"])
        conn.execute(
            "INSERT INTO work_item_projects(work_item_id, project_id, source) VALUES(?,?,?)",
            (self.ids["WM-9"], "valkama", "named"),
        )
        # A project gained marks the item for the word index, as in a fresh store.
        self.assertEqual(
            (1,),
            conn.execute(
                "SELECT stale FROM work_item_search_rows WHERE work_item_id = ?",
                (self.ids["WM-9"],),
            ).fetchone()[:],
        )
        with self.assertRaisesRegex(sqlite3.IntegrityError, "CHECK"):
            conn.execute(
                "INSERT INTO work_item_projects(work_item_id, project_id, source) VALUES(?,?,?)",
                (self.ids["WM-9"], "other", "label"),
            )
        conn.rollback()

    def test_spaces_takes_the_project_off_each_space_and_keeps_the_rest_as_it_was(self) -> None:
        columns = "planning_space_id, key, name, provider_kind, next_number, created_at, updated_at"
        point = self.report["recovery_point"]
        with contextlib.closing(sqlite3.connect(point)) as before:
            kept = sorted(
                tuple(row) for row in before.execute(f"SELECT {columns} FROM planning_spaces")
            )
            identity = before.execute(
                "SELECT data_scope_id FROM platform_store_metadata"
            ).fetchone()
        self.assertTrue(kept)
        after = self.read(f"SELECT {columns}, launch_place FROM planning_spaces")
        self.assertEqual(kept, sorted(tuple(row)[:-1] for row in after))
        self.assertEqual({"space"}, {row["launch_place"] for row in after})
        self.assertNotIn(
            "project_id", {row[1] for row in self.read("PRAGMA table_info(planning_spaces)")}
        )
        self.assertEqual(
            tuple(identity),
            tuple(self.read("SELECT data_scope_id FROM platform_store_metadata")[0]),
        )
        step_spaces = next(step for step in self.report["steps"] if step["name"] == "spaces")
        self.assertEqual(len(kept), step_spaces["result"]["spaces"])
        post_store_identity = next(
            entry for entry in self.report["postconditions"] if entry["name"] == "store-identity"
        )
        self.assertEqual(len(kept), post_store_identity["detail"]["spaces"])
        # A name is a space's alone now, as a fresh store holds it.
        with self.assertRaisesRegex(sqlite3.IntegrityError, "UNIQUE"):
            self.read(
                "INSERT INTO planning_spaces(planning_space_id, name, key) VALUES('x', ?, 'ZZ')",
                (kept[0][2],),
            )

    def test_the_derived_states_are_reported(self) -> None:
        derived = self.report["postconditions"][11]["detail"]["derived"]
        # WM-1 waits on a ready task nobody started; WM-6, WM-15 and WM-16 have work
        # started under them; every child of WM-18 is done.
        self.assertEqual({"awaiting_confirmation": 1, "in_progress": 3, "not_started": 1}, derived)

    def test_a_second_run_changes_nothing_and_says_the_migration_ran(self) -> None:
        backups = sorted(os.listdir(os.path.join(self.directory.name, "backups")))
        before = file_digest(self.path)
        again = self.migrate()
        self.assertEqual("current", again["status"])
        self.assertEqual("the work-model migration has already run", again["message"])
        self.assertEqual(before, file_digest(self.path))
        self.assertEqual(backups, sorted(os.listdir(os.path.join(self.directory.name, "backups"))))


#: `sessions` as the Board era declared it, under a name of its own until it takes the
#: place of the one the catalog holds. The cutover renamed `card_id` to `work_item_id`
#: and kept its type; the columns added since were appended by `ALTER TABLE`.
BOARD_SESSIONS = """CREATE TABLE sessions_board(
    id TEXT PRIMARY KEY,
    client TEXT NOT NULL,
    cwd TEXT NOT NULL DEFAULT '',
    label TEXT NOT NULL DEFAULT '',
    card_id INTEGER,
    status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','ended','failed')),
    attention TEXT NOT NULL DEFAULT '',
    attention_seen INTEGER NOT NULL DEFAULT 0,
    started_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    last_seen TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    ended_at TEXT
)"""
BOARD_COLUMNS = (
    "id,client,cwd,label,card_id,status,attention,attention_seen,started_at,last_seen,ended_at"
)
APPENDED_COLUMNS = (
    "parent_session_id",
    "agent_id",
    "transcript_path",
    "client_version",
    "opened_in",
    "opened_host",
    "opened_folder",
    "host_session_id",
)


def reshape_sessions_as_the_board_left_them(path: str, item: str) -> None:
    """Give a built store the `sessions` of one that passed the Board cutover, holding
    sessions that name no item and sessions that name one by its text id."""

    conn = sqlite3.connect(path)
    try:
        conn.execute(BOARD_SESSIONS)
        conn.execute(
            f"INSERT INTO sessions_board({BOARD_COLUMNS})"
            f" SELECT {BOARD_COLUMNS.replace('card_id', 'work_item_id')} FROM sessions"
        )
        conn.execute("DROP TABLE sessions")
        conn.execute("ALTER TABLE sessions_board RENAME TO sessions")
        conn.execute("ALTER TABLE sessions RENAME COLUMN card_id TO work_item_id")
        for column in APPENDED_COLUMNS:
            conn.execute(f"ALTER TABLE sessions ADD COLUMN {column} TEXT NOT NULL DEFAULT ''")
        conn.execute(
            "CREATE INDEX sessions_parent ON sessions(parent_session_id)"
            " WHERE parent_session_id != ''"
        )
        for number in range(3):
            conn.execute(
                "INSERT INTO sessions(id,client,label,work_item_id,started_at,last_seen)"
                " VALUES(?,'codex','unbound',NULL,?,?)",
                (f"board-session-{number}", T1, T1),
            )
        conn.execute(
            "INSERT INTO sessions(id,client,label,work_item_id,parent_session_id,agent_id,"
            "started_at,last_seen) VALUES('board-child','claude','bound',?,'board-session-0',"
            "'agent-1',?,?)",
            (item, T2, T2),
        )
        conn.commit()
    finally:
        conn.close()


class BoardEraSessionsTests(StoreCase):
    """A store that passed the Board cutover keeps `sessions.work_item_id` as INTEGER."""

    def setUp(self) -> None:
        super().setUp()
        reshape_sessions_as_the_board_left_them(self.path, self.ids["WM-7"])
        self.before = self.sessions()
        self.parent_index = self.index_sql()

    def sessions(self) -> list[tuple]:
        return [
            tuple(row)
            for row in self.read(
                "SELECT *, typeof(work_item_id) FROM sessions ORDER BY id"  # the stored type too
            )
        ]

    def index_sql(self) -> list[tuple]:
        return [
            tuple(row)
            for row in self.read(
                "SELECT type, name, sql FROM sqlite_master WHERE tbl_name = 'sessions'"
                " AND type IN ('index', 'trigger')"
                " AND sql IS NOT NULL ORDER BY name"
            )
        ]

    def test_the_fixture_is_shaped_as_the_board_left_it(self) -> None:
        declared = {row[1]: row[2] for row in self.read("PRAGMA table_info(sessions)")}
        self.assertEqual("INTEGER", declared["work_item_id"])
        self.assertEqual(
            ["null", "null", "null", "text", "text"], sorted(row[-1] for row in self.before)
        )

    def test_items_rebuilds_sessions_to_the_fresh_declaration_and_keeps_its_rows(self) -> None:
        report = self.migrate()
        self.assertEqual("migrated", report["status"])
        self.assertEqual(
            [(name, True) for name in POSTCONDITION_NAMES],
            [(entry["name"], entry["passed"]) for entry in report["postconditions"]],
        )
        declared = {row[1]: row[2] for row in self.read("PRAGMA table_info(sessions)")}
        self.assertEqual("TEXT", declared["work_item_id"])
        self.assertEqual(self.before, self.sessions())
        self.assertEqual(self.parent_index, self.index_sql())
        step_items = next(step for step in report["steps"] if step["name"] == "items")
        self.assertEqual(["sessions_parent"], step_items["result"]["sessions_rebuilt"])
        events = self.read("SELECT COUNT(*) FROM session_events WHERE session_id = 'kept-session'")
        self.assertEqual(1, events[0][0])


#: A task at work whose holder took a step, and one whose step is all that holds it.
def remember_route(path: str, scope: dict) -> str:
    """Leave the shell's last route in the store, as 2.9 wrote it."""

    record = json.dumps({"module_id": "planning", "scope": scope}, separators=(",", ":"))
    conn = sqlite3.connect(path)
    try:
        conn.execute(
            "INSERT INTO platform_ui_prefs(key, record_json, updated_at)"
            " VALUES ('last-route', ?, '2026-01-02T03:04:05Z')",
            (record,),
        )
        conn.commit()
    finally:
        conn.close()
    return record


class LastRouteTests(StoreCase):
    """The last route a project scoped has no address in 3.0, so the shell starts afresh."""

    def route(self) -> list[str]:
        return [str(row[0]) for row in self.read("SELECT record_json FROM platform_ui_prefs")]

    def test_last_route_drops_a_route_a_project_scoped_and_row_counts_and_routes_hold(self) -> None:
        remember_route(self.path, {"kind": "project", "project_ref": {"project_id": "valkama"}})
        report = self.migrate()
        self.assertEqual("migrated", report["status"])
        self.assertEqual(
            [(name, True) for name in POSTCONDITION_NAMES],
            [(entry["name"], entry["passed"]) for entry in report["postconditions"]],
        )
        step_oracle = next(step for step in report["steps"] if step["name"] == "oracle")
        self.assertEqual(1, step_oracle["result"]["remembered_routes_to_drop"])
        step_last_route = next(step for step in report["steps"] if step["name"] == "last-route")
        self.assertEqual({"dropped": 1}, step_last_route["result"])
        self.assertEqual([], self.route())

    def test_a_global_route_is_kept_as_it_was(self) -> None:
        record = remember_route(self.path, {"kind": "global"})
        report = self.migrate()
        self.assertEqual("migrated", report["status"])
        step_oracle = next(step for step in report["steps"] if step["name"] == "oracle")
        self.assertEqual(0, step_oracle["result"]["remembered_routes_to_drop"])
        post_routes = next(entry for entry in report["postconditions"] if entry["name"] == "routes")
        self.assertEqual(
            (True, {"dropped": [], "kept": 1}), (post_routes["passed"], post_routes["detail"])
        )
        self.assertEqual([record], self.route())


KEPT_STEPS = {"WM-7": ("Wire it", "agent-c"), "WM-8": ("Try it", "agent-f")}


#: Requests a 2.9 store holds on items of the fixture, as (id, item, kind, status,
#: stored reason): what 2.9 read `task_closed` and left pending, one it stored so, and
#: the ones `ended-requests` leaves as they are.
CLOSED_ITEM_REQUESTS = (
    ("on-done", "WM-5", "question", "pending", None),
    ("on-cancelled", "WM-10", "decision", "pending", None),
    ("stored-closed", "WM-11", "question", "expired", "task_closed"),
    ("answered-on-done", "WM-12", "question", "answered", None),
    ("on-open", "WM-8", "question", "pending", None),
)


def add_requests(path: str, ids: dict[str, str], rows: tuple = CLOSED_ITEM_REQUESTS) -> None:
    conn = sqlite3.connect(path)
    try:
        for request_id, item, kind, status, reason in rows:
            conn.execute(
                "INSERT INTO work_item_requests(request_id,work_item_id,kind,prompt,fields_json,"
                "author,status,created_at,expired_reason,resolved_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
                (
                    request_id,
                    ids[item],
                    kind,
                    "Which way?",
                    "[]",
                    "agent-a",
                    status,
                    T1,
                    reason,
                    T2 if status != "pending" else None,
                ),
            )
        with schema17.words_as_2_9():
            words.bring_current(conn)
        conn.commit()
    finally:
        conn.close()


class ClosedItemRequestsTests(StoreCase):
    """`ended-requests`: a request a close left pending ends as its item closed, done or cancelled.

    The requests are rebuilt from the fresh declaration; a stored `task_closed` and
    a request pending on a closed item end `expired` with the reason of the item's
    category, with no event; every other row keeps its item, kind and status
    (`requests-kept`), none waits on a closed item (`no-closed-waits`), and the
    ones ended are those foreseen (`requests-ended`).
    """

    def setUp(self) -> None:
        super().setUp()
        add_requests(self.path, self.ids)

    def requests(self) -> dict[str, tuple]:
        return {
            str(row[0]): (str(row[1]), row[2], str(row[3]))
            for row in self.read(
                "SELECT request_id, status, expired_reason, revision FROM work_item_requests"
            )
        }

    def test_m14_ends_the_requests_a_close_left_waiting_by_the_items_category(self) -> None:
        report = self.migrate()
        self.assertEqual("migrated", report["status"])
        self.assertEqual(
            [(name, True) for name in POSTCONDITION_NAMES],
            [(entry["name"], entry["passed"]) for entry in report["postconditions"]],
        )
        held = self.requests()
        self.assertEqual(("expired", "item_completed", "1"), held["on-done"])
        self.assertEqual(("expired", "item_cancelled", "1"), held["on-cancelled"])
        self.assertEqual(("expired", "item_cancelled", "1"), held["stored-closed"])
        self.assertEqual(("answered", None, "0"), held["answered-on-done"])
        self.assertEqual(("pending", None, "0"), held["on-open"])
        self.assertEqual(("pending", None, "0"), held["kept-request"])
        [ended] = self.read(
            "SELECT answered_by, resolved_at FROM work_item_requests WHERE request_id = 'on-done'"
        )
        self.assertEqual(migration.AUTHOR, ended[0])
        self.assertIsNotNone(ended[1])
        [kept] = self.read(
            "SELECT resolved_at FROM work_item_requests WHERE request_id = 'stored-closed'"
        )
        self.assertEqual(T2, kept[0], "a close already ended it then")
        self.assertEqual(
            0,
            self.read("SELECT COUNT(*) FROM work_item_events WHERE action = 'request_expired'")[0][
                0
            ],
        )
        [step] = [step for step in report["steps"] if step["name"] == "ended-requests"]
        self.assertTrue(step["needed"])
        self.assertEqual({"item_cancelled": 2, "item_completed": 1}, step["result"]["ended"])
        details = {
            entry["name"]: entry["detail"]
            for entry in report["postconditions"]
            if entry["name"] in ("requests-kept", "no-closed-waits", "requests-ended")
        }
        self.assertEqual(
            {
                "requests-kept": {"requests": 6},
                "no-closed-waits": {"pending_on_closed": 0},
                "requests-ended": {
                    "ended": {"item_cancelled": 2, "item_completed": 1},
                    "lapsed": {},
                },
            },
            details,
        )
        again = self.migrate()
        self.assertEqual("current", again["status"])

    def test_a_reason_task_closed_is_refused_by_the_migrated_store(self) -> None:
        self.migrate()
        conn = sqlite3.connect(self.path)
        try:
            with self.assertRaisesRegex(sqlite3.IntegrityError, "CHECK constraint failed"):
                conn.execute(
                    "UPDATE work_item_requests SET expired_reason = 'task_closed'"
                    " WHERE request_id = 'on-done'"
                )
            conn.execute(
                "UPDATE work_item_requests SET purpose = 'review' WHERE request_id = 'on-open'"
            )
            with self.assertRaisesRegex(sqlite3.IntegrityError, "CHECK constraint failed"):
                conn.execute(
                    "UPDATE work_item_requests SET purpose = 'acceptance'"
                    " WHERE request_id = 'on-open'"
                )
        finally:
            conn.rollback()
            conn.close()

    def test_ended_requests_ends_a_request_that_had_lapsed_on_a_closed_item_as_it_lapsed(
        self,
    ) -> None:
        """A pending request past its deadline, or on a run that ended, on a closed item
        ends `deadline` or `execution_closed`, resolved when it lapsed, not as the close."""

        conn = sqlite3.connect(self.path)
        try:
            conn.execute(
                "INSERT INTO executions(execution_id, work_item_id, client_family, role,"
                " environment, expected_effect, status, ended_at)"
                " VALUES ('run-1', ?, 'claude', 'r', 'e', 'x', 'complete', ?)",
                (self.ids["WM-10"], T2),
            )
            conn.execute(
                "INSERT INTO work_item_requests(request_id,work_item_id,kind,prompt,fields_json,"
                "author,status,created_at,expires_at) VALUES"
                " ('overdue', ?, 'question', 'By noon?', '[]', 'agent-a', 'pending', ?, ?)",
                (self.ids["WM-5"], T1, T2),
            )
            conn.execute(
                "INSERT INTO work_item_requests(request_id,work_item_id,kind,prompt,fields_json,"
                "author,status,created_at,execution_id) VALUES"
                " ('run-bound', ?, 'question', 'During the run?', '[]', 'agent-a', 'pending', ?,"
                " 'run-1')",
                (self.ids["WM-10"], T1),
            )
            conn.commit()
        finally:
            conn.close()
        add_requests(self.path, self.ids, ())
        report = self.migrate()
        self.assertEqual("migrated", report["status"])
        self.assertTrue(all(entry["passed"] for entry in report["postconditions"]))
        [step] = [step for step in report["steps"] if step["name"] == "ended-requests"]
        self.assertEqual(
            {"deadline": 1, "execution_closed": 1, "item_cancelled": 2, "item_completed": 1},
            step["result"]["ended"],
        )
        [post_requests_ended] = [
            entry for entry in report["postconditions"] if entry["name"] == "requests-ended"
        ]
        self.assertEqual(
            {
                "ended": {"item_cancelled": 2, "item_completed": 1},
                "lapsed": {"deadline": 1, "execution_closed": 1},
            },
            post_requests_ended["detail"],
        )
        held = {
            str(row[0]): (row[1], row[2], row[3], row[4])
            for row in self.read(
                "SELECT request_id, status, expired_reason, resolved_at, answered_by"
                " FROM work_item_requests WHERE request_id IN ('overdue', 'run-bound', 'on-done')"
            )
        }
        self.assertEqual(("expired", "deadline", T2), held["overdue"][:3])
        self.assertEqual(("expired", "execution_closed", T2), held["run-bound"][:3])
        self.assertNotEqual(migration.AUTHOR, held["overdue"][3], "no close ended it")
        self.assertEqual(("expired", "item_completed"), held["on-done"][:2])
        self.assertEqual("current", self.migrate()["status"])

    def test_a_stored_task_closed_on_an_item_open_again_is_refused_and_nothing_written(
        self,
    ) -> None:
        add_requests(
            self.path, self.ids, (("reopened", "WM-8", "question", "expired", "task_closed"),)
        )
        before, digest = identity(self.path), file_digest(self.path)
        with self.assertRaises(store_steps.RunFailedError) as raised:
            self.migrate()
        self.assertEqual(["ended-requests"], raised.exception.report["failed"])
        self.assertIn("reopened", raised.exception.report["steps"][-1]["error"])
        self.assertEqual((before, digest), (identity(self.path), file_digest(self.path)))


class KeptStepClaimTests(StoreCase):
    """A step claimed on a task at work stays claimed, and `identities` compares it as it is."""

    def setUp(self) -> None:
        super().setUp()
        conn = sqlite3.connect(self.path)
        try:
            for reference, (text, holder) in KEPT_STEPS.items():
                conn.execute(
                    "UPDATE work_items SET checklist = ? WHERE work_item_id = ?",
                    (
                        json.dumps([_step(text, holder)], sort_keys=True, separators=(",", ":")),
                        self.ids[reference],
                    ),
                )
            with schema17.words_as_2_9():
                words.bring_current(conn)
            conn.commit()
        finally:
            conn.close()
        self.checklists = {reference: self.item(reference)["checklist"] for reference in KEPT_STEPS}

    def test_a_claimed_step_on_a_task_at_work_is_kept_and_identities_holds(self) -> None:
        report = self.migrate()
        self.assertEqual("migrated", report["status"])
        self.assertEqual(
            [(name, True) for name in POSTCONDITION_NAMES],
            [(entry["name"], entry["passed"]) for entry in report["postconditions"]],
        )
        for reference in KEPT_STEPS:
            with self.subTest(item=reference):
                row = self.item(reference)
                self.assertEqual(self.checklists[reference], row["checklist"])
                self.assertEqual("active", row["category"])
                self.assertEqual([], self.events(reference, "checklist_released"))

    def test_identities_refuses_a_migration_that_clears_a_kept_claim(self) -> None:
        identity_before, digest = identity(self.path), file_digest(self.path)
        clear = writing(
            "UPDATE work_items SET checklist = json_set(checklist, '$[0].claimed_by', '')"
            " WHERE work_item_id = ?",
            (self.ids["WM-7"],),
        )
        step = store_steps.Step("fault", "clears a kept claim", clear)
        with with_step(step), self.assertRaises(store_steps.RunFailedError) as raised:
            self.migrate()
        report = raised.exception.report
        self.assertIn("identities", report["failed"])
        post_identities = next(
            entry for entry in report["postconditions"] if entry["name"] == "identities"
        )
        self.assertIn(f"{self.ids['WM-7']} changed its checklist", post_identities["error"])
        self.assertEqual((identity_before, digest), (identity(self.path), file_digest(self.path)))


class RefusalTests(unittest.TestCase):
    """A store that is not one Valkama 2.9 left is refused and left as it was."""

    def setUp(self) -> None:
        self.directory = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.addCleanup(self.directory.cleanup)
        self.path = os.path.join(self.directory.name, "valkama.sqlite3")

    def assert_refused(self, error: type[BaseException], text: str) -> None:
        before = listed(self.directory.name)
        digest = file_digest(self.path) if os.path.exists(self.path) else None
        with self.assertRaisesRegex(error, text):
            store.migrate_work_model(self.path)
        self.assertEqual(before, listed(self.directory.name))
        if digest is not None:
            self.assertEqual(digest, file_digest(self.path))

    def test_a_store_at_17_without_the_word_index_is_older_than_2_9(self) -> None:
        schema17.build(self.path)
        self.assert_refused(store.StoreTooOldError, "open it with Valkama 2.9 first")

    def test_a_store_below_17_is_refused(self) -> None:
        schema17.build_2_9(self.path)
        conn = sqlite3.connect(self.path)
        conn.execute("PRAGMA user_version=16")
        conn.close()
        self.assert_refused(store.StoreTooOldError, "open it with Valkama 2.9 first")

    def test_a_store_from_a_newer_build_is_refused(self) -> None:
        conn = sqlite3.connect(self.path)
        conn.execute(f"PRAGMA user_version={store.STORE_SCHEMA_VERSION + 1}")
        conn.close()
        self.assert_refused(store.StoreTooNewError, "newer")

    def test_a_file_holding_no_store_is_refused(self) -> None:
        open(self.path, "wb").close()
        self.assert_refused(store.StoreTooOldError, "open it with Valkama 2.9 first")

    def test_no_file_is_refused(self) -> None:
        self.assert_refused(FileNotFoundError, "no store")

    def test_a_fresh_store_of_this_build_is_reported_current(self) -> None:
        conn = store.connect(self.path)
        conn.close()
        report = store.migrate_work_model(self.path)
        self.assertEqual("current", report["status"])
        self.assertEqual([], report["steps"])


@contextlib.contextmanager
def with_step(step: store_steps.Step) -> Iterator[None]:
    with mock.patch.object(migration, "STEPS", (*migration.STEPS, step)):
        yield


def fault(
    name: str, sql: str, parameters: Callable[[dict[str, str]], tuple] = lambda _ids: ()
) -> tuple:
    return name, sql, parameters


def again(_conn: sqlite3.Connection, _context: store_steps.Context) -> None:
    """A step that does nothing and is always needed: one a second run takes again."""


def writing(
    sql: str, parameters: tuple
) -> Callable[[sqlite3.Connection, store_steps.Context], None]:
    """A step that issues one write."""

    def write(conn: sqlite3.Connection, _context: store_steps.Context) -> None:
        conn.execute(sql, parameters)

    return write


#: For each postcondition, a write after the steps that leaves a store it refuses.
FAULTS = (
    fault("fresh-shape", "CREATE INDEX work_items_extra ON work_items(title)"),
    fault("row-counts", "DELETE FROM work_item_comments"),
    fault(
        "integrity",
        "INSERT INTO work_item_comments(work_item_id,author,body) VALUES('nobody','agent','x')",
    ),
    fault(
        "no-epic",
        "UPDATE work_items SET kind = 'task' WHERE work_item_id = ?",
        lambda ids: (ids["WM-13"],),
    ),
    fault(
        "parents",
        "UPDATE work_items SET parent_id = ? WHERE work_item_id = ?",
        lambda ids: (ids["WM-16"], ids["WM-15"]),
    ),
    fault(
        "categories",
        "DELETE FROM workflow_states WHERE workflow_id = ? AND key = 'deferred'",
        lambda ids: (ids["workflow"],),
    ),
    fault(
        "history-keys",
        "UPDATE work_item_events SET detail = 'backlog' WHERE work_item_id = ? AND action = 'created'",
        lambda ids: (ids["WM-9"],),
    ),
    fault(
        "containers-unheld",
        "UPDATE work_items SET claim_ref = 'x' WHERE work_item_id = ?",
        lambda ids: (ids["WM-13"],),
    ),
    fault(
        "holders",
        "UPDATE work_items SET claim_ref = 'x' WHERE work_item_id = ?",
        lambda ids: (ids["WM-5"],),
    ),
    fault(
        "acceptance",
        "UPDATE work_items SET acceptance = 'migrated', accepted_at = 'x' WHERE work_item_id = ?",
        lambda ids: (ids["WM-9"],),
    ),
    fault(
        "started",
        "UPDATE work_items SET started_at = 'x' WHERE work_item_id = ?",
        lambda ids: (ids["WM-9"],),
    ),
    fault(
        "derived",
        "UPDATE work_items SET started_at = NULL WHERE work_item_id = ?",
        lambda ids: (ids["WM-17"],),
    ),
    fault("indexes", "DROP INDEX work_items_parent"),
    fault(
        "identities",
        "UPDATE work_items SET title = 'Renamed by a fault' WHERE work_item_id = ?",
        lambda ids: (ids["WM-9"],),
    ),
    fault(
        "known-exceptions",
        "UPDATE work_items SET state_id = (SELECT state_id FROM workflow_states"
        " WHERE workflow_id = work_items.workflow_id AND key = 'done') WHERE work_item_id = ?",
        lambda ids: (ids["WM-21"],),
    ),
    fault(
        "requests-asked",
        "UPDATE work_item_requests SET addressee = 'kept-session' WHERE request_id = 'kept-request'",
    ),
    fault(
        "no-old-waiting",
        "INSERT INTO work_item_waiting_notices(work_item_id,scope,from_call,created_call)"
        " VALUES(?,'tree',0,0)",
        lambda ids: (ids["WM-1"],),
    ),
    fault("request-shapes", "DROP INDEX work_item_waiting_notices_delivered"),
    fault(
        "requests-kept",
        "UPDATE work_item_requests SET status = 'declined' WHERE request_id = 'kept-request'",
    ),
    fault(
        "no-closed-waits",
        "UPDATE work_item_requests SET work_item_id = ? WHERE request_id = 'kept-request'",
        lambda ids: (ids["WM-5"],),
    ),
    fault(
        "requests-ended",
        "UPDATE work_item_requests SET status = 'expired', expired_reason = 'item_cancelled'"
        " WHERE request_id = 'kept-request'",
    ),
    fault("fresh-tables", "CREATE TABLE stray_rows(id INTEGER PRIMARY KEY)"),
    fault("awaiting-rows", "UPDATE work_item_confirmations SET left_at = since"),
    fault("store-identity", "UPDATE planning_spaces SET next_number = next_number + 1 WHERE key = 'ALT'"),
    fault("space-projects", "UPDATE planning_spaces SET launch_place = 'item_project' WHERE key = 'WM'"),
    fault(
        "store-identity",
        "UPDATE planning_spaces SET next_number = next_number + 1 WHERE key = 'ALT'",
    ),
    fault(
        "space-projects",
        "UPDATE planning_spaces SET launch_place = 'item_project' WHERE key = 'WM'",
    ),
    fault(
        "task-projects",
        "DELETE FROM work_item_projects WHERE work_item_id = ?",
        lambda ids: (ids["WM-9"],),
    ),
    fault(
        "labels-kept",
        """UPDATE work_items SET labels = '["stray"]' WHERE work_item_id = ?""",
        lambda ids: (ids["WM-9"],),
    ),
    fault(
        "routes",
        "INSERT INTO platform_ui_prefs(key, record_json, updated_at)"
        " VALUES ('last-route', ?, '2026-01-02T03:04:05Z')",
        lambda _ids: ('{"module_id":"planning","scope":{"kind":"project"}}',),
    ),
)

#: `work_item_waiting_notices` as a fresh store declares it, but with neither CHECK.
_UNCHECKED_WAITING = planning_store.WAITING_NOTICES.replace(
    " CHECK(scope IN ('tree','space'))", ""
).replace(",\n    CHECK((delivered_call IS NULL) = (delivered_at IS NULL))", "")


def once(
    title: str, write: Callable[[sqlite3.Connection, store_steps.Context], None]
) -> store_steps.Step:
    """A fault step a second run would not take again, so `second-run` holds beside it and the
    report names only what the fault breaks."""

    ran: list[bool] = []

    def run(conn: sqlite3.Connection, context: store_steps.Context) -> None:
        write(conn, context)
        ran.append(True)

    return store_steps.Step("fault", title, run, lambda _conn, _context: not ran)


def rebuilt(
    table: str, old: str, new: str
) -> Callable[[sqlite3.Connection, store_steps.Context], None]:
    """A step that rebuilds `table` with `old` in its definition written as `new`."""

    def write(conn: sqlite3.Connection, _context: store_steps.Context) -> None:
        sql = conn.execute(
            "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?", (table,)
        ).fetchone()[0]
        assert old in sql, (table, old)
        definition = re.sub(
            rf'^CREATE TABLE\s+"?{table}"?',
            f"CREATE TABLE {table}{planning_store.REPLACEMENT}",
            sql.replace(old, new, 1),
        )
        planning_store.rebuild_table(conn, table, definition, f"SELECT * FROM {table}")

    return write


def without_trigger(
    write: Callable[[sqlite3.Connection, store_steps.Context], None],
) -> Callable[[sqlite3.Connection, store_steps.Context], None]:
    """`write` with the trigger keeping each kind in its states dropped around it: it
    reads `workflow_states`, so that table cannot be renamed while it stands."""

    def around(conn: sqlite3.Connection, context: store_steps.Context) -> None:
        for name in planning_store.STATE_FITS_KIND_TRIGGERS:
            conn.execute(f"DROP TRIGGER {name}")
        write(conn, context)
        for statement in planning_store.STATE_FITS_KIND:
            conn.execute(statement)

    return around


def emptied(half: str) -> Callable[[sqlite3.Connection, store_steps.Context], None]:
    """A step that leaves one half of the trigger keeping each kind in its states in
    place, under its name, refusing nothing."""

    def write(conn: sqlite3.Connection, _context: store_steps.Context) -> None:
        name = f"work_items_state_fits_kind_{half}"
        conn.execute(f"DROP TRIGGER {name}")
        conn.execute(
            f"CREATE TRIGGER {name} BEFORE {planning_store.STATE_FITS_KIND_TRIGGERS[name]}"
            " ON work_items BEGIN SELECT 1; END"
        )

    return write


#: For each `fresh-shape` probe, a store that passes the pragmas and fails the probe alone: the
#: fault, and what `fresh-shape` says of it. A narrowed events CHECK is `history-actions`'s to widen again, so a
#: second run would take it (`second-run`).
P1_FAULTS = (
    (
        "the update half of the trigger refuses nothing",
        emptied("update"),
        "moving a task into the service state is taken, a fresh store refuses it",
    ),
    (
        "the insert half of the trigger refuses nothing",
        emptied("insert"),
        "inserting a task into the service state is taken, a fresh store refuses it",
    ),
    (
        "the events table refuses an action a fresh store takes",
        rebuilt("work_item_events", "'accepted',", ""),
        "with {'action': 'accepted'} is refused (CHECK constraint failed",
        ["fresh-shape", "second-run"],
    ),
    (
        "the states table takes a category the work model retired",
        without_trigger(rebuilt("workflow_states", "'triage',", "'backlog','triage',")),
        "with {'category': 'backlog'} is taken, a fresh store refuses it",
    ),
    (
        "a table holds a CHECK a fresh store does not declare",
        rebuilt(
            "work_item_refs", "value TEXT NOT NULL,", "value TEXT NOT NULL CHECK(value != ''),"
        ),
        "work_item_refs declares 2 CHECK clauses, a fresh store 1",
    ),
)


def several(
    statements: Callable[[dict[str, str]], list[tuple[str, tuple]]], ids: dict[str, str]
) -> Callable[[sqlite3.Connection, store_steps.Context], None]:
    """A step that issues each of `statements`, in order."""

    def write(conn: sqlite3.Connection, _context: store_steps.Context) -> None:
        for sql, parameters in statements(ids):
            conn.execute(sql, parameters)

    return write


def _quiet(sql: str, parameters: tuple) -> list[tuple[str, tuple]]:
    """`sql` on one item, and its word index row marked current again, so the fault
    stays one `indexes` does not see."""

    return [
        (sql, parameters),
        (
            "UPDATE work_item_search_rows SET stale = 0 WHERE work_item_id = ?",
            (parameters[-1],),
        ),
    ]


#: For one clause of a postcondition each, a write after the steps that only that
#: clause sees: the postcondition, what it says, the writes, and every postcondition
#: that fails. Where a second one fails as well, it is the row count of a table the
#: fault had to add to or take from.
CLAUSE_FAULTS: tuple[
    tuple[str, str, Callable[[dict[str, str]], list[tuple[str, tuple]]], list[str]], ...
] = (
    (
        "request-shapes",
        "work_item_waiting_notices takes a row with scope 'other'",
        lambda _ids: [
            ("DROP TABLE work_item_waiting_notices", ()),
            (_UNCHECKED_WAITING, ()),
            (planning_store.WAITING_OPEN_INDEX, ()),
            (planning_store.WAITING_DELIVERED_INDEX, ()),
        ],
        ["fresh-shape", "request-shapes"],
    ),
    (
        "fresh-tables",
        "table stray_rows is not one a fresh store declares",
        lambda _ids: [("CREATE TABLE stray_rows(id INTEGER PRIMARY KEY)", ())],
        ["fresh-shape", "fresh-tables"],
    ),
    (
        "fresh-tables",
        "table work_item_waiting_notices holds 1 rows, not 0",
        lambda ids: [
            (
                "INSERT INTO work_item_waiting_notices(work_item_id,scope,from_call,created_call)"
                " VALUES(?,'tree',0,0)",
                (ids["WM-1"],),
            )
        ],
        ["integrity", "no-old-waiting", "fresh-tables"],
    ),
    (
        "requests-asked",
        "the request kept-request asks the session kept-session",
        lambda _ids: [
            (
                "UPDATE work_item_requests SET addressee = 'kept-session'"
                " WHERE request_id = 'kept-request'",
                (),
            )
        ],
        ["requests-asked"],
    ),
    (
        "requests-asked",
        "requests differ: missing ['kept-request'], extra ['other-request']",
        lambda _ids: [
            (
                "UPDATE work_item_requests SET request_id = 'other-request'"
                " WHERE request_id = 'kept-request'",
                (),
            )
        ],
        ["requests-asked"],
    ),
    (
        "row-counts",
        "work_item_projects holds",
        lambda ids: _quiet(
            "INSERT INTO work_item_projects(work_item_id, project_id, source)"
            " VALUES(?, 'stray', 'named')",
            (ids["WM-9"],),
        ),
        ["row-counts", "task-projects"],
    ),
    (
        "history-keys",
        "no opened record for the container",
        lambda ids: [
            (
                "UPDATE work_item_events SET detail = 'opened elsewhere'"
                " WHERE work_item_id = ? AND action = 'opened'",
                (ids["WM-6"],),
            )
        ],
        ["history-keys"],
    ),
    (
        "containers-unheld",
        "stands in cancelled, not triage",
        lambda ids: [
            (
                "UPDATE work_items SET state_id = (SELECT state_id FROM workflow_states"
                " WHERE workflow_id = work_items.workflow_id AND key = 'cancelled')"
                " WHERE work_item_id = ?",
                (ids["WM-13"],),
            )
        ],
        ["containers-unheld"],
    ),
    (
        "holders",
        "WM-10 reads as closed",
        lambda ids: [
            (
                "UPDATE work_item_events SET created_at = ?"
                " WHERE work_item_id = ? AND action = 'transitioned'",
                (T5, ids["WM-10"]),
            )
        ],
        ["holders"],
    ),
    (
        "holders",
        "the release on WM-21 comes before its last move",
        lambda ids: [
            (
                "UPDATE work_item_events SET id = (SELECT MAX(id) + 1 FROM work_item_events)"
                " WHERE id = (SELECT MAX(id) FROM work_item_events"
                " WHERE work_item_id = ? AND action = 'transitioned')",
                (ids["WM-21"],),
            )
        ],
        ["holders"],
    ),
    (
        "acceptance",
        f"WM-2 has migrated at {T5}, not migrated at {T3}",
        lambda ids: [
            ("UPDATE work_items SET accepted_at = ? WHERE work_item_id = ?", (T5, ids["WM-2"]))
        ],
        ["acceptance"],
    ),
    (
        "indexes",
        "a search for 'searc' finds other items",
        lambda ids: [
            (
                f"DELETE FROM {words.INDEX} WHERE rowid ="
                f" (SELECT id FROM {words.ROWS} WHERE work_item_id = ?)",
                (ids["WM-9"],),
            )
        ],
        # The tables FTS5 keeps the index in are not counted: `indexes` holds the index.
        ["indexes"],
    ),
    (
        "indexes",
        "the index marks",
        lambda _ids: [(f"INSERT INTO {words.ROWS}(work_item_id, stale) VALUES('nobody', 0)", ())],
        ["row-counts", "indexes"],
    ),
    (
        "identities",
        "the set of space and number pairs changed",
        lambda ids: [("UPDATE work_items SET number = 99 WHERE work_item_id = ?", (ids["WM-9"],))],
        ["identities"],
    ),
    (
        "identities",
        "changed its labels",
        lambda ids: _quiet(
            "UPDATE work_items SET labels = '[ ]' WHERE work_item_id = ?", (ids["WM-9"],)
        ),
        ["identities"],
    ),
    (
        "identities",
        "changed its checklist",
        lambda ids: [
            ("UPDATE work_items SET checklist = '[ ]' WHERE work_item_id = ?", (ids["WM-9"],))
        ],
        ["identities"],
    ),
    (
        "identities",
        "changed its checklist beyond the claims released",
        lambda ids: [
            (
                "UPDATE work_items SET checklist = json_set(checklist, '$[0].text', 'Look again')"
                " WHERE work_item_id = ?",
                (ids["WM-4"],),
            )
        ],
        ["identities"],
    ),
    (
        "identities",
        "has the labels",
        lambda ids: _quiet(
            """UPDATE work_items SET labels = '["ui"]' WHERE work_item_id = ?""", (ids["WM-6"],)
        ),
        # The kind label `items` adds is gone, which the labels' own postcondition sees too.
        ["identities", "labels-kept"],
    ),
)


class RollbackTests(StoreCase):
    """A failed step or postcondition leaves the store exactly as it was."""

    def assert_untouched(self, before: tuple[int, str], digest: str) -> None:
        self.assertEqual(before, identity(self.path))
        self.assertEqual(digest, file_digest(self.path))
        with self.assertRaises(store.WorkModelMigrationRequiredError):
            store.connect(self.path)

    def own_store(self) -> None:
        """A 2.9 store for one subtest: the fault of one the migration did not refuse
        leaves a migrated store, which the next would find already current."""

        directory = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.addCleanup(directory.cleanup)
        self.path = os.path.join(directory.name, "valkama.sqlite3")
        self.ids = build(self.path)
        self.file = item_projects_file(self.path, directory.name)

    def refused(self, step: store_steps.Step) -> dict:
        before, digest = identity(self.path), file_digest(self.path)
        with with_step(step), self.assertRaises(store_steps.RunFailedError) as raised:
            self.migrate()
        self.assert_untouched(before, digest)
        self.assertEqual("failed", raised.exception.report["status"])
        return raised.exception.report

    def test_a_step_that_fails_rolls_back_every_step_before_it(self) -> None:
        def broken(_conn: sqlite3.Connection, _context: store_steps.Context) -> None:
            raise RuntimeError("the disk is full")

        report = self.refused(store_steps.Step("item-projects", "broken", broken))
        self.assertEqual(["item-projects"], report["failed"])
        self.assertIn("the disk is full", report["steps"][-1]["error"])
        self.assertEqual([], report["postconditions"])

    def test_each_postcondition_refuses_a_store_that_breaks_it(self) -> None:
        for name, sql, parameters in FAULTS:
            with self.subTest(postcondition=name):
                self.own_store()
                write = writing(sql, parameters(self.ids))
                report = self.refused(store_steps.Step("fault", name, write))
                self.assertIn(name, report["failed"])
                failed = next(entry for entry in report["postconditions"] if entry["name"] == name)
                self.assertFalse(failed["passed"])
                self.assertTrue(failed["error"])

    def assert_only(self, step: store_steps.Step, failed: list[str], name: str, says: str) -> None:
        report = self.refused(step)
        self.assertEqual(failed, report["failed"])
        entry = next(entry for entry in report["postconditions"] if entry["name"] == name)
        self.assertIn(says, entry["error"])

    def test_fresh_shape_probes_each_check_and_both_halves_of_the_trigger(self) -> None:
        for title, write, says, *failed in FRESH_SHAPE_FAULTS:
            with self.subTest(fault=title):
                self.own_store()
                self.assert_only(
                    once(title, write),
                    failed[0] if failed else ["fresh-shape"],
                    "fresh-shape",
                    says,
                )

    def test_each_clause_refuses_a_store_only_it_sees_broken(self) -> None:
        for name, says, statements, failed in CLAUSE_FAULTS:
            with self.subTest(postcondition=name, says=says):
                self.own_store()
                self.assert_only(once(says, several(statements, self.ids)), failed, name, says)

    def test_p16_refuses_a_step_a_second_run_would_take_again(self) -> None:
        step = store_steps.Step("again", "always", again)
        self.assertIn("second-run", self.refused(step)["failed"])

    def test_recovery_point_refuses_a_recovery_point_that_no_longer_holds_the_store(self) -> None:
        def spoil(_conn: sqlite3.Connection, context: store_steps.Context) -> None:
            point = sqlite3.connect(context.recovery_point)
            point.execute("DELETE FROM work_item_comments")
            point.commit()
            point.close()

        # The fault step is one a second run would take again, so `second-run` fails beside it.
        report = self.refused(store_steps.Step("fault", "recovery-point", spoil))
        self.assertEqual(["second-run", "recovery-point"], report["failed"])


class CommandTests(StoreCase):
    """`valkama migrate work-model`, end to end through the command line."""

    def run_command(self, *arguments: str) -> tuple[int, dict | str]:
        output = io.StringIO()
        with (
            mock.patch.dict(os.environ, {"VALKAMA_DB": self.path}),
            contextlib.redirect_stdout(output),
        ):
            try:
                cli.main(["migrate", "work-model", "--item-projects", self.file, *arguments])
                code = 0
            except SystemExit as exit_:
                code = exit_.code if isinstance(exit_.code, int) else 1
                if not isinstance(exit_.code, int) and exit_.code:
                    return code, str(exit_.code)
        text = output.getvalue()
        return code, json.loads(text) if text else ""

    def test_the_command_migrates_the_configured_store(self) -> None:
        code, report = self.run_command()
        self.assertEqual(0, code)
        assert isinstance(report, dict)
        self.assertEqual(("migrated", self.path), (report["status"], report["store"]))
        self.assertEqual(store.STORE_SCHEMA_VERSION, identity(self.path)[0])
        code, again = self.run_command()
        assert isinstance(again, dict)
        self.assertEqual((0, "current"), (code, again["status"]))

    def test_a_dry_run_migrates_a_copy_and_only_reads_the_store(self) -> None:
        before, digest = identity(self.path), file_digest(self.path)
        into = os.path.join(self.directory.name, "trial")
        code, report = self.run_command("--dry-run", "--into", into)
        self.assertEqual(0, code)
        assert isinstance(report, dict)
        self.assertEqual(
            (True, True, "migrated"), (report["dry_run"], report["kept"], report["status"])
        )
        self.assertEqual("copy", report["phases"][0]["name"])
        copy = os.path.join(into, "valkama.sqlite3")
        self.assertEqual(copy, report["store"])
        self.assertEqual(store.STORE_SCHEMA_VERSION, identity(copy)[0])
        self.assertTrue(os.path.isdir(os.path.join(into, "backups")))
        self.assertEqual((before, digest), (identity(self.path), file_digest(self.path)))
        self.assertFalse(os.path.exists(os.path.join(self.directory.name, "backups")))

    def test_a_dry_run_without_a_directory_leaves_nothing_behind(self) -> None:
        before = listed(self.directory.name)
        code, report = self.run_command("--dry-run")
        assert isinstance(report, dict)
        self.assertEqual((0, False), (code, report["kept"]))
        self.assertFalse(os.path.exists(report["store"]))
        self.assertEqual(before, listed(self.directory.name))

    def test_a_failed_run_prints_its_report_and_exits_1(self) -> None:
        step = store_steps.Step("again", "always", again)
        with with_step(step):
            code, report = self.run_command()
        assert isinstance(report, dict)
        self.assertEqual((1, "failed", ["second-run"]), (code, report["status"], report["failed"]))
        self.assertEqual(17, identity(self.path)[0])

    def test_a_store_older_than_2_9_is_refused_by_name(self) -> None:
        os.remove(self.path)
        schema17.build(self.path)
        code, message = self.run_command()
        self.assertEqual(1, code)
        self.assertIn("open it with Valkama 2.9 first", str(message))

    def test_into_without_a_dry_run_is_refused(self) -> None:
        with self.assertRaises(SystemExit) as raised, contextlib.redirect_stderr(io.StringIO()):
            cli.main(["migrate", "work-model", "--into", self.directory.name])
        self.assertEqual(2, raised.exception.code)
        self.assertEqual(17, identity(self.path)[0])

    def test_the_capabilities_name_the_command(self) -> None:
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            cli.main(["capabilities"])
        self.assertIn("migrate", json.loads(output.getvalue())["commands"])


if __name__ == "__main__":
    unittest.main()
