"""The one-shot move from the Board domain to PlanningSpaces and WorkItems.

Forward only, and it refuses rather than guesses. A board becomes a space, its
lanes become that space's workflow states, and every card, link, checklist step,
comment, ref and event moves with its identity intact. Nothing is dropped
quietly: a row this mapping cannot express stops the migration and names itself.

The caller owns the transaction and the snapshot. `store.connect()` takes the
verified snapshot; this module only reads the old tables and writes the new ones,
so a failure anywhere leaves the store exactly as it was.
"""

from __future__ import annotations

import json
import re
import sqlite3
from uuid import NAMESPACE_URL, uuid5

from . import model
from . import store as planning_store

# The Board era's lane names are this installation's state keys, and the default
# workflow already declares them. A board carrying a lane outside this map is a
# store this migration was not written for, and it says so.
_LANE_TO_STATE = {
    "backlog": "backlog",
    "todo": "todo",
    "dev": "dev",
    "review": "review",
    "done": "done",
    "blocked": "blocked",
}

# `moved` is the only action whose name changes, because a lane change is a state
# transition now. The rest are the same audited facts.
_ACTION_MAP = {"moved": "transitioned"}

_LINK_MAP = {"blocks": "blocks", "discovered_from": "discovered-from"}

_CHECKLIST_ID = re.compile(r"^ci_([0-9a-f]{32})$")
# Fixed, so a legacy step id always derives to the same UUID however many
# times this migration is proved on a copy before it is run for real.
_STEP_NAMESPACE = NAMESPACE_URL


class MigrationRefused(model.PlanningError):
    """A row the mapping cannot express, named rather than dropped."""


def board_domain_present(conn: sqlite3.Connection) -> bool:
    row = conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'cards'"
    ).fetchone()
    return row is not None


def migrate_board_domain(conn: sqlite3.Connection, *, project_for_space: dict[str, str]) -> dict:
    """Convert every board into a PlanningSpace and return what moved.

    `project_for_space` is keyed by the stable Planning space key decoded from
    canonical owner bindings. A Board-era title is never used to choose a
    Project, and a board without an exact binding refuses the whole cutover.
    """

    if not board_domain_present(conn):
        raise MigrationRefused("this store has no Board domain to migrate")
    if conn.execute("SELECT 1 FROM work_items LIMIT 1").fetchone() is not None:
        raise MigrationRefused("this store already holds work items; the migration is one-shot")

    launched = conn.execute("SELECT COUNT(*) FROM cards WHERE launch <> ''").fetchone()[0]
    if launched:
        raise MigrationRefused(
            f"{launched} card(s) carry a launch packet, which Executions owns from the next"
            " layer; migrate those after it lands rather than dropping them here"
        )
    stray_lane = conn.execute(
        "SELECT DISTINCT lane FROM cards WHERE lane NOT IN"
        " ('backlog','todo','dev','review','done','blocked')"
    ).fetchall()
    if stray_lane:
        raise MigrationRefused(
            "cards hold lane(s) this mapping does not know: "
            + ", ".join(sorted(str(row[0]) for row in stray_lane))
        )

    mapping = dict(project_for_space)
    spaces: dict[int, dict] = {}
    states: dict[tuple[int, str], str] = {}
    for board in conn.execute("SELECT * FROM boards ORDER BY id"):
        board_id = int(board["id"])
        name = str(board["name"])
        taken = frozenset(row[0] for row in conn.execute("SELECT key FROM planning_spaces"))
        space_key = model.derive_space_key(name, taken)
        project_id = mapping.get(space_key)
        if project_id is None:
            raise MigrationRefused(
                f"board {board_id} has no exact Project binding for planning space {space_key}"
            )
        space = planning_store.create_space(
            conn,
            project_id=project_id,
            name=name,
            key=space_key,
        )
        spaces[board_id] = space
        workflow = planning_store.workflow_for_space(conn, space["planning_space_id"])
        for state in planning_store.states_for_workflow(conn, str(workflow["workflow_id"])):
            states[(board_id, str(state["key"]))] = str(state["state_id"])
        conn.execute(
            "UPDATE planning_spaces SET created_at = ? WHERE planning_space_id = ?",
            (board["created_at"], space["planning_space_id"]),
        )

    items: dict[int, str] = {}
    card_boards: dict[int, int] = {}
    parents: list[tuple[int, int]] = []
    numbers: dict[int, int] = {}
    for card in conn.execute("SELECT * FROM cards ORDER BY id"):
        board_id = int(card["board_id"])
        if board_id not in spaces:
            raise MigrationRefused(f"card {card['id']} points at board {board_id}, which is absent")
        space = spaces[board_id]
        numbers[board_id] = numbers.get(board_id, 0) + 1
        number = numbers[board_id]
        item_id = model.new_id()
        items[int(card["id"])] = item_id
        card_boards[int(card["id"])] = board_id
        if card["parent_id"] is not None:
            parents.append((int(card["id"]), int(card["parent_id"])))
        conn.execute(
            "INSERT INTO work_items(work_item_id,planning_space_id,number,workflow_id,state_id,"
            "kind,priority,title,description,summary,labels,source,checklist,claim_ref,position,"
            "revision,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (
                item_id,
                space["planning_space_id"],
                number,
                space["workflow_id"],
                states[(board_id, _LANE_TO_STATE[str(card["lane"])])],
                "task",
                str(card["priority"]),
                str(card["title"]),
                str(card["description"] or ""),
                _summary(card["summary"], int(card["id"])),
                _labels(card["labels"], int(card["id"])),
                str(card["source"] or ""),
                _checklist(card["checklist"], int(card["id"])),
                str(card["claimed_by"] or ""),
                float(card["position"]),
                int(card["revision"]),
                str(card["created_at"]),
                str(card["updated_at"]),
            ),
        )
        conn.execute(
            "UPDATE planning_spaces SET next_number = ? WHERE planning_space_id = ?",
            (number + 1, space["planning_space_id"]),
        )

    # A card with children is an epic. The Board era carried the same fact in
    # `parent_id` alone and had no word for it, so nothing is invented here.
    for child, parent in parents:
        if parent not in items:
            raise MigrationRefused(f"card {child} names parent {parent}, which is absent")
        conn.execute(
            "UPDATE work_items SET parent_id = ? WHERE work_item_id = ?",
            (items[parent], items[child]),
        )
        conn.execute(
            "UPDATE work_items SET kind = 'epic' WHERE work_item_id = ? AND kind = 'task'",
            (items[parent],),
        )

    links = 0
    for link in conn.execute("SELECT * FROM links ORDER BY id"):
        kind = _LINK_MAP.get(str(link["kind"]))
        if kind is None:
            raise MigrationRefused(f"link {link['id']} has kind {link['kind']}, which has no map")
        conn.execute(
            "INSERT OR IGNORE INTO work_item_links(from_id,to_id,kind,created_at) VALUES(?,?,?,?)",
            (
                items[int(link["from_id"])],
                items[int(link["to_id"])],
                kind,
                str(link["created_at"]),
            ),
        )
        links += 1

    comments = 0
    for comment in conn.execute("SELECT * FROM comments ORDER BY id"):
        conn.execute(
            "INSERT INTO work_item_comments(work_item_id,author,body,created_at) VALUES(?,?,?,?)",
            (
                items[int(comment["card_id"])],
                str(comment["author"]),
                str(comment["body"]),
                str(comment["created_at"]),
            ),
        )
        comments += 1

    refs = 0
    for ref in conn.execute("SELECT * FROM refs ORDER BY id"):
        conn.execute(
            "INSERT OR IGNORE INTO work_item_refs(work_item_id,kind,value,label,author,created_at)"
            " VALUES(?,?,?,?,?,?)",
            (
                items[int(ref["card_id"])],
                str(ref["kind"]),
                str(ref["value"]),
                str(ref["label"] or ""),
                str(ref["author"] or "agent"),
                str(ref["created_at"]),
            ),
        )
        refs += 1

    events = 0
    for event in conn.execute("SELECT * FROM events ORDER BY id"):
        action = _ACTION_MAP.get(str(event["action"]), str(event["action"]))
        if action not in model.EVENT_ACTIONS:
            raise MigrationRefused(f"event {event['id']} has action {event['action']} with no map")
        conn.execute(
            "INSERT INTO work_item_events(work_item_id,action,detail,author,created_at)"
            " VALUES(?,?,?,?,?)",
            (
                items[int(event["card_id"])],
                action,
                str(event["detail"] or "")[:512],
                str(event["author"] or "agent"),
                str(event["created_at"]),
            ),
        )
        events += 1

    result = _verify(
        conn,
        spaces=len(spaces),
        work_items=len(items),
        links=links,
        comments=comments,
        refs=refs,
        events=events,
    )
    # What the Kernel needs in order to move its own pointers inside this same
    # transaction. Planning cannot do it: the two are independent siblings in the
    # import contract, so the caller is the one place that may know about both.
    result["card_to_work_item"] = dict(items)
    result["card_space_keys"] = {
        card_id: str(spaces[board_id]["key"]) for card_id, board_id in card_boards.items()
    }
    result["board_space_keys"] = {
        str(space["name"]): str(space["key"]) for space in spaces.values()
    }
    return result


def _verify(conn: sqlite3.Connection, **counted: int) -> dict:
    """Compare what was written against what the Board tables hold."""

    expected = {
        "spaces": conn.execute("SELECT COUNT(*) FROM boards").fetchone()[0],
        "work_items": conn.execute("SELECT COUNT(*) FROM cards").fetchone()[0],
        "links": conn.execute("SELECT COUNT(*) FROM links").fetchone()[0],
        "comments": conn.execute("SELECT COUNT(*) FROM comments").fetchone()[0],
        "refs": conn.execute("SELECT COUNT(*) FROM refs").fetchone()[0],
        "events": conn.execute("SELECT COUNT(*) FROM events").fetchone()[0],
    }
    written = {
        "spaces": conn.execute("SELECT COUNT(*) FROM planning_spaces").fetchone()[0],
        "work_items": conn.execute("SELECT COUNT(*) FROM work_items").fetchone()[0],
        "links": conn.execute("SELECT COUNT(*) FROM work_item_links").fetchone()[0],
        "comments": conn.execute("SELECT COUNT(*) FROM work_item_comments").fetchone()[0],
        "refs": conn.execute("SELECT COUNT(*) FROM work_item_refs").fetchone()[0],
        "events": conn.execute("SELECT COUNT(*) FROM work_item_events").fetchone()[0],
    }
    drift = {
        name: (expected[name], written[name])
        for name in expected
        if expected[name] != written[name]
    }
    if drift:
        raise MigrationRefused(
            "migrated counts disagree with the source: "
            + ", ".join(
                f"{name} {before} -> {after}" for name, (before, after) in sorted(drift.items())
            )
        )
    if counted["links"] != written["links"] and counted["links"] != expected["links"]:
        raise MigrationRefused("link deduplication lost rows the source held")
    return {"interface_version": f"{model.PLANNING_INTERFACE}-migration", **written}


def _labels(raw: object, card_id: int) -> str:
    try:
        return model.dumps(model.labels(json.loads(str(raw or "[]"))))
    except (json.JSONDecodeError, model.PlanningError) as error:
        raise MigrationRefused(
            f"card {card_id} has labels this mapping refuses: {error}"
        ) from error


def _summary(raw: object, card_id: int) -> str:
    text = str(raw or "")
    if not text:
        return ""
    try:
        record = model.summary(text)
    except model.PlanningError as error:
        raise MigrationRefused(f"card {card_id} has a summary it cannot keep: {error}") from error
    return model.dumps(record)


def _checklist(raw: object, card_id: int) -> str:
    """Carry the steps over, keeping each step's identity.

    A Board step id reads `ci_` and thirty-two hex digits, which is a UUID with
    its dashes taken out. The same digits come back with the dashes in, so a
    reference recorded anywhere still names the same step.
    """

    try:
        items = json.loads(str(raw or "[]"))
    except json.JSONDecodeError as error:
        raise MigrationRefused(f"card {card_id} has a malformed checklist") from error
    if not isinstance(items, list):
        raise MigrationRefused(f"card {card_id} has a checklist that is not a list")
    converted = []
    for index, item in enumerate(items):
        if not isinstance(item, dict):
            raise MigrationRefused(f"card {card_id} checklist step {index} is not an object")
        converted.append({**item, "id": _step_id(item.get("id"), card_id)})
    try:
        return model.dumps(model.checklist(converted))
    except model.PlanningError as error:
        raise MigrationRefused(
            f"card {card_id} has a checklist step this mapping refuses: {error}"
        ) from error


def _step_id(raw: object, card_id: int) -> str:
    """One step's identity, carried across three id schemes this store holds.

    `ci_` and thirty-two hex digits is a UUID with its dashes removed, so the
    same digits come back with the dashes in and any reference to that step still
    names it. An older scheme wrote `ci_<card>_<index>`, which is not a UUID at
    all; those become a UUID derived from the original string, so the mapping is
    the same every time it runs. A step with no id was never referenceable and
    gets a fresh one.
    """

    text = str(raw or "")
    if not text:
        return model.new_id()
    match = _CHECKLIST_ID.match(text)
    if match is not None:
        digits = match.group(1)
        return "-".join((digits[:8], digits[8:12], digits[12:16], digits[16:20], digits[20:]))
    try:
        return model.identifier(text, "checklist step id")
    except model.PlanningError:
        return str(uuid5(_STEP_NAMESPACE, f"valkama:checklist-step:{card_id}:{text}"))
