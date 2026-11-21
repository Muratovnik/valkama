"""What a release's source archive says about itself, so it installs without Git.

A release publishes `valkama-<version>-source.zip`: the files of one commit,
without the history. `launcher install` pins a commit, and a directory with no
`.git` cannot name one, so the release build writes this record into the
archive: the commit it was built from, its version, and the SHA-256 of every
other file it holds, by relative path. An unpacked archive installs by reading
the record and checking each file against it. A changed or missing file is
refused by name, rather than pinned under a commit it no longer matches; a file
the record does not list is not part of the release and is never copied, as an
untracked file in a clone never reaches a release.

The record holds only what any public archive may: the commit id, the version,
relative paths and digests. `windows/release.py` loads this file by its path,
so it imports nothing but the standard library.
"""

from __future__ import annotations

import hashlib
import json
import re
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path, PurePosixPath

#: The record's name, at the root of the archive.
RECORD = "valkama-source.json"
SCHEMA_VERSION = 1
_COMMIT = re.compile(r"[0-9a-f]{40}|[0-9a-f]{64}")
_DIGEST = re.compile(r"[0-9a-f]{64}")
#: How many problems a refusal names before it counts the rest.
_NAMED = 10


class SourceArchiveError(ValueError):
    """The directory is not the source archive its record describes."""


def _again(version: str | None = None) -> str:
    archive = f"valkama-{version}-source.zip" if version else "the release's source archive"
    return f"Unpack {archive} again into an empty directory and run launcher install there."


def _path_problem(path: object) -> str | None:
    if not isinstance(path, str) or not path:
        return "a path that is not text"
    pure = PurePosixPath(path)
    if (
        "\\" in path
        or ":" in path
        or "\0" in path
        or pure.is_absolute()
        or pure.as_posix() != path
        or any(part in {"", ".", ".."} for part in pure.parts)
    ):
        return f"the path {path!r}, which leads outside the archive"
    if path == RECORD:
        return "the record itself"
    return None


def _record_problem(commit: object, version: object, files: object) -> str | None:
    if not isinstance(commit, str) or not _COMMIT.fullmatch(commit):
        return "its commit is not a full commit id"
    if not isinstance(version, str) or not version.strip():
        return "it names no version"
    if not isinstance(files, Mapping) or not files:
        return "it lists no files"
    for path, digest in files.items():
        problem = _path_problem(path)
        if problem is not None:
            return f"it lists {problem}"
        if not isinstance(digest, str) or not _DIGEST.fullmatch(digest):
            return f"the digest of {path} is not a SHA-256"
    return None


def record(commit: str, version: str, files: Mapping[str, str]) -> bytes:
    """The record of an archive holding `files`, each relative path to its SHA-256."""

    problem = _record_problem(commit, version, files)
    if problem is not None:
        raise SourceArchiveError(f"a source archive record cannot be written: {problem}")
    document = {
        "schema_version": SCHEMA_VERSION,
        "commit": commit,
        "version": version,
        "files": dict(sorted(files.items())),
    }
    return (json.dumps(document, ensure_ascii=False, indent=1) + "\n").encode("utf-8")


def _digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


@dataclass(frozen=True)
class SourceArchive:
    """An unpacked archive: where it is, and what its record says it holds."""

    root: Path
    commit: str
    version: str
    files: Mapping[str, str]

    def _file(self, path: str) -> Path | None:
        target = self.root / path
        if not target.is_file() or not target.resolve().is_relative_to(self.root.resolve()):
            return None
        return target

    def problems(self) -> list[str]:
        """Each listed file that is missing or differs from its digest, by name."""

        found = []
        for path, digest in self.files.items():
            target = self._file(path)
            if target is None:
                found.append(f"{path} is missing")
            elif _digest(target.read_bytes()) != digest:
                found.append(f"{path} was changed")
        return found

    def refusal(self, problems: list[str]) -> SourceArchiveError:
        named = "; ".join(problems[:_NAMED])
        if len(problems) > _NAMED:
            named += f"; and {len(problems) - _NAMED} more"
        return SourceArchiveError(
            f"{self.root} is not the source archive of {self.commit} its record describes:"
            f" {named}. {_again(self.version)}"
        )

    def copy(self, target: Path) -> None:
        """Write every listed file under `target`, each checked as it is read.

        The check is on the bytes written, so a file changed after `verify` is
        refused here rather than copied.
        """

        for path, digest in self.files.items():
            source = self._file(path)
            data = source.read_bytes() if source is not None else None
            if data is None or _digest(data) != digest:
                raise self.refusal([f"{path} {'is missing' if data is None else 'was changed'}"])
            destination = target / path
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(data)


def read(root: Path) -> SourceArchive:
    """The record at the root of an unpacked archive, refused when it is not one."""

    try:
        document = json.loads((root / RECORD).read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise SourceArchiveError(f"{root / RECORD} cannot be read: {error}. {_again()}") from error
    if not isinstance(document, dict):
        problem: str | None = "it is not an object"
    elif document.get("schema_version") != SCHEMA_VERSION:
        problem = f"it is not schema {SCHEMA_VERSION}"
    else:
        problem = _record_problem(
            document.get("commit"), document.get("version"), document.get("files")
        )
    if problem is not None:
        raise SourceArchiveError(
            f"{root / RECORD} is not a source archive record: {problem}. {_again()}"
        )
    return SourceArchive(root, document["commit"], document["version"], dict(document["files"]))


def verify(root: Path) -> SourceArchive:
    """The archive at `root`, once every file its record lists is there unchanged."""

    archive = read(root)
    problems = archive.problems()
    if problems:
        raise archive.refusal(problems)
    return archive
