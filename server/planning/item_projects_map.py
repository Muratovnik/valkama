"""The file that says, before the work-model migration, which projects each task names.

The migration looks at no repository and decides nothing about projects: what this
file says is what it writes. `valkama projects map-items` writes the file from a
store Valkama 2.9 left, the registry and Git, all only read; a person reads it,
may add projects to it, and `valkama migrate work-model --item-projects` checks it
again (`preconditions`) before it takes its recovery point.

For each task the first trace of a project decides, in this order:

- its commits, through `item_projects.commit_projects`: those projects, `commits`;
- else its labels the label table maps: those projects, `named`;
- else the file holds nothing for it, and the migration gives it the former
  project of its space, `migrated`.

A goal or stage -- a 2.9 epic, or any item with children -- names no projects, so
the file holds nothing for it and its labels stay.

The label table is a rule, not a list: a label is mapped when it is the id of a
registered project bound to the item's own space. `--label <label>=<project>` maps
one more, in any space; its words must be words of the project's id, since the
label leaves the item and only the id's words find it afterwards. A mapped label
leaves a task whose projects hold its project, wherever they came from. One whose
commits name another project stays, and the task is listed as a discrepancy; one
naming a project bound to another space is not mapped, and a task holding it with
no commit is listed for a person to decide.

`items_digest` is the SHA-256 of every item id of the store, sorted, one a line:
a file read from another state of the store is refused rather than half applied.
"""

from __future__ import annotations

import hashlib
import json
import sqlite3
from collections import Counter
from collections.abc import Mapping, Sequence
from typing import Any

from ..projects import project_registry
from ..store_identity.metadata import read_store_metadata
from . import item_projects, words

FORMAT = "valkama-item-projects"
VERSION = 1
_KEYS = {"data_scope_id", "format", "items", "items_digest", "labels", "version"}
_ENTRY_KEYS = {"drop_labels", "projects"}
_PROJECT_KEYS = {"project_id", "source"}

#: The items a 2.9 store holds that the migration makes goals or stages.
CONTAINERS_2_9 = (
    "SELECT work_item_id FROM work_items WHERE kind = 'epic'"
    " OR work_item_id IN (SELECT parent_id FROM work_items WHERE parent_id IS NOT NULL)"
)
_UPGRADE = "run valkama projects upgrade first"
_AGAIN = "run valkama projects map-items again"


class RefusedError(ValueError):
    """A file, a label or a store the migration does not start from, saying why."""


def digest(conn: sqlite3.Connection) -> str:
    """The fingerprint of the store's items: SHA-256 of their ids, sorted, one a line."""

    identities = sorted(str(row[0]) for row in conn.execute("SELECT work_item_id FROM work_items"))
    return hashlib.sha256("".join(f"{identity}\n" for identity in identities).encode()).hexdigest()


def label_refusal(label: str, project_id: str) -> str | None:
    """Why `label` cannot be carried into `project_id`, or None when it can."""

    if not set(words.terms(label)) <= set(words.terms(project_id)):
        return (
            f"label {label} is not a word of project {project_id}: a search for it would"
            " lose its items; keep it as a label"
        )
    return None


def _registry(listing: Mapping[str, Any]) -> list[Mapping[str, Any]]:
    if listing["status"] != "available":
        raise RefusedError(f"{listing['reason']}: {_UPGRADE}")
    return list(listing["projects"])


def _spaces(conn: sqlite3.Connection) -> list[sqlite3.Row]:
    return conn.execute(
        "SELECT planning_space_id, key, name, project_id FROM planning_spaces ORDER BY key"
    ).fetchall()


def _bound(projects: Sequence[Mapping[str, Any]], data_scope_id: str, key: str) -> list[str]:
    """The ids of the projects the registry binds to the space `key` of this store."""

    return [
        str(project["project_id"])
        for project in project_registry.space_projects(
            projects, {"data_scope_id": data_scope_id, "space_key": key}
        )
    ]


def build(
    conn: sqlite3.Connection, listing: Mapping[str, Any], chosen: Mapping[str, str]
) -> tuple[dict[str, Any], dict[str, Any]]:
    """The file for the store `conn` reads, and what a person checks it by.

    `chosen` is the labels mapped by `--label`, each held to `label_refusal` and to
    a registered project here. The summary counts the tasks by space and by source
    and lists the discrepancies and the labels of other spaces' projects.
    """

    conn.row_factory = sqlite3.Row
    projects = _registry(listing)
    registered = {str(project["project_id"]) for project in projects}
    for label, project_id in sorted(chosen.items()):
        if project_id not in registered:
            raise RefusedError(
                f"project {project_id} named by --label {label}={project_id} is not registered:"
                f" registered projects are {', '.join(sorted(registered)) or 'none'}"
            )
        refusal = label_refusal(label, project_id)
        if refusal:
            raise RefusedError(refusal)
    data_scope_id = str(read_store_metadata(conn)["data_scope_id"])
    keys: dict[str, str] = {}
    home: dict[str, str] = {}
    for space in _spaces(conn):
        keys[str(space["planning_space_id"])] = str(space["key"])
        for project_id in _bound(projects, data_scope_id, str(space["key"])):
            home[project_id] = str(space["key"])
    containers = {str(row[0]) for row in conn.execute(CONTAINERS_2_9)}
    commits: dict[str, list[str]] = {}
    for identity, value in conn.execute(
        "SELECT work_item_id, value FROM work_item_refs WHERE kind = 'commit' ORDER BY id"
    ):
        commits.setdefault(str(identity), []).append(str(value))
    owners = item_projects.commit_projects(
        [value for values in commits.values() for value in values], projects
    )
    entries: dict[str, dict[str, Any]] = {}
    used: dict[str, str] = dict(chosen)
    counts: dict[str, Counter[str]] = {key: Counter() for key in sorted(keys.values())}
    discrepancies: list[dict[str, Any]] = []
    foreign: list[dict[str, Any]] = []
    for row in conn.execute(
        "SELECT work_item_id, planning_space_id, number, labels FROM work_items"
        " ORDER BY planning_space_id, number"
    ):
        identity, key = str(row["work_item_id"]), keys[str(row["planning_space_id"])]
        reference = f"{key}-{row['number']}"
        if identity in containers:
            counts[key]["containers"] += 1
            continue
        labels = list(dict.fromkeys(json.loads(row["labels"] or "[]")))
        table = {
            label: chosen.get(label) or (label if home.get(label) == key else None)
            for label in labels
        }
        mapped = {label: project for label, project in table.items() if project is not None}
        used.update(mapped)
        from_commits = sorted(
            {owners[value] for value in commits.get(identity, []) if value in owners}
        )
        if from_commits:
            chosen_projects, source = from_commits, item_projects.SOURCES[1]
            for label, project in mapped.items():
                if project not in from_commits:
                    discrepancies.append(
                        {
                            "reference": reference,
                            "label": label,
                            "project": project,
                            "commits": from_commits,
                        }
                    )
        else:
            chosen_projects = sorted(set(mapped.values()))
            source = item_projects.NAMED
            foreign += [
                {"reference": reference, "label": label, "space": home[label]}
                for label in labels
                if table[label] is None and label in home and home[label] != key
            ]
        if not chosen_projects:
            counts[key][item_projects.SOURCES[2]] += 1
            continue
        counts[key][source] += 1
        entries[identity] = {
            "drop_labels": [label for label in labels if mapped.get(label) in chosen_projects],
            "projects": [{"project_id": project, "source": source} for project in chosen_projects],
        }
    document = {
        "data_scope_id": data_scope_id,
        "format": FORMAT,
        "items": entries,
        "items_digest": digest(conn),
        "labels": dict(sorted(used.items())),
        "version": VERSION,
    }
    sources = Counter[str]()
    for counted in counts.values():
        sources.update(
            {source: n for source, n in counted.items() if source in item_projects.SOURCES}
        )
    summary = {
        "counts": {key: dict(sorted(counted.items())) for key, counted in counts.items()},
        "sources": dict(sorted(sources.items())),
        "entries": len(entries),
        "labels": document["labels"],
        "discrepancies": discrepancies,
        "foreign_labels": foreign,
    }
    return document, summary


def dumps(document: Mapping[str, Any]) -> str:
    """The file's text: JSON with sorted keys, one level a line."""

    return json.dumps(document, ensure_ascii=False, indent=1, sort_keys=True) + "\n"


def _exact(value: object, keys: set[str], where: str) -> dict[str, Any]:
    if not isinstance(value, dict) or set(value) != keys:
        raise RefusedError(f"the item projects file is malformed: {where} must hold {sorted(keys)}")
    return value


def parse(raw: bytes) -> dict[str, Any]:
    """The file's document, held to its shape; `RefusedError` names what is wrong."""

    try:
        document = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise RefusedError(f"the item projects file is not JSON: {error}") from error
    document = _exact(document, _KEYS, "the file")
    if document["format"] != FORMAT or document["version"] != VERSION:
        raise RefusedError(f"the item projects file is not {FORMAT} version {VERSION}")
    if not isinstance(document["data_scope_id"], str) or not isinstance(
        document["items_digest"], str
    ):
        raise RefusedError("the item projects file is malformed: its store must be named by text")
    labels = document["labels"]
    if not isinstance(labels, dict) or not all(
        isinstance(key, str) and isinstance(value, str) for key, value in labels.items()
    ):
        raise RefusedError(
            "the item projects file is malformed: labels must map a label to a project"
        )
    if not isinstance(document["items"], dict):
        raise RefusedError(
            "the item projects file is malformed: items must map an item to its entry"
        )
    for identity, entry in document["items"].items():
        where = f"items[{identity}]"
        entry = _exact(entry, _ENTRY_KEYS, where)
        drop = entry["drop_labels"]
        if not isinstance(drop, list) or not all(isinstance(label, str) for label in drop):
            raise RefusedError(f"the item projects file is malformed: {where}.drop_labels")
        if not isinstance(entry["projects"], list):
            raise RefusedError(f"the item projects file is malformed: {where}.projects")
        seen: set[str] = set()
        for index, project in enumerate(entry["projects"]):
            project = _exact(project, _PROJECT_KEYS, f"{where}.projects[{index}]")
            if project["source"] not in item_projects.SOURCES or not isinstance(
                project["project_id"], str
            ):
                raise RefusedError(
                    f"the item projects file is malformed: {where}.projects[{index}] must name a"
                    f" project and one of the sources {', '.join(item_projects.SOURCES)}"
                )
            if project["project_id"] in seen:
                raise RefusedError(f"{where} names project {project['project_id']} twice")
            seen.add(project["project_id"])
        if len(seen) > item_projects.MAX_PROJECTS:
            raise RefusedError(f"{where} names more than {item_projects.MAX_PROJECTS} projects")
    return document


def empty(conn: sqlite3.Connection) -> dict[str, Any]:
    """The file of a store that holds no item: nothing to carry."""

    return {
        "data_scope_id": str(read_store_metadata(conn)["data_scope_id"]),
        "format": FORMAT,
        "items": {},
        "items_digest": digest(conn),
        "labels": {},
        "version": VERSION,
    }


def _check_file(
    conn: sqlite3.Connection, document: Mapping[str, Any], registered: set[str], data_scope_id: str
) -> list[str]:
    if document["data_scope_id"] != data_scope_id:
        return [
            f"the item projects file was made from the store {document['data_scope_id']},"
            f" not this one ({data_scope_id}): {_AGAIN}"
        ]
    if document["items_digest"] != digest(conn):
        return [f"the item projects file was made from another state of this store: {_AGAIN}"]
    found: list[str] = []
    labels: Mapping[str, str] = document["labels"]
    for label, project_id in sorted(labels.items()):
        if project_id not in registered:
            found.append(f"label {label} names project {project_id}, which is not registered")
        else:
            found += [refusal for refusal in [label_refusal(label, project_id)] if refusal]
    containers = {str(row[0]) for row in conn.execute(CONTAINERS_2_9)}
    known = {str(row[0]) for row in conn.execute("SELECT work_item_id FROM work_items")}
    for identity, entry in sorted(document["items"].items()):
        named = [str(project["project_id"]) for project in entry["projects"]]
        if identity not in known or identity in containers:
            found.append(f"the item projects file gives projects to {identity}, which is no task")
            continue
        found += [
            f"{identity} names project {project_id}, which is not registered"
            for project_id in named
            if project_id not in registered
        ]
        for label in entry["drop_labels"]:
            if label not in labels:
                found.append(f"{identity} drops the label {label}, which labels does not map")
            elif labels[label] not in named:
                found.append(
                    f"{identity} drops the label {label}, but does not name its project"
                    f" {labels[label]}"
                )
    return found


def preconditions(conn: sqlite3.Connection, raw: bytes | None) -> dict[str, Any]:
    """What must hold before the migration's first write, read from `conn` alone.

    The registry is read, in format 4; every space's project is bound to it there;
    no two spaces share a name; and the file `raw` holds belongs to this store, in
    this state, naming registered projects only, with each label it drops mapped to
    a project the same entry names. A store holding items needs the file; one
    holding none takes an empty one. Answers the parsed file and the registry read,
    for the steps to take from `Context.memo`; raises `RefusedError` with every reason.
    """

    conn.row_factory = sqlite3.Row
    listing = project_registry.read_registry()
    projects = _registry(listing)
    registered = {str(project["project_id"]) for project in projects}
    data_scope_id = str(read_store_metadata(conn)["data_scope_id"])
    spaces = _spaces(conn)
    found = [
        f"planning space {space['key']} belongs to project {space['project_id']}, which the"
        f" registry does not bind to it: run valkama projects bind {space['project_id']}"
        f" --space {space['key']}"
        for space in spaces
        if str(space["project_id"]) not in _bound(projects, data_scope_id, str(space["key"]))
    ]
    names = Counter(str(space["name"]) for space in spaces)
    found += [
        f"planning spaces {', '.join(str(s['key']) for s in spaces if s['name'] == name)} share"
        f" the name {name!r}: rename all but one first"
        for name, count in sorted(names.items())
        if count > 1
    ]
    if raw is None:
        if conn.execute("SELECT 1 FROM work_items LIMIT 1").fetchone() is not None:
            found.append(
                "the store holds work items: name the file valkama projects map-items wrote"
                " with --item-projects"
            )
        document = empty(conn)
    else:
        try:
            document = parse(raw)
        except RefusedError as error:
            found.append(str(error))
            document = None
        if document is not None:
            found += _check_file(conn, document, registered, data_scope_id)
    if found:
        shown = "; ".join(found[:8])
        more = f"; and {len(found) - 8} more" if len(found) > 8 else ""
        raise RefusedError(f"the work-model migration cannot start: {shown}{more}")
    return {"item_projects": document, "registry": listing}


__all__ = ["RefusedError", "build", "dumps", "preconditions"]
