"""Schema 18: the owner's names for the quota accounts keyed by `account`.

The source is a store built from the catalog a schema-17 build created
(`tests/schema17.py`), holding the rows `schema9.populate` writes and two names
written as that build wrote them, under the column `organization`. What this suite
holds the migration to: the key column is `account`, defined as a fresh store defines
it, and every name keeps its key, its name and when it was given; every other row stays
as it was; one recovery point, `preschema18`, holds the store at 17 as it was, and
restored it brings the store back to 17 and the migration runs again; a second open
writes nothing; a build that knows only 17 refuses the result; and what opens a store
without bringing it up waits on a store at 17 for a full open.
"""

from __future__ import annotations

import os
import re
import shutil
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from server import store
from server.hooks import light
from server.quota import names as account_names
from tests import schema9, schema17
from tests.test_schema12_migration import _catalog, _columns, _rows, _shape

TABLE = "quota_account_names"
#: The names as the schema-17 build wrote them: its key, the name, when it was given.
NAMES = [
    ("org-1", "Main account", "2030-03-04T09:00:00.000Z"),
    ("org-2", "Second account", "2030-03-05T10:30:00.000Z"),
]
LABELS = ("preschema18", "preschema17", "prewords", "pretables", "preupgrade", "preidentity")


def _definition(conn: sqlite3.Connection) -> str:
    """The table's definition with its spacing, quoting and `IF NOT EXISTS` left out."""

    sql = conn.execute("SELECT sql FROM sqlite_master WHERE name = ?", (TABLE,)).fetchone()[0]
    text = re.sub(r"\s+", " ", str(sql).replace('"', "")).strip()
    return text.replace(" IF NOT EXISTS ", " ")


class SchemaEighteenTests(unittest.TestCase):
    def setUp(self) -> None:
        directory = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)
        self.path = str(self.root / "valkama.sqlite3")
        patch = mock.patch.dict(os.environ, {"VALKAMA_DB": self.path})
        patch.start()
        self.addCleanup(patch.stop)
        schema17.build(self.path)
        conn = sqlite3.connect(self.path)
        try:
            schema9.populate(conn)
            conn.executemany(
                f"INSERT INTO {TABLE}(organization, name, updated_at) VALUES (?,?,?)", NAMES
            )
            conn.commit()
            self.assertEqual(17, conn.execute("PRAGMA user_version").fetchone()[0])
            columns = _columns(conn)
            self.assertEqual(["organization", "name", "updated_at"], columns[TABLE])
            # Every other table, read through the columns the source had.
            self.shape = {table: names for table, names in columns.items() if table != TABLE}
            self.before = _rows(conn, self.shape)
        finally:
            conn.close()

    def snapshots(self, label: str = "preschema18") -> list[Path]:
        return sorted((self.root / "backups").glob(f"*-{label}-*.sqlite3"))

    def taken(self) -> dict[str, int]:
        return {label: len(self.snapshots(label)) for label in LABELS if self.snapshots(label)}

    def names(self, conn: sqlite3.Connection, key: str) -> list[tuple]:
        return [
            tuple(row)
            for row in conn.execute(f"SELECT {key}, name, updated_at FROM {TABLE} ORDER BY 1")
        ]

    def assert_reached_18(self, conn: sqlite3.Connection) -> None:
        self.assertEqual(18, conn.execute("PRAGMA user_version").fetchone()[0])
        self.assertEqual(["account", "name", "updated_at"], _columns(conn)[TABLE])
        self.assertEqual(NAMES, self.names(conn, "account"))
        self.assertEqual(self.before, _rows(conn, self.shape))
        self.assertEqual("ok", conn.execute("PRAGMA integrity_check").fetchone()[0])

    def test_the_store_reaches_18_keeping_every_name_under_its_key(self) -> None:
        conn = store.connect()
        self.addCleanup(conn.close)
        conn.row_factory = None
        self.assert_reached_18(conn)
        # Read and written through the names module, by the key the name had.
        self.assertEqual(
            {"org-1": "Main account", "org-2": "Second account"}, account_names.read(conn)
        )
        account_names.write(conn, {"names": {"org-2": "Renamed"}})
        self.assertEqual("Renamed", account_names.names_of(conn, ["org-2"])["org-2"])

    def test_the_key_keeps_its_bound_under_its_new_name(self) -> None:
        conn = store.connect()
        self.addCleanup(conn.close)
        with self.assertRaises(sqlite3.IntegrityError):
            conn.execute(f"INSERT INTO {TABLE}(account, name, updated_at) VALUES ('', 'x', 't')")
        with self.assertRaises(sqlite3.IntegrityError):
            conn.execute(
                f"INSERT INTO {TABLE}(account, name, updated_at) VALUES (?, 'x', 't')", ("o" * 513,)
            )
        with self.assertRaises(sqlite3.IntegrityError):
            conn.execute(
                f"INSERT INTO {TABLE}(account, name, updated_at) VALUES ('org-1', 'x', 't')"
            )

    def test_one_recovery_point_holding_the_store_at_17_as_it_was(self) -> None:
        store.connect().close()
        self.assertEqual({"preschema18": 1}, self.taken())
        backup = sqlite3.connect(f"file:{self.snapshots()[0]}?mode=ro", uri=True)
        self.addCleanup(backup.close)
        self.assertEqual(17, backup.execute("PRAGMA user_version").fetchone()[0])
        self.assertEqual(["organization", "name", "updated_at"], _columns(backup)[TABLE])
        self.assertEqual(NAMES, self.names(backup, "organization"))
        self.assertEqual(self.before, _rows(backup, self.shape))

    def test_the_recovery_point_restores_17_and_the_migration_runs_again(self) -> None:
        store.connect().close()
        for leftover in (f"{self.path}-wal", f"{self.path}-shm"):
            if os.path.exists(leftover):
                os.remove(leftover)
        shutil.copyfile(self.snapshots()[0], self.path)
        restored = sqlite3.connect(self.path)
        try:
            self.assertEqual(17, restored.execute("PRAGMA user_version").fetchone()[0])
            self.assertEqual(["organization", "name", "updated_at"], _columns(restored)[TABLE])
            self.assertEqual(NAMES, self.names(restored, "organization"))
            self.assertEqual(self.before, _rows(restored, self.shape))
        finally:
            restored.close()
        conn = store.connect()
        self.addCleanup(conn.close)
        conn.row_factory = None
        self.assert_reached_18(conn)
        # The restored store is the point's own source, so the replay reuses it.
        self.assertEqual({"preschema18": 1}, self.taken())

    def test_reopening_a_store_at_18_writes_nothing(self) -> None:
        store.connect().close()
        observer = sqlite3.connect(self.path)
        self.addCleanup(observer.close)
        written = observer.execute("PRAGMA data_version").fetchone()[0]
        store.connect().close()
        self.assertEqual(written, observer.execute("PRAGMA data_version").fetchone()[0])
        self.assertEqual({"preschema18": 1}, self.taken())

    def test_a_fresh_store_has_the_catalog_a_migrated_one_reaches(self) -> None:
        migrated = store.connect()
        self.addCleanup(migrated.close)
        fresh_path = str(self.root / "fresh" / "valkama.sqlite3")
        with mock.patch.dict(os.environ, {"VALKAMA_DB": fresh_path}):
            fresh = store.connect()
        self.addCleanup(fresh.close)
        self.assertEqual(_shape(fresh), _shape(migrated))
        for kind in ("table", "index", "trigger"):
            with self.subTest(kind=kind):
                self.assertEqual(_catalog(fresh, kind), _catalog(migrated, kind))
        # The renamed column's bound names it too, as the fresh definition does.
        self.assertEqual(_definition(fresh), _definition(migrated))

    def test_a_build_that_knows_only_17_refuses_a_store_at_18(self) -> None:
        store.connect().close()
        before = Path(self.path).read_bytes()
        with (
            mock.patch.object(store, "STORE_SCHEMA_VERSION", 17),
            self.assertRaises(store.StoreTooNewError) as refusal,
        ):
            store.connect()
        self.assertEqual((18, 17), (refusal.exception.stored, refusal.exception.supported))
        self.assertEqual(before, Path(self.path).read_bytes())

    def test_a_light_open_waits_on_a_store_at_17_for_a_full_open(self) -> None:
        with self.assertRaises(light.UnwritableError) as waiting:
            light.open_light(self.path, store.STORE_SCHEMA_VERSION)
        self.assertEqual("schema", waiting.exception.reason)
        store.connect().close()
        conn = light.open_light(self.path, store.STORE_SCHEMA_VERSION)
        self.addCleanup(conn.close)
        self.assertEqual(NAMES, self.names(conn, "account"))


if __name__ == "__main__":
    unittest.main()
