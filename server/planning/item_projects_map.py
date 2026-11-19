"""The file that says, before the work-model migration, which projects each task names.

The migration looks at no repository and decides nothing about projects: what this
file says is what it writes. `valkama projects map-items` writes the file from a
store Valkama 2.9 left, the registry and Git, all only read; a person reads it,
may add projects to it, and `valkama migrate work-model --item-projects` checks it
again (`preconditions`) before it takes its recovery point.

For each task the first trace of a project decides, in this order:

- its commits, the projects `item_projects.commit_projects` reads off the pairs of
  its commit refs: those projects, `commits`;
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

`commit_refs` says what becomes of each commit ref, one record a ref: the commits
its text names (`item_projects.commit_pairs`), each as a project and a hash with the
subject and time Git gave, the hex words it skipped, `url` when it is an address
that names no commit and becomes a `url` ref, and `drop` when nothing is carried. A
person may set `drop` on any record or take a pair out of one.

`items_digest` is the SHA-256 of every item id of the store, sorted, one a line,
followed by every commit ref's id, item and text, one a line in the order of the
ids: a file read from another state of the store is refused rather than half
applied.
"""

from __future__ import annotations

import hashlib
import json
import re
import sqlite3
import time
from collections import Counter
from collections.abc import Mapping, Sequence
from typing import Any

from ..projects import project_registry
from ..store_identity.metadata import read_store_metadata
from . import item_projects, words

FORMAT = "valkama-item-projects"
VERSION = 1
_KEYS = {"data_scope_id", "format", "items", "items_digest", "labels", "version"}
#: The part a store without commit refs may leave out.
COMMIT_REFS = "commit_refs"
_ENTRY_KEYS = {"drop_labels", "projects"}
_PROJECT_KEYS = {"project_id", "source"}
_RECORD_KEYS = {"drop", "item", "pairs", "ref", "skipped", "url"}
_PAIR_KEYS = {"committed_at", "hash", "project", "subject"}
#: A hash as a commit row holds it.
_HASH = re.compile(r"[0-9a-f]{7,64}")
_COMMIT_REFS_SQL = (
    "SELECT id, work_item_id, value, label FROM work_item_refs WHERE kind = 'commit' ORDER BY id"
)

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
    """The fingerprint of the store's items and commit refs: SHA-256 of the item ids,
    sorted, one a line, then of each commit ref's id, item and text as a JSON list."""

    identities = sorted(str(row[0]) for row in conn.execute("SELECT work_item_id FROM work_items"))
    lines = [f"{identity}\n" for identity in identities]
    lines += [
        json.dumps([int(row[0]), str(row[1]), str(row[2])], ensure_ascii=False) + "\n"
        for row in conn.execute(_COMMIT_REFS_SQL)
    ]
    return hashlib.sha256("".join(lines).encode()).hexdigest()


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
    a registered project here. The summary counts the tasks by space and by source,
    lists the discrepancies and the labels of other spaces' projects, and says what
    becomes of the commit refs (`_commit_summary`).
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
    refs = conn.execute(_COMMIT_REFS_SQL).fetchall()
    started = time.perf_counter()
    found = item_projects.commit_pairs([str(ref["value"]) for ref in refs], projects)
    seconds = round(time.perf_counter() - started, 6)
    records = [_record(ref, found[str(ref["value"])]) for ref in refs]
    pairs_of: dict[str, list[item_projects.CommitPair]] = {}
    for record in records:
        pairs_of.setdefault(record["item"], []).extend(record["pairs"])
    references: dict[str, str] = {}
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
        references[identity] = reference
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
        from_commits = item_projects.commit_projects(pairs_of.get(identity, []))
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
        "commit_refs": records,
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
        COMMIT_REFS: _commit_summary(refs, records, references, seconds),
    }
    return document, summary


def _record(ref: sqlite3.Row, found: item_projects.CommitRefPairs) -> dict[str, Any]:
    """The file's record of one commit ref: dropped when it carries nothing."""

    return {
        "drop": not found["pairs"] and not found["url"],
        "item": str(ref["work_item_id"]),
        "pairs": [dict(pair) for pair in found["pairs"]],
        "ref": int(ref["id"]),
        "skipped": list(found["skipped"]),
        "url": found["url"],
    }


def _commit_summary(
    refs: Sequence[sqlite3.Row],
    records: Sequence[Mapping[str, Any]],
    references: Mapping[str, str],
    seconds: float,
) -> dict[str, Any]:
    """What a person checks the commit refs' records by.

    The distinct pairs by project and those without one; the refs that become `url`
    refs, the ones dropped and the ones whose text skipped a hex word; and each
    commit two refs of one item name with labels that differ, the first of which the
    attachment keeps. `seconds` is how long Git took.
    """

    texts = {int(ref["id"]): ref for ref in refs}
    carried = [record for record in records if not record["drop"]]
    pairs = {(pair["project"], pair["hash"]) for record in carried for pair in record["pairs"]}
    labels: dict[tuple[str, str | None, str], list[str]] = {}
    for record in carried:
        ref = texts[record["ref"]]
        label = item_projects.commit_label(str(ref["label"]), str(ref["value"]))
        for pair in record["pairs"]:
            found = labels.setdefault((record["item"], pair["project"], pair["hash"]), [])
            if label and label not in found:
                found.append(label)

    def shown(record: Mapping[str, Any]) -> dict[str, Any]:
        return {
            "ref": record["ref"],
            "reference": references[record["item"]],
            "value": str(texts[record["ref"]]["value"]),
        }

    return {
        "refs": len(records),
        "pairs_by_project": dict(
            sorted(Counter(project for project, _ in pairs if project is not None).items())
        ),
        "pairs_without_repository": sum(1 for project, _ in pairs if project is None),
        "attachments": len(labels),
        "urls": [shown(record) for record in carried if record["url"]],
        "dropped": [shown(record) for record in records if record["drop"]],
        "skipped": [
            {**shown(record), "skipped": record["skipped"]}
            for record in records
            if record["skipped"]
        ],
        "diverging_labels": [
            {"reference": references[item], "project": project, "hash": hash_, "labels": found}
            for (item, project, hash_), found in labels.items()
            if len(found) > 1
        ],
        "seconds": seconds,
    }


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
    if not isinstance(document, dict) or not _KEYS <= set(document) <= {*_KEYS, COMMIT_REFS}:
        raise RefusedError(
            f"the item projects file is malformed: the file must hold {sorted(_KEYS)},"
            f" and {COMMIT_REFS} beside them when the store holds commit refs"
        )
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
    if COMMIT_REFS in document:
        _parse_commit_refs(document[COMMIT_REFS])
    return document


def _malformed(where: str, what: str) -> RefusedError:
    return RefusedError(f"the item projects file is malformed: {where} {what}")


def _hashes(value: object) -> bool:
    """Whether `value` is a hash as a commit row holds it: 7 to 64 lower-case hex digits."""

    return isinstance(value, str) and _HASH.fullmatch(value) is not None


def _parse_commit_refs(records: object) -> None:
    """Hold `commit_refs` to its shape: one record a ref, each pair a project or null
    and a hash, a record without pairs only when it is a url or dropped."""

    if not isinstance(records, list):
        raise _malformed(COMMIT_REFS, "must list one record for each commit ref")
    seen: set[int] = set()
    for index, record in enumerate(records):
        where = f"{COMMIT_REFS}[{index}]"
        record = _exact(record, _RECORD_KEYS, where)
        if type(record["ref"]) is not int or not isinstance(record["item"], str):
            raise _malformed(where, "must name its ref by id and its item by id")
        if record["ref"] in seen:
            raise _malformed(where, f"repeats the ref {record['ref']}")
        seen.add(record["ref"])
        if not isinstance(record["url"], bool) or not isinstance(record["drop"], bool):
            raise _malformed(where, "must say true or false for url and drop")
        skipped = record["skipped"]
        if not isinstance(skipped, list) or not all(_hashes(word) for word in skipped):
            raise _malformed(f"{where}.skipped", "must list hex words of 7 to 64 lower-case digits")
        if not isinstance(record["pairs"], list):
            raise _malformed(f"{where}.pairs", "must be a list")
        for number, pair in enumerate(record["pairs"]):
            at = f"{where}.pairs[{number}]"
            pair = _exact(pair, _PAIR_KEYS, at)
            if pair["project"] is not None and not isinstance(pair["project"], str):
                raise _malformed(f"{at}.project", "must be a project id or null")
            if not _hashes(pair["hash"]):
                raise _malformed(f"{at}.hash", "must be 7 to 64 lower-case hex digits")
            if not isinstance(pair["subject"], str) or not (
                pair["committed_at"] is None or isinstance(pair["committed_at"], str)
            ):
                raise _malformed(at, "must give its subject as text and its time as text or null")
        if not record["pairs"] and not record["url"] and not record["drop"]:
            raise _malformed(where, "carries nothing: give it a pair, or set url or drop")


def empty(conn: sqlite3.Connection) -> dict[str, Any]:
    """The file of a store that holds no item: nothing to carry."""

    return {
        COMMIT_REFS: [],
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
    return found + _check_commit_refs(conn, document, registered)


def _listed_refs(refs: Sequence[int]) -> str:
    more = f" and {len(refs) - 5} more" if len(refs) > 5 else ""
    return ", ".join(str(ref) for ref in refs[:5]) + more


def _check_commit_refs(
    conn: sqlite3.Connection, document: Mapping[str, Any], registered: set[str]
) -> list[str]:
    """The file's records are of this store's commit refs, each on its own item,
    naming registered projects; and every project an entry derives from commits is
    the project of a pair it carries."""

    stored = {int(row[0]): str(row[1]) for row in conn.execute(_COMMIT_REFS_SQL)}
    records: Sequence[Mapping[str, Any]] = document.get(COMMIT_REFS) or []
    found: list[str] = []
    if COMMIT_REFS not in document and stored:
        found.append(
            f"the store holds {len(stored)} commit refs and the item projects file has no"
            f" {COMMIT_REFS}: {_AGAIN}"
        )
    named = {int(record["ref"]): record for record in records}
    if COMMIT_REFS in document and set(named) != set(stored):
        missing, extra = sorted(set(stored) - set(named)), sorted(set(named) - set(stored))
        if missing:
            found.append(f"{COMMIT_REFS} leaves out the commit refs {_listed_refs(missing)}")
        if extra:
            found.append(f"{COMMIT_REFS} names {_listed_refs(extra)}, which are no commit refs")
    carried: dict[str, set[str]] = {}
    for ref, record in sorted(named.items()):
        if ref in stored and record["item"] != stored[ref]:
            found.append(
                f"{COMMIT_REFS} gives the ref {ref} to {record['item']}, but it is on {stored[ref]}"
            )
        projects = [pair["project"] for pair in record["pairs"] if pair["project"] is not None]
        found += [
            f"commit ref {ref} names project {project}, which is not registered"
            for project in projects
            if project not in registered
        ]
        if not record["drop"]:
            carried.setdefault(str(record["item"]), set()).update(projects)
    for identity, entry in sorted(document["items"].items()):
        found += [
            f"the file derives project {project['project_id']} from commits it drops for {identity}"
            for project in entry["projects"]
            if project["source"] == item_projects.COMMITS
            and project["project_id"] not in carried.get(identity, set())
        ]
    return found


def preconditions(conn: sqlite3.Connection, raw: bytes | None) -> dict[str, Any]:
    """What must hold before the migration's first write, read from `conn` alone.

    The registry is read, in format 4; every space's project is bound to it there;
    no two spaces share a name; and the file `raw` holds belongs to this store, in
    this state, naming registered projects only, with each label it drops mapped to
    a project the same entry names; it holds a record of each commit ref, and a
    project an entry derives from commits is one of a pair it carries
    (`_check_commit_refs`). A store holding items needs the file; one
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
