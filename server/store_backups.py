"""Recovery points for the store, and the proof that one holds it.

Every schema or destructive data operation in this product takes a backup
first, and a backup nobody verified is a promise rather than a recovery point.
So this module owns three things that only make sense together: making one clean
copy, checking that the copy is intact, and hashing what a database logically
holds so a copy can be compared against its source.

The identity is a hash of `iterdump()` rather than of the file, because two
SQLite files holding the same rows differ byte for byte -- page layout, free
lists and a VACUUM all move bytes without changing a single value. What the
caller needs to know is whether the copy holds this store, and that is a
question about rows.

Where the copies go and what they are named is passed in. The store's path
default and the product's file prefix belong to the module that owns the store,
and a second answer to "where is the store" here is exactly the failure the one
configuration resolution exists to end.
"""

from __future__ import annotations

import os
import sqlite3
from collections.abc import Callable
from hashlib import sha256
from typing import NamedTuple


class BackupLocation(NamedTuple):
    """The backups directory, and the prefix every generated name carries."""

    directory: str
    prefix: str


def snapshot(conn: sqlite3.Connection, backups: BackupLocation, label: str) -> str:
    """One clean copy of the database, keeping the last 5 snapshots per label.

    VACUUM INTO rather than a file copy: with WAL journaling the latest commits
    may still live in the -wal file, and a copy of the main file alone would be
    a torn backup.
    """
    import datetime
    import re
    import uuid

    os.makedirs(backups.directory, exist_ok=True)
    stamp = datetime.datetime.now(datetime.UTC).strftime("%Y%m%dT%H%M%SZ")
    unique = uuid.uuid4().hex[:6]  # two upgrades in one second must not collide
    destination = os.path.join(
        backups.directory, f"{backups.prefix}-{label}-{stamp}-{unique}.sqlite3"
    )
    conn.execute("VACUUM INTO ?", (destination,))
    # Retention keeps the last 5 of THIS label, ordered by mtime. All three
    # properties are load-bearing, and a second label broke each of them:
    #
    # By mtime, because sorting names was chronological only while every file
    # shared one label. "premerge" sorts before "preupgrade", so a fresh merge
    # snapshot fell inside the deleted prefix and the merge committed with no
    # backup at all.
    #
    # Per label, because one shared quota let ordinary merge activity evict the
    # pre-schema-surgery snapshot this function exists to make. Six merges used
    # to be enough to delete the only "preupgrade" copy.
    #
    # Matching the generated shape AND this label, because anything else in this
    # directory is somebody else's artifact: a hand-made backup, or a WAL or SHM
    # sidecar. The narrow claim is the true one; a hand-made file that imitates
    # this exact shape under this exact label is still collectable.
    # Built from the caller's prefix rather than spelled out: the previous
    # rename left this pattern reading `platform-` while the files it had just
    # renamed were something else, so retention quietly stopped seeing half of
    # them.
    generated = re.compile(
        rf"^{re.escape(backups.prefix)}-(?P<label>.+)-\d{{8}}T\d{{6}}Z-[0-9a-f]{{6}}\.sqlite3$"
    )
    peers = []
    for name in os.listdir(backups.directory):
        match = generated.match(name)
        if match and match.group("label") == label:
            peers.append(os.path.join(backups.directory, name))
    for stale in sorted(peers, key=os.path.getmtime)[:-5]:
        if stale != destination:
            os.remove(stale)
    return destination


def reusable_snapshot(backups: BackupLocation, label: str) -> str | None:
    """Return this label's newest existing snapshot, or None to make a fresh one."""

    import glob

    pattern = os.path.join(backups.directory, f"{backups.prefix}-{label}-*.sqlite3")
    existing = sorted(glob.glob(pattern), key=os.path.getmtime)
    return existing[-1] if existing else None


def integrity_check(conn: sqlite3.Connection, *, source: str) -> None:
    result = str(conn.execute("PRAGMA integrity_check").fetchone()[0])
    if result != "ok":
        raise RuntimeError(f"{source} integrity check failed: {result}")


def logical_identity(conn: sqlite3.Connection) -> str:
    """Hash the complete logical store, independent of SQLite page layout."""

    digest = sha256()
    for line in conn.iterdump():
        if line in {"BEGIN TRANSACTION;", "COMMIT;"}:
            continue
        digest.update(line.encode("utf-8"))
        digest.update(b"\n")
    return digest.hexdigest()


def snapshot_identity(path: str) -> str:
    """Integrity-check one snapshot file and hash what it logically holds."""

    snapshot = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    try:
        integrity_check(snapshot, source="snapshot")
        return logical_identity(snapshot)
    finally:
        snapshot.close()


def verified_snapshot(
    conn: sqlite3.Connection,
    label: str,
    *,
    locate: Callable[[], BackupLocation],
) -> tuple[str, str]:
    """Name one recovery point that holds exactly this logical source.

    A refused migration leaves its snapshot behind so an immediate retry reuses
    the same recovery point instead of stacking copies. The owner may keep
    working with the previous build in between, though, and then that copy names
    a store that no longer exists: restoring it would undo everything done since.
    So a snapshot is reused only while it still matches, the older copy stays on
    disk under this label's retention, and this attempt takes its own.

    `locate` is called rather than passed as a value, so each of the two paths
    below resolves the backup location for itself -- the same two resolutions
    this made when it read the store's path directly.
    """

    integrity_check(conn, source="source store")
    source_identity = logical_identity(conn)
    reusable = reusable_snapshot(locate(), label)
    if reusable is not None and snapshot_identity(reusable) == source_identity:
        return reusable, source_identity
    destination = snapshot(conn, locate(), label)
    if snapshot_identity(destination) != source_identity:
        raise RuntimeError("snapshot does not match the exact logical source store")
    return destination, source_identity
