"""Resolve a work item ref, or an attached commit, into what it points at.

A ref is a pointer Planning stores verbatim — a session id, a memory id, a
url. Turning one into something displayable means asking the system that owns
it, which is why this is not part of the Planning domain: Planning never needs
the answer, only the surfaces do. A commit is no ref: it is attached as a
registered project and a hash, and `show_commit` asks that project's repository.
"""

from __future__ import annotations

import json
import os
import sqlite3
import subprocess
import time

from . import processes
from .documents import REF_RESOLVE_TIMEOUT
from .planning import commits, model
from .projects import project_registry
from .sessions import session_context
from .store import connect


def show_commit(repository: str, hash_text: str) -> dict:
    """Read-only context for one attached commit: its subject and the files it changed.

    `repository` is a registered project's id and `hash_text` a hash or a start of
    one; anything else is refused, so the request names no directory and no
    revision git could read as an option or a file. Git is asked in that project's
    root alone, and a root this machine lacks is reported, not looked around for.
    """

    project = commits.registered(repository)
    value = commits.stored_hash(hash_text, repository)
    if not commits.rooted(project):
        return {
            "kind": "commit",
            "value": value,
            "resolved": False,
            "detail": f"{repository} has no root on this machine",
        }
    root = project["root"]
    try:
        # Git's stat is human-facing context; replacement preserves a
        # diagnostic when an older commit carries invalid UTF-8. `^{commit}`
        # keeps a hash from naming any other object.
        completed = processes.run_text(
            [
                "git",
                "-C",
                root,
                "show",
                "--stat",
                "--no-color",
                "--format=%h %an %ad%n%s",
                "--end-of-options",
                f"{value}^{{commit}}",
            ],
            encoding="utf-8",
            errors="replace",
            timeout=REF_RESOLVE_TIMEOUT,
        )
    except (OSError, subprocess.SubprocessError) as error:
        return {
            "kind": "commit",
            "value": value,
            "resolved": False,
            "detail": f"git unavailable: {error}",
        }
    if completed.returncode != 0:
        return {
            "kind": "commit",
            "value": value,
            "resolved": False,
            "detail": f"commit not found in {repository}",
        }
    return {
        "kind": "commit",
        "value": value,
        "resolved": True,
        "repository": root,
        "detail": completed.stdout.strip()[:4000],
    }


def resolve_ref(kind: str, value: str, conn: sqlite3.Connection | None = None) -> dict:
    """Read-only context for one card ref, so a timeline row means something.

    Bounded and local: a session only as the existence and size of its transcript
    (its contents are deliberately out of scope), and a memory id only as the
    pointer it is, because provider resolution is outside this process.
    """
    if kind not in model.REF_KINDS:
        hint = (
            f": {model.COMMIT_REF_HINT}, and GET /api/commit shows one" if kind == "commit" else ""
        )
        raise ValueError(f"unknown ref kind {kind!r}{hint}")
    value = value.strip()
    if not value:
        raise ValueError("a ref value is required")
    if kind == "session":
        # The platform's own session table first: it knows every observed client,
        # not only Claude, and it can answer a prefix the way humans write one
        # ("agent (session 1baa03d7)"). An ambiguous prefix is reported rather
        # than silently picking one of several sessions.
        owned = conn is None
        conn = conn or connect()
        try:
            context = session_context(conn, value)
        finally:
            if owned:
                conn.close()
        if context.get("resolved") or context.get("status") == "ambiguous":
            return context
        transcripts = os.path.join(os.path.expanduser("~"), ".claude", "projects")
        for directory, _subdirectories, files in os.walk(transcripts):
            for name in files:
                if name.startswith(value) and name.endswith(".jsonl"):
                    path = os.path.join(directory, name)
                    stat = os.stat(path)
                    # A session predating the platform's own registry: an early
                    # transcript record still names the directory it ran in,
                    # which is what "open this session" needs. The leading
                    # records may be summaries without one, so scan a few.
                    cwd = ""
                    try:
                        with open(path, encoding="utf-8") as handle:
                            for _ in range(20):
                                line = handle.readline(262144)
                                if not line:
                                    break
                                try:
                                    record = json.loads(line)
                                except ValueError:
                                    continue
                                cwd = str(record.get("cwd") or "")
                                if cwd:
                                    break
                    except OSError:
                        cwd = ""
                    answer = {
                        "kind": kind,
                        "value": value,
                        "resolved": True,
                        "session": name[: -len(".jsonl")],
                        "client": "claude",
                        "client_family": "claude",
                        "detail": f"transcript present, {stat.st_size} bytes",
                        "at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(stat.st_mtime)),
                    }
                    if cwd:
                        answer["cwd"] = cwd
                    answer["session_cwd"] = cwd
                    answer["space_root"] = project_registry.session_space_context(None, cwd)
                    return answer
        return {
            "kind": kind,
            "value": value,
            "resolved": False,
            "detail": "no transcript found for this session id",
        }
    if kind == "memory":
        return {
            "kind": kind,
            "value": value,
            "resolved": False,
            "detail": "AgentMemory resolution belongs to the configured provider;"
            " this is a one-way pointer",
        }
    return {"kind": kind, "value": value, "resolved": True, "detail": value}
