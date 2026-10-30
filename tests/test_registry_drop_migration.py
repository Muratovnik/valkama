"""Schema 8 to 9: the registry's tables leave, with a recovery point, and nothing else moves.

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


def _catalog(conn: sqlite3.Connection, kind: str) -> set[str]:
    return {
        str(row[0])
        for row in conn.execute(
            "SELECT name FROM sqlite_master WHERE type=? AND name NOT LIKE 'sqlite_%'", (kind,)
        )
    }


def _rows(conn: sqlite3.Connection, tables: set[str]) -> dict[str, list[tuple]]:
    return {
        table: [tuple(row) for row in conn.execute(f"SELECT * FROM {table} ORDER BY rowid")]
        for table in sorted(tables)
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
            planning.create_planning_space(conn, project_id="kept", name="Kept", key="KEEP")
            first = planning.create_work_item(conn, space="KEEP", title="Kept with its history")
            second = planning.create_work_item(conn, space="KEEP", title="Linked to the first")
            planning.link_work_items(conn, second["reference"], first["reference"], "blocks")
            planning.attach_ref(conn, first["reference"], "memory", "memory:kept")
            planning.attach_ref(conn, first["reference"], "session", "kept-session")
            planning.comment_work_item(conn, first["reference"], "Kept byte for byte")
            planning.claim_work_item(conn, first["reference"], author="kept-agent")
            conn.commit()
            sessions.op_ingest_session_event(
                conn,
                {
                    "session_id": "kept-session",
                    "client": "claude",
                    "event": "session_start",
                    "work_item": first["reference"],
                },
            )
            attempt = executions.open_execution(
                conn,
                execution_id="exec-kept",
                work_item_id=first["work_item_id"],
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
            before = _rows(source, kept)
            before_counts = _counts(source)
            identity = store_backups.logical_identity(source)
        finally:
            source.close()

        conn = store.connect()
        self.addCleanup(conn.close)
        self.assertEqual(9, conn.execute("PRAGMA user_version").fetchone()[0])
        self.assertEqual(kept, _catalog(conn, "table"))
        self.assertEqual(set(), RETIRED_INDEXES & _catalog(conn, "index"))
        self.assertEqual(
            {"platform_store_metadata", "platform_ui_prefs"},
            {name for name in _catalog(conn, "table") if name.startswith("platform_")},
        )
        self.assertEqual(before, _rows(conn, kept))
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
        before = _rows(source, kept)
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
            self.assertEqual(9, replayed.execute("PRAGMA user_version").fetchone()[0])
            self.assertEqual(kept, _catalog(replayed, "table"))
            self.assertEqual(before, _rows(replayed, kept))
        # The restored store is the snapshot's own source, so the replay reuses
        # that recovery point instead of stacking a second copy of it.
        self.assertEqual(1, len(self.snapshots("preschema9")))

    def test_a_store_the_schema_8_build_created_needs_no_module_rows(self) -> None:
        # That build stopped writing module rows, so its stores have none. The
        # rows' tables are dropped, not carried, and nothing checks them first.
        schema8.build(self.path)
        conn = store.connect()
        self.addCleanup(conn.close)
        self.assertEqual(9, conn.execute("PRAGMA user_version").fetchone()[0])
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
        self.assertEqual(9, migrated.execute("PRAGMA user_version").fetchone()[0])
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
        self.assertEqual(9, conn.execute("PRAGMA user_version").fetchone()[0])
        self.assertEqual(1, len(self.snapshots("preschema9")))

    def test_a_schema_8_build_refuses_the_migrated_store_before_writing(self) -> None:
        schema8.build(self.path)
        store.connect().close()
        before = Path(self.path).read_bytes()
        with mock.patch.object(store, "STORE_SCHEMA_VERSION", 8):
            with self.assertRaises(store.StoreTooNewError) as refusal:
                store.connect()
        self.assertEqual((9, 8), (refusal.exception.stored, refusal.exception.supported))
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
