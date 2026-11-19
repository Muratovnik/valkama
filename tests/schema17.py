"""A store as the last schema-17 build created it, for the migration that starts there.

`fixtures/store-schema-17.sql` is every statement in `sqlite_master` of a fresh
store that build created, captured once from it rather than restated from the code
under test: a migration proven against a catalog the same module wrote proves only
that it agrees with itself.

`build` writes such a store holding its identity row. Rows come from
`schema9.populate`, whose plain SQL lands in this catalog unchanged. `raise_to_18`
carries a store at 17 to schema 18 as Valkama 2.9.0 does as it opens one, with that
release's own step, so a store 2.9.0 left is built from this catalog too.
"""

from __future__ import annotations

import contextlib
import sqlite3
from collections.abc import Iterator
from pathlib import Path
from unittest import mock

from server.planning import words
from server.quota import store as quota_store
from tests import schema8

FIXTURE = Path(__file__).resolve().parent / "fixtures" / "store-schema-17.sql"
#: The word index's schema and refill text as Valkama 2.9 wrote them.
WORDS_2_9 = Path(__file__).resolve().parent / "fixtures" / "store-words-2.9.sql"
CREATED_AT = "2026-11-13T00:00:00Z"


def build(path: str, *, data_scope_id: str = "00000000-0000-4000-8000-000000000017") -> None:
    """Write a store at schema 17, holding its identity row."""

    conn = sqlite3.connect(path)
    try:
        for _, statement in schema8.statements(FIXTURE):
            conn.execute(statement)
        conn.execute(
            "INSERT INTO platform_store_metadata"
            "(singleton,data_scope_id,owner_id,is_primary,is_writable,created_at)"
            " VALUES (1,?,'valkama',1,1,?)",
            (data_scope_id, CREATED_AT),
        )
        conn.execute("PRAGMA user_version=17")
        conn.commit()
    finally:
        conn.close()


@contextlib.contextmanager
def words_as_2_9() -> Iterator[None]:
    """`words` writing the index as Valkama 2.9 did, for a store that release left.

    Only the text of its schema and its refill has changed since -- 3.0 reads the
    projects of an item, a table 2.9 has not -- so the two are 2.9's, captured in
    `WORDS_2_9`, and the module's steps around them are its own.
    """

    text = WORDS_2_9.read_text(encoding="utf-8")
    schema, refill = text.split("\n-- refill\n")
    schema = "".join(line for line in schema.splitlines(keepends=True) if not line.startswith("--"))
    with (
        mock.patch.object(words, "SCHEMA", schema),
        mock.patch.object(words, "_REFILL", refill.strip().rstrip(";")),
    ):
        yield


def build_2_9(path: str, *, data_scope_id: str = "00000000-0000-4000-8000-000000000029") -> None:
    """Write a store as Valkama 2.9 leaves one: schema 17 with its word index, in WAL mode.

    The index is what tells 2.9's store from 2.8's at the same number, and what 2.9
    writes of it is `words.migrate` as `words_as_2_9` gives it. Items written
    afterwards are marked stale until `words.bring_current`, given the same way,
    reads them, as the next open by 2.9 would.
    """

    build(path, data_scope_id=data_scope_id)
    conn = sqlite3.connect(path)
    try:
        conn.execute("PRAGMA journal_mode=WAL")
        with words_as_2_9():
            words.migrate(conn)
        conn.commit()
    finally:
        conn.close()


def raise_to_18(path: str) -> None:
    """Carry a store at 17 to 18 as Valkama 2.9.0 does as it opens one: schema 18's step,
    which keys the names of the quota accounts by `account`, and the stamp. The step is
    the one that release runs (`quota.store.migrate`), and it is the whole of schema 18."""

    conn = sqlite3.connect(path)
    try:
        if int(conn.execute("PRAGMA user_version").fetchone()[0]) != 17:
            raise RuntimeError("only a store at 17 is carried to 18")
        quota_store.migrate(conn)
        quota_store.assert_current(conn)
        conn.execute("PRAGMA user_version=18")
        conn.commit()
    finally:
        conn.close()
