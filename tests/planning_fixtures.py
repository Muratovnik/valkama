"""A planning space with more work items than one page holds, built in one statement.

Creating a thousand items through the service takes a thousand guarded writes;
the paging tests care about how many rows there are and in which states, not how
each got there, so the rows are inserted directly.
"""

from __future__ import annotations

import sqlite3
import uuid

from server.planning import service


def bulk_items(
    conn: sqlite3.Connection, space: str, count: int, *, title: str = "Bulk"
) -> set[str]:
    """Add `count` items to `space`, spread evenly over its workflow's states.

    The items fill the states in workflow order, so the last of them sit in the
    terminal states — the ones a list read in state order reaches last. Returns
    the new items' ids. The space's counter moves past the new numbers, so a
    later `create_work_item` there does not collide with them.
    """

    found = service.get_planning_space(conn, space)
    space_id = str(found["planning_space_id"])
    workflow = found["workflow"]
    states = [str(state["state_id"]) for state in workflow["states"]]
    first = int(
        conn.execute(
            "SELECT next_number FROM planning_spaces WHERE planning_space_id = ?", (space_id,)
        ).fetchone()[0]
    )
    rows = [
        (
            str(uuid.uuid4()),
            space_id,
            first + index,
            str(workflow["workflow_id"]),
            states[index * len(states) // count],
            f"{title} {first + index}",
            index,
        )
        for index in range(count)
    ]
    conn.executemany(
        "INSERT INTO work_items(work_item_id,planning_space_id,number,workflow_id,state_id,"
        "title,position) VALUES(?,?,?,?,?,?,?)",
        rows,
    )
    conn.execute(
        "UPDATE planning_spaces SET next_number = ? WHERE planning_space_id = ?",
        (first + count, space_id),
    )
    conn.commit()
    return {row[0] for row in rows}


def item_ids(conn: sqlite3.Connection, space: str) -> set[str]:
    """Every item id the store holds for one space, read straight from the table."""

    space_id = str(service.get_planning_space(conn, space)["planning_space_id"])
    return {
        str(row[0])
        for row in conn.execute(
            "SELECT work_item_id FROM work_items WHERE planning_space_id = ?", (space_id,)
        )
    }
