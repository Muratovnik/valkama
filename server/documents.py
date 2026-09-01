"""Searching the repository documents the owner has offered.

This is not planning and never was. It lived in `board.py` because the board's
search answered one query across cards and documents at once, so when the Board
domain went the document half had nowhere to stand. Nothing here knows what a
work item is: it takes a query and returns file, line and text.
"""

from __future__ import annotations

import os

from .ops import configuration

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
    "REF_RESOLVE_TIMEOUT",
    "doc_roots",
    "search_documents",
]
