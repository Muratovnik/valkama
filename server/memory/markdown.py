"""A read-only knowledge provider over Markdown already on disk.

MEM-006 asks for a second provider of deliberately different completeness, and
this is it: a folder of Markdown files can be searched and read and cannot be
written, which is exactly the asymmetry the Memory module has to show honestly
rather than hide behind one uniform set of buttons.

It is also the cheapest useful memory a project has. Most repositories already
carry their decisions in `docs/`, and pointing at that folder costs no service,
no index and no daemon — which is the point of §5.8's local reference provider.

Two safety properties, both the same ones the skills catalogue earned:

Every path is resolved and checked to be inside its root before it is opened.
A search result names a file relative to the root, so a pointer that escapes it
by symlink, by `..`, or by a junction cannot be turned into a read.

Everything is bounded — how many files are walked, how large a file may be read,
how long a snippet is. A knowledge folder is somebody's whole repository, and an
unbounded walk over one is a request that never returns.
"""

from __future__ import annotations

import os
from pathlib import Path, PurePosixPath

from . import contracts

#: How many files a single search will look at. A large repository has more, and
#: a search that says so is better than one that walks for a minute.
MAX_FILES = 2000
#: How much of one file is read to match and to preview.
MAX_BYTES = 256 * 1024
#: How many results one query answers with.
MAX_RESULTS = 40

SUFFIXES = (".md", ".markdown")


class MarkdownKnowledgeProvider:
    """Search and read Markdown under one root. It cannot write, and says so."""

    #: What this provider can do, in the Kernel's own vocabulary. `memory.write`
    #: and `memory.attach` are absent rather than refused at call time: a
    #: capability a provider does not declare is one the interface never offers.
    CAPABILITIES = ("memory.search", "memory.read-metadata", "memory.open", "memory.health")

    def __init__(self, root: str | os.PathLike[str]):
        self.root = Path(root).expanduser()

    def health(self) -> tuple[str, dict | None]:
        try:
            if not self.root.is_dir():
                return "unavailable", {
                    "code": "root_missing",
                    "message": "the configured knowledge root is not a directory",
                }
        except OSError:
            return "unavailable", {
                "code": "root_unreadable",
                "message": "the configured knowledge root cannot be read",
            }
        return "ready", None

    def search(self, query: str, *, limit: int = MAX_RESULTS) -> dict:
        """Files whose name or text contains the query, newest match first.

        Substring matching, deliberately. Ranking is §16.6's first forbidden
        thing, and a provider that cannot rank is one whose results a reader can
        reason about: everything here matched, in the order the tree gave them.
        """

        needle = str(query or "").strip().lower()
        if not needle:
            raise contracts.KnowledgeError("a memory search needs something to look for")
        state = self.health()
        if state[0] != "ready":
            return {"results": [], "truncated": False, "health": state[0], "reason": state[1]}

        results: list[dict] = []
        walked = 0
        truncated = False
        bounded = max(1, min(int(limit), MAX_RESULTS))
        for path in sorted(self._files()):
            walked += 1
            if walked > MAX_FILES:
                truncated = True
                break
            relative = self._relative(path)
            text = self._read(path)
            if needle not in relative.lower() and needle not in text.lower():
                continue
            results.append(self._entry(relative, text, needle))
            if len(results) >= bounded:
                truncated = True
                break
        return {"results": results, "truncated": truncated, "health": "ready", "reason": None}

    def read(self, external_id: str) -> dict:
        """One file's bounded text, refusing anything outside the root."""

        path = self._resolve(external_id)
        return {
            "ref": contracts.memory_ref(
                connection_id="local",
                resource_type="markdown-document",
                external_id=external_id,
                label=self._title(self._read(path)) or external_id,
            ),
            "markdown": self._read(path),
            "truncated": path.stat().st_size > MAX_BYTES,
        }

    def _files(self):
        for base, directories, names in os.walk(self.root):
            # Nothing generated, nothing hidden: a knowledge root is authored
            # text, and a walk into `node_modules` is a walk that never ends.
            directories[:] = [
                name for name in directories if not name.startswith((".", "node_modules"))
            ]
            for name in names:
                if name.lower().endswith(SUFFIXES):
                    yield Path(base) / name

    def _resolve(self, external_id: str) -> Path:
        """The file this pointer names, or a refusal.

        Resolved and then checked against the resolved root, so a symlink or a
        junction out of the tree is caught by where it lands rather than by how
        it is spelled.
        """

        candidate = (self.root / str(external_id)).resolve()
        root = self.root.resolve()
        if root != candidate and root not in candidate.parents:
            raise contracts.KnowledgeError(
                f"memory pointer escapes its knowledge root: {external_id}"
            )
        if not candidate.is_file():
            raise contracts.KnowledgeError(f"no such knowledge document: {external_id}")
        return candidate

    def _relative(self, path: Path) -> str:
        return str(PurePosixPath(path.relative_to(self.root).as_posix()))

    def _read(self, path: Path) -> str:
        try:
            with open(path, encoding="utf-8", errors="replace") as handle:
                return handle.read(MAX_BYTES)
        except OSError:
            return ""

    def _entry(self, relative: str, text: str, needle: str) -> dict:
        return {
            **contracts.memory_ref(
                connection_id="local",
                resource_type="markdown-document",
                external_id=relative,
                label=self._title(text) or relative,
            ),
            "snippet": self._snippet(text, needle),
        }

    @staticmethod
    def _title(text: str) -> str:
        for line in text.splitlines()[:40]:
            stripped = line.strip()
            if stripped.startswith("# "):
                return stripped[2:].strip()[: contracts.MAX_LABEL]
        return ""

    @staticmethod
    def _snippet(text: str, needle: str) -> str:
        """The line that matched, cut at word boundaries rather than at offsets.

        The window is chosen by character count, which lands mid-word at both
        ends. One snippet in an inspector panel survives that; a page of them
        reads like corrupted text, and a reader cannot tell a bad cut from a
        bad document. Only a word the window already broke is dropped, so
        nothing whole is lost, and a window with no space in it is kept as it
        is rather than emptied.
        """

        lowered = text.lower()
        index = lowered.find(needle)
        if index < 0:
            return ""
        start = max(0, index - 80)
        window = " ".join(text[start : start + contracts.MAX_SNIPPET].split())
        if start > 0:
            head, _, rest = window.partition(" ")
            # Keep a whole first word: dropping it would lose the match when the
            # window opens inside the match itself.
            window = rest or head
        if start + contracts.MAX_SNIPPET < len(text):
            body, _, tail = window.rpartition(" ")
            window = body or tail
        return window


__all__ = ["MAX_BYTES", "MAX_FILES", "MAX_RESULTS", "SUFFIXES", "MarkdownKnowledgeProvider"]
