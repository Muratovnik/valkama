"""Which items of a space an agent is at work on now, as the read model says.

The rule under test, from `live_work`: an item takes the strongest state of the
sessions behind it (its claim, its open steps) and of the attempts running on
it. A session that is not active, or silent past the lease period, stands for
nothing; one silent past a day is `quiet`; one with a turn of its own running, or
with a subagent running since it really last started, is at work; any other is
`waiting`, `long` once silent past `WAITING_LONG`, and a compacted context is no
start or event. A turn runs when a prompt is the last of the session's events that
open or end one and its transcript was written within `TURN_SILENT`; a notice stops
it until the transcript is written again, and the session `asks` meanwhile. A session whose own turn runs makes one
item `working`: of those it holds, the one its own write named last, and holding
none, the one it wrote to since its last prompt. A live subagent makes `working` the
item it wrote to since it last started, holds an open step of, names by number in
its label or first in its packet, or, with no such sign, the one item its session
holds. A session's other items are `held`. A live subagent is an active row started
since the session really started, not silent past `SUBAGENT_SILENT` by its transcript.

Every case reads `planning_payload`, so the key is checked where views take it.
Hook events go through the real ingest path and claims through the real write
path under a bound identity. The clock is `leases.utc_now`, set years ahead, so
every event the cases record is newer than the moment a claim call touched its
session and applies to the row.
"""

from __future__ import annotations

import json
import os
import sqlite3
import tempfile
import unittest
import uuid
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from unittest import mock

from server import store
from server.hooks import ingest, normalize
from server.http_surface import EventFrames
from server.planning import calls, leases, live_work, service, views
from tests.planning_fixtures import bulk_items

NOW = datetime(2030, 1, 1, 12, 0, 0, tzinfo=UTC)
SPACE = "LW"


def ago(**delta: float) -> str:
    """A hook's time: `delta` before the clock, with the milliseconds a hook sends."""

    return (NOW - timedelta(**delta)).strftime("%Y-%m-%dT%H:%M:%S.000Z")


def second(**delta: float) -> str:
    """A session row's time: `delta` before the clock, to the second."""

    return (NOW - timedelta(**delta)).strftime("%Y-%m-%dT%H:%M:%SZ")


def confirmed(session: str, agent: str | None = None) -> calls.Identity:
    return calls.Identity(
        state=calls.CONFIRMED,
        source=calls.CLAUDE_HOOK,
        session_id=session,
        agent_id=agent,
        agent_type="Explore" if agent else None,
        tool_use_id="t",
        client="claude",
    )


class LiveWorkCase(unittest.TestCase):
    def setUp(self) -> None:
        directory = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.addCleanup(directory.cleanup)
        environment = mock.patch.dict(
            os.environ, {"VALKAMA_DB": os.path.join(directory.name, "valkama.sqlite3")}
        )
        environment.start()
        self.addCleanup(environment.stop)
        clock = mock.patch.object(leases, "utc_now", return_value=NOW)
        clock.start()
        self.addCleanup(clock.stop)
        self.conn = store.connect()
        self.addCleanup(self.conn.close)
        service.create_planning_space(self.conn, project_id="live", name="Live", key=SPACE)
        self._uid = 0

    # -- what the cases are made of --------------------------------------------

    def item(self, steps: list[str] | None = None) -> str:
        created = service.create_work_item(self.conn, space=SPACE, title="Work")
        if steps:
            service.set_checklist(self.conn, created["reference"], steps)
        return str(created["reference"])

    def identity(self, reference: str) -> str:
        return str(service.get_work_item(self.conn, reference)["work_item_id"])

    def hook(
        self,
        session: str,
        event: str,
        when: str,
        agent: str | None = None,
        **fields: object,
    ) -> None:
        """One client hook through the real ingest path; `fields` go in as the input does."""

        self._uid += 1
        payload: dict[str, object] = {"session_id": session, **fields}
        if agent is not None:
            payload["agent_id"] = agent
        record = normalize.lifecycle_event(
            "claude",
            event,
            payload,
            event_uid=f"00000000-0000-4000-8000-{self._uid:012d}",
            occurred_at=when,
        )
        assert record is not None
        ingest.record(self.conn, record, delivery="direct")

    def claim(self, reference: str, session: str, agent: str | None = None) -> None:
        with calls.bind(confirmed(session, agent), "claim_work_item"):
            service.claim_work_item(self.conn, reference, move_state=False)

    def hold_step(self, reference: str, session: str | None, agent: str | None = None) -> None:
        (step, *_) = service.get_work_item(self.conn, reference)["checklist"]
        if session is None:
            service.claim_checklist_item(self.conn, reference, step["id"], author="user")
            return
        with calls.bind(confirmed(session, agent), "claim_work_item_checklist_item"):
            service.claim_checklist_item(self.conn, reference, step["id"])

    def comment(self, reference: str, session: str, agent: str | None = None) -> None:
        with calls.bind(confirmed(session, agent), "comment_work_item"):
            service.comment_work_item(self.conn, reference, "a note")

    def seen(self, session: str, when: str) -> None:
        self.conn.execute("UPDATE sessions SET last_seen = ? WHERE id = ?", (when, session))

    def attempt(self, reference: str, status: str) -> None:
        self.conn.execute(
            "INSERT INTO executions(execution_id, work_item_id, client_family, role,"
            " environment, expected_effect, status) VALUES (?,?,?,?,?,?,?)",
            (str(uuid.uuid4()), self.identity(reference), "claude", "r", "e", "x", status),
        )

    def live(self) -> dict[str, dict]:
        return views.planning_payload(self.conn, space=SPACE)["live_work"]

    def state_of(self, reference: str) -> dict | None:
        return self.live().get(self.identity(reference))


def _session() -> str:
    return str(uuid.uuid4())


#: One case per row: what happened to a fresh item, and what the map says of it.
#: Each builder takes the case and the item's reference.
_Build = Callable[[LiveWorkCase, str], None]


def _claimed_then(*events: str, agent_events: tuple[str, ...] = ()) -> _Build:
    """A claim by one session, then its own lifecycle events, a minute apart, oldest first."""

    def build(case: LiveWorkCase, reference: str) -> None:
        session = _session()
        case.claim(reference, session)
        for index, event in enumerate(events):
            case.hook(session, event, ago(minutes=(len(events) - index) * 10))
        for event in agent_events:
            case.hook(session, event, ago(minutes=1), agent="a1")

    return build


def _written_after_the_prompt(agent: str | None = None) -> _Build:
    """A claim, a prompt, then a comment by the session or by one of its subagents."""

    def build(case: LiveWorkCase, reference: str) -> None:
        session = _session()
        case.claim(reference, session)
        case.hook(session, "session-start", ago(minutes=20))
        case.hook(session, "user-prompt-submit", ago(minutes=10))
        case.comment(reference, session, agent)

    return build


def _written_beside_waiting(case: LiveWorkCase, reference: str) -> None:
    """A claim taken after one session's prompt, and a step another holds after its turn."""

    claimer, stepper = _session(), _session()
    case.hook(claimer, "user-prompt-submit", ago(minutes=12))
    case.claim(reference, claimer)
    case.hold_step(reference, stepper)
    case.hook(stepper, "user-prompt-submit", ago(minutes=20))
    case.hook(stepper, "stop", ago(minutes=10))


def _silent_for(delta: timedelta, last: str) -> _Build:
    def build(case: LiveWorkCase, reference: str) -> None:
        session = _session()
        case.claim(reference, session)
        case.hook(session, "session-start", ago(minutes=30))
        case.hook(session, last, ago(minutes=20))
        case.seen(session, (NOW - delta).strftime("%Y-%m-%dT%H:%M:%SZ"))

    return build


def _subagent(started_after_restart: bool) -> _Build:
    def build(case: LiveWorkCase, reference: str) -> None:
        session = _session()
        case.claim(reference, session)
        case.hook(session, "session-start", ago(minutes=50))
        if started_after_restart:
            case.hook(session, "session-start", ago(minutes=40))
            case.hook(session, "subagent-start", ago(minutes=30), agent="a1")
        else:
            case.hook(session, "subagent-start", ago(minutes=40), agent="a1")
            case.hook(session, "session-start", ago(minutes=30))
        case.hook(session, "stop", ago(minutes=10))

    return build


def _subagent_across(source: str | None, *, turn_ended: bool = True) -> _Build:
    """A subagent of a session in a turn, then a session start with this `source`."""

    def build(case: LiveWorkCase, reference: str) -> None:
        session = _session()
        case.claim(reference, session)
        case.hook(session, "session-start", ago(minutes=50), source="startup")
        case.hook(session, "user-prompt-submit", ago(minutes=45))
        case.hook(session, "subagent-start", ago(minutes=40), agent="a1")
        if turn_ended:
            case.hook(session, "stop", ago(minutes=35))
        case.hook(session, "session-start", ago(minutes=30), source=source)

    return build


def _compacted_in_a_turn(case: LiveWorkCase, reference: str) -> None:
    """A context compacted while a turn runs: the turn goes on, and no prompt follows."""

    session = _session()
    case.claim(reference, session)
    case.hook(session, "session-start", ago(minutes=50), source="startup")
    case.hook(session, "user-prompt-submit", ago(minutes=14))
    case.hook(session, "pre-compact", ago(minutes=11))
    case.hook(session, "session-start", ago(minutes=10), source="compact")


def _compacted_after_a_turn(case: LiveWorkCase, reference: str) -> None:
    """A context compacted while nothing runs: the session goes on waiting."""

    session = _session()
    case.claim(reference, session)
    case.hook(session, "session-start", ago(minutes=50), source="startup")
    case.hook(session, "user-prompt-submit", ago(minutes=40))
    case.hook(session, "stop", ago(minutes=35))
    case.hook(session, "session-start", ago(minutes=30), source="compact")


def _started_again_since_a_restart(case: LiveWorkCase, reference: str) -> None:
    """A subagent continued after a restart: its row keeps its first start, and runs."""

    session = _session()
    case.claim(reference, session)
    case.hook(session, "session-start", ago(minutes=50), source="startup")
    case.hook(session, "subagent-start", ago(minutes=45), agent="a1")
    case.hook(session, "subagent-stop", ago(minutes=44), agent="a1")
    case.hook(session, "session-start", ago(minutes=40), source="resume")
    case.hook(session, "subagent-start", ago(minutes=30), agent="a1")
    case.hook(session, "stop", ago(minutes=10))


def _step_held_by_a_subagent(*, stopped: bool) -> _Build:
    """Its step taken before the prompt, so only the holder can make it move."""

    def build(case: LiveWorkCase, reference: str) -> None:
        session = _session()
        case.hook(session, "session-start", ago(minutes=30))
        case.hook(session, "subagent-start", ago(minutes=25), agent="a1")
        case.hold_step(reference, session, agent="a1")
        if stopped:
            case.hook(session, "subagent-stop", ago(minutes=15), agent="a1")
        case.hook(session, "user-prompt-submit", ago(minutes=10))

    return build


def _held_beside_written(case: LiveWorkCase, reference: str) -> None:
    """A claim of a session that stands on another item, and a step one at work holds."""

    claimer, stepper = _session(), _session()
    other = case.item()
    case.claim(reference, claimer)
    case.claim(other, claimer)
    case.hook(claimer, "user-prompt-submit", ago(minutes=12))
    case.comment(other, claimer)
    case.hook(stepper, "user-prompt-submit", ago(minutes=10))
    case.hold_step(reference, stepper)


def _step_held_by_a_person(case: LiveWorkCase, reference: str) -> None:
    case.hold_step(reference, None)


def _two_sessions(first_quiet: bool, second_event: str) -> _Build:
    """A claim by one session and a step by another."""

    def build(case: LiveWorkCase, reference: str) -> None:
        claimer, stepper = _session(), _session()
        case.claim(reference, claimer)
        case.hook(claimer, "session-start", ago(minutes=30))
        case.hook(claimer, "stop", ago(minutes=25))
        if first_quiet:
            case.seen(claimer, second(days=2))
        case.hold_step(reference, stepper)
        case.hook(stepper, "session-start", ago(minutes=20))
        case.hook(stepper, second_event, ago(minutes=10))

    return build


def _two_quiet(case: LiveWorkCase, reference: str) -> None:
    claimer, stepper = _session(), _session()
    case.claim(reference, claimer)
    case.hold_step(reference, stepper)
    case.seen(claimer, second(days=3))
    case.seen(stepper, second(days=2))


def _session_marked(status: str) -> _Build:
    def build(case: LiveWorkCase, reference: str) -> None:
        session = _session()
        case.claim(reference, session)
        case.hook(session, "user-prompt-submit", ago(minutes=10))
        case.conn.execute("UPDATE sessions SET status = ? WHERE id = ?", (status, session))

    return build


def _session_without_a_row(case: LiveWorkCase, reference: str) -> None:
    session = _session()
    case.claim(reference, session)
    case.conn.execute("DELETE FROM sessions WHERE id = ?", (session,))


def _claim_nobody_confirmed(case: LiveWorkCase, reference: str) -> None:
    service.claim_work_item(case.conn, reference, author="someone", move_state=False)


def _attempt(status: str) -> _Build:
    def build(case: LiveWorkCase, reference: str) -> None:
        case.attempt(reference, status)

    return build


def _unheld_comment(*events: str, comment_after: int) -> _Build:
    """A session that holds nothing here comments on the item among its own events.

    `comment_after` is how many of `events` come before the comment.
    """

    def build(case: LiveWorkCase, reference: str) -> None:
        session = _session()
        for index, event in enumerate(events):
            if index == comment_after:
                case.comment(reference, session)
            case.hook(session, event, ago(minutes=(len(events) - index) * 10))
        if comment_after >= len(events):
            case.comment(reference, session)

    return build


def _nothing(_case: LiveWorkCase, _reference: str) -> None:
    pass


WORKING = {"state": "working"}
HELD = {"state": "held"}
WAITING = {"state": "waiting", "long": False, "asks": False}
WAITING_LONG = {"state": "waiting", "long": True, "asks": False}
ASKS = {"state": "waiting", "long": False, "asks": True}

CASES: list[tuple[str, list[str] | None, _Build, dict | None]] = [
    (
        "a claim taken before the prompt",
        None,
        _claimed_then("session-start", "user-prompt-submit"),
        WORKING,
    ),
    ("a comment after the prompt", None, _written_after_the_prompt(), WORKING),
    ("a subagent's comment after the prompt", None, _written_after_the_prompt("a1"), WORKING),
    (
        "a comment on an item nobody holds, after the prompt",
        None,
        _unheld_comment("session-start", "user-prompt-submit", comment_after=2),
        WORKING,
    ),
    (
        "a comment on an item nobody holds, before the prompt",
        None,
        _unheld_comment("session-start", "user-prompt-submit", comment_after=1),
        None,
    ),
    (
        "a comment on an item nobody holds, then the turn ended",
        None,
        _unheld_comment("user-prompt-submit", "stop", comment_after=1),
        None,
    ),
    ("a claim after the turn ended", None, _claimed_then("user-prompt-submit", "stop"), WAITING),
    (
        "a claim after a notification",
        None,
        _claimed_then("user-prompt-submit", "notification"),
        ASKS,
    ),
    (
        "a resumed session with a claim and no prompt",
        None,
        _claimed_then("user-prompt-submit", "stop", "session-start"),
        WAITING,
    ),
    (
        "a subagent's own stop after its parent's prompt",
        None,
        _claimed_then(
            "session-start",
            "user-prompt-submit",
            agent_events=("subagent-start", "subagent-stop", "stop"),
        ),
        WORKING,
    ),
    ("a waiting session with a subagent started since", None, _subagent(True), WORKING),
    ("a waiting session with a subagent from before a restart", None, _subagent(False), WAITING),
    ("a subagent across a compaction", None, _subagent_across("compact"), WORKING),
    ("a subagent across a startup", None, _subagent_across("startup"), WAITING),
    ("a subagent across a resume", None, _subagent_across("resume"), WAITING),
    ("a subagent across a clear", None, _subagent_across("clear"), WAITING),
    ("a subagent across a fork", None, _subagent_across("fork"), WAITING),
    ("a subagent across a start with no source", None, _subagent_across(None), WAITING),
    ("a turn across a compaction", None, _compacted_in_a_turn, WORKING),
    ("a turn over, then a compaction", None, _compacted_after_a_turn, WAITING),
    ("a subagent started again since a restart", None, _started_again_since_a_restart, WORKING),
    ("a step a subagent holds", ["step"], _step_held_by_a_subagent(stopped=False), WORKING),
    ("a step a stopped subagent left", ["step"], _step_held_by_a_subagent(stopped=True), HELD),
    ("an attempt running with no session", None, _attempt("running"), WORKING),
    ("an attempt starting", None, _attempt("starting"), WORKING),
    ("an attempt that finished", None, _attempt("complete"), None),
    (
        "silent exactly a day, after a prompt",
        None,
        _silent_for(timedelta(days=1), "user-prompt-submit"),
        WAITING_LONG,
    ),
    (
        "silent exactly a day, after a stop",
        None,
        _silent_for(timedelta(days=1), "stop"),
        WAITING_LONG,
    ),
    (
        "silent a day and a second",
        None,
        _silent_for(timedelta(days=1, seconds=1), "user-prompt-submit"),
        {"state": "quiet", "quiet_since": second(days=1, seconds=1)},
    ),
    (
        "silent exactly the lease period",
        None,
        _silent_for(leases.LEASE_PERIOD, "user-prompt-submit"),
        {"state": "quiet", "quiet_since": second(days=14)},
    ),
    (
        "silent the lease period and a second",
        None,
        _silent_for(leases.LEASE_PERIOD + timedelta(seconds=1), "user-prompt-submit"),
        None,
    ),
    ("working beside quiet", ["step"], _two_sessions(True, "user-prompt-submit"), WORKING),
    ("waiting beside quiet", ["step"], _two_sessions(True, "stop"), WAITING),
    ("waiting beside working", ["step"], _two_sessions(False, "user-prompt-submit"), WORKING),
    ("held beside working", ["step"], _held_beside_written, WORKING),
    ("working beside waiting", ["step"], _written_beside_waiting, WORKING),
    (
        "two quiet sessions",
        ["step"],
        _two_quiet,
        {"state": "quiet", "quiet_since": second(days=2)},
    ),
    ("a session that ended", None, _session_marked("ended"), None),
    ("a session that failed", None, _session_marked("failed"), None),
    ("a session with no row", None, _session_without_a_row, None),
    ("a claim no session confirmed", None, _claim_nobody_confirmed, None),
    ("a step a person holds", ["step"], _step_held_by_a_person, None),
    ("nothing at all", None, _nothing, None),
]


class RuleTests(LiveWorkCase):
    def test_each_case_reads_as_the_rule_says(self) -> None:
        built = []
        for _name, steps, build, _expected in CASES:
            reference = self.item(steps)
            build(self, reference)
            built.append(reference)
        found = self.live()
        for (name, _steps, _build, expected), reference in zip(CASES, built, strict=True):
            with self.subTest(name):
                self.assertEqual(expected, found.get(self.identity(reference)))

    def test_a_finished_step_stands_for_nobody(self) -> None:
        reference = self.item(["step"])
        session = _session()
        self.hold_step(reference, session)
        self.hook(session, "user-prompt-submit", ago(minutes=2))
        self.assertEqual(WORKING, self.state_of(reference), "the one item its session holds")
        (step,) = service.get_work_item(self.conn, reference)["checklist"]
        with calls.bind(confirmed(session), "tick_work_item_checklist_item"):
            service.tick_checklist_item(self.conn, reference, step["id"])
        self.assertEqual(WORKING, self.state_of(reference), "the tick is a write of this turn")
        self.hook(session, "user-prompt-submit", ago(minutes=1))
        self.assertIsNone(self.state_of(reference), "the next turn finds nothing behind it")

    def test_one_session_moves_the_item_it_wrote_to_and_holds_the_other(self) -> None:
        written, other = self.item(), self.item()
        session = _session()
        self.claim(written, session)
        self.claim(other, session)
        self.hook(session, "user-prompt-submit", ago(minutes=10))
        self.comment(written, session)
        self.assertEqual(WORKING, self.state_of(written))
        self.assertEqual(HELD, self.state_of(other))
        self.hook(session, "stop", ago(minutes=5))
        self.assertEqual((WAITING, WAITING), (self.state_of(written), self.state_of(other)))
        self.hook(session, "user-prompt-submit", ago(minutes=1))
        self.assertEqual(
            (WORKING, HELD),
            (self.state_of(written), self.state_of(other)),
            "a new prompt finds it where it last wrote",
        )
        self.comment(other, session)
        self.assertEqual(
            (HELD, WORKING),
            (self.state_of(written), self.state_of(other)),
            "it stands on one item, the one it wrote to last",
        )

    def test_the_map_follows_the_items_order(self) -> None:
        references = [self.item() for _ in range(3)]
        for reference in reversed(references):
            self.attempt(reference, "running")
        self.assertEqual([self.identity(reference) for reference in references], list(self.live()))

    def test_a_space_with_no_live_session_reads_no_lifecycle(self) -> None:
        reference = self.item()
        session = _session()
        self.claim(reference, session)
        self.seen(session, second(days=2))
        statements: list[str] = []
        self.conn.set_trace_callback(statements.append)
        self.addCleanup(self.conn.set_trace_callback, None)
        found = live_work.live_work(self.conn, [service.get_work_item(self.conn, reference)])
        self.assertEqual(
            {"state": "quiet", "quiet_since": second(days=2)}, found[self.identity(reference)]
        )
        self.assertFalse(any("session_start" in statement for statement in statements))

    def test_no_items_and_no_space_read_an_empty_map(self) -> None:
        self.assertEqual({}, live_work.live_work(self.conn, []))
        self.conn.execute("DELETE FROM planning_spaces")
        self.assertEqual({}, views.planning_payload(self.conn)["live_work"])


class SubagentWorkTests(LiveWorkCase):
    """What a coordinator's live subagent is seen working on, whatever its parent's turn does."""

    def coordinator(self, *held: str) -> str:
        """A session holding these items, whose turn has ended."""

        session = _session()
        for reference in held:
            self.claim(reference, session)
        self.hook(session, "session-start", ago(minutes=59), source="startup")
        self.hook(session, "user-prompt-submit", ago(minutes=58))
        self.hook(session, "stop", ago(minutes=4))
        return session

    def subagent(self, session: str, agent: str, label: str = "") -> None:
        """A subagent running since three minutes ago, named by its launch when `label` says."""

        self.hook(session, "subagent-start", ago(minutes=3), agent=agent)
        if label:
            self.hook(
                session,
                "post-tool-use",
                ago(minutes=3),
                tool_name="Agent",
                tool_response={"agentId": agent},
                tool_input={"description": label},
            )

    def wake(self, session: str) -> None:
        """A subagent's notice wakes the coordinator: a new prompt, and its turn ends again."""

        self.hook(session, "user-prompt-submit", ago(minutes=1))
        self.hook(session, "stop", ago(seconds=30))

    def test_what_a_subagent_wrote_moves_past_its_parents_next_prompt(self) -> None:
        reference = self.item()
        session = self.coordinator(reference)
        self.subagent(session, "a1")
        self.comment(reference, session, "a1")
        self.wake(session)
        self.assertEqual(WORKING, self.state_of(reference))
        self.hook(session, "user-prompt-submit", ago(seconds=10))
        self.assertEqual(WORKING, self.state_of(reference), "in a turn of its parent as well")

    def test_what_a_subagent_wrote_stops_moving_when_it_stops(self) -> None:
        reference = self.item()
        session = self.coordinator(reference, self.item())
        self.subagent(session, "a1")
        self.subagent(session, "a2")
        self.comment(reference, session, "a1")
        self.hook(session, "subagent-stop", ago(seconds=50), agent="a1")
        self.wake(session)
        self.assertEqual(HELD, self.state_of(reference), "a2 runs and is not seen on it")

    def test_a_write_counts_from_the_subagents_last_start(self) -> None:
        reference = self.item()
        session = self.coordinator(reference, self.item())
        self.subagent(session, "a1")
        self.comment(reference, session, "a1")
        self.hook(session, "subagent-stop", ago(minutes=2), agent="a1")
        self.wake(session)
        self.hook(session, "subagent-start", ago(seconds=20), agent="a1")
        self.assertEqual(HELD, self.state_of(reference), "started again for something else")
        self.comment(reference, session, "a1")
        self.assertEqual(WORKING, self.state_of(reference))

    def test_a_step_a_subagent_holds_moves_past_its_parents_next_prompt(self) -> None:
        reference = self.item(["step"])
        session = self.coordinator(reference)
        self.subagent(session, "a1")
        self.hold_step(reference, session, agent="a1")
        self.wake(session)
        self.assertEqual(WORKING, self.state_of(reference))

    def test_a_label_moves_the_items_it_names_by_number_and_no_other(self) -> None:
        first, second_named, other = self.item(), self.item(), self.item()
        session = self.coordinator(first, second_named, other)
        self.subagent(session, "a1", f"build: both of them ({first}, {second_named})")
        self.assertEqual(
            (WORKING, WORKING, HELD),
            (self.state_of(first), self.state_of(second_named), self.state_of(other)),
        )

    def test_a_label_names_an_item_only_by_its_exact_number(self) -> None:
        item = self.item()
        self.assertEqual("LW-1", item)
        # Holding a second item, so holding this one alone does not move it.
        session = self.coordinator(item, self.item())
        for index, label in enumerate(
            (
                "the longer number LW-12",
                "lw-1 in small letters",
                "XLW-1 of another space",
                "a file LW-1.md",
                "in code `LW-1`",
                "at http://host/LW-1",
                # Cut to the label's limit in the middle of LW-123, so it reads LW-1.
                "x" * 114 + " LW-123",
            )
        ):
            with self.subTest(label):
                agent = f"a{index}"
                self.subagent(session, agent, label)
                self.assertEqual(HELD, self.state_of(item))
                self.hook(session, "subagent-stop", ago(seconds=1), agent=agent)

    def test_a_label_moves_an_item_nobody_holds(self) -> None:
        held, named = self.item(), self.item()
        session = self.coordinator(held)
        self.subagent(session, "a1", f"look at {named}")
        self.assertEqual((HELD, WORKING), (self.state_of(held), self.state_of(named)))

    def test_a_label_moves_nothing_once_its_subagent_stopped_or_was_cut_off(self) -> None:
        reference = self.item()
        session = self.coordinator(reference)
        self.subagent(session, "a1", f"build {reference}")
        self.assertEqual(WORKING, self.state_of(reference))
        self.hook(session, "subagent-stop", ago(seconds=50), agent="a1")
        self.assertEqual(WAITING, self.state_of(reference))
        self.hook(session, "subagent-start", ago(seconds=40), agent="a1")
        self.assertEqual(WORKING, self.state_of(reference))
        self.hook(session, "session-start", ago(seconds=20), source="resume")
        self.assertEqual(WAITING, self.state_of(reference))

    def test_a_coordinator_holding_many_moves_only_what_its_subagents_are_seen_on(self) -> None:
        references = [self.item(["step"]) for _ in range(17)]
        written, stepped, named, *others = references
        session = self.coordinator(*references)
        for agent, label in (("a1", ""), ("a2", ""), ("a3", f"build {named}"), ("a4", "tests")):
            self.subagent(session, agent, label)
        self.comment(written, session, "a1")
        self.hold_step(stepped, session, agent="a2")
        self.wake(session)
        self.assertEqual(
            (WORKING, WORKING, WORKING),
            (self.state_of(written), self.state_of(stepped), self.state_of(named)),
        )
        self.assertEqual([HELD] * 14, [self.state_of(reference) for reference in others])

    # -- a subagent with no write, step or label number, by the rest of the ladder --

    def packet(self, session: str, agent: str, reference: str) -> None:
        """What the usage reader found in that subagent's packet."""

        self.conn.execute(
            "INSERT INTO usage_runs(session_id, agent_id, client, path, packet_item)"
            " VALUES (?, ?, 'claude', 'x', ?)",
            (session, agent, self.identity(reference)),
        )

    def test_it_moves_the_one_item_its_parent_holds(self) -> None:
        reference = self.item()
        session = self.coordinator(reference)
        self.assertEqual(WAITING, self.state_of(reference))
        self.subagent(session, "a1", "tests")
        self.assertEqual(WORKING, self.state_of(reference))
        self.hook(session, "subagent-stop", ago(seconds=1), agent="a1")
        self.assertEqual(WAITING, self.state_of(reference))

    def test_two_items_held_move_neither(self) -> None:
        first, second = self.item(), self.item()
        session = self.coordinator(first, second)
        self.subagent(session, "a1", "tests")
        self.assertEqual((HELD, HELD), (self.state_of(first), self.state_of(second)))

    def test_an_item_held_in_another_space_counts_as_one_more(self) -> None:
        here = self.item()
        service.create_planning_space(self.conn, project_id="far", name="Far", key="FAR")
        there = service.create_work_item(self.conn, space="FAR", title="Far")
        session = self.coordinator(here)
        self.claim(str(there["reference"]), session)
        self.subagent(session, "a1", "tests")
        self.assertEqual(HELD, self.state_of(here))

    def test_the_first_number_of_its_packet_moves_that_item_whatever_the_parent_holds(self) -> None:
        first, second, third = self.item(), self.item(), self.item()
        session = self.coordinator(first, second, third)
        self.subagent(session, "a1", "tests")
        self.packet(session, "a1", second)
        self.assertEqual(
            (HELD, WORKING, HELD),
            (self.state_of(first), self.state_of(second), self.state_of(third)),
        )

    def test_a_packet_on_another_item_leaves_the_parents_only_item_still(self) -> None:
        held, other = self.item(), self.item()
        session = self.coordinator(held)
        self.subagent(session, "a1", "tests")
        self.packet(session, "a1", other)
        self.assertEqual((HELD, WORKING), (self.state_of(held), self.state_of(other)))

    def test_a_label_on_another_space_leaves_the_parents_only_item_still(self) -> None:
        held = self.item()
        service.create_planning_space(self.conn, project_id="far", name="Far", key="FAR")
        there = service.create_work_item(self.conn, space="FAR", title="Far")
        session = self.coordinator(held)
        self.subagent(session, "a1", f"build {there['reference']}")
        self.assertEqual(HELD, self.state_of(held))

    def test_a_write_elsewhere_leaves_the_parents_only_item_still(self) -> None:
        held, other = self.item(), self.item()
        session = self.coordinator(held)
        self.subagent(session, "a1", "tests")
        self.comment(other, session, "a1")
        self.assertEqual((HELD, WORKING), (self.state_of(held), self.state_of(other)))

    def test_its_own_step_elsewhere_leaves_the_parents_only_item_still(self) -> None:
        held, stepped = self.item(), self.item(["step"])
        session = self.coordinator(held)
        self.subagent(session, "a1", "tests")
        self.hold_step(stepped, session, agent="a1")
        self.assertEqual((HELD, WORKING), (self.state_of(held), self.state_of(stepped)))


class SilentSubagentTests(LiveWorkCase):
    """A subagent row stays `active` when its agent falls, and only its transcript can tell.

    The row moves only at the agent's start and stop, so the case starts it long ago
    and says through the transcript's time how long it has really been silent.
    """

    def setUp(self) -> None:
        super().setUp()
        directory = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.addCleanup(directory.cleanup)
        self.directory = directory.name
        self.reference = self.item()
        self.session = _session()
        self.claim(self.reference, self.session)
        self.hook(
            self.session,
            "session-start",
            ago(days=2),
            source="startup",
            transcript_path=os.path.join(self.directory, f"{self.session}.jsonl"),
        )

    def started(self, **delta: float) -> None:
        """The agent started that long ago, named by the item's number; its parent's turn ended."""

        self.hook(self.session, "subagent-start", ago(**delta), agent="a1")
        self.hook(
            self.session,
            "post-tool-use",
            ago(**delta),
            tool_name="Agent",
            tool_response={"agentId": "a1"},
            tool_input={"description": f"build {self.reference}"},
        )
        self.hook(self.session, "stop", ago(seconds=30))

    def transcript_written(self, delta: timedelta) -> None:
        folder = os.path.join(self.directory, self.session, "subagents")
        os.makedirs(folder)
        path = os.path.join(folder, "agent-a1.jsonl")
        with open(path, "w", encoding="utf-8"):
            pass
        written = (NOW - delta).timestamp()
        os.utime(path, (written, written))

    def test_a_subagent_silent_for_an_hour_in_a_long_step_still_runs(self) -> None:
        self.started(hours=5)
        self.transcript_written(timedelta(hours=1))
        self.assertEqual(WORKING, self.state_of(self.reference))

    def test_a_subagent_silent_up_to_the_limit_runs_and_past_it_does_not(self) -> None:
        self.started(hours=5)
        self.transcript_written(live_work.SUBAGENT_SILENT)
        self.assertEqual(WORKING, self.state_of(self.reference))
        path = os.path.join(self.directory, self.session, "subagents", "agent-a1.jsonl")
        written = (NOW - live_work.SUBAGENT_SILENT - timedelta(seconds=1)).timestamp()
        os.utime(path, (written, written))
        self.assertEqual(WAITING, self.state_of(self.reference), "its parent's turn has ended")

    def test_a_recent_start_outweighs_an_old_transcript(self) -> None:
        self.started(minutes=30)
        self.transcript_written(timedelta(hours=5))
        self.assertEqual(WORKING, self.state_of(self.reference))

    def test_with_no_transcript_only_a_day_since_its_start_stops_a_subagent(self) -> None:
        self.started(hours=23)
        self.assertEqual(WORKING, self.state_of(self.reference))
        self.hook(self.session, "subagent-stop", ago(seconds=20), agent="a1")
        self.assertEqual(WAITING, self.state_of(self.reference))

    def test_with_no_transcript_a_subagent_past_a_day_does_not_run(self) -> None:
        self.started(days=1, seconds=1)
        self.assertEqual(WAITING, self.state_of(self.reference))

    def test_a_fallen_subagent_leaves_its_parents_running_turn_as_it_was(self) -> None:
        self.started(hours=5)
        self.transcript_written(timedelta(hours=3))
        # The session went on to another item, so its own turn stands there.
        other = self.item()
        self.claim(other, self.session)
        self.hook(self.session, "user-prompt-submit", ago(seconds=10))
        self.assertEqual((HELD, WORKING), (self.state_of(self.reference), self.state_of(other)))


class TurnTests(LiveWorkCase):
    """A turn left open by a client that fell, or stopped by a notice, by the transcript's time.

    The session holds one item, so a turn of its own that runs makes that item `working`.
    """

    def setUp(self) -> None:
        super().setUp()
        directory = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.addCleanup(directory.cleanup)
        self.transcript = os.path.join(directory.name, "session.jsonl")
        self.reference = self.item()
        self.session = _session()
        self.claim(self.reference, self.session)
        self.hook(
            self.session,
            "session-start",
            ago(hours=6),
            source="startup",
            transcript_path=self.transcript,
        )

    def written(self, delta: timedelta) -> None:
        with open(self.transcript, "a", encoding="utf-8"):
            pass
        moment = (NOW - delta).timestamp()
        os.utime(self.transcript, (moment, moment))

    def state(self) -> dict | None:
        return self.state_of(self.reference)

    def test_a_turn_runs_up_to_the_limit_of_silence_and_past_it_does_not(self) -> None:
        self.hook(self.session, "user-prompt-submit", ago(hours=1))
        self.written(live_work.TURN_SILENT)
        self.assertEqual(WORKING, self.state())
        self.written(live_work.TURN_SILENT + timedelta(seconds=1))
        self.assertEqual(WAITING, self.state(), "its client fell, or it is in one long step")
        self.written(timedelta(seconds=5))
        self.assertEqual(WORKING, self.state(), "it wrote again, so it runs again")

    def test_a_prompt_within_the_limit_runs_whatever_the_transcript_says(self) -> None:
        self.written(timedelta(hours=3))
        self.hook(self.session, "user-prompt-submit", ago(minutes=15))
        self.assertEqual(WORKING, self.state())

    def test_with_no_transcript_file_a_turn_runs_while_the_session_is_heard_from(self) -> None:
        self.hook(self.session, "user-prompt-submit", ago(hours=3))
        self.assertEqual(WAITING, self.state(), "nothing heard since the prompt: it fell")
        self.seen(self.session, second(minutes=15))
        self.assertEqual(WORKING, self.state(), "a hook or a call of its own was heard")
        self.seen(self.session, second(minutes=15, seconds=1))
        self.assertEqual(WAITING, self.state())

    def test_a_notice_stops_the_turn_until_the_transcript_is_written_after_it(self) -> None:
        self.hook(self.session, "user-prompt-submit", ago(minutes=10))
        self.written(timedelta(minutes=5, seconds=6))
        self.hook(self.session, "notification", ago(minutes=5))
        self.assertEqual(ASKS, self.state(), "it asks a person, and nothing was written since")
        self.written(timedelta(minutes=5))
        self.assertEqual(ASKS, self.state(), "written in the notice's own second")
        self.written(timedelta(minutes=4))
        self.assertEqual(WORKING, self.state(), "the answer arrived and the turn went on")

    def test_a_turn_that_went_on_after_a_notice_falls_silent_like_any_other(self) -> None:
        self.hook(self.session, "user-prompt-submit", ago(hours=2))
        self.hook(self.session, "notification", ago(hours=1))
        self.written(live_work.TURN_SILENT + timedelta(seconds=1))
        self.assertEqual(WAITING, self.state(), "it went on, so it no longer asks")

    def test_a_notice_with_no_transcript_file_asks_until_the_next_prompt(self) -> None:
        self.hook(self.session, "user-prompt-submit", ago(minutes=10))
        self.hook(self.session, "notification", ago(minutes=5))
        self.assertEqual(ASKS, self.state())
        self.hook(self.session, "user-prompt-submit", ago(minutes=1))
        self.assertEqual(WORKING, self.state())

    def test_a_notice_after_the_turn_ended_opens_none(self) -> None:
        self.hook(self.session, "user-prompt-submit", ago(minutes=10))
        self.hook(self.session, "stop", ago(minutes=5))
        self.hook(self.session, "notification", ago(minutes=4))
        self.written(timedelta(minutes=1))
        self.assertEqual(WAITING, self.state(), "its turn is over: it asks nothing")

    def test_a_session_that_asks_and_has_a_live_subagent_is_at_work(self) -> None:
        self.hook(self.session, "user-prompt-submit", ago(minutes=10))
        self.hook(self.session, "subagent-start", ago(minutes=8), agent="a1")
        self.hook(self.session, "notification", ago(minutes=5))
        self.assertEqual(WORKING, self.state(), "its subagent is on the one item it holds")

    def test_asking_outdoes_a_wait_of_the_same_length_and_no_shorter_one(self) -> None:
        reference = self.item(["step"])
        asking, done = _session(), _session()
        self.claim(reference, done)
        self.hook(done, "user-prompt-submit", ago(minutes=10))
        self.hook(done, "stop", ago(minutes=5))
        self.hold_step(reference, asking)
        self.hook(asking, "user-prompt-submit", ago(minutes=10))
        self.hook(asking, "notification", ago(minutes=5))
        self.assertEqual(ASKS, self.state_of(reference))
        self.seen(asking, second(hours=5))
        self.assertEqual(WAITING, self.state_of(reference), "it has asked for too long")

    def test_waiting_is_long_past_four_hours_of_silence_and_not_at_them(self) -> None:
        self.hook(self.session, "user-prompt-submit", ago(hours=5))
        self.hook(self.session, "stop", ago(hours=4, minutes=30))
        self.seen(self.session, second(hours=4))
        self.assertEqual(WAITING, self.state())
        self.seen(self.session, second(hours=4, seconds=1))
        self.assertEqual(WAITING_LONG, self.state())

    def test_a_long_wait_is_weaker_than_a_short_one_and_stronger_than_quiet(self) -> None:
        reference = self.item(["step"])
        long, short, quiet = _session(), _session(), _session()
        self.claim(reference, quiet)
        self.seen(quiet, second(days=2))
        self.hold_step(reference, long)
        self.hook(long, "stop", ago(hours=5))
        self.assertEqual(WAITING_LONG, self.state_of(reference))
        other = self.item(["step"])
        self.claim(other, long)
        self.hold_step(other, short)
        self.hook(short, "stop", ago(minutes=5))
        self.assertEqual(WAITING, self.state_of(other))


class StoreAgeTests(unittest.TestCase):
    """A store an earlier build wrote lacks what the map asks for, and reads empty."""

    def old_store(self, *, claim_column: bool, parent_column: bool) -> sqlite3.Connection:
        conn = sqlite3.connect(":memory:")
        conn.row_factory = sqlite3.Row
        self.addCleanup(conn.close)
        claim = ", claim_call_id INTEGER" if claim_column else ""
        parent = (
            ", parent_session_id TEXT NOT NULL DEFAULT '', agent_id TEXT, label TEXT"
            if parent_column
            else ""
        )
        conn.executescript(
            f"CREATE TABLE work_items(work_item_id TEXT, claim_ref TEXT{claim});"
            f"CREATE TABLE sessions(id TEXT, status TEXT, last_seen TEXT, started_at TEXT,"
            f" transcript_path TEXT{parent});"
            "CREATE TABLE execution_events(id INTEGER, kind TEXT, session_id TEXT, agent_id TEXT,"
            " identity_state TEXT, occurred_at TEXT, received_at TEXT, work_item_id TEXT,"
            " source TEXT);"
            "CREATE TABLE executions(work_item_id TEXT, status TEXT);"
            "CREATE TABLE usage_runs(session_id TEXT, agent_id TEXT, packet_item TEXT);"
            "INSERT INTO work_items(work_item_id, claim_ref) VALUES ('w', '');"
        )
        conn.execute("INSERT INTO executions VALUES ('w', 'running')")
        return conn

    def test_a_store_without_the_claim_call_or_the_parent_session_reads_empty(self) -> None:
        items = [{"work_item_id": "w", "checklist": []}]
        for claim_column, parent_column in ((False, False), (False, True), (True, False)):
            with self.subTest(claim=claim_column, parent=parent_column):
                conn = self.old_store(claim_column=claim_column, parent_column=parent_column)
                self.assertEqual({}, live_work.live_work(conn, items))

    def test_the_same_store_with_both_columns_reads_its_attempt(self) -> None:
        conn = self.old_store(claim_column=True, parent_column=True)
        items = [{"work_item_id": "w", "checklist": []}]
        self.assertEqual({"w": {"state": "working"}}, live_work.live_work(conn, items))

    def test_a_store_without_attempts_reads_empty(self) -> None:
        conn = self.old_store(claim_column=True, parent_column=True)
        conn.execute("DROP TABLE executions")
        items = [{"work_item_id": "w", "checklist": []}]
        self.assertEqual({}, live_work.live_work(conn, items))


class StreamTests(LiveWorkCase):
    def test_a_frame_is_written_when_the_map_changes_and_only_then(self) -> None:
        reference = self.item()
        session = _session()
        self.claim(reference, session)
        self.hook(session, "session-start", ago(minutes=30))
        frames = EventFrames(clock=lambda: 0.0)

        def frame() -> bytes | None:
            return frames.frame(json.dumps(views.planning_payload(self.conn, space=SPACE)))

        self.assertIsNotNone(frame())
        self.hook(session, "pre-compact", ago(minutes=20))
        self.assertIsNone(frame(), "an event that changes no state writes no frame")
        self.hook(session, "user-prompt-submit", ago(minutes=10))
        written = frame()
        self.assertIsNotNone(written)
        self.assertIn(b'"live_work": {"', written or b"")
        self.hook(session, "pre-compact", ago(minutes=5))
        self.assertIsNone(frame(), "a working session's heartbeat writes no frame")


class CostTests(LiveWorkCase):
    def test_a_space_of_1400_items_costs_seven_reads(self) -> None:
        bulk_items(self.conn, SPACE, 1400)
        claimed, stepped = self.item(), self.item(["step"])
        working, waiting = _session(), _session()
        self.claim(claimed, working)
        self.hook(working, "session-start", ago(minutes=30))
        self.hook(working, "subagent-start", ago(minutes=20), agent="a1")
        self.hook(working, "user-prompt-submit", ago(minutes=10))
        self.comment(claimed, working, "a1")
        self.hold_step(stepped, waiting)
        self.hook(waiting, "stop", ago(minutes=10))
        self.attempt(stepped, "running")
        inside: list[bool] = [False]
        statements: list[str] = []
        original = live_work.live_work

        def measured(conn: sqlite3.Connection, items: object) -> dict[str, dict]:
            inside[0] = True
            try:
                return original(conn, items)  # type: ignore[arg-type]
            finally:
                inside[0] = False

        def trace(text: str) -> None:
            # SQLite traces what one statement runs inside it, such as the
            # table a `pragma_table_info` reads, as `-- ...`: part of that read.
            if inside[0] and not text.startswith("--"):
                statements.append(text)

        self.conn.set_trace_callback(trace)
        self.addCleanup(self.conn.set_trace_callback, None)
        with mock.patch.object(live_work, "live_work", measured):
            found = views.planning_payload(self.conn, space=SPACE)["live_work"]

        self.assertEqual({self.identity(claimed): WORKING, self.identity(stepped): WORKING}, found)
        self.assertLessEqual(len(statements), 7, statements)
        self.assertTrue(any("'session_start'" in text for text in statements), statements)


if __name__ == "__main__":
    unittest.main()
