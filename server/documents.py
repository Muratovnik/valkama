"""The documents of the owner's projects: finding one, checking a path to it.

This is not planning and never was. It lived in `board.py` because the board's
search answered one query across cards and documents at once, so when the Board
domain went the document half had nowhere to stand. Nothing here knows what a
work item is: `search_documents` takes a query and returns file, line and text,
and `locate` takes a path as a text wrote it and says what it may open.
"""

from __future__ import annotations

import hashlib
import ntpath
import os
import stat
import subprocess
import sys
import unicodedata
from collections.abc import Sequence
from datetime import UTC, datetime
from typing import Literal, NamedTuple

from . import git_worktrees
from .ops import configuration
from .projects import project_registry

# Repository documents the platform may search, as an OS-path-separated list.
# There is no default: the store knows nothing about which checkouts exist, and
# guessing one would search a directory the owner never offered.
DOC_ROOTS_VAR = "VALKAMA_DOC_ROOTS"
DOC_SUFFIXES = (".md", ".markdown")
MAX_DOC_BYTES = 512 * 1024
MAX_DOC_HITS = 40
SKIP_DIRECTORIES = {
    ".git",
    "node_modules",
    "dist",
    "release",
    "__pycache__",
    ".state",
    ".venv",
}

# How long a single reference resolution may spend on the filesystem or on a
# subprocess before it answers "unresolved" instead of hanging the surface.
REF_RESOLVE_TIMEOUT = 6

#: A longer path is refused unread, and the page never sends one.
MAX_PATH_CHARS = 1024
#: How many paths one question may carry, each costing at most a few `stat` calls.
MAX_RESOLVE_PATHS = 64

# fmt: off
# CPython 3.13.0 Lib/ntpath.py -- Copyright (c) 2001-2024 Python Software Foundation.
# SPDX-License-Identifier: PSF-2.0
# Copied unmodified, down to `fmt: on`. License: server/licenses/cpython-LICENSE.txt
# Source: https://github.com/python/cpython/blob/v3.13.0/Lib/ntpath.py
# `os.path.isreserved` is new in 3.13 and this server targets 3.11. Once it targets
# 3.13, that function replaces this copy and the notice goes with it.
_reserved_chars = frozenset(
    {chr(i) for i in range(32)} |
    {'"', '*', ':', '<', '>', '?', '|', '/', '\\'}
)

_reserved_names = frozenset(
    {'CON', 'PRN', 'AUX', 'NUL', 'CONIN$', 'CONOUT$'} |
    {f'COM{c}' for c in '123456789\xb9\xb2\xb3'} |
    {f'LPT{c}' for c in '123456789\xb9\xb2\xb3'}
)

def _isreservedname(name):
    """Return true if the filename is reserved by the system."""
    # Trailing dots and spaces are reserved.
    if name[-1:] in ('.', ' '):
        return name not in ('.', '..')
    # Wildcards, separators, colon, and pipe (*?"<>/\:|) are reserved.
    # ASCII control characters (0-31) are reserved.
    # Colon is reserved for file streams (e.g. "name:stream[:type]").
    if _reserved_chars.intersection(name):
        return True
    # DOS device names are reserved (e.g. "nul" or "nul .txt"). The rules
    # are complex and vary across Windows versions. On the side of
    # caution, return True for names that may not be reserved.
    return name.partition('.')[0].rstrip(' ').upper() in _reserved_names
# fmt: on


class Root(NamedTuple):
    """One registered project and its root after `realpath`."""

    project: str
    path: str


class Located(NamedTuple):
    """A path that exists inside a registered root."""

    kind: Literal["file", "directory"]
    project: str
    #: From the project's root, in POSIX form. This is what a page may be told.
    relative: str
    markdown: bool
    #: Where it really is. It stays on the server, except in a plan to open it.
    absolute: str


class DocumentRefused(NamedTuple):
    """Why a path opens nothing: one code from the closed list in `README.md`."""

    code: str


def registered_roots(*, reader: project_registry.RegistryReader | None = None) -> tuple[Root, ...]:
    """Every registered project's root. An unreadable registry leaves none."""

    return tuple(
        Root(str(project["project_id"]), os.path.realpath(str(project["canonical_root"])))
        for project in project_registry.read_registry(reader=reader)["projects"]
    )


def nested_roots(base: str, roots: Sequence[Root]) -> tuple[str, ...]:
    """The registered roots strictly inside `base`, for a path written from one of them."""

    return tuple(
        root.path
        for root in roots
        if _inside(root.path, base) and os.path.normcase(root.path) != os.path.normcase(base)
    )


def _inside(path: str, root: str) -> bool:
    """Whether a path lies under a root, by spelling alone: no disk is touched.

    Case is folded, which is right only before the disk is asked: it lets a path
    written in any case through to `realpath`, and `_relative_in` decides after it.
    """

    folded = os.path.normcase(root)
    try:
        return os.path.commonpath([folded, os.path.normcase(path)]) == folded
    except ValueError:  # another drive, or an absolute path against a relative one
        return False


def _relative_in(root: str, real: str) -> str | None:
    """`real` from `root` in POSIX form, or None when it is not under it.

    Both come from `realpath`, which spells an existing path as the disk does, so
    they are compared exactly. A folder can be case-sensitive on Windows, where
    `proj` beside `Proj` is a sibling and not the root: `commonpath` and `relpath`
    fold case there, so neither may decide this.
    """

    if real == root:
        return "."
    head = root if root.endswith(os.sep) else root + os.sep
    if not real.startswith(head):
        return None
    return real[len(head) :].replace(os.sep, "/")


def _written_form(raw: str) -> tuple[bool, str] | None:
    """Whether a written path is absolute and its form, or None if it is no local path.

    The page cuts a suffix (`:42`, `#...`) off before it asks, so a colon left in
    a segment is a stream of the file and not a line.
    """

    if not raw or len(raw) > MAX_PATH_CHARS:
        return None
    if any(unicodedata.category(character) == "Cc" for character in raw):
        return None
    path = raw.replace("\\", "/")
    if path.startswith("~/"):
        path = os.path.expanduser(path).replace("\\", "/")
    # A network or device path, a path rooted on no drive, and a home nobody could
    # expand. `_isreservedname` sees only segments, and `\\?\` turns off the path
    # parsing Windows would otherwise apply.
    if path.startswith(("/", "~/")):
        return None
    drive, tail = ntpath.splitdrive(path)
    if drive and not (drive[0].isascii() and drive[0].isalpha() and tail.startswith("/")):
        return None
    if any(_isreservedname(segment) for segment in tail.split("/")):
        return None
    return bool(drive), path


def _classified(path: str, roots: Sequence[Root]) -> Located | DocumentRefused:
    """A built path against the boundary, by spelling and then by where it lands."""

    if not any(_inside(path, root.path) for root in roots):
        return DocumentRefused("outside_root")
    real = os.path.realpath(path)
    holders = [
        (root, relative)
        for root in roots
        if (relative := _relative_in(root.path, real)) is not None
    ]
    if not holders:
        return DocumentRefused("outside_root")
    try:
        mode = os.stat(real).st_mode
    except (FileNotFoundError, NotADirectoryError):
        return DocumentRefused("not_found")
    except OSError:
        return DocumentRefused("unreadable")
    if stat.S_ISREG(mode):
        kind: Literal["file", "directory"] = "file"
    elif stat.S_ISDIR(mode):
        kind = "directory"
    else:
        return DocumentRefused("not_a_file")
    holder, relative = max(holders, key=lambda held: len(held[0].path))
    markdown = kind == "file" and real.lower().endswith(DOC_SUFFIXES)
    return Located(kind, holder.project, relative, markdown, real)


def locate(
    raw: str, *, base: str | None, roots: Sequence[Root], nested: Sequence[str] = ()
) -> Located | DocumentRefused:
    """What a written path is, decided by where it lands and not by how it is spelled.

    `base` is what a relative path starts from, or None when nothing is bound.
    `roots` is the boundary for every path, checked twice: by spelling before the
    disk is touched, so `..` and an absolute path outside answer the same whether
    anything is there, and again after `realpath`, so a link or a junction inside a
    root that leads out is caught even with nothing behind it. `nested` is the
    registered roots inside `base`: a relative path that is not under `base` is
    looked for there and answered when exactly one holds it. `base` comes first, so
    a nested project never overrides it.
    """

    form = _written_form(raw)
    if form is None:
        return DocumentRefused("invalid_path")
    absolute, path = form
    if absolute:
        return _classified(os.path.normpath(path), roots)
    if base is None:
        return DocumentRefused("space_unbound")
    found = _classified(os.path.normpath(os.path.join(base, path)), roots)
    if not isinstance(found, DocumentRefused) or found.code != "not_found":
        return found
    located: dict[str, Located] = {}
    for root in nested:
        candidate = os.path.normpath(os.path.join(root, path))
        # A path that climbs out of a nested root was not written from it.
        if _inside(candidate, root):
            answer = _classified(candidate, roots)
            if isinstance(answer, Located):
                # Spelled as the disk spells it: two siblings in two cases are two files.
                located[answer.absolute] = answer
    if len(located) > 1:
        return DocumentRefused("ambiguous")
    return next(iter(located.values()), found)


class DocumentError(Exception):
    """A refused request: one code from the closed list in `README.md`, never an OS error."""

    def __init__(self, code: str, **details: int) -> None:
        super().__init__(code)
        self.code = code
        self.details = details


def _resolved(raw: str, answer: Located | DocumentRefused) -> dict[str, object]:
    """One path's answer to the page. `absolute` is the field that does not go."""

    if isinstance(answer, Located):
        shown: dict[str, object] = {
            "path": raw,
            "status": answer.kind,
            "project": answer.project,
            "relative": answer.relative,
        }
        if answer.kind == "file":
            shown["markdown"] = answer.markdown
        return shown
    if answer.code == "not_found":
        return {"path": raw, "status": "missing"}
    if answer.code in {"ambiguous", "space_unbound"}:
        return {"path": raw, "status": answer.code}
    return {"path": raw, "status": "refused", "code": answer.code}


def _project_root(project: str, roots: Sequence[Root]) -> str:
    """A registered project's root, named by its id: the registry's, never the page's."""

    root = next((found for found in roots if found.project == project), None)
    if root is None:
        raise DocumentError("project_unknown")
    return root.path


def resolve_paths(
    space: str | None,
    paths: Sequence[str],
    *,
    project: str | None = None,
    exact: bool = False,
    reader: project_registry.RegistryReader | None = None,
) -> list[dict[str, object]]:
    """What each written path is, from `stat` alone: no file is opened.

    `space` is the exact identity of a planning space, as `GET /api/ref` takes it,
    and only the base of a relative path: the boundary is every registered root
    whatever the space. One that does not parse is refused, so a crafted value
    reaches no directory at all; one the registry does not bind leaves relative
    paths unbound and absolute ones answered.

    `project` names the other base a page has: the project of a document it shows,
    whose links the page has already read from the document's folder into paths
    from that project's root. The root is the registry's for that id, and the
    boundary is still every registered root, as from a space. A page names one
    base or none. `exact` is for those links: an author wrote them from the
    document's folder, so what is not under the root is not there, and a project
    registered inside the root is not asked.
    """

    if not paths or len(paths) > MAX_RESOLVE_PATHS or (space is not None and project is not None):
        raise DocumentError("invalid_request")
    roots = registered_roots(reader=reader)
    base: str | None = None
    if project is not None:
        base = _project_root(project, roots)
    elif space is not None:
        mapping = project_registry.resolve_space_root(
            {"kind": "planning-space", "resource_id": space}, reader=reader
        )
        if mapping["status"] == "malformed" and mapping["resource_ref"] is None:
            raise DocumentError("invalid_request")
        if mapping["status"] == "mapped":
            base = os.path.realpath(str(mapping["canonical_root"]))
    nested = nested_roots(base, roots) if base is not None and not exact else ()
    return [_resolved(raw, locate(raw, base=base, roots=roots, nested=nested)) for raw in paths]


if sys.platform == "win32":

    def _opened_path(descriptor: int, _path: str) -> str:
        """Where an open file is, as the system names it now; "" when it cannot say."""

        import ctypes
        import msvcrt
        from ctypes import wintypes

        final_path = ctypes.WinDLL("kernel32", use_last_error=True).GetFinalPathNameByHandleW
        final_path.argtypes = (wintypes.HANDLE, wintypes.LPWSTR, wintypes.DWORD, wintypes.DWORD)
        final_path.restype = wintypes.DWORD
        handle = msvcrt.get_osfhandle(descriptor)
        size = 512
        while True:
            buffer = ctypes.create_unicode_buffer(size)
            # 0 is FILE_NAME_NORMALIZED with VOLUME_NAME_DOS, what `realpath` asks for too.
            length = final_path(handle, buffer, size, 0)
            if length == 0:
                return ""
            if length < size:
                break
            size = length + 1
        name = buffer.value
        if name.startswith("\\\\?\\UNC\\"):
            return "\\\\" + name[len("\\\\?\\UNC\\") :]
        return name.removeprefix("\\\\?\\")

else:

    def _opened_path(descriptor: int, path: str) -> str:
        """Where an open file is: its descriptor's link, or the path if it is that file now."""

        try:
            return os.readlink(f"/proc/self/fd/{descriptor}")
        except OSError:
            pass
        real = os.path.realpath(path)
        try:
            now = os.stat(real)
        except OSError:
            return ""
        opened = os.fstat(descriptor)
        return real if (now.st_dev, now.st_ino) == (opened.st_dev, opened.st_ino) else ""


def _read_bounded(path: str, root: str) -> tuple[bytes, os.stat_result]:
    """The file at `path` if it is still under `root` once open, read to one byte past the limit.

    `locate` checked the path, and `open` takes it by name a moment later: a folder
    on the way swapped for a junction in between would open a file outside. So the
    open file's own path is checked, and nothing is read from one outside. One byte
    over the limit is enough to tell a file that grew after `stat`.
    """

    with open(path, "rb") as handle:
        if _relative_in(root, _opened_path(handle.fileno(), path)) is None:
            raise DocumentError("outside_root")
        return handle.read(MAX_DOC_BYTES + 1), os.fstat(handle.fileno())


def read_markdown(
    project: str, path: str, *, reader: project_registry.RegistryReader | None = None
) -> dict[str, object]:
    """One Markdown file of one project, read from the root the registry gives.

    The path comes back through `locate` with this project as its whole boundary,
    which is what `resolve_paths` answered it from: a nested project is inside its
    parent, and a second lookup must not take the path into another project.
    """

    root = Root(project, _project_root(project, registered_roots(reader=reader)))
    located = locate(path, base=root.path, roots=(root,))
    if isinstance(located, DocumentRefused):
        raise DocumentError(located.code)
    if located.kind == "directory":
        raise DocumentError("directory")
    if not located.markdown:
        raise DocumentError("not_markdown")
    try:
        data, status = _read_bounded(located.absolute, root.path)
    except OSError as error:
        print(f"Valkama could not read a document: {error}", file=sys.stderr)  # noqa: T201
        raise DocumentError("unreadable") from error
    if len(data) > MAX_DOC_BYTES:
        raise DocumentError("too_large", size=max(status.st_size, len(data)), limit=MAX_DOC_BYTES)
    if b"\0" in data:
        raise DocumentError("binary")
    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError as error:
        raise DocumentError("not_utf8") from error
    return {
        "project": project,
        "path": located.relative,
        "markdown": text.removeprefix("\ufeff"),
        "size": len(data),
        "modified_at": datetime.fromtimestamp(status.st_mtime, UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "revision": hashlib.sha256(data).hexdigest()[:16],
    }


def doc_roots() -> list[str]:
    raw = configuration.configured("document_roots") or ""
    return [part for part in (item.strip() for item in raw.split(os.pathsep)) if part]


def search_documents(
    query: str, roots: list[str] | None = None, *, by_path: bool = False
) -> list[dict]:
    """Grep the configured document roots for one query, with a bounded result.

    Deliberately plain substring search over Markdown: the canonical artifacts
    are documents, and an index would be one more thing to keep true. Memory
    and transcripts stay out of scope by owner decision.

    `by_path` also takes a document whose path from its root holds the query, at
    `line` 0 with no `text`, ahead of those found by a line: a person looking for
    a file types its name, which its text need not hold.
    """
    needle = query.strip().lower()
    if not needle:
        return []
    hits: list[dict] = []
    for root in roots if roots is not None else doc_roots():
        if not os.path.isdir(root):
            continue
        for relative in _documents_in(root):
            path = os.path.join(root, relative)
            if by_path and needle in relative.lower():
                if os.path.isfile(path):
                    hits.append({"path": relative, "root": root, "line": 0, "text": ""})
                if len(hits) >= MAX_DOC_HITS:
                    return _named_first(hits)
                continue
            try:
                if os.path.getsize(path) > MAX_DOC_BYTES:
                    continue
                with open(path, encoding="utf-8", errors="replace") as handle:
                    lines = handle.read().splitlines()
            except OSError:
                continue
            for number, line in enumerate(lines, start=1):
                if needle in line.lower():
                    hits.append(
                        {"path": relative, "root": root, "line": number, "text": line.strip()[:240]}
                    )
                    break  # one hit per document keeps the list readable
            if len(hits) >= MAX_DOC_HITS:
                return _named_first(hits)
    return _named_first(hits)


def _named_first(hits: list[dict]) -> list[dict]:
    """Documents named by their path ahead of those found by a line, each in the order found."""

    return sorted(hits, key=lambda hit: hit["line"] != 0)


def _documents_in(root: str) -> list[str]:
    """The Markdown files under a root, as `/`-separated paths from it in path order.

    Where the root lies in a Git work tree that does not ignore it, Git names them:
    the files it tracks and those it would add, so nothing its ignore rules cover,
    such as scratch, private evidence or build output, is read or offered, and its
    index answers instead of a walk of the whole tree on every search. A root Git
    cannot answer for is walked, past `SKIP_DIRECTORIES`.
    """

    listed = _listed_by_git(root)
    if listed is None:
        listed = []
        for directory, subdirectories, files in os.walk(root):
            subdirectories[:] = [name for name in subdirectories if name not in SKIP_DIRECTORIES]
            for name in files:
                listed.append(
                    os.path.relpath(os.path.join(directory, name), root).replace("\\", "/")
                )
    return sorted(
        {
            path
            for path in listed
            if path.lower().endswith(DOC_SUFFIXES)
            and SKIP_DIRECTORIES.isdisjoint(path.split("/")[:-1])
        }
    )


def _listed_by_git(root: str) -> list[str] | None:
    """The files under a root that its Git does not ignore, or None where Git has no say.

    No say is no Git, a root outside any work tree, or a root its enclosing work tree
    ignores, which is not that repository's to describe. Git that takes too long or
    names a file in other than UTF-8 offers nothing rather than a walk that would
    offer what it ignores.
    """

    try:
        ignored = git_worktrees.git_text(
            root, "check-ignore", "-q", "--", ".", timeout=REF_RESOLVE_TIMEOUT
        )
        # 0: the root is ignored; 1: it is not; anything else: not a work tree.
        if ignored.returncode != 1:
            return None
        found = git_worktrees.git_text(
            root,
            "ls-files",
            "-z",
            "--cached",
            "--others",
            "--exclude-standard",
            timeout=REF_RESOLVE_TIMEOUT,
        )
    except OSError:
        return None
    except (subprocess.TimeoutExpired, UnicodeDecodeError):
        return []
    if found.returncode != 0:
        return None
    return [path for path in found.stdout.split("\0") if path]


#: How many documents one search of a space's project answers with.
MAX_PROJECT_HITS = 20
#: The longest query that search takes; a file's name is shorter.
MAX_QUERY_CHARS = 200


def search_space_documents(
    space: str, query: str, *, reader: project_registry.RegistryReader | None = None
) -> list[dict[str, object]]:
    """The Markdown files of the project a planning space is bound to that a query names.

    The search is `search_documents` over that one root, by path as well as by a
    line. Each answer is a path from the root, which is what `resolve` takes from
    the same space, with the line it was found at (0 for its path) and that line.
    The root is never told. A file reached through a link or a junction that leads
    out of the root is left out, as `resolve` would refuse it. A space the registry
    does not bind to one existing root has no files to offer, and an identity that
    does not parse is refused, as `resolve` refuses it.
    """

    if len(query) > MAX_QUERY_CHARS:
        raise DocumentError("invalid_request")
    mapping = project_registry.resolve_space_root(
        {"kind": "planning-space", "resource_id": space}, reader=reader
    )
    if mapping["status"] == "malformed" and mapping["resource_ref"] is None:
        raise DocumentError("invalid_request")
    if mapping["status"] != "mapped":
        return []
    root = os.path.realpath(str(mapping["canonical_root"]))
    found: list[dict[str, object]] = []
    for hit in search_documents(query, [root], by_path=True):
        if _relative_in(root, os.path.realpath(os.path.join(root, hit["path"]))) is None:
            continue
        found.append({"path": hit["path"], "line": hit["line"], "text": hit["text"]})
        if len(found) >= MAX_PROJECT_HITS:
            break
    return found


__all__ = [
    "DOC_ROOTS_VAR",
    "MAX_DOC_BYTES",
    "MAX_DOC_HITS",
    "MAX_PATH_CHARS",
    "MAX_PROJECT_HITS",
    "MAX_QUERY_CHARS",
    "MAX_RESOLVE_PATHS",
    "REF_RESOLVE_TIMEOUT",
    "DocumentError",
    "DocumentRefused",
    "Located",
    "Root",
    "doc_roots",
    "locate",
    "nested_roots",
    "read_markdown",
    "registered_roots",
    "resolve_paths",
    "search_documents",
    "search_space_documents",
]
