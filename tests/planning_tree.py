"""A space whose work items are placed straight in SQL, for the work model's read rules.

A read rule is checked on the tree it reads, not on the writes that would build it:
the writes that accept work, start it and move it out of a container have their own
rules and their own tests. So an item here is a row put where the case needs it,
with its stored kind, state, parent, start and acceptance. Like a write, each placing
brings the search index current, so a search reads the items as they now stand.

Every item gets the acceptance the work model requires of where it stands, so the
store's own check of it refuses none of them: an item in ready, active, review,
blocked or completed, and a container in the service state, is accepted; one in
triage or deferred is not. Inside a chain of accepted open containers the basis is
`inherited`, as the work model gives it; elsewhere a container is accepted by the
owner and a task by assignment. A cancelled item is accepted only when the case
says so.
"""

from __future__ import annotations

import sqlite3

from server.planning import model, service, store, words

#: Where an item stands by the key of the default workflow's state, and the
#: categories whose work the work model holds to an acceptance.
ACCEPTED_KEYS = frozenset({"ready", "dev", "review", "blocked", "done", "container"})
#: Ask the tree for the basis the work model gives an item where it stands.
DERIVED = object()
#: When the tree's facts happened: an hour each, in order.
STAMP = "2026-11-20T{hour:02d}:00:00Z"


class Tree:
    """One space of a fresh store and the items placed in it, by name."""

    def __init__(self, conn: sqlite3.Connection, key: str = "OR") -> None:
        self.conn = conn
        self.key = key
        space = service.create_planning_space(
            conn, project_id=key.lower(), name=f"Space {key}", key=key
        )
        self.space_id = str(space["planning_space_id"])
        self.workflow_id = str(space["workflow"]["workflow_id"])
        self.states = {
            str(row[0]): str(row[1])
            for row in conn.execute(
                "SELECT key, state_id FROM workflow_states WHERE workflow_id = ?",
                (self.workflow_id,),
            )
        }
        self.ids: dict[str, str] = {}
        self.refs: dict[str, str] = {}
        self.hour = 0

    def stamp(self) -> str:
        self.hour += 1
        return STAMP.format(hour=self.hour)

    def add(
        self,
        name: str,
        *,
        kind: str = "task",
        state: str = "triage",
        parent: str | None = None,
        started: bool = False,
        basis: object = DERIVED,
        holder: str = "",
    ) -> str:
        """Place an item; `kind` is `task`, `goal` or `stage`, `state` a default key."""

        container = kind in ("goal", "stage")
        if state == "container" and not container:
            raise ValueError("only a container stands in the service state")
        identity = model.new_id()
        number = store.next_number(self.conn, self.space_id)
        parent_id = self.ids[parent] if parent is not None else None
        accepted = self._basis(state, parent_id, container) if basis is DERIVED else basis
        if state == "dev" and not holder:
            holder = f"worker of {name}"
        self.conn.execute(
            "INSERT INTO work_items(work_item_id, planning_space_id, number, workflow_id,"
            " state_id, kind, priority, title, description, labels, position, parent_id,"
            " acceptance, accepted_at, started_at, claim_ref)"
            " VALUES (?, ?, ?, ?, ?, ?, 'medium', ?, '', '[]', ?, ?, ?, ?, ?, ?)",
            (
                identity,
                self.space_id,
                number,
                self.workflow_id,
                self.states[state],
                model.CONTAINER_KIND if container else kind,
                f"{name} item",
                number,
                parent_id,
                accepted,
                self.stamp() if accepted is not None else None,
                self.stamp() if started else None,
                holder,
            ),
        )
        self.ids[name] = identity
        self.refs[name] = model.human_id(self.key, number)
        words.bring_current(self.conn)
        return identity

    def _basis(self, state: str, parent_id: str | None, container: bool) -> str | None:
        if state not in ACCEPTED_KEYS:
            return None
        if parent_id is not None and self._accepted_chain(parent_id):
            return "inherited"
        return "owner" if container else "assignment"

    def _accepted_chain(self, identity: str | None) -> bool:
        """Whether every container above, from `identity` up, is accepted and open."""

        while identity is not None:
            row = self.conn.execute(
                "SELECT i.parent_id, s.key FROM work_items i"
                " JOIN workflow_states s ON s.state_id = i.state_id WHERE i.work_item_id = ?",
                (identity,),
            ).fetchone()
            if row[1] != "container":
                return False
            identity = row[0]
        return True

    def move(self, name: str, state: str, *, started: bool | None = None) -> None:
        """Stand an item somewhere else, with the acceptance and the start that go there."""

        identity = self.ids[name]
        row = self.conn.execute(
            "SELECT parent_id, kind, acceptance, started_at FROM work_items WHERE work_item_id = ?",
            (identity,),
        ).fetchone()
        accepted = row[2]
        if state in ACCEPTED_KEYS and accepted is None:
            accepted = self._basis(state, row[0], row[1] == model.CONTAINER_KIND)
        if state in ("triage", "deferred"):
            accepted = None
        begun = row[3]
        if started and begun is None:
            begun = self.stamp()
        self.conn.execute(
            "UPDATE work_items SET state_id = ?, acceptance = ?,"
            " accepted_at = CASE WHEN ? IS NULL THEN NULL ELSE COALESCE(accepted_at, ?) END,"
            " started_at = ?, claim_ref = CASE WHEN ? = 'dev' THEN claim_ref ELSE '' END"
            " WHERE work_item_id = ?",
            (self.states[state], accepted, accepted, self.stamp(), begun, state, identity),
        )
        words.bring_current(self.conn)

    def leave(self, name: str) -> None:
        """Move an item out of its container, as the event a move writes on the container says."""

        identity = self.ids[name]
        parent = self.conn.execute(
            "SELECT parent_id FROM work_items WHERE work_item_id = ?", (identity,)
        ).fetchone()[0]
        self.conn.execute(
            "UPDATE work_items SET parent_id = NULL WHERE work_item_id = ?", (identity,)
        )
        self.conn.execute(
            "INSERT INTO work_item_events(work_item_id, action, detail, author)"
            " VALUES (?, 'child_left', ?, 'tree')",
            (parent, self.refs[name]),
        )

    def block(self, source: str, target: str) -> None:
        service.link_work_items(self.conn, self.refs[source], self.refs[target], "blocks")


def oracle(conn: sqlite3.Connection, key: str = "OR") -> Tree:
    """One space holding the cases of the work model's read rules at once.

    G is an accepted goal with work at every depth under it: the stage S and the
    stage S2 inside it, accepted, with a task at work and a ready one; a task done
    straight under G; a closed stage D, a stage E not accepted and a deferred one,
    F. H is an accepted goal with nothing under it and K one whose only child, k,
    left. X blocks G and S blocks the ready task y outside the tree; z is in review,
    w blocked, v cancelled and u a spare task. Every kind and every category is
    here, and three of the four goals and stages that stand accepted and open
    derive a different state.
    """

    tree = Tree(conn, key)
    tree.add("G", kind="goal", state="container")
    tree.add("S", kind="stage", state="container", parent="G")
    tree.add("S2", kind="stage", state="container", parent="S")
    tree.add("a", state="dev", parent="S2", started=True)
    tree.add("b", state="ready", parent="S")
    tree.add("c", state="done", parent="G", started=True)
    tree.add("D", kind="stage", state="done", parent="G")
    tree.add("d", state="done", parent="D", started=True)
    tree.add("E", kind="stage", parent="G")
    tree.add("e", parent="E")
    tree.add("F", kind="stage", state="deferred", parent="G")
    tree.add("H", kind="goal", state="container")
    tree.add("K", kind="goal", state="container")
    tree.add("k", parent="K")
    tree.leave("k")
    tree.add("X")
    tree.add("y", state="ready")
    tree.add("z", state="review", started=True)
    tree.add("w", state="blocked", started=True)
    tree.add("v", state="cancelled")
    tree.add("u")
    tree.block("X", "G")
    tree.block("S", "y")
    return tree


#: What each accepted open goal and stage of `oracle` derives.
ORACLE_DERIVED = {
    "G": "in_progress",
    "S": "in_progress",
    "S2": "in_progress",
    "H": "not_started",
    "K": "awaiting_confirmation",
}
