"""The filter of tasks by kind and label, as the board's filter keeps them.

One rule for every read that narrows its work so: the Volumes read counts by it
(`volumes.Request.matching`), and the read of the questions waiting for the owner lists
by it the questions that number counts (`interactions.request_list`). A filter keeps the
tasks of any of its kinds, or of any kind when it names none, that carry every one of
its labels. A goal or stage never matches: it has no kind of a task, and its labels are
not labels of work.
"""

from __future__ import annotations

import json
import sqlite3
from collections.abc import Iterable
from typing import NamedTuple

from . import model

KIND_FILTERS_TASKS = "kind filters tasks: task, bug or improvement"
NO_LABEL = "no work item carries label {label}"


class WorkFilter(NamedTuple):
    """The tasks a filtered read keeps: of any of `kinds`, or of any kind when it names
    none, and carrying every one of `labels`."""

    kinds: tuple[str, ...]
    labels: tuple[str, ...]

    def answer(self) -> dict:
        return {"kinds": list(self.kinds), "labels": list(self.labels)}

    def condition(self) -> tuple[tuple[str, ...], tuple[object, ...]]:
        """The rule as conditions on `work_items i` joined by `AND`, with their parameters
        in order."""

        kinds = json.dumps(list(self.kinds) or sorted(model.TASK_KINDS))
        carries = "EXISTS (SELECT 1 FROM json_each(i.labels) WHERE value = ?)"
        return (
            ("i.kind IN (SELECT value FROM json_each(?))", *(carries for _ in self.labels)),
            (kinds, *self.labels),
        )


def named(kinds: Iterable[str], labels: Iterable[str]) -> WorkFilter | None:
    """The filter a caller names, None when it names no kind and no label, or a refusal of
    a kind that is no task's. Each kind and label is kept once, in the order named."""

    kept_kinds = tuple(dict.fromkeys(kinds))
    kept_labels = tuple(dict.fromkeys(labels))
    if not kept_kinds and not kept_labels:
        return None
    if any(kind not in model.TASK_KINDS for kind in kept_kinds):
        raise model.PlanningError(KIND_FILTERS_TASKS)
    return WorkFilter(kept_kinds, kept_labels)


def of_store(
    conn: sqlite3.Connection, kinds: Iterable[str], labels: Iterable[str]
) -> WorkFilter | None:
    """The filter a caller names of one store (`named`), which refuses a label no item of
    the store carries. A label the store holds but a scope does not gives an empty read,
    not a refusal."""

    kept = named(kinds, labels)
    for label in () if kept is None else kept.labels:
        carried = conn.execute(
            "SELECT 1 FROM work_items w, json_each(w.labels) l WHERE l.value = ? LIMIT 1",
            (label,),
        ).fetchone()
        if carried is None:
            raise model.PlanningError(NO_LABEL.format(label=label))
    return kept
