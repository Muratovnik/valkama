"""Resolve a work item ref into what it points at.

A ref is a pointer Planning stores verbatim — a session id, a commit hash, a
url. Turning one into something displayable means asking the system that owns
it, which is why this is not part of the Planning domain: Planning never needs
the answer, only the surfaces do.
"""

from __future__ import annotations

import json
import os
import re
import sqlite3
import subprocess
import time

from . import processes
from .documents import REF_RESOLVE_TIMEOUT, doc_roots
from .projects import project_registry
from .sessions import session_context
from .store import REF_KINDS, connect

# A recorded commit value may name its repository before the revision, as
# `repo@abc1234` or `repo abc1234`: a name that starts with a letter or digit,
# then `@` or spaces, then one word that is not git's own `@{...}` syntax.
# Anything else is the revision as written. The web's `sameCommit` reads a
# value by this same rule, and both test suites hold the same examples.
_NAMED_COMMIT = re.compile(r"(?P<name>[A-Za-z0-9][A-Za-z0-9._-]*)(?:@(?!\{)| +)(?P<rev>\S+)")


def split_commit_value(value: str) -> tuple[str | None, str]:
    """The repository name a commit value carries, if any, and its revision."""

    named = _NAMED_COMMIT.fullmatch(value)
    if named is None:
        return None, value
    return named["name"], named["rev"]


def _commit_roots(space: str | None, name: str | None) -> list[str]:
    """The repositories a commit is looked for in, in the order they are asked.

    Every directory comes from the owner's configuration, never from the
    request. First the registered project the value names (`name` matched,
    ignoring case, against a project's id or its directory's name), then the
    project the registry binds the card's planning space to, then the
    configured document roots, then every other registered project: a space
    bound to one repository still carries commits of the others.

    `space` is the exact identity of the card's planning space, never a path.
    An identity that does not parse is refused, so a crafted value reaches no
    directory at all; one the registry does not bind adds nothing, and a name
    that matches no project only leaves the usual order.
    """

    named: list[str] = []
    bound: list[str] = []
    registered: list[str] = []
    if space is not None:
        mapping = project_registry.resolve_space_root(
            {"kind": "planning-space", "resource_id": space}
        )
        if mapping["status"] == "malformed":
            raise ValueError("space must be a planning space's exact identity")
        if mapping["status"] == "mapped":
            bound.append(str(mapping["canonical_root"]))
    # An unreadable or malformed registry adds no root; the card still shows
    # whatever the other sources find.
    for project in project_registry.read_registry()["projects"]:
        root = str(project["canonical_root"])
        if name is not None and name.lower() in {
            project["project_id"].lower(),
            os.path.basename(os.path.normpath(root)).lower(),
        }:
            named.append(root)
        else:
            registered.append(root)
    roots: list[str] = []
    seen: set[str] = set()
    for root in [*named, *bound, *doc_roots(), *registered]:
        key = os.path.normcase(os.path.abspath(root))
        if key not in seen:
            seen.add(key)
            roots.append(root)
    return roots


def resolve_ref(
    kind: str,
    value: str,
    conn: sqlite3.Connection | None = None,
    *,
    space: str | None = None,
) -> dict:
    """Read-only context for one card ref, so a timeline row means something.

    Bounded and local: a commit is resolved with git in the owner's registered
    project repositories and configured document roots, in the order
    `_commit_roots` gives, stopping at the first that has it; a session only as the existence and size of its transcript (its contents
    are deliberately out of scope), and a memory id only as the pointer it is,
    because provider resolution is outside this process.
    """
    if kind not in REF_KINDS:
        raise ValueError(f"unknown ref kind {kind!r}")
    value = value.strip()
    if not value:
        raise ValueError("a ref value is required")
    if kind == "commit":
        # A value is a revision and only that: one that begins like an option
        # is not asked about (`--output=` would have git write a file), the
        # options end before it, and `^{commit}` keeps `rev:path` from reading
        # a file out of the repository. A repository name in front of it only
        # chooses which registered root is asked first.
        name, revision = split_commit_value(value)
        if revision.startswith("-"):
            return {
                "kind": kind,
                "value": value,
                "resolved": False,
                "detail": "a commit ref cannot begin with '-'",
            }
        commit = f"{revision}^{{commit}}"
        for root in _commit_roots(space, name):
            # A linked worktree's `.git` is a file, and it is a repository too.
            if not os.path.exists(os.path.join(root, ".git")):
                continue
            try:
                # Many roots may be asked: each gets one existence check, and
                # only the first that has the commit is asked to show it.
                present = processes.run_text(
                    ["git", "-C", root, "cat-file", "-e", "--end-of-options", commit],
                    timeout=REF_RESOLVE_TIMEOUT,
                )
                if present.returncode != 0:
                    continue
                # Git's stat is human-facing context; replacement preserves a
                # diagnostic when an older commit carries invalid UTF-8.
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
                        commit,
                    ],
                    encoding="utf-8",
                    errors="replace",
                    timeout=REF_RESOLVE_TIMEOUT,
                )
            except (OSError, subprocess.SubprocessError) as error:
                return {
                    "kind": kind,
                    "value": value,
                    "resolved": False,
                    "detail": f"git unavailable: {error}",
                }
            if completed.returncode == 0:
                return {
                    "kind": kind,
                    "value": value,
                    "resolved": True,
                    "repository": root,
                    "detail": completed.stdout.strip()[:4000],
                }
        return {
            "kind": kind,
            "value": value,
            "resolved": False,
            "detail": "commit not found in the project's repository, any configured"
            " document root or any other registered project",
        }
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
