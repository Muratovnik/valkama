"""The documents of the owner's projects: finding one, checking a path to it.

This is not planning and never was. It lived in `board.py` because the board's
search answered one query across cards and documents at once, so when the Board
domain went the document half had nowhere to stand. Nothing here knows what a
work item is: `search_documents` takes a query and returns file, line and text,
and `locate` takes a path as a text wrote it and says what it may open.
"""

from __future__ import annotations

import ntpath
import os
import stat
import unicodedata
from collections.abc import Sequence
from typing import Literal, NamedTuple

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
    """Whether a path lies under a root, by spelling alone: no disk is touched."""

    folded = os.path.normcase(root)
    try:
        return os.path.commonpath([folded, os.path.normcase(path)]) == folded
    except ValueError:  # another drive, or an absolute path against a relative one
        return False


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
    holders = [root for root in roots if _inside(real, root.path)]
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
    holder = max(holders, key=lambda root: len(root.path))
    relative = os.path.relpath(real, holder.path).replace("\\", "/")
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
                located[os.path.normcase(answer.absolute)] = answer
    if len(located) > 1:
        return DocumentRefused("ambiguous")
    return next(iter(located.values()), found)


def doc_roots() -> list[str]:
    raw = configuration.configured("document_roots") or ""
    return [part for part in (item.strip() for item in raw.split(os.pathsep)) if part]


def search_documents(query: str, roots: list[str] | None = None) -> list[dict]:
    """Grep the configured document roots for one query, with a bounded result.

    Deliberately plain substring search over Markdown: the canonical artifacts
    are documents, and an index would be one more thing to keep true. Memory
    and transcripts stay out of scope by owner decision.
    """
    needle = query.strip().lower()
    if not needle:
        return []
    hits: list[dict] = []
    for root in roots if roots is not None else doc_roots():
        if not os.path.isdir(root):
            continue
        for directory, subdirectories, files in os.walk(root):
            subdirectories[:] = [name for name in subdirectories if name not in SKIP_DIRECTORIES]
            for name in sorted(files):
                if not name.lower().endswith(DOC_SUFFIXES):
                    continue
                path = os.path.join(directory, name)
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
                            {
                                "path": os.path.relpath(path, root).replace("\\", "/"),
                                "root": root,
                                "line": number,
                                "text": line.strip()[:240],
                            }
                        )
                        break  # one hit per document keeps the list readable
                if len(hits) >= MAX_DOC_HITS:
                    return hits
    return hits


__all__ = [
    "DOC_ROOTS_VAR",
    "MAX_DOC_HITS",
    "MAX_PATH_CHARS",
    "REF_RESOLVE_TIMEOUT",
    "DocumentRefused",
    "Located",
    "Root",
    "doc_roots",
    "locate",
    "nested_roots",
    "registered_roots",
    "search_documents",
]
