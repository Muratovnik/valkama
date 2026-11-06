"""Schema 8 onward: the registry's tables leave, with a recovery point, and nothing else moves.

The source is a store built from the catalog the schema-8 build created, not
one shaped by the code under test, and populated the way that build left a
real store: work, history, sessions, the registry and module rows an earlier
build seeded, the integration switches and the last route.
"""

from __future__ import annotations

import os
import shutil
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from server import sessions, store, store_backups
from server.executions import service as executions
from server.planning import service as planning
from server.planning import store as planning_store
from server.platform import migrations
from tests import registry_rows, schema8

#: What schema 9 no longer has: the registry's tables, the module rows with
#: their audit, and the integration switches. Stated here rather than read from
#: the migration, which is what this suite checks.
RETIRED = {
    "platform_adapter_links",
    "platform_modules",
    "platform_services",
    "platform_adapters",
    "platform_connections",
    "platform_assignments",
    "platform_grants",
    "platform_actions",
    "platform_action_inputs",
    "platform_core_ref_bindings",
    "platform_packages",
    "platform_known_stores",
    "platform_registry_meta",
    "platform_registry_audit",
    "integration_settings",
}
RETIRED_INDEXES = {"platform_adapter_links_item", "platform_registry_audit_entity"}
#: What the same upgrade adds: session identity is an additive step every store
#: older than it takes on the way, schema 8 included, and so is schema 10's table
#: of replaced answers, schema 11's usage tables and schema 12's pins. The chain
#: ends at the build's own schema, under the one recovery point labelled for its
#: oldest step.
ADDED = {
    "execution_events",
    "work_item_request_answers",
    "owner_alert_settings",
    "usage_runs",
    "usage_segments",
    "usage_requests",
    "pinned_work_items",
    "work_item_subscriptions",
}
#: When the schema-8 build wrote the rows below.
CREATED_AT = "2026-08-09T16:50:36Z"


def _catalog(conn: sqlite3.Connection, kind: str) -> set[str]:
    return {
        str(row[0])
        for row in conn.execute(
            "SELECT name FROM sqlite_master WHERE type=? AND name NOT LIKE 'sqlite_%'", (kind,)
        )
    }


def _columns(conn: sqlite3.Connection, tables: set[str]) -> dict[str, list[str]]:
    return {
        table: [str(row[1]) for row in conn.execute(f"PRAGMA table_info({table})")]
        for table in sorted(tables)
    }


def _rows(conn: sqlite3.Connection, columns: dict[str, list[str]]) -> dict[str, list[tuple]]:
    """Every row of each table, read through the columns the source store had.

    An additive step appends columns to some of these tables; what is held here
    is that every value the source had is still where it was.
    """

    return {
        table: [
            tuple(row)
            for row in conn.execute(f"SELECT {', '.join(names)} FROM {table} ORDER BY rowid")
        ]
        for table, names in columns.items()
    }


def _counts(conn: sqlite3.Connection) -> dict[str, int]:
    return {
        table: conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
        for table in sorted(_catalog(conn, "table"))
    }


class SchemaEightMigrationTests(unittest.TestCase):
    def setUp(self) -> None:
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.path = str(Path(directory.name) / "valkama.sqlite3")
        patch = mock.patch.dict(os.environ, {"VALKAMA_DB": self.path})
        patch.start()
        self.addCleanup(patch.stop)

    def snapshots(self, label: str) -> list[Path]:
        return list((Path(self.path).parent / "backups").glob(f"*-{label}-*.sqlite3"))

    def populated_source(self) -> None:
        schema8.build(self.path)
        conn = sqlite3.connect(self.path)
        conn.row_factory = sqlite3.Row
        try:
            first = self.planning_rows(conn)
            conn.commit()
            sessions.op_ingest_session_event(
                conn,
                {
                    "session_id": "kept-session",
                    "client": "claude",
                    "event": "session_start",
                    "work_item": "KEEP-1",
                },
            )
            attempt = executions.open_execution(
                conn,
                execution_id="exec-kept",
                work_item_id=first,
                project_id="kept",
                packet={
                    "client": "claude",
                    "role": "executor",
                    "environment": "workdir",
                    "expected_effect": "change_required",
                },
            )
            executions.link_session(conn, attempt, "kept-session", "launched")
            # What earlier builds seeded, and the rows nothing has written since.
            registry_rows.seed(conn)
            conn.execute(
                "INSERT INTO integration_settings VALUES('agentmemory',1,'2026-08-09T16:50:36Z')"
            )
            conn.execute(
                "INSERT INTO platform_ui_prefs VALUES('last-route',?,'2026-10-01T00:00:00Z')",
                ('{"module_id":"planning","scope":{"kind":"global"}}',),
            )
            conn.commit()
        finally:
            conn.close()

    @staticmethod
    def planning_rows(conn: sqlite3.Connection) -> str:
        """Work with its history, as the schema-8 build wrote it; the held item's id.

        Plain SQL in the shapes that build wrote, so the fixture keeps working
        however later code writes these tables. The space and its workflow come
        from `create_space`, which writes only tables nothing since has changed.
        """

        space = planning_store.create_space(conn, project_id="kept", name="Kept", key="KEEP")
        workflow = planning_store.workflow_for_space(conn, space["planning_space_id"])
        first = "11111111-1111-4111-8111-111111111111"
        second = "22222222-2222-4222-8222-222222222222"
        for identity, number, claim, title in (
            (first, 1, "kept-agent", "Kept with its history"),
            (second, 2, "", "Linked to the first"),
        ):
            conn.execute(
                "INSERT INTO work_items(work_item_id,planning_space_id,number,workflow_id,"
                "state_id,claim_ref,title,position,revision,created_at,updated_at)"
                " VALUES(?,?,?,?,?,?,?,?,1,?,?)",
                (
                    identity,
                    space["planning_space_id"],
                    number,
                    workflow["workflow_id"],
                    workflow["initial_state_id"],
                    claim,
                    title,
                    float(number),
                    CREATED_AT,
                    CREATED_AT,
                ),
            )
        conn.execute("UPDATE planning_spaces SET next_number=3")
        conn.execute(
            "INSERT INTO work_item_links(from_id,to_id,kind,created_at) VALUES(?,?,'blocks',?)",
            (second, first, CREATED_AT),
        )
        for identity, action, detail in (
            (first, "created", "backlog"),
            (second, "created", "backlog"),
            (second, "linked", "blocks KEEP-1"),
            (first, "linked", "blocks from KEEP-2"),
            (first, "claimed", ""),
        ):
            conn.execute(
                "INSERT INTO work_item_events(work_item_id,action,detail,author,created_at)"
                " VALUES(?,?,?,'kept-agent',?)",
                (identity, action, detail, CREATED_AT),
            )
        for kind, value in (("memory", "memory:kept"), ("session", "kept-session")):
            conn.execute(
                "INSERT INTO work_item_refs(work_item_id,kind,value,label,author,created_at)"
                " VALUES(?,?,?,'','kept-agent',?)",
                (first, kind, value, CREATED_AT),
            )
        conn.execute(
            "INSERT INTO work_item_comments(work_item_id,author,body,created_at)"
            " VALUES(?,'kept-agent','Kept byte for byte',?)",
            (first, CREATED_AT),
        )
        return first

    def test_the_retired_tables_leave_and_every_other_row_stays(self) -> None:
        self.populated_source()
        source = sqlite3.connect(self.path)
        try:
            self.assertEqual(8, source.execute("PRAGMA user_version").fetchone()[0])
            self.assertTrue(_catalog(source, "table") >= RETIRED)
            # The source holds rows the drop has to take with it.
            for table in (
                "platform_modules",
                "platform_registry_audit",
                "platform_adapters",
                "platform_action_inputs",
                "platform_known_stores",
                "integration_settings",
            ):
                with self.subTest(table=table):
                    self.assertTrue(source.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0])
            kept = _catalog(source, "table") - RETIRED
            shape = _columns(source, kept)
            before = _rows(source, shape)
            before_counts = _counts(source)
            identity = store_backups.logical_identity(source)
        finally:
            source.close()

        conn = store.connect()
        self.addCleanup(conn.close)
        self.assertEqual(
            store.STORE_SCHEMA_VERSION, conn.execute("PRAGMA user_version").fetchone()[0]
        )
        self.assertEqual(kept | ADDED, _catalog(conn, "table"))
        self.assertEqual(set(), RETIRED_INDEXES & _catalog(conn, "index"))
        self.assertEqual(
            {"platform_store_metadata", "platform_ui_prefs"},
            {name for name in _catalog(conn, "table") if name.startswith("platform_")},
        )
        self.assertEqual(before, _rows(conn, shape))
        self.assertEqual("Kept with its history", planning.get_work_item(conn, "KEEP-1")["title"])
        self.assertEqual("ok", conn.execute("PRAGMA integrity_check").fetchone()[0])

        # The recovery point: one, beside the store, taken before the first
        # write, and holding the source exactly.
        snapshots = self.snapshots("preschema9")
        self.assertEqual(1, len(snapshots))
        self.assertEqual([], self.snapshots("preproductmodel"))
        backup = sqlite3.connect(f"file:{snapshots[0]}?mode=ro", uri=True)
        self.addCleanup(backup.close)
        self.assertEqual("ok", backup.execute("PRAGMA integrity_check").fetchone()[0])
        self.assertEqual(8, backup.execute("PRAGMA user_version").fetchone()[0])
        self.assertEqual(before_counts, _counts(backup))
        self.assertEqual(identity, store_backups.logical_identity(backup))

        # Opening the migrated store again writes nothing and takes no copy.
        conn.close()
        observer = sqlite3.connect(self.path)
        self.addCleanup(observer.close)
        written = observer.execute("PRAGMA data_version").fetchone()[0]
        store.connect().close()
        self.assertEqual(written, observer.execute("PRAGMA data_version").fetchone()[0])
        self.assertEqual(1, len(self.snapshots("preschema9")))

    def test_the_recovery_point_restores_and_replays_the_migration_once(self) -> None:
        self.populated_source()
        source = sqlite3.connect(self.path)
        kept = _catalog(source, "table") - RETIRED
        shape = _columns(source, kept)
        before = _rows(source, shape)
        source.close()
        store.connect().close()
        restored = str(Path(self.path).parent / "restored.sqlite3")
        shutil.copyfile(self.snapshots("preschema9")[0], restored)
        raw = sqlite3.connect(restored)
        self.assertEqual(8, raw.execute("PRAGMA user_version").fetchone()[0])
        self.assertTrue(_catalog(raw, "table") >= RETIRED)
        raw.close()
        with mock.patch.dict(os.environ, {"VALKAMA_DB": restored}):
            replayed = store.connect()
            self.addCleanup(replayed.close)
            self.assertEqual(
                store.STORE_SCHEMA_VERSION, replayed.execute("PRAGMA user_version").fetchone()[0]
            )
            self.assertEqual(kept | ADDED, _catalog(replayed, "table"))
            self.assertEqual(before, _rows(replayed, shape))
        # The restored store is the snapshot's own source, so the replay reuses
        # that recovery point instead of stacking a second copy of it.
        self.assertEqual(1, len(self.snapshots("preschema9")))

    def test_a_store_the_schema_8_build_created_needs_no_module_rows(self) -> None:
        # That build stopped writing module rows, so its stores have none. The
        # rows' tables are dropped, not carried, and nothing checks them first.
        schema8.build(self.path)
        conn = store.connect()
        self.addCleanup(conn.close)
        self.assertEqual(
            store.STORE_SCHEMA_VERSION, conn.execute("PRAGMA user_version").fetchone()[0]
        )
        self.assertEqual(set(), RETIRED & _catalog(conn, "table"))

    def test_rows_in_the_retired_tables_are_dropped_without_being_read(self) -> None:
        schema8.build(self.path)
        conn = sqlite3.connect(self.path)
        try:
            registry_rows.seed(conn)
            # Each of these refused a store while its table was read: no
            # Settings row, a module no build declares, a record that is not
            # JSON at all.
            conn.execute("DELETE FROM platform_modules WHERE module_id='settings'")
            conn.execute(
                "INSERT INTO platform_modules VALUES"
                "('future-module','{}','disabled',1,3,'2026-01-01T00:00:00Z')"
            )
            conn.execute("UPDATE platform_adapters SET record_json='not json'")
            conn.commit()
        finally:
            conn.close()
        migrated = store.connect()
        self.addCleanup(migrated.close)
        self.assertEqual(
            store.STORE_SCHEMA_VERSION, migrated.execute("PRAGMA user_version").fetchone()[0]
        )
        self.assertEqual(set(), RETIRED & _catalog(migrated, "table"))

    def test_a_failed_attempt_leaves_the_store_at_8_and_the_retry_reuses_its_copy(self) -> None:
        self.populated_source()
        source = sqlite3.connect(self.path)
        identity = store_backups.logical_identity(source)
        source.close()
        original = migrations.drop_retired_tables

        def fail_after_dropping(conn: sqlite3.Connection) -> None:
            original(conn)
            raise RuntimeError("injected after the drop")

        with mock.patch.object(migrations, "drop_retired_tables", side_effect=fail_after_dropping):
            with self.assertRaisesRegex(RuntimeError, "injected"):
                store.connect()
        raw = sqlite3.connect(self.path)
        try:
            self.assertEqual(8, raw.execute("PRAGMA user_version").fetchone()[0])
            self.assertTrue(_catalog(raw, "table") >= RETIRED)
            self.assertEqual(identity, store_backups.logical_identity(raw))
        finally:
            raw.close()
        self.assertEqual(1, len(self.snapshots("preschema9")))
        conn = store.connect()
        self.addCleanup(conn.close)
        self.assertEqual(
            store.STORE_SCHEMA_VERSION, conn.execute("PRAGMA user_version").fetchone()[0]
        )
        self.assertEqual(1, len(self.snapshots("preschema9")))

    def test_a_schema_8_build_refuses_the_migrated_store_before_writing(self) -> None:
        schema8.build(self.path)
        store.connect().close()
        before = Path(self.path).read_bytes()
        with mock.patch.object(store, "STORE_SCHEMA_VERSION", 8):
            with self.assertRaises(store.StoreTooNewError) as refusal:
                store.connect()
        self.assertEqual(
            (store.STORE_SCHEMA_VERSION, 8),
            (refusal.exception.stored, refusal.exception.supported),
        )
        self.assertEqual(before, Path(self.path).read_bytes())

    def test_the_full_integrity_check_runs_on_a_migration_and_not_on_every_open(self) -> None:
        schema8.build(self.path)
        with mock.patch.object(
            store_backups, "integrity_check", wraps=store_backups.integrity_check
        ) as check:
            store.connect().close()
            migrated = [call.kwargs["source"] for call in check.call_args_list]
            check.reset_mock()
            store.connect().close()
            reopened = [call.kwargs["source"] for call in check.call_args_list]
        self.assertIn("post-migration store", migrated)
        self.assertEqual([], reopened)


if __name__ == "__main__":
    unittest.main()
