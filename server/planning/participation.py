"""The owner's participation: where an agent's decision waits for the owner.

At each point an agent decides something the owner may want to decide instead --
a finding outside the accepted goal, a goal it proposes, a cancel, a close -- the
setting says `agent` (it goes ahead) or `human` (it waits for the owner). Two
switches say whether the queue hands out work and whether the reminder to triage
shows, and four numbers stand beside them. A set names a value for every point and
switch; changing one of them leaves the set's name behind, as `custom`.

There is one common setting, and a space overrides single values of it and inherits
the rest, later changes of the common ones included. A key with no row takes the
value above it, and above the common one the default set held here, so a store
without a row reads as that set and changing the default set needs no migration.
Which set a scope stands at is read from its values, never stored: a stored name
would part from the values at the first change of one of them.

The rules of a label live in the same two scopes: whether a finding with the label
is ready at once, and what the label means. A space's rule of a label overrides the
common one, field by field.

Only a person writes the setting, and the surface that takes the write says so; no
agent tool reads or writes it. `load` reads both tables once, as a snapshot a
request or a write reads every point from.
"""

from __future__ import annotations

import sqlite3
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from datetime import UTC, datetime

from . import calls, model
from . import store as planning_store

AGENT = "agent"
HUMAN = "human"
ON = "on"
OFF = "off"

#: The points at which an agent decides, each `agent` or `human`.
POINTS = (
    "finding",
    "proposed_goal",
    "task_in_goal",
    "decision",
    "cancel_outside",
    "cancel_shared",
    "condition",
    "goal_close",
    "goal_defer",
)
#: The switches of a scope, each `on` or `off`: the queue hands out work, and the
#: reminder to triage shows.
SWITCHES = ("queue", "triage_reminder")
#: The numbers beside the points, which no set gives: the default, the least and the
#: most. The bounds keep a slip of the hand from turning a lease or a reminder off.
NUMBERS: Mapping[str, tuple[int, int, int]] = {
    "triage_age_days": (10, 1, 365),
    "triage_count": (100, 1, 10_000),
    "lease_quiet_days": (3, 1, 60),
    "recent_close_minutes": (30, 1, 1440),
}
#: Every key, in the order the setting is read out.
KEYS = planning_store.PARTICIPATION_KEYS
#: The keys a set gives: the points and the switches.
CHOSEN = tuple(key for key in KEYS if key not in NUMBERS)

MINIMAL = "minimal"
DEFAULT = "default"
MAXIMAL = "maximal"
MANUAL = "manual"
#: What a scope whose values match no set stands at.
CUSTOM = "custom"
_SET_NAMES = (MINIMAL, DEFAULT, MAXIMAL, MANUAL)
#: Each point's and switch's value in the four sets, in their order. From the least
#: the owner takes part to the most; `manual` also hands out work by hand.
_BY_SET: Mapping[str, tuple[str, str, str, str]] = {
    "queue": (ON, ON, ON, OFF),
    "finding": (AGENT, HUMAN, HUMAN, HUMAN),
    "proposed_goal": (AGENT, HUMAN, HUMAN, HUMAN),
    "task_in_goal": (AGENT, AGENT, AGENT, HUMAN),
    "decision": (AGENT, HUMAN, HUMAN, HUMAN),
    "cancel_outside": (AGENT, AGENT, HUMAN, HUMAN),
    "cancel_shared": (AGENT, HUMAN, HUMAN, HUMAN),
    "condition": (AGENT, HUMAN, HUMAN, HUMAN),
    "goal_close": (AGENT, AGENT, HUMAN, HUMAN),
    "goal_defer": (AGENT, AGENT, HUMAN, HUMAN),
    "triage_reminder": (ON, ON, ON, OFF),
}
#: The four sets, each naming a value for every point and switch.
SETS: Mapping[str, Mapping[str, str]] = {
    name: {key: _BY_SET[key][column] for key in CHOSEN} for column, name in enumerate(_SET_NAMES)
}

#: What a person reads when an agent writes the setting.
OWNER_ONLY = "the owner changes participation in Valkama"

Value = str | int


def _key(key: object) -> str:
    if not isinstance(key, str) or key not in KEYS:
        raise model.PlanningError(
            f"{key} is not a key of participation: the keys are {', '.join(KEYS)}"
        )
    return key


def validate(key: object, value: object) -> Value:
    """The value `key` takes for `value`, or `model.PlanningError` saying what it takes:
    `agent` or `human` at a point, `on` or `off` at a switch, a whole number within its
    bounds for a number."""

    key = _key(key)
    if key in NUMBERS:
        _default, least, most = NUMBERS[key]
        if not isinstance(value, int) or isinstance(value, bool) or not least <= value <= most:
            raise model.PlanningError(f"{key} is a whole number from {least} to {most}")
        return value
    allowed = (ON, OFF) if key in SWITCHES else (AGENT, HUMAN)
    if value not in allowed:
        raise model.PlanningError(f"{key} is {allowed[0]} or {allowed[1]}")
    return str(value)


def set_of(values: Mapping[str, object]) -> str:
    """The set whose every point and switch `values` holds, or `custom`."""

    for name, chosen in SETS.items():
        if all(values.get(key) == value for key, value in chosen.items()):
            return name
    return CUSTOM


def _stored(key: str, text: str) -> Value | None:
    """A stored value as its key reads it; None for one that no longer passes the
    check, which reads as no row rather than breaking the read that wanted it."""

    try:
        return validate(key, int(text) if key in NUMBERS and text.isdigit() else text)
    except model.PlanningError:
        return None


@dataclass(frozen=True)
class Label:
    """One scope's rule of a label; None in a field takes the rule above."""

    ready: bool | None
    description: str | None


_NO_RULE = Label(ready=False, description=None)


@dataclass(frozen=True)
class Settings:
    """Both tables as one read found them: by scope (None for the common one), each
    scope's own values and own label rules."""

    own_values: Mapping[str | None, Mapping[str, Value]]
    own_labels: Mapping[str | None, Mapping[str, Label]]

    def own(self, space: str | None, key: str) -> Value | None:
        """The value the scope sets itself, or None when it inherits."""

        return self.own_values.get(space, {}).get(key)

    def inherited(self, space: str | None, key: str) -> Value:
        """What the scope would read without a value of its own: the common one's for a
        space, the default set's (or the number's default) for the common one."""

        if space is not None:
            common = self.own(None, key)
            if common is not None:
                return common
        if key in NUMBERS:
            return NUMBERS[key][0]
        return SETS[DEFAULT][key]

    def value(self, space: str | None, key: str) -> Value:
        """The value in force in the scope."""

        own = self.own(space, key)
        return self.inherited(space, key) if own is None else own

    def mode(self, space: str | None, point: str) -> str:
        """`agent` or `human` at one point."""

        if point not in POINTS:
            raise ValueError(f"{point} is not a point of participation")
        return str(self.value(space, point))

    def on(self, space: str | None, switch: str) -> bool:
        """Whether a switch is on."""

        if switch not in SWITCHES:
            raise ValueError(f"{switch} is not a switch of participation")
        return self.value(space, switch) == ON

    def number(self, space: str | None, key: str) -> int:
        """One of the numbers beside the points."""

        if key not in NUMBERS:
            raise ValueError(f"{key} is not a number of participation")
        return int(self.value(space, key))

    def chosen(self, space: str | None) -> dict[str, str]:
        """The value of every point and switch in force in the scope."""

        return {key: str(self.value(space, key)) for key in CHOSEN}

    def set(self, space: str | None) -> str:
        """The set the scope stands at, or `custom`."""

        return set_of(self.chosen(space))

    def label_inherited(self, space: str | None, label: str) -> Label:
        """The rule of a label the scope would read without one of its own."""

        if space is None:
            return _NO_RULE
        return self.label(None, label)

    def label(self, space: str | None, label: str) -> Label:
        """The rule of a label in force in the scope, each field taken from the scope
        when it sets it and from above when it does not."""

        above = self.label_inherited(space, label)
        own = self.own_labels.get(space, {}).get(label)
        if own is None:
            return above
        return Label(
            ready=above.ready if own.ready is None else own.ready,
            description=above.description if own.description is None else own.description,
        )

    def ready_label(self, space: str | None, labels: Iterable[str]) -> str | None:
        """The first of an item's labels whose rule in force makes a finding ready."""

        return next((label for label in labels if self.label(space, label).ready), None)


#: Both tables in one statement, a value row first (0) or a label rule (1): a read
#: loads the setting once, and a single read of a held item pays one statement for it.
_LOAD = (
    "SELECT 0, planning_space_id, key, value, NULL FROM participation_settings"
    " UNION ALL SELECT 1, planning_space_id, label, ready, description FROM label_settings"
)


def load(conn: sqlite3.Connection) -> Settings:
    """Both tables, read once.

    A store an earlier build wrote, read as it is in an attached scope, has neither
    table, and reads as a store without a row: the default set and numbers.
    """

    try:
        rows = conn.execute(_LOAD).fetchall()
    except sqlite3.OperationalError as error:
        if "no such table" not in str(error):
            raise
        return Settings({}, {})
    values: dict[str | None, dict[str, Value]] = {}
    labels: dict[str | None, dict[str, Label]] = {}
    for kind, space, name, value, description in rows:
        if kind == 0:
            stored = _stored(str(name), str(value))
            if stored is not None:
                values.setdefault(space, {})[str(name)] = stored
            continue
        labels.setdefault(space, {})[str(name)] = Label(
            ready=None if value is None else bool(value),
            description=None if description is None else str(description),
        )
    return Settings(values, labels)


# -- writes ------------------------------------------------------------------------


def _begin(conn: sqlite3.Connection) -> tuple[int | None, str]:
    """The write's transaction, the call that makes it and its moment."""

    if not conn.in_transaction:
        conn.execute("BEGIN IMMEDIATE")
    now = datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")
    return calls.call_id(conn, None), now


def _put(conn: sqlite3.Connection, space: str | None, values: Mapping[str, Value | None]) -> None:
    """Write each value of one scope; None takes the scope's own value away."""

    call, now = _begin(conn)
    for key, value in values.items():
        conn.execute(
            "DELETE FROM participation_settings WHERE planning_space_id IS ? AND key = ?",
            (space, key),
        )
        if value is not None:
            conn.execute(
                "INSERT INTO participation_settings"
                "(planning_space_id, key, value, call_id, updated_at) VALUES(?,?,?,?,?)",
                (space, key, str(value), call, now),
            )


def write_value(conn: sqlite3.Connection, space: str | None, key: object, value: object) -> None:
    """Set one value of a scope, or with `value` None let it inherit again."""

    name = _key(key)
    _put(conn, space, {name: None if value is None else validate(name, value)})


def write_set(conn: sqlite3.Connection, space: str | None, name: object) -> None:
    """Give every point and switch of a scope the value of a set, or with `name` None
    take the scope's own points and switches away; its numbers stay."""

    if name is None:
        _put(conn, space, dict.fromkeys(CHOSEN))
        return
    if name not in SETS:
        raise model.PlanningError(f"set is one of {', '.join(SETS)}, or null")
    _put(conn, space, SETS[str(name)])


def write_label(
    conn: sqlite3.Connection,
    space: str | None,
    label: object,
    *,
    ready: object,
    description: object,
) -> None:
    """Set a scope's rule of a label; both fields None take the rule away."""

    name = model.text_field(label, "label", limit=model.MAX_LABEL_LENGTH)
    if ready is not None and not isinstance(ready, bool):
        raise model.PlanningError("ready must be true, false or null")
    text = None if description is None else model.multiline_field(description, "description")
    said = text or None
    call, now = _begin(conn)
    conn.execute(
        "DELETE FROM label_settings WHERE planning_space_id IS ? AND label = ?", (space, name)
    )
    if ready is not None or said is not None:
        conn.execute(
            "INSERT INTO label_settings"
            "(planning_space_id, label, ready, description, call_id, updated_at)"
            " VALUES(?,?,?,?,?,?)",
            (space, name, None if ready is None else int(ready), said, call, now),
        )


# -- the read of one scope ---------------------------------------------------------


def _rule(rule: Label) -> dict[str, object]:
    return {"ready": bool(rule.ready), "description": rule.description}


def _own_fields(rule: Label | None) -> dict[str, bool]:
    """Which fields of a label's rule the scope's own record sets: a field it leaves out
    is taken from above, so a write of one field keeps the other inherited."""

    return {
        "ready": rule is not None and rule.ready is not None,
        "description": rule is not None and rule.description is not None,
    }


def shown(conn: sqlite3.Connection, space: str | None) -> dict:
    """One scope as the owner reads it: its set, every value with whether the scope
    sets it and what it would inherit, and the rules of every label it reads, each
    with the fields the scope sets itself."""

    settings = load(conn)
    key = None
    if space is not None:
        found = conn.execute(
            "SELECT key FROM planning_spaces WHERE planning_space_id = ?", (space,)
        ).fetchone()
        key = None if found is None else str(found[0])
    labels = set(settings.own_labels.get(None, {}))
    if space is not None:
        labels |= set(settings.own_labels.get(space, {}))
    return {
        "scope": key,
        "set": settings.set(space),
        "sets": {name: dict(values) for name, values in SETS.items()},
        "values": [
            {
                "key": name,
                "value": settings.value(space, name),
                "own": settings.own(space, name) is not None,
                "inherited": settings.inherited(space, name),
            }
            for name in KEYS
        ],
        "labels": [
            {
                "label": label,
                **_rule(settings.label(space, label)),
                "own": _own_fields(settings.own_labels.get(space, {}).get(label)),
                "inherited": _rule(settings.label_inherited(space, label)),
            }
            for label in sorted(labels)
        ],
    }


__all__ = [
    "AGENT",
    "CHOSEN",
    "CUSTOM",
    "DEFAULT",
    "HUMAN",
    "KEYS",
    "MANUAL",
    "MAXIMAL",
    "MINIMAL",
    "NUMBERS",
    "OFF",
    "ON",
    "OWNER_ONLY",
    "POINTS",
    "SETS",
    "SWITCHES",
    "Label",
    "Settings",
    "load",
    "set_of",
    "shown",
    "validate",
    "write_label",
    "write_set",
    "write_value",
]
