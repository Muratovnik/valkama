"""The owner's participation setting: its sets, its scopes, its write and its labels.

The values each set gives are written out here by hand from the table the setting was
designed by, rather than read from the module's own `SETS`, so a value both got wrong
still fails here.
"""

from __future__ import annotations

import os
import sqlite3
import tempfile
import unittest
from collections.abc import Mapping
from unittest import mock

from server import store
from server.planning import api, calls, model, participation, questions, service, tools
from server.planning import store as planning_store
from tests.planning_fixtures import standing_in

#: Each point and switch in the sets minimal, default, maximal and manual.
DESIGNED = {
    "queue": ("on", "on", "on", "off"),
    "finding": ("agent", "human", "human", "human"),
    "proposed_goal": ("agent", "human", "human", "human"),
    "task_in_goal": ("agent", "agent", "agent", "human"),
    "decision": ("agent", "human", "human", "human"),
    "cancel_outside": ("agent", "agent", "human", "human"),
    "cancel_shared": ("agent", "human", "human", "human"),
    "condition": ("agent", "human", "human", "human"),
    "goal_close": ("agent", "agent", "human", "human"),
    "goal_defer": ("agent", "agent", "human", "human"),
    "triage_reminder": ("on", "on", "on", "off"),
}
SET_NAMES = ("minimal", "default", "maximal", "manual")
SWITCHES = ("queue", "triage_reminder")
#: The numbers: the default, the least and the most each takes.
NUMBERS = {
    "triage_age_days": (10, 1, 365),
    "triage_count": (100, 1, 10_000),
    "lease_quiet_days": (3, 1, 60),
    "recent_close_minutes": (30, 1, 1440),
}
PATH = "/api/planning/participation"
AGENT = calls.Identity(calls.CONFIRMED, calls.CLAUDE_PAIR, session_id="session-a")


def designed(name: str) -> dict[str, str]:
    column = SET_NAMES.index(name)
    return {key: values[column] for key, values in DESIGNED.items()}


class Harness(unittest.TestCase):
    def setUp(self) -> None:
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        path = os.path.join(directory.name, "valkama.sqlite3")
        patch = mock.patch.dict(os.environ, {"VALKAMA_DB": path})
        patch.start()
        self.addCleanup(patch.stop)
        self.conn = store.connect()
        self.addCleanup(self.conn.close)
        self.space = str(
            service.create_planning_space(self.conn, name="Alpha", key="ALPHA")["planning_space_id"]
        )
        self.other = str(
            service.create_planning_space(self.conn, name="Beta", key="BETA")["planning_space_id"]
        )
        self.conn.commit()

    def person(self, **payload: object) -> dict:
        with calls.bind(calls.browser(), "participation"):
            status, body = api.handle_post(self.conn, PATH, payload) or (0, {})
        self.conn.commit()
        self.assertEqual(200, status)
        return body

    def refused(self, payload: Mapping[str, object], identity: calls.Identity) -> tuple[int, dict]:
        with calls.bind(identity, "participation"), self.assertRaises(Exception) as caught:
            api.handle_post(self.conn, PATH, payload)
        self.conn.rollback()
        status, body = api.error_response(caught.exception)
        return status, body["error"]

    def read(self, space: str | None = None) -> dict:
        query = {} if space is None else {"space": [space]}
        status, body = api.handle_get(self.conn, PATH, query) or (0, {})
        self.assertEqual(200, status)
        return body

    def rows(self) -> list[tuple]:
        return [
            tuple(row)
            for row in self.conn.execute(
                "SELECT planning_space_id, key, value FROM participation_settings ORDER BY key"
            )
        ] + [
            tuple(row)
            for row in self.conn.execute(
                "SELECT planning_space_id, label, ready, description FROM label_settings"
            )
        ]


class SetTests(Harness):
    def test_every_set_gives_every_point_its_value(self) -> None:
        for name in SET_NAMES:
            with self.subTest(set=name):
                self.person(space="ALPHA", set=name)
                settings = participation.load(self.conn)
                found = {
                    key: ("on" if settings.on(self.space, key) else "off")
                    if key in SWITCHES
                    else settings.mode(self.space, key)
                    for key in DESIGNED
                }
                self.assertEqual(designed(name), found)
                self.assertEqual(name, settings.set(self.space))
                # The other space and the common setting are left at the default set.
                self.assertEqual(designed("default"), settings.chosen(self.other))
                self.assertEqual("default", settings.set(None))
        # The reminder is off under the manual set and on again under the default one.
        self.person(space="ALPHA", set="manual")
        self.assertFalse(participation.load(self.conn).on(self.space, "triage_reminder"))
        self.person(space="ALPHA", set="default")
        self.assertTrue(participation.load(self.conn).on(self.space, "triage_reminder"))

    def test_a_store_with_no_row_reads_the_default_set_and_numbers(self) -> None:
        settings = participation.load(self.conn)
        for scope in (None, self.space):
            self.assertEqual(designed("default"), settings.chosen(scope))
            self.assertEqual("default", settings.set(scope))
            for key, (default, _least, _most) in NUMBERS.items():
                self.assertEqual(default, settings.number(scope, key))
        self.assertEqual([], self.rows())

    def test_changing_one_value_of_a_set_leaves_its_name_behind(self) -> None:
        self.person(space="ALPHA", set="maximal")
        read = self.person(space="ALPHA", key="goal_close", value="agent")
        self.assertEqual("custom", read["set"])
        self.assertEqual("custom", participation.set_of({**designed("maximal"), "queue": "off"}))
        self.assertEqual("maximal", participation.set_of(designed("maximal")))


class ScopeTests(Harness):
    def test_only_a_person_writes_and_a_space_inherits_again(self) -> None:
        for identity in (AGENT, calls.Identity(calls.UNCONFIRMED, "mcp", session_id="b")):
            with self.subTest(source=identity.source):
                status, error = self.refused({"space": "ALPHA", "set": "maximal"}, identity)
                self.assertEqual(
                    (403, "owner_only", "the owner changes participation in Valkama"),
                    (status, error["code"], error["message"]),
                )
        self.assertEqual([], self.rows(), "an agent's write wrote nothing")
        self.person(space="ALPHA", key="lease_quiet_days", value=5)
        read = self.person(space="ALPHA", set="maximal")
        own = {entry["key"]: entry["value"] for entry in read["values"] if entry["own"]}
        self.assertEqual({**designed("maximal"), "lease_quiet_days": 5}, own)
        self.assertEqual(12, len(own), "eleven from the set, and the number written before")
        self.assertEqual(("ALPHA", "maximal"), (read["scope"], read["set"]))
        read = self.person(space="ALPHA", set=None)
        own = {entry["key"]: entry["value"] for entry in read["values"] if entry["own"]}
        self.assertEqual({"lease_quiet_days": 5}, own, "the numbers stay")
        self.assertEqual(self.read()["set"], read["set"])
        # Inheriting again takes later changes of the common setting.
        self.person(space=None, set="manual")
        self.assertEqual(
            ("manual", "manual"), (self.read("ALPHA")["set"], self.read("BETA")["set"])
        )

    def test_a_space_overrides_one_value_and_inherits_the_rest(self) -> None:
        self.person(space=None, key="finding", value="agent")
        read = self.person(space="ALPHA", key="decision", value="agent")
        values = {entry["key"]: entry for entry in read["values"]}
        self.assertEqual(
            {"key": "decision", "value": "agent", "own": True, "inherited": "human"},
            values["decision"],
        )
        self.assertEqual(
            {"key": "finding", "value": "agent", "own": False, "inherited": "agent"},
            values["finding"],
        )
        self.assertEqual(
            {"key": "lease_quiet_days", "value": 3, "own": False, "inherited": 3},
            values["lease_quiet_days"],
        )
        common = {entry["key"]: entry for entry in self.read()["values"]}
        self.assertEqual(
            {"key": "finding", "value": "agent", "own": True, "inherited": "human"},
            common["finding"],
        )
        self.assertEqual(list(participation.KEYS), [entry["key"] for entry in read["values"]])
        self.assertEqual({name: designed(name) for name in SET_NAMES}, read["sets"])
        # `value: null` lets the space inherit again.
        read = self.person(space="ALPHA", key="decision", value=None)
        self.assertFalse(any(entry["own"] for entry in read["values"]))
        settings = participation.load(self.conn)
        self.assertEqual(
            ("agent", "human"),
            (settings.mode(self.space, "finding"), settings.mode(self.space, "decision")),
        )

    def test_a_write_checks_each_value_by_its_key_and_each_number_by_its_bounds(self) -> None:
        for payload, says in (
            ({"key": "finding", "value": "on"}, "finding is agent or human"),
            ({"key": "queue", "value": "agent"}, "queue is on or off"),
            ({"key": "queue", "value": True}, "queue is on or off"),
            ({"key": "lease_quiet_days", "value": 0}, "from 1 to 60"),
            ({"key": "lease_quiet_days", "value": 61}, "from 1 to 60"),
            ({"key": "triage_count", "value": 10_001}, "from 1 to 10000"),
            ({"key": "triage_age_days", "value": "10"}, "from 1 to 365"),
            ({"key": "recent_close_minutes", "value": True}, "from 1 to 1440"),
            ({"key": "recent_close_minutes", "value": 1.5}, "from 1 to 1440"),
            ({"key": "speed", "value": "on"}, "speed is not a key of participation"),
            ({"key": "speed", "value": None}, "speed is not a key of participation"),
            ({"set": "careful"}, "set is one of minimal, default, maximal, manual"),
            ({"key": "finding"}, "value is required"),
            ({"key": "finding", "value": "agent", "set": "default"}, "name one of"),
            ({"value": "agent"}, "name one of"),
            ({"key": "finding", "value": "agent", "ready": True}, "unknown field: ready"),
            ({"label": "flow", "ready": "yes", "description": None}, "ready must be true"),
            ({"label": "flow", "ready": True}, "description is required"),
            ({"label": "", "ready": True, "description": None}, "label is required"),
        ):
            with self.subTest(payload=payload):
                status, error = self.refused({"space": "ALPHA", **payload}, calls.browser())
                self.assertEqual((400, "invalid_request"), (status, error["code"]))
                self.assertIn(says, error["message"])
        status, error = self.refused({"key": "finding", "value": "agent"}, calls.browser())
        self.assertEqual((400, "space is required"), (status, error["message"]))
        status, error = self.refused(
            {"space": "NONE", "key": "finding", "value": "agent"}, calls.browser()
        )
        self.assertEqual((400, "no planning space named NONE"), (status, error["message"]))
        self.assertEqual([], self.rows())
        # Each bound itself is taken.
        for key, (_default, least, most) in NUMBERS.items():
            for value in (least, most):
                self.person(space="ALPHA", key=key, value=value)
                self.assertEqual(value, participation.load(self.conn).number(self.space, key))

    def test_a_space_goes_with_its_setting(self) -> None:
        self.person(space="ALPHA", set="manual")
        self.person(space="ALPHA", label="flow", ready=True, description=None)
        self.conn.execute("PRAGMA foreign_keys=ON")
        self.conn.execute("DELETE FROM workflows WHERE planning_space_id = ?", (self.space,))
        self.conn.execute("DELETE FROM planning_spaces WHERE planning_space_id = ?", (self.space,))
        self.assertEqual([], self.rows())

    def test_a_stored_value_its_key_refuses_reads_as_no_row(self) -> None:
        self.conn.execute(
            "INSERT INTO participation_settings(planning_space_id, key, value, updated_at)"
            " VALUES(?, 'finding', 'maybe', 'x'), (?, 'triage_count', '0', 'x')",
            (self.space, self.space),
        )
        settings = participation.load(self.conn)
        self.assertEqual("human", settings.mode(self.space, "finding"))
        self.assertEqual(100, settings.number(self.space, "triage_count"))

    def test_the_store_takes_a_key_of_the_setting_and_no_other(self) -> None:
        self.assertEqual(set(DESIGNED) | set(NUMBERS), set(planning_store.PARTICIPATION_KEYS))
        with self.assertRaisesRegex(sqlite3.IntegrityError, "CHECK"):
            self.conn.execute(
                "INSERT INTO participation_settings(key, value, updated_at)"
                " VALUES('speed', 'on', 'x')"
            )
        self.conn.rollback()
        self.conn.execute(
            "INSERT INTO participation_settings(key, value, updated_at) VALUES('queue', 'on', 'x')"
        )
        with self.assertRaisesRegex(sqlite3.IntegrityError, "UNIQUE"):
            self.conn.execute(
                "INSERT INTO participation_settings(key, value, updated_at)"
                " VALUES('queue', 'off', 'x')"
            )
        self.conn.rollback()

    def test_a_reader_names_what_it_reads(self) -> None:
        settings = participation.load(self.conn)
        for read, name in (
            (settings.mode, "queue"),
            (settings.on, "finding"),
            (settings.number, "finding"),
        ):
            with self.subTest(name=name), self.assertRaises(ValueError):
                read(self.space, name)


class NumberTests(Harness):
    """The numbers beside the points are read where they are used, by the item's space."""

    def setUp(self) -> None:
        super().setUp()
        self.person(space=None, key="lease_quiet_days", value=3)
        self.person(space="ALPHA", key="lease_quiet_days", value=5)

    def held_and_silent(self, author: str | None, days: int) -> dict[str, str]:
        """An item in each space claimed by `author` (by session A when None), quiet `days`."""

        found = {}
        for key in ("ALPHA", "BETA"):
            reference = service.create_work_item(self.conn, space=key, title="Held")["reference"]
            if author is None:
                with calls.bind(AGENT, "claim_work_item"):
                    service.claim_work_item(self.conn, reference)
            else:
                service.claim_work_item(self.conn, reference, author=author)
            found[key] = str(reference)
        then = f"-{days} days"
        self.conn.execute(
            "UPDATE sessions SET last_seen = strftime('%Y-%m-%dT%H:%M:%SZ', 'now', ?)", (then,)
        )
        self.conn.execute(
            "UPDATE work_item_events SET created_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now', ?)",
            (then,),
        )
        self.conn.commit()
        return found

    def claims(self, found: Mapping[str, str]) -> dict[str, str | None]:
        return {
            key: service.get_work_item(self.conn, reference)["claim_ref"] or None
            for key, reference in found.items()
        }

    def test_the_numbers_are_read_by_the_items_space(self) -> None:
        self.conn.execute(
            "INSERT INTO sessions(id, client, last_seen) VALUES(?, 'claude', ?)",
            (AGENT.session_id, "2030-01-01T00:00:00Z"),
        )
        found = self.held_and_silent(None, days=4)
        states = {
            key: service.get_work_item(self.conn, reference)["claim"]["state"]
            for key, reference in found.items()
        }
        self.assertEqual({"ALPHA": "live", "BETA": "stale"}, states)
        held = self.claims(found)
        self.assertEqual(1, service.expire_leases(self.conn))
        self.assertEqual({"ALPHA": held["ALPHA"], "BETA": None}, self.claims(found))
        self.assertIsNotNone(held["ALPHA"])
        self.person(space="ALPHA", key="recent_close_minutes", value=60)
        settings = participation.load(self.conn)
        self.assertEqual(
            (60, 30),
            (
                settings.number(self.space, "recent_close_minutes"),
                settings.number(self.other, "recent_close_minutes"),
            ),
        )

    def test_a_hold_no_session_proved_ages_by_its_items_space(self) -> None:
        found = self.held_and_silent("worker-a", days=4)
        self.assertEqual(1, service.expire_leases(self.conn))
        self.assertEqual({"ALPHA": "worker-a", "BETA": None}, self.claims(found))


class LabelTests(Harness):
    def label(self, read: dict, name: str) -> dict:
        return next(entry for entry in read["labels"] if entry["label"] == name)

    def test_a_label_carries_its_description_in_both_scopes(self) -> None:
        self.person(space=None, label="flow", ready=True, description="Work on the flow")
        read = self.person(space="ALPHA", label="flow", ready=None, description="Ours")
        self.assertEqual(
            {
                "label": "flow",
                "ready": True,
                "description": "Ours",
                "own": True,
                "inherited": {"ready": True, "description": "Work on the flow"},
            },
            self.label(read, "flow"),
        )
        self.assertEqual(
            {
                "label": "flow",
                "ready": True,
                "description": "Work on the flow",
                "own": False,
                "inherited": {"ready": True, "description": "Work on the flow"},
            },
            self.label(self.read("BETA"), "flow"),
        )
        self.assertEqual(
            {
                "label": "flow",
                "ready": True,
                "description": "Work on the flow",
                "own": True,
                "inherited": {"ready": False, "description": None},
            },
            self.label(self.read(), "flow"),
        )
        # A description alone is a rule of its own, which leaves the ready rule above.
        self.person(space=None, label="docs", ready=None, description="Documents")
        self.assertEqual(
            participation.Label(ready=None, description="Documents"),
            participation.load(self.conn).own_labels[None]["docs"],
        )
        # Both null take the space's rule away; the common one stands.
        read = self.person(space="ALPHA", label="flow", ready=None, description=None)
        self.assertFalse(self.label(read, "flow")["own"])
        self.assertEqual(
            [(None, "docs", None, "Documents"), (None, "flow", 1, "Work on the flow")],
            sorted(
                (row[0], row[1], row[2], row[3])
                for row in self.conn.execute(
                    "SELECT planning_space_id, label, ready, description FROM label_settings"
                )
            ),
        )

    def test_the_first_label_ready_in_its_space_makes_a_finding_ready(self) -> None:
        self.person(space=None, label="flow", ready=True, description=None)
        self.person(space=None, label="docs", ready=True, description=None)
        self.person(space="ALPHA", label="flow", ready=False, description=None)
        settings = participation.load(self.conn)
        self.assertEqual("docs", settings.ready_label(self.space, ["ui", "flow", "docs"]))
        self.assertEqual("flow", settings.ready_label(self.other, ["ui", "flow", "docs"]))
        self.assertIsNone(settings.ready_label(self.space, ["ui", "flow"]))
        self.assertIsNone(settings.ready_label(None, []))
        read = self.read("ALPHA")
        self.assertEqual(
            (False, True),
            (self.label(read, "flow")["ready"], self.label(read, "flow")["inherited"]["ready"]),
        )

    def test_the_store_holds_a_label_rule_to_a_ready_or_a_description(self) -> None:
        with self.assertRaisesRegex(sqlite3.IntegrityError, "CHECK"):
            self.conn.execute("INSERT INTO label_settings(label, updated_at) VALUES('flow', 'x')")
        self.conn.rollback()


class FindingTests(Harness):
    """A finding, a task an agent files under no accepted goal: it lies in triage
    whatever the point `finding` says, and the rule of a label accepts it on
    `label_rule` when the write that files it, or puts that label on it, carries the
    label."""

    def file(self, key: str = "ALPHA", **arguments: object) -> dict:
        with calls.bind(AGENT, "create_work_item"):
            answer = tools.OPS["create_work_item"](
                self.conn, {"space": key, "title": "A finding", **arguments}
            )
        self.conn.commit()
        assert isinstance(answer, dict)
        return service.get_work_item(self.conn, str(answer["reference"]))

    def edit(self, reference: str, identity: calls.Identity, **update: object) -> dict:
        with calls.bind(identity, "apply_work_item_changes"):
            api.handle_post(
                self.conn, "/api/planning/work-item/apply", {"id": reference, "update": update}
            )
        self.conn.commit()
        return service.get_work_item(self.conn, reference)

    def where(self, card: dict) -> tuple[str, str | None]:
        acceptance = card["acceptance"]
        return card["state"]["category"], None if acceptance is None else acceptance["basis"]

    def accepted(self, reference: str) -> list[str]:
        return [
            str(row[0])
            for row in self.conn.execute(
                "SELECT e.detail FROM work_item_events e JOIN work_items w"
                " ON w.work_item_id = e.work_item_id JOIN planning_spaces p"
                " ON p.planning_space_id = w.planning_space_id"
                " WHERE e.action = 'accepted' AND p.key || '-' || w.number = ? ORDER BY e.id",
                (reference,),
            )
        ]

    def decided(self) -> list[tuple[str, str, str]]:
        return [
            (str(row[0]), str(row[1]), str(row[2]))
            for row in self.conn.execute(
                "SELECT d.point, p.key || '-' || w.number, d.what FROM agent_decisions d"
                " JOIN work_item_events e ON e.id = d.event_id"
                " JOIN work_items w ON w.work_item_id = e.work_item_id"
                " JOIN planning_spaces p ON p.planning_space_id = w.planning_space_id"
                " ORDER BY d.event_id"
            )
        ]

    def test_a_finding_lands_in_triage_at_any_setting(self) -> None:
        for mode in ("agent", "human"):
            with self.subTest(finding=mode):
                self.person(space="ALPHA", key="finding", value=mode)
                self.assertEqual(mode, participation.load(self.conn).mode(self.space, "finding"))
                card = self.file()
                self.assertEqual(("triage", None), self.where(card))
                self.assertNotIn("waits_for_owner", card)
        self.assertEqual([], self.decided())

    def test_the_space_overrides_the_general_and_the_label_both(self) -> None:
        self.person(space=None, key="finding", value="human")
        self.person(space="ALPHA", key="finding", value="agent")
        self.person(space=None, label="flow", ready=True, description=None)
        self.person(space="ALPHA", label="flow", ready=False, description=None)
        self.person(space=None, label="docs", ready=True, description=None)
        settings = participation.load(self.conn)
        self.assertEqual(
            ("agent", "human"),
            (settings.mode(self.space, "finding"), settings.mode(self.other, "finding")),
        )
        flow = self.file(labels=["flow"])
        self.assertEqual(("triage", None), self.where(flow))
        docs = self.file(labels=["ui", "docs"])
        elsewhere = self.file("BETA", labels=["docs"])
        # BETA would ask the owner about a finding, and the rule takes it all the same.
        for card in (docs, elsewhere):
            self.assertEqual(("ready", "label_rule"), self.where(card))
            self.assertEqual(["label_rule: docs"], self.accepted(card["reference"]))
        self.assertEqual(
            [
                ("finding", docs["reference"], f"accepted {docs['reference']} by the label docs"),
                (
                    "finding",
                    elsewhere["reference"],
                    f"accepted {elsewhere['reference']} by the label docs",
                ),
            ],
            self.decided(),
        )

    def test_a_label_put_on_a_finding_accepts_it_by_its_rule(self) -> None:
        lying = self.file(labels=["docs"])
        self.person(space=None, label="docs", ready=True, description=None)
        # Switching the rule on takes nothing that already lies in triage.
        self.assertEqual(
            ("triage", None), self.where(service.get_work_item(self.conn, lying["reference"]))
        )
        # An edit that leaves the label as it was takes nothing either.
        self.assertEqual(
            ("triage", None), self.where(self.edit(lying["reference"], AGENT, labels_add=["ui"]))
        )
        # The agent's edit that puts the label on accepts it, and is the agent's decision.
        agents = self.file(labels=["ui"])
        self.assertEqual(
            ("ready", "label_rule"),
            self.where(self.edit(agents["reference"], AGENT, labels_add=["docs"])),
        )
        # The person's edit accepts it too, by the same rule, and decides nothing for an agent.
        persons = self.file()
        self.assertEqual(
            ("ready", "label_rule"),
            self.where(self.edit(persons["reference"], calls.browser(), labels=["docs"])),
        )
        self.assertEqual(
            [("finding", agents["reference"], f"accepted {agents['reference']} by the label docs")],
            self.decided(),
        )
        self.assertEqual(["label_rule: docs"], self.accepted(persons["reference"]))

    def test_a_finding_whose_group_waits_on_the_owner_is_left_to_the_answer(self) -> None:
        self.person(space=None, label="docs", ready=True, description=None)
        with calls.bind(AGENT, "create_work_item"):
            group = service.create_work_item(
                self.conn, space="ALPHA", title="A group of findings", kind="goal"
            )
            questions.ask(
                self.conn,
                str(group["work_item_id"]),
                kind="question",
                prompt="Take these findings on?",
                fields=[],
                author="claude",
                purpose="triage",
            )
        self.conn.commit()
        under = self.file(labels=["docs"], parent=group["reference"])
        self.assertEqual(("triage", None), self.where(under))
        moved_in = self.file(labels=["ui"], parent=group["reference"])
        self.assertEqual(
            ("triage", None),
            self.where(self.edit(moved_in["reference"], AGENT, labels_add=["docs"])),
        )
        # Beside the group, under no question, the same label takes it.
        beside = self.file(labels=["docs"])
        self.assertEqual(("ready", "label_rule"), self.where(beside))
        # A goal is no finding the rule takes.
        goal = self.file(kind="goal", labels=["docs"])
        self.assertIsNone(goal["acceptance"])


class QueueTests(Harness):
    """The switch `queue`: the queue hands work out while it is on, and work is taken by
    number while it is off."""

    def ready(self, key: str = "ALPHA") -> str:
        return str(standing_in(self.conn, "ready", space=key, title="Ready")["reference"])

    def take_next(self, key: str = "ALPHA") -> dict:
        with calls.bind(AGENT, "claim_ready_work_item"):
            answer = service.claim_ready_work_item(self.conn, space=key)
        self.conn.commit()
        assert answer is not None
        return answer

    def store(self) -> tuple[list[tuple], int, int]:
        """What a call may write: every item's hold and revision, the history, the store's
        own count of changes."""

        rows = self.conn.execute(
            "SELECT work_item_id, claim_ref, claim_call_id, revision, state_id"
            " FROM work_items ORDER BY work_item_id"
        ).fetchall()
        events = int(self.conn.execute("SELECT COUNT(*) FROM work_item_events").fetchone()[0])
        return [tuple(row) for row in rows], events, self.conn.total_changes

    def test_the_queue_hands_out_work_while_it_is_on(self) -> None:
        task = self.ready()
        self.conn.commit()
        taken = self.take_next()
        self.assertEqual(task, taken["reference"])
        self.assertEqual("ready", taken["started"]["from"])
        self.assertIn("session-a", taken["claim_ref"])
        # The space's own `on` holds against a common setting that hands work out by hand.
        self.person(space=None, set="manual")
        self.person(space="ALPHA", key="queue", value="on")
        second = self.ready()
        self.conn.commit()
        self.assertEqual(second, self.take_next()["reference"])

    def test_manual_work_refuses_the_queue_and_keeps_claims_by_number(self) -> None:
        self.person(space="ALPHA", set="manual")
        task = self.ready()
        # A hold quiet past its lease, which a queue that runs releases first.
        lapsed = str(service.create_work_item(self.conn, space="ALPHA", title="Held")["reference"])
        service.claim_work_item(self.conn, lapsed, author="worker-a")
        self.conn.execute(
            "UPDATE work_item_events SET created_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now', ?)",
            ("-30 days",),
        )
        self.conn.commit()
        before = self.store()
        with (
            calls.bind(AGENT, "claim_ready_work_item"),
            self.assertRaises(model.QueueOffError) as caught,
        ):
            service.claim_ready_work_item(self.conn, space="ALPHA")
        self.assertEqual(before, self.store())
        self.assertEqual(
            "worker-a", service.get_work_item(self.conn, lapsed)["claim_ref"], "lease kept"
        )
        status, body = api.error_response(caught.exception)
        text = (
            "the owner hands out work in ALPHA by hand: take the item they named with"
            " claim_work_item"
        )
        self.assertEqual((409, {"code": "queue_off", "message": text}), (status, body["error"]))
        # The tool says so to the agent before it calls.
        [tool] = [entry for entry in tools.TOOLS if entry["name"] == "claim_ready_work_item"]
        self.assertIn(
            "Refused with queue_off where the owner hands out work by hand.", tool["description"]
        )
        # By number the same task is taken, as the owner's word hands it over.
        with calls.bind(AGENT, "claim_work_item"):
            claimed = service.claim_work_item(self.conn, task)
        self.conn.commit()
        self.assertEqual((task, "ready"), (claimed["reference"], claimed["started"]["from"]))
        self.assertIn("session-a", claimed["claim_ref"])
        # Only that space hands work out by hand: the next one's queue still runs.
        other = self.ready("BETA")
        self.conn.commit()
        self.assertEqual(other, self.take_next("BETA")["reference"])


if __name__ == "__main__":
    unittest.main()
