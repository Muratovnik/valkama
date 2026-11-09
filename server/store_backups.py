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

The pictures pasted into items are files beside the store rather than rows in it,
so a copy of the database alone would come back with every picture missing. A
snapshot therefore takes the pictures' directory along, as a directory named like
the snapshot with `.images` for `.sqlite3`. Each file there is named by the
SHA-256 of its bytes, which is what makes a copy checkable without knowing which
rows hold it: a file is intact when its bytes hash to its name.
"""

from __future__ import annotations

import contextlib
import os
import re
import shutil
import sqlite3
from collections.abc import Callable, Iterator
from hashlib import sha256
from typing import NamedTuple


class BackupLocation(NamedTuple):
    """The backups directory, the prefix every generated name carries, and the pictures.

    `images` is the directory of the store's pictures, copied beside each
    snapshot; empty for a caller whose store keeps none.
    """

    directory: str
    prefix: str
    images: str = ""


_PICTURE = re.compile(r"[0-9a-f]{64}")
_SNAPSHOT_SUFFIX = ".sqlite3"
IMAGES_SUFFIX = ".images"


def images_beside(snapshot_path: str) -> str:
    """The directory that holds a snapshot's pictures."""

    stem = snapshot_path.removesuffix(_SNAPSHOT_SUFFIX)
    return stem + IMAGES_SUFFIX


def _pictures(directory: str) -> list[str]:
    """The picture files in a directory, by name; none when it does not exist."""

    try:
        names = os.listdir(directory)
    except FileNotFoundError:
        return []
    return sorted(name for name in names if _PICTURE.fullmatch(name))


def _copy_pictures(source: str, destination: str) -> None:
    pictures = _pictures(source)
    if not pictures:
        return
    os.makedirs(destination, exist_ok=True)
    for name in pictures:
        shutil.copyfile(os.path.join(source, name), os.path.join(destination, name))


def verify_pictures(snapshot_path: str, source: str) -> None:
    """Refuse a snapshot whose pictures are not all there, each holding what its name says.

    Every picture in `source` must have its copy, because the rows the snapshot
    holds name them; a copy whose bytes do not hash to its name is no copy.
    """

    copies = images_beside(snapshot_path)
    held = set(_pictures(copies))
    missing = [name for name in _pictures(source) if name not in held]
    if missing:
        raise RuntimeError(f"snapshot lacks {len(missing)} picture(s) of the source store")
    for name in held:
        digest = sha256()
        with open(os.path.join(copies, name), "rb") as handle:
            for chunk in iter(lambda: handle.read(1 << 20), b""):
                digest.update(chunk)
        if digest.hexdigest() != name:
            raise RuntimeError("a picture in the snapshot does not hold what its name says")


@contextlib.contextmanager
def _writes_held(conn: sqlite3.Connection, backups: BackupLocation) -> Iterator[None]:
    """Hold off every other write to the store while its rows and pictures are copied.

    The rows are copied by `VACUUM INTO`, which cannot run inside a transaction of
    `conn`, and the pictures are files beside them; between the two an upload could
    commit a picture the copied rows do not name, and a delete could take one they
    do. So a second connection holds the store's write lock across the whole copy
    and its check: `VACUUM INTO` only reads, which the lock allows, and every other
    writer waits for it as it waits for any write. A store with no pictures, or with
    no file, needs none of this.
    """

    database = next(
        (str(row[2]) for row in conn.execute("PRAGMA database_list") if row[1] == "main"), ""
    )
    if not backups.images or not database:
        yield
        return
    holder = sqlite3.connect(database, timeout=5)
    try:
        holder.execute("BEGIN IMMEDIATE")
        yield
    finally:
        holder.rollback()
        holder.close()


def snapshot(conn: sqlite3.Connection, backups: BackupLocation, label: str) -> str:
    """One clean copy of the database, keeping the last 5 snapshots per label.

    VACUUM INTO rather than a file copy: with WAL journaling the latest commits
    may still live in the -wal file, and a copy of the main file alone would be
    a torn backup. The pictures are copied and checked under the same write lock
    (`_writes_held`).
    """

    with _writes_held(conn, backups):
        return _snapshot(conn, backups, label)


def _snapshot(conn: sqlite3.Connection, backups: BackupLocation, label: str) -> str:
    """`snapshot`, for a caller that already holds the other writers off."""
    import datetime
    import uuid

    os.makedirs(backups.directory, exist_ok=True)
    stamp = datetime.datetime.now(datetime.UTC).strftime("%Y%m%dT%H%M%SZ")
    unique = uuid.uuid4().hex[:6]  # two upgrades in one second must not collide
    destination = os.path.join(
        backups.directory, f"{backups.prefix}-{label}-{stamp}-{unique}.sqlite3"
    )
    conn.execute("VACUUM INTO ?", (destination,))
    # After the rows, and with no write since them: a picture is on disk before the
    # row that names it commits, so every picture the copied rows name is there.
    if backups.images:
        _copy_pictures(backups.images, images_beside(destination))
        verify_pictures(destination, backups.images)
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
            shutil.rmtree(images_beside(stale), ignore_errors=True)
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
    # VACUUM can move triggers after indexes without changing either. iterdump
    # orders these by sqlite_master insertion order, which is not store data.
    schema_tail = []
    for line in conn.iterdump():
        if line in {"BEGIN TRANSACTION;", "COMMIT;"}:
            continue
        if line.startswith(
            ("CREATE INDEX ", "CREATE UNIQUE INDEX ", "CREATE TRIGGER ", "CREATE VIEW ")
        ):
            schema_tail.append(line)
            continue
        digest.update(line.encode("utf-8"))
        digest.update(b"\n")
    for line in sorted(schema_tail):
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


#: What a snapshot that failed verification is renamed with. No reuse or
#: retention pattern matches it, so it stays until a person removes it.
UNVERIFIED_SUFFIX = ".unverified"


def set_aside(path: str) -> None:
    """Rename one snapshot out of reuse and retention, keeping every byte."""

    try:
        os.rename(path, path + UNVERIFIED_SUFFIX)
    except OSError:
        # Left in place it is still older than the fresh copy taken next, so
        # the next open reuses that one instead.
        return
    pictures = images_beside(path)
    if os.path.isdir(pictures):
        try:
            os.rename(pictures, pictures + UNVERIFIED_SUFFIX)
        except OSError:
            pass


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

    A reusable snapshot that cannot be read at all -- half a file from a
    process killed during `VACUUM INTO` -- is set aside under `*.unverified`
    and this attempt takes its own. Renamed rather than deleted, because a
    recovery point is never removed on a guess; renamed rather than left,
    because it would otherwise be found as reusable at every later open and
    stop each of them.
    """

    with _writes_held(conn, locate()):
        integrity_check(conn, source="source store")
        source_identity = logical_identity(conn)
        reusable = reusable_snapshot(locate(), label)
        if reusable is not None:
            try:
                if snapshot_identity(reusable) == source_identity:
                    verify_pictures(reusable, locate().images)
                    return reusable, source_identity
            except (OSError, sqlite3.Error, RuntimeError):
                set_aside(reusable)
        backups = locate()
        destination = _snapshot(conn, backups, label)
        if snapshot_identity(destination) != source_identity:
            raise RuntimeError("snapshot does not match the exact logical source store")
        return destination, source_identity
