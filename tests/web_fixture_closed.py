"""The board of a space and its Volumes read over one period, for the Work filter's «Closed in a
period» to be checked against: the web keeps exactly the cards the read counts as closed in it.

The space is a store's second, `ALPHA`, with work of its own alone, whose moments are written
here rather than by the clock: each card's whole history stands at one moment, so it came to
stand where it is then. The period is the days 2026-11-12 to 2026-11-18 at UTC+03:00, asked of
the read as its grammar names it, to the day after the last. Around its two ends stand a task
finished at the first moment in it and one a second before; one at the last second in it and a
cancelled one at the first after it. Inside stand a cancelled task, a goal finished in it, and a
task filed straight into a finished state, which never moved: its last write falls after the
period, so the moment `closed_at` gives it is not the one the read counts. An open task that came
to stand in triage inside the period is counted by neither.

Some carry the label `ui`, the goal among them, and the read is asked a second time under it:
narrowed by a label, the read counts tasks alone, so the goal is not among them.
"""

from __future__ import annotations

from collections.abc import Callable
from urllib.parse import urlencode

from server import store
from server.planning import service

SPACE = "ALPHA"
#: The days the period is asked by, at the offset it is read at.
PERIOD = {"from": "2026-11-12", "to": "2026-11-19", "utc_offset": "180"}
#: Each card by its title: where it comes to stand, and the moment its history stands at.
CARDS = (
    ("Finished at the period's first moment", "task", "done", "2026-11-11T21:00:00Z"),
    ("Finished a second before the period", "task", "done", "2026-11-11T20:59:59Z"),
    ("Finished at the period's last second", "task", "done", "2026-11-18T20:59:59Z"),
    ("Cancelled at the first moment after it", "task", "cancelled", "2026-11-18T21:00:00Z"),
    ("Cancelled inside the period", "task", "cancelled", "2026-11-15T10:00:00Z"),
    ("Goal finished inside the period", "goal", "done", "2026-11-16T10:00:00Z"),
    ("Filed finished inside the period", "task", None, "2026-11-14T10:00:00Z"),
    ("Open since inside the period", "task", None, "2026-11-13T10:00:00Z"),
)
#: The label the second read narrows to, and the cards that carry it.
LABEL = "ui"
LABELLED = frozenset(
    {
        "Finished at the period's first moment",
        "Cancelled inside the period",
        "Goal finished inside the period",
        "Filed finished inside the period",
    }
)
#: The last write of the card filed finished, after the period.
LATER = "2026-11-25T10:00:00Z"


def _file(conn, title: str, kind: str, state: str | None) -> str:
    """One card, moved to `state` by a transition, or left where it was filed; a goal is
    accepted when filed, since only accepted work is completed."""

    accepted = {"acceptance": "assignment"} if kind == "goal" else {}
    labels = [LABEL] if title in LABELLED else []
    filed = service.create_work_item(
        conn, space=SPACE, title=title, kind=kind, labels=labels, **accepted
    )
    reference = str(filed["reference"])
    if state is not None:
        service.set_summary(conn, reference, {"done": "Over.", "next": "Nothing."})
        service.transition_work_item(
            conn, reference, state, acceptance="assignment", force=kind == "goal"
        )
    return reference


def closed_in_period(
    http: Callable[[str], dict], data_scope_id: str, settle: Callable[[dict], None]
) -> dict:
    """The space's board, settled as every board fixture is (`settle`), and its Volumes read,
    whole and under the label."""

    conn = store.connect()
    try:
        service.create_planning_space(conn, name="Alpha", key=SPACE)
        for title, kind, state, moment in CARDS:
            reference = _file(conn, title, kind, state)
            identity = conn.execute(
                "SELECT i.work_item_id FROM work_items i JOIN planning_spaces p"
                " ON p.planning_space_id = i.planning_space_id WHERE p.key = ? AND i.number = ?",
                (SPACE, int(reference.split("-")[1])),
            ).fetchone()[0]
            conn.execute(
                "UPDATE work_item_events SET created_at = ? WHERE work_item_id = ?",
                (moment, identity),
            )
            conn.execute(
                "UPDATE work_items SET created_at = ?, updated_at = ? WHERE work_item_id = ?",
                (moment, moment, identity),
            )
            if title.startswith("Filed finished"):
                # Into a finished state with no move of its own, written last after the period.
                conn.execute(
                    "UPDATE work_items SET updated_at = ?, acceptance = 'assignment',"
                    " accepted_at = created_at, state_id = (SELECT s.state_id"
                    " FROM workflow_states s JOIN work_items i ON i.workflow_id = s.workflow_id"
                    " WHERE i.work_item_id = ? AND s.key = 'done') WHERE work_item_id = ?",
                    (LATER, identity, identity),
                )
        conn.commit()
    finally:
        conn.close()
    ref = {"data_scope_id": data_scope_id, "space_key": SPACE}
    board = http(f"/api/planning?{urlencode(ref)}")
    settle(board)
    query = {"scope_kind": "space", **ref, **PERIOD}
    volumes = http(f"/api/planning/volumes?{urlencode(query)}")
    labelled = http(f"/api/planning/volumes?{urlencode({**query, 'label': LABEL})}")
    return {"board": board, "volumes": volumes, "volumes_labelled": labelled}
