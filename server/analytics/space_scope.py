"""Which work one space holds, for the usage read narrowed to it.

Its items are the ones its board holds (`planning.item_projects.space_read`): the space's
own items and the items of other spaces that name a project the registry binds to it.
A project filter narrows them as that read narrows by a project: from the space, and
from other spaces only when the project is one of the space's. Work on no item is the
space's when the project of the place its session stands in, which the project dimension
reads such work by, is one of the space's projects. Nothing here says a second time
which items a space holds.
"""

from __future__ import annotations

import sqlite3
from collections.abc import Iterable
from dataclasses import dataclass

from ..planning import item_projects, model, read_model
from ..planning.usage import UsageQueryError, Value
from ..projects import project_registry


@dataclass(frozen=True)
class SpaceHolding:
    """The work of one space: the ids of the items it holds and of the projects bound to it."""

    items: frozenset[str]
    projects: frozenset[str]

    def admits_item(self, work_item_id: str) -> bool:
        """Whether work on this item, which the store still holds, is the space's."""

        return work_item_id in self.items

    def admits_place(self, place: frozenset[str] | None) -> bool:
        """Whether work on no item whose session stands at `place` is the space's: unknown
        there, it is no space's."""

        return place is not None and not place.isdisjoint(self.projects)


def _held(
    conn: sqlite3.Connection,
    space: sqlite3.Row,
    project: str | None,
    listing: project_registry.RegistryResult,
) -> set[str]:
    clauses, parameters = item_projects.space_read(conn, space, project, listing=listing)
    held = f"SELECT i.work_item_id FROM work_items i WHERE {' AND '.join(clauses)}"  # noqa: S608 - fixed clauses
    return {str(row[0]) for row in conn.execute(held, parameters)}


def holding(
    conn: sqlite3.Connection,
    reference: str,
    projects: Iterable[Value] | None,
    listing: project_registry.RegistryResult,
) -> SpaceHolding:
    """The work the space a caller names by its key, id or name holds, or a refusal.

    `projects` are the values a project filter admits, `None` among them for items that
    name no project; with no filter the space's whole read.
    """

    try:
        space = read_model.space_row(conn, reference)
    except model.PlanningError as error:
        raise UsageQueryError(str(error)) from error
    if projects is None:
        items = _held(conn, space, None, listing)
    else:
        admitted = set(projects)
        items = set()
        for project in sorted(value for value in admitted if isinstance(value, str)):
            items |= _held(conn, space, project, listing)
        if None in admitted:
            named = item_projects.ids_of_items(conn, _held(conn, space, None, listing))
            items |= {item for item, held in named.items() if not held}
    bound = item_projects.space_project_ids(conn, str(space["key"]), listing=listing)
    return SpaceHolding(frozenset(items), frozenset(bound))


__all__ = ["SpaceHolding", "holding"]
