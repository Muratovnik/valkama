"""Pictures pasted into an item's text: kept by their hash, beside the store, and only there.

A person pastes a screenshot into a comment, a reply or a description, and the
text gets a Markdown image naming `/api/images/<sha256>`. The bytes are a file
named by that hash in the `images` directory beside the store's own file, and a
row in `work_item_images` says which item holds it. Two items holding one picture
share one file; the file goes when the last row that holds it goes, which is when
its item is deleted.

What is a picture is decided by its first bytes, never by a name or a declared
type: PNG, JPEG, WebP and GIF, nothing else, and no more than `MAX_BYTES`. The
bytes are never logged, never sent anywhere and never read by anything but the
two routes that store and serve them and the tool that hands one to an agent: a
screenshot can hold whatever was on a person's screen.

Where the directory is comes from the connection, not from the configuration:
the store this connection opened is the one the pictures belong to, and a second
resolution of "where is the store" is the failure the one resolution exists to end.
"""

from __future__ import annotations

import contextlib
import os
import re
import sqlite3
import tempfile
from hashlib import sha256
from typing import NamedTuple

from . import calls, model, read_model

#: The largest picture taken, in bytes; the editor refuses a larger one before sending it.
MAX_BYTES = 10 * 1024 * 1024
#: The directory beside the store's file that holds the pictures.
DIRECTORY = "images"
#: Where one picture is served, and so what the Markdown written for it names.
PATH_PREFIX = "/api/images/"
_HASH = re.compile(r"[0-9a-f]{64}")


class ImageRefusedError(model.PlanningError):
    """A picture refused, with the status and the code both surfaces report."""

    def __init__(self, status: int, code: str, message: str) -> None:
        super().__init__(message)
        self.status = status
        self.code = code


class Picture(NamedTuple):
    """One picture's bytes and what they are, for a reader that shows it."""

    sha256: str
    media_type: str
    data: bytes


def media_type(data: bytes) -> str | None:
    """What the bytes are by their signature, or None when they are no picture taken here."""

    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if data.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if data.startswith((b"GIF87a", b"GIF89a")):
        return "image/gif"
    if len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    return None


def directory_beside(database: str) -> str:
    """The pictures' directory for the store whose file is `database`."""

    return os.path.join(os.path.dirname(os.path.abspath(database)), DIRECTORY)


def directory(conn: sqlite3.Connection) -> str:
    """The pictures' directory of the store this connection opened."""

    for row in conn.execute("PRAGMA database_list"):
        if row[1] == "main" and row[2]:
            return directory_beside(str(row[2]))
    raise ImageRefusedError(503, "unavailable", "this store has no file to keep pictures beside")


def path_of(sha: str) -> str:
    """The address one picture is served at."""

    return f"{PATH_PREFIX}{sha}"


def _hash(value: object) -> str:
    if not isinstance(value, str) or _HASH.fullmatch(value) is None:
        raise ImageRefusedError(404, "not_found", "no such picture")
    return value


def _write(folder: str, sha: str, data: bytes) -> bool:
    """Put the file in place whole; True when this call wrote it.

    A file already there that holds these bytes is left alone, and is not this
    call's to take back; one that does not is replaced.
    """

    target = os.path.join(folder, sha)
    with contextlib.suppress(FileNotFoundError), open(target, "rb") as handle:
        if sha256(handle.read(MAX_BYTES + 1)).hexdigest() == sha:
            return False
    os.makedirs(folder, exist_ok=True)
    descriptor, name = tempfile.mkstemp(prefix=f".{sha}.", suffix=".tmp", dir=folder)
    try:
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(name, target)
    finally:
        with contextlib.suppress(FileNotFoundError):
            os.remove(name)
    return True


def store(conn: sqlite3.Connection, reference: object, data: bytes) -> dict:
    """Keep one picture for one item, and commit; what the editor writes into the text.

    The file is written under the store's write lock and before the row, so a
    reader never finds a row without its file, and a removal never runs between
    the two. A write that fails takes back a file it put there itself.
    """

    if len(data) > MAX_BYTES:
        raise ImageRefusedError(413, "too_large", f"a picture may be at most {MAX_BYTES} bytes")
    kind = media_type(data)
    if kind is None:
        raise ImageRefusedError(
            415, "not_an_image", "only a PNG, JPEG, WebP or GIF picture can be attached"
        )
    if not conn.in_transaction:
        conn.execute("BEGIN IMMEDIATE")
    folder = ""
    digest = sha256(data).hexdigest()
    wrote = False
    try:
        item = str(read_model.item_row(conn, reference)["work_item_id"])
        folder = directory(conn)
        wrote = _write(folder, digest, data)
        conn.execute(
            "INSERT OR IGNORE INTO work_item_images(work_item_id,sha256,media_type,size,call_id)"
            " VALUES(?,?,?,?,?)",
            (item, digest, kind, len(data), calls.call_id(conn, item)),
        )
        conn.commit()
    except BaseException:
        conn.rollback()
        if wrote:
            with contextlib.suppress(OSError):
                os.remove(os.path.join(folder, digest))
        raise
    return {
        "work_item_id": item,
        "sha256": digest,
        "media_type": kind,
        "size": len(data),
        "path": path_of(digest),
    }


def _bytes(conn: sqlite3.Connection, sha: str) -> bytes:
    """The file's bytes, refused when missing or when they are not what the name says."""

    try:
        with open(os.path.join(directory(conn), sha), "rb") as handle:
            data = handle.read(MAX_BYTES + 1)
    except FileNotFoundError as error:
        raise ImageRefusedError(404, "not_found", "the picture's file is missing") from error
    if sha256(data).hexdigest() != sha:
        raise ImageRefusedError(404, "not_found", "the picture's file does not hold it")
    return data


def read(conn: sqlite3.Connection, sha: object, *, item: object = None) -> Picture:
    """One picture an item holds; with `item`, only one that item holds."""

    digest = _hash(sha)
    if item is None:
        row = conn.execute(
            "SELECT media_type FROM work_item_images WHERE sha256 = ? LIMIT 1", (digest,)
        ).fetchone()
    else:
        owner = str(read_model.item_row(conn, item)["work_item_id"])
        row = conn.execute(
            "SELECT media_type FROM work_item_images WHERE sha256 = ? AND work_item_id = ?",
            (digest, owner),
        ).fetchone()
    if row is None:
        raise ImageRefusedError(404, "not_found", "no such picture")
    return Picture(digest, str(row[0]), _bytes(conn, digest))


def of_item(conn: sqlite3.Connection, work_item_id: str) -> list[dict]:
    """The pictures one item holds, oldest first, as an agent reads them."""

    rows = conn.execute(
        "SELECT sha256, media_type, size, created_at FROM work_item_images"
        " WHERE work_item_id = ? ORDER BY created_at, sha256",
        (work_item_id,),
    ).fetchall()
    return [
        {
            "sha256": str(row[0]),
            "media_type": str(row[1]),
            "size": int(row[2]),
            "created_at": str(row[3]),
            "path": path_of(str(row[0])),
        }
        for row in rows
    ]


def held(conn: sqlite3.Connection, work_item_id: str) -> list[str]:
    """The hashes of the pictures one item holds."""

    return [
        str(row[0])
        for row in conn.execute(
            "SELECT sha256 FROM work_item_images WHERE work_item_id = ?", (work_item_id,)
        )
    ]


def release(conn: sqlite3.Connection, hashes: list[str]) -> int:
    """Remove each file no item holds any more; how many went.

    Called by the write that took the rows away, inside its transaction and so
    under the store's write lock: an upload of the same picture waits for it,
    and writes the file again if it was taken.
    """

    if not hashes:
        return 0
    folder = directory(conn)
    removed = 0
    for sha in sorted(set(hashes)):
        if conn.execute(
            "SELECT 1 FROM work_item_images WHERE sha256 = ? LIMIT 1", (sha,)
        ).fetchone():
            continue
        with contextlib.suppress(FileNotFoundError):
            os.remove(os.path.join(folder, sha))
            removed += 1
    return removed


def carry(conn: sqlite3.Connection, from_id: str, to_id: str) -> None:
    """Give the survivor of a merge the pictures the merged item holds.

    Copied rather than moved: the merged item keeps its description and its
    reports, which may show them too, and each item lets its own go.
    """

    conn.execute(
        "INSERT OR IGNORE INTO work_item_images"
        "(work_item_id,sha256,media_type,size,created_at,call_id)"
        " SELECT ?, sha256, media_type, size, created_at, call_id"
        " FROM work_item_images WHERE work_item_id = ?",
        (to_id, from_id),
    )
