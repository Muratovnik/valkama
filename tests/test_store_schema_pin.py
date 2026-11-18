"""The fresh store's declaration is pinned to the schema version it belongs to.

A change to what a fresh store declares raises `store.STORE_SCHEMA_VERSION`, so an
older build refuses the store instead of reading a table it lacks as current. Every
gate compared only the number, so a declaration change without the raise passed
them all. Here the normalized `sqlite_master` of a store this build creates fresh
(tables, indexes, triggers and views) is pinned together with the version it
belongs to. A declaration that moves while the version stays fails; so does a
version that moves while the declaration stays.

The pin is the two constants below, changed together in the commit that makes a
raise. The statusline copy of the version (`server/hooks/statusline.py`) moves with
it, as `tests/test_hooks_statusline.py` requires.
"""

from __future__ import annotations

import hashlib
import os
import re
import sqlite3
import tempfile
import unittest

from server import store

#: The schema version the declaration below belongs to.
PINNED_SCHEMA_VERSION = 21

#: The digest of a fresh store's declaration at that version, `declaration_digest`.
PINNED_DECLARATION_DIGEST = "201970f243055750bfdff76a7a41edc0c580808cbc375cf5ea77a17af6c311c7"

_TOKEN = re.compile(r"\w+|[^\w\s]")


def declaration_digest(conn: sqlite3.Connection) -> str:
    """The digest of a store's declared objects, unmoved by whitespace or by the order
    `sqlite_master` lists them in.

    Each declaration is cut into words and punctuation marks and joined by one space,
    so `CREATE TABLE t( id INTEGER )` and `CREATE TABLE t(id INTEGER)` read alike.
    Rows with a NULL `sql` are left out: they are the automatic indexes a UNIQUE or
    PRIMARY KEY constraint creates, which the table's own declaration already carries.
    """

    lines = []
    for kind, name, table, sql in conn.execute(
        "SELECT type, name, tbl_name, sql FROM sqlite_master"
        " WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'"
    ):
        tokens = " ".join(_TOKEN.findall(str(sql)))
        lines.append(f"{kind}|{name}|{table}|{tokens}")
    return hashlib.sha256("\n".join(sorted(lines)).encode("utf-8")).hexdigest()


def pin_failure(version: int, digest: str) -> str | None:
    """What is wrong with a build at `version` whose fresh declaration digests to
    `digest`; None when the pin holds."""

    if (version, digest) == (PINNED_SCHEMA_VERSION, PINNED_DECLARATION_DIGEST):
        return None
    found = f"found STORE_SCHEMA_VERSION {version} and declaration digest {digest}"
    pinned = f"pinned {PINNED_SCHEMA_VERSION} and {PINNED_DECLARATION_DIGEST}"
    if version == PINNED_SCHEMA_VERSION:
        return (
            f"the fresh store's declaration changed without a raise: {found}; {pinned}. "
            f"Raise STORE_SCHEMA_VERSION to {version + 1} in server/store.py, set SCHEMA_VERSION "
            "in server/hooks/statusline.py to the same value and run "
            "tests.test_hooks_statusline, then pin the new version and the found digest "
            "in tests/test_store_schema_pin.py."
        )
    if digest == PINNED_DECLARATION_DIGEST:
        return (
            f"STORE_SCHEMA_VERSION moved without a change of the fresh declaration: {found}; "
            f"{pinned}. A raise has nothing to raise for: restore the version, or make the "
            "declaration change it belongs to and pin both."
        )
    return (
        f"STORE_SCHEMA_VERSION and the fresh declaration both moved: {found}; {pinned}. "
        "Pin the found version and digest in tests/test_store_schema_pin.py in the commit "
        "that makes the raise."
    )


class DeclarationPinTests(unittest.TestCase):
    def setUp(self) -> None:
        directory = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.addCleanup(directory.cleanup)
        self.path = os.path.join(directory.name, "fresh.sqlite3")

    def fresh_digest(self) -> str:
        conn = store.connect(self.path)
        try:
            return declaration_digest(conn)
        finally:
            conn.close()

    def test_the_fresh_declaration_is_pinned_to_its_schema_version(self) -> None:
        failure = pin_failure(store.STORE_SCHEMA_VERSION, self.fresh_digest())
        self.assertIsNone(failure, failure)

    def test_a_declaration_change_without_a_raise_is_refused(self) -> None:
        # A disposable fresh store with one column added: no product file changes.
        conn = store.connect(self.path)
        try:
            conn.execute("ALTER TABLE work_items ADD COLUMN pin_probe TEXT")
            changed = declaration_digest(conn)
        finally:
            conn.close()
        failure = pin_failure(store.STORE_SCHEMA_VERSION, changed)
        self.assertIsNotNone(failure)
        assert failure is not None
        self.assertIn("changed without a raise", failure)
        self.assertIn(changed, failure)
        self.assertIn("Raise STORE_SCHEMA_VERSION", failure)

    def test_a_raise_with_an_unchanged_declaration_is_refused(self) -> None:
        failure = pin_failure(PINNED_SCHEMA_VERSION + 1, PINNED_DECLARATION_DIGEST)
        self.assertIsNotNone(failure)
        assert failure is not None
        self.assertIn("nothing to raise for", failure)

    def test_a_raise_with_a_changed_declaration_waits_for_its_pin(self) -> None:
        failure = pin_failure(PINNED_SCHEMA_VERSION + 1, "0" * 64)
        self.assertIsNotNone(failure)
        assert failure is not None
        self.assertIn("both moved", failure)
        self.assertIn("0" * 64, failure)

    def test_whitespace_and_order_do_not_move_the_digest(self) -> None:
        compact = sqlite3.connect(":memory:")
        spaced = sqlite3.connect(":memory:")
        try:
            compact.execute("CREATE TABLE a(id INTEGER PRIMARY KEY, x TEXT)")
            compact.execute("CREATE TABLE b(id INTEGER PRIMARY KEY)")
            spaced.execute("CREATE TABLE b(\n  id INTEGER PRIMARY KEY\n)")
            spaced.execute("CREATE TABLE a(\n  id   INTEGER PRIMARY KEY,\n  x TEXT\n)")
            self.assertEqual(declaration_digest(compact), declaration_digest(spaced))
        finally:
            compact.close()
            spaced.close()
