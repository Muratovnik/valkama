"""What a launch owes the work item it runs.

The runner owns process shape and nothing else: it can spawn a client, say a
process ended and with which exit code, but not what any of that means for the
work. This module is the other half — it claims the item before the process
exists, starts it, records the session that carries the attempt, and when the
process ends pays out a session status, a note, and a transition the workflow is
allowed to refuse.

The attempt itself is now a row, written before the process exists. That order
is the point: a client that mints its own session identity announces it only
once it has started speaking, so an execution created afterwards could be
matched to its session by nothing better than time. Created first, the identity
travels into the child in its environment and is read back out.

A resume still reads the exact client session the previous launch linked to its
attempt rather than searching for one that looks related; correlating an attempt
to a task by anything less exact stays forbidden.
"""

from __future__ import annotations

import contextlib
import json
import sqlite3
import sys
from dataclasses import dataclass
from datetime import UTC, datetime

from .. import runner, sessions
from ..planning import calls as planning_calls
from ..planning import deferral as planning_deferral
from ..planning import item_projects
from ..planning import model as planning_model
from ..planning import service as planning_service
from ..sessions import op_ingest_session_event
from . import results
from . import service as execution_service
from .drivers import capabilities_for


def launch_work_item(conn: sqlite3.Connection, payload: dict) -> dict:
    """Start a work item on an agent: claim it, spawn the client, record it.

    The claim is taken in the store before the process exists, so a launch
    cannot hand the same item to two agents even when two people press the
    button at the same moment.
    """

    reference = str(payload.get("work_item") or "")
    packet = runner.validate_packet(payload)
    launcher = runner.RUNNER
    with launcher.reserve(reference) as reservation:
        return _launch_reserved(conn, payload, reference, packet, launcher, reservation)


def _launch_reserved(
    conn: sqlite3.Connection,
    payload: dict,
    reference: str,
    packet: runner.LaunchPacket,
    launcher: runner.Runner,
    reservation: object,
) -> dict:
    """Persist and spawn while this process owns the item reservation."""

    actor = f"{packet.client}:{packet.role}"
    # A reference is `KEY-NUMBER`, so its prefix is the space key exactly; the
    # runner wants that key for the launch environment it hands the client.
    space_key = _reference_parts(reference)[0]

    # The attempt exists before the process does: evidence about a launch has to
    # be taken from before the launch. The claim, move and attempt must commit
    # together, so an attempt-insert failure cannot strand an active item.
    execution_id = execution_service.new_execution_id()
    try:
        conn.execute("BEGIN IMMEDIATE")
        record = planning_service.get_work_item(conn, reference)
        # Nobody works a goal or a stage: it is refused before its state is read,
        # since an accepted open one shows none, with the refusal every claim gives.
        if record["kind"] in ("goal", "stage"):
            raise planning_model.container_unheld()
        resume_session_id = _resumable_session(conn, record, packet.client) if packet.resume else ""
        state_before = str(record["state"]["key"])
        # The claim as it stood, with the call that took it: a launch that never
        # started puts it back as it was, confirmed or not.
        claim_before = planning_service.claim_of(conn, reference)
        # Put off, the item stands on a condition the claim below takes away with the
        # move out; a launch that never started puts it back with the state.
        deferred_before = planning_service.deferral_of(conn, reference)
        assigned = runner.session_identity(packet, resume_session_id)
        launch_id = runner.new_launch_id()
        session = _LaunchSession.of(conn, packet, assigned or launch_id)
        # The reservation proves no launch of this item runs here any more, so an
        # earlier launch's claim is this one's to take over, though its end awaits
        # the next reap and its session still reads live.
        earlier = (record.get("claim") or {}).get("source") == planning_calls.LAUNCH
        with session.proving():
            planning_service.claim_work_item(
                conn,
                reference,
                author=actor,
                force=bool(payload.get("force")) or earlier,
                start_reason="launched",
            )
        session.open(conn)
        launched = planning_service.get_work_item(conn, reference)
        execution_service.open_execution(
            conn,
            execution_id=execution_id,
            work_item_id=str(record["work_item_id"]),
            project_id=_project_id(conn, str(record["work_item_id"])),
            packet=packet.as_dict(),
            adapter_lineage_id=capabilities_for(packet.client).adapter_lineage_id,
        )
        conn.commit()
    except Exception:
        conn.rollback()
        raise

    try:
        # The same rule applied to the checkout, which is why it is resolved
        # here and not left to the spawn: for a worktree environment the client
        # edits a sibling checkout, so a baseline read from `packet.repo` would
        # describe a directory nobody touches — and the reap measures the change
        # against the one that was edited. On a worktree's first launch the two
        # agree by accident; on a reused or diverged one they do not. Resolved,
        # then read, then handed to the runner so all three name one directory.
        # The roots beside it are read too, the ones this run passes the client:
        # an attempt may change only one of them.
        directory = runner.launch_directory(packet, reference)
        added = _added_roots(conn, str(record["work_item_id"]), packet)
        execution_service.record_baseline(
            conn, execution_id, execution_service.observe_baseline(directory[0], added)
        )
        conn.commit()
    except Exception as error:
        # Baseline preparation can fail outside LaunchError (for example Git or
        # SQLite). No process exists yet. Discard any partial baseline write
        # before compensation starts its own guarded transaction.
        conn.rollback()
        _restore(
            conn,
            reference,
            state_before,
            claim_before,
            launched,
            actor,
            execution_id,
            error,
            session,
            deferred=deferred_before,
        )
        raise

    try:
        started = launcher.launch(
            reference,
            payload,
            space_key,
            resume_session_id,
            execution_id=execution_id,
            correlation=_correlation(conn, execution_id, record),
            directory=directory,
            reservation=reservation,
            added_dirs=[root["root"] for root in added],
            session_id=assigned,
            launch_id=launch_id,
        )
    except runner.LaunchError as error:
        # A process that never started must not leave a phantom executor or a
        # false move into an active state. The launch-owned revision decides
        # whether restoring the prior state and claim is still safe.
        _restore(
            conn,
            reference,
            state_before,
            claim_before,
            launched,
            actor,
            execution_id,
            error,
            session,
            deferred=deferred_before,
        )
        raise

    session_identity = session.session_id
    # The ingest opens its own transaction, so it runs before any statement
    # here leaves one open: sqlite3 refuses a nested BEGIN.
    op_ingest_session_event(
        conn,
        {
            "session_id": session_identity,
            "client": packet.client,
            "event": "session_start",
            "cwd": started["cwd"],
            "label": f"{reference} {record['title']}"[:200],
            "work_item": reference,
            "detail": {
                "role": packet.role,
                "environment": packet.environment,
                "expected_effect": packet.expected_effect,
                "review_mode": packet.review_mode,
                "interface_version": packet.interface_version,
                "launch_id": started["launch_id"],
                "resumed_from": started["resumed_from"],
            },
        },
    )
    execution_service.mark_running(
        conn,
        execution_id,
        launch_id=started["launch_id"],
        cwd=started["cwd"],
        resumed_from=resume_session_id,
    )
    execution_service.link_session(
        conn,
        execution_id,
        session_identity,
        "resumed" if resume_session_id else "launched",
    )
    planning_service.attach_ref(
        conn,
        reference,
        "session",
        session_identity,
        label=f"{packet.client} {packet.role}",
        author=actor,
    )
    planning_service.comment_work_item(
        conn, reference, _start_note(packet, started, resume_session_id), author=actor
    )
    conn.commit()
    return started


def _added_roots(
    conn: sqlite3.Connection, work_item_id: str, packet: runner.LaunchPacket
) -> list[item_projects.AddedRoot]:
    """The roots this run passes its client beside the one it runs in
    (`item_projects.added_roots`): none on a run its driver takes none on, such
    as a Codex resume."""

    if not capabilities_for(packet.client).takes_added_dirs(resume=packet.resume):
        return []
    return item_projects.added_roots(conn, work_item_id)


def _project_id(conn: sqlite3.Connection, work_item_id: str) -> str:
    """The project of the root a launch from this item runs in, or an empty string
    when no project is chosen or known (`item_projects.launch_root`)."""

    return item_projects.launch_root(conn, work_item_id)["project_id"] or ""


def _correlation(conn: sqlite3.Connection, execution_id: str, record: dict) -> dict[str, str]:
    """The exact identities a spawned client should stamp on whatever it exports.

    Named in OpenTelemetry's resource-attribute form because that is where they
    go. There is no installation attribute: this build has no installation
    identity, and inventing one here would put a value in every exported trace
    that nothing else in the product could resolve.
    """

    return {
        "valkama.execution.id": execution_id,
        "valkama.project.id": _project_id(conn, str(record["work_item_id"])),
        "valkama.planning_space.id": str(record["planning_space_id"]),
        "valkama.work_item.id": str(record["work_item_id"]),
        "valkama.work_item.reference": str(record["reference"]),
    }


def stop_work_item(conn: sqlite3.Connection, reference: str) -> dict:
    """Stop a launch this platform owns; the item keeps its claim and history."""

    stopped = runner.RUNNER.stop(reference)
    recorded = False
    if stopped.get("execution_id"):
        # `cancelled` whether or not the process was still alive: either the
        # owner ended it, or it had already ended without being reaped, and in
        # neither case did the attempt deliver a verdict of its own. Unless a
        # reap got there first — then the attempt already has a real verdict,
        # the guarded close refuses, and this says so rather than overwriting it.
        recorded = execution_service.close_execution(
            conn,
            str(stopped["execution_id"]),
            status="cancelled",
            outcome="cancelled",
            exit_code=stopped.get("exit_code"),
            result={
                "outcome": "cancelled",
                "delivery": "",
                "oracle": "stopped from the platform before the client reported",
                "unresolved": "whatever the attempt had already changed is in the checkout",
                "structured": False,
            },
            final_artifact=execution_service.observe_outcome(
                str(stopped.get("cwd") or ""), _base_artifact(conn, str(stopped["execution_id"]))
            )
            if stopped.get("cwd")
            else None,
        )
        conn.commit()
    for session_id in _ended_sessions(stopped):
        op_ingest_session_event(
            conn,
            {
                "session_id": session_id,
                "client": "runner",
                "event": "session_end",
                "status": "stopped" if stopped["stopped"] else "ended",
            },
        )
    note = (
        "launch stopped from the platform"
        if stopped["stopped"]
        else f"launch had already ended (exit {stopped.get('exit_code')})"
    )
    if stopped.get("execution_id") and not recorded:
        note += "; its attempt was already recorded and was left as it stood"
    planning_service.comment_work_item(conn, reference, note, author="runner")
    conn.commit()
    return stopped


def reap_launches(conn: sqlite3.Connection) -> list[dict]:
    """Record every launch that ended: its session status and a note on its item.

    One launch per pass of the loop, isolated. Every item in `ended` has already
    been handed over by the runner and is gone from its registry, so nothing will
    offer it again: an exception on the third of five used to take the other two
    with it, leaving rows that said `running` for processes that had finished.
    Now a failure is confined to the attempt it happened on, and even that one is
    given its verdict where the store will still take it.
    """

    ended = runner.RUNNER.reap()
    for item in ended:
        try:
            _record_ending(conn, item)
        except Exception as failure:  # noqa: BLE001 -- one item's failure is not the batch's
            _report_ending_failure(conn, item, failure)
    return ended


def _record_ending(conn: sqlite3.Connection, item: dict) -> None:
    """Everything one finished launch owes its work item."""

    result = item["result"]
    reference = str(item["reference"])
    failed = result["outcome"] in results.FAILED_OUTCOMES
    for session_id in _ended_sessions(item):
        op_ingest_session_event(
            conn,
            {
                "session_id": session_id,
                "client": item["client"],
                "event": "session_end",
                "work_item": reference,
                "status": "error" if failed else result["outcome"],
                "detail": {
                    "exit_code": item["exit_code"],
                    "launch_id": item["launch_id"],
                    "outcome": result["outcome"],
                    "expected_effect": result["expected_effect"],
                    "structured": result["structured"],
                },
            },
        )
    if item["client_session_id"]:
        planning_service.attach_ref(
            conn,
            reference,
            "session",
            item["client_session_id"],
            label=f"{item['client']} exact task",
            author="runner",
        )
    if item.get("execution_id"):
        execution_id = str(item["execution_id"])
        # The identity a client mints arrives on its own output, so this is
        # the first moment a Codex attempt can be bound to the client's own
        # session, the one a resume reattaches to (`_resumable_session`); the
        # session the launch ran under was linked at its start. The link is
        # idempotent, so a client that assigned its identity up front is
        # simply linked once.
        execution_service.link_session(
            conn, execution_id, str(item["client_session_id"] or ""), "launched"
        )
        execution_service.close_execution(
            conn,
            execution_id,
            status=execution_service.status_for_outcome(result["outcome"]),
            outcome=result["outcome"],
            exit_code=item["exit_code"],
            result=result,
            final_artifact=execution_service.observe_outcome(
                str(item.get("cwd") or ""), _base_artifact(conn, execution_id)
            ),
        )
        conn.commit()
    # The ending moves nothing. Work goes to review only with the question of what the
    # owner is to check, which the agent that did it asks; the result contract tells it
    # so. A task the agent left at work waits for its lease to lapse, with this note.
    planning_service.comment_work_item(
        conn, reference, _note(item, result, failed), author="runner"
    )
    conn.commit()  # finish this attempt before the next session-end ingest


def _ended_sessions(item: dict) -> list[str]:
    """The sessions a launch's end ends, from what the runner handed over.

    The session the launch ran under from its start (`session_id`), whose end its
    claim's lease follows; and the client's own when it announced a different one
    as it ran, because the process that ran it ended too. Nothing a claim reads
    follows the second.
    """

    named = (str(item.get("session_id") or ""), str(item.get("client_session_id") or ""))
    return [session_id for session_id in dict.fromkeys(named) if session_id]


def _report_ending_failure(conn: sqlite3.Connection, item: dict, failure: BaseException) -> None:
    """Say that a finished launch could not be recorded, and still close its row.

    Two things, in the order they can be trusted. The report goes to stderr
    because this runs on the watcher thread, which has no caller to return to
    and no logger — the same place the listener says its build is missing. Then
    the attempt is given the verdict the runner already reached, so a process
    that really ended does not leave a row claiming to be live for the rest of
    the platform's life. That second part is itself best-effort: whatever refused
    the record may refuse this too, and a failure here is not worth taking the
    remaining launches down for.
    """

    reference = str(item.get("reference") or "")
    print(  # noqa: T201
        f"warning: could not record the ending of launch {item.get('launch_id')!r}"
        f" on {reference}: {type(failure).__name__}: {failure}",
        file=sys.stderr,
    )
    execution_id = str(item.get("execution_id") or "")
    if not execution_id:
        return
    result = item["result"]
    with contextlib.suppress(Exception):
        conn.rollback()
        execution_service.close_execution(
            conn,
            execution_id,
            status=execution_service.status_for_outcome(result["outcome"]),
            outcome=result["outcome"],
            exit_code=item["exit_code"],
            result=result,
        )
        conn.commit()


def _base_artifact(conn: sqlite3.Connection, execution_id: str) -> dict | None:
    """The checkout this attempt started from, so its change is measured from there."""

    row = conn.execute(
        "SELECT base_artifact_json FROM executions WHERE execution_id = ?",
        (execution_id,),
    ).fetchone()
    if row is None or not row[0]:
        return None
    try:
        record = json.loads(str(row[0]))
    except json.JSONDecodeError:
        return None
    return record if isinstance(record, dict) else None


def _resumable_session(conn: sqlite3.Connection, record: dict, client: str) -> str:
    """The exact client session a resume must reattach to, or a refusal.

    This reads the client's session the previous launch linked to its attempt
    (`execution_service.resumable_session`), never the launch's own id; it does
    not search for a session that merely looks related. A launch with no such
    link cannot be resumed, which is the honest answer.
    """

    found = execution_service.resumable_session(conn, str(record["work_item_id"]), client)
    if found is None:
        raise runner.LaunchError(
            f"{record['reference']} has no exact resumable {client} session;"
            " heuristic task correlation is forbidden"
        )
    return found


def _restore(
    conn: sqlite3.Connection,
    reference: str,
    state: str,
    claim: planning_service.PriorClaim | None,
    launched: dict,
    actor: str,
    execution_id: str,
    error: BaseException,
    session: _LaunchSession,
    *,
    deferred: planning_deferral.Held | None = None,
) -> None:
    """Compensate only the unchanged launch-owned item, with the write lock held.

    A claim the launch took over goes back with the call that took it, so it is
    as confirmed as it was. The launch's own release is made in the launch's call,
    since only the session its claim names holds it; a session the claim opened is
    ended, because its process never ran. An item the launch took out of deferred
    goes back with `deferred`, the condition it stood there on.
    """

    conn.execute("BEGIN IMMEDIATE")
    try:
        current = planning_service.get_work_item(conn, reference)
        owned = (
            current["revision"] == launched["revision"]
            and current["state"]["state_id"] == launched["state"]["state_id"]
            and current["claim_ref"] == launched["claim_ref"] == actor
        )
        if owned:
            restored = planning_service.put_back_after_launch(
                conn,
                reference,
                state,
                author=actor,
                expected_revision=int(launched["revision"]),
                deferred=deferred,
                claim=claim,
            )
            # The state was put back above, so the release may not move it: it
            # would requeue it. A move out of work has already let the launch's
            # claim go, and a second release would only write a second, empty
            # `released`.
            if claim is None and restored["claim_ref"] == actor:
                with session.proving():
                    planning_service.claim_work_item(
                        conn,
                        reference,
                        author=actor,
                        release=True,
                        expected_revision=int(restored["revision"]),
                        move_state=False,
                    )
        session.close_unstarted(conn)
        unresolved = (
            "nothing ran; the prior state and claim were restored"
            if owned
            else "nothing ran; work item changed after launch, so its current state and claim were kept"
        )
        execution_service.close_execution(
            conn,
            execution_id,
            status="failed",
            outcome="launch_failed",
            result={
                "outcome": "launch_failed",
                "delivery": "",
                "oracle": f"the client never started: {error}",
                "unresolved": unresolved,
                "structured": False,
            },
        )
        note = f"launch_failed: {error}"
        if not owned:
            note += "; compensation skipped because the work item changed after launch"
        planning_service.comment_work_item(conn, reference, note, author=actor)
        conn.commit()
    except Exception:
        conn.rollback()
        raise


@dataclass(frozen=True)
class _LaunchSession:
    """The session a launch's claim names, and whether the claim opened it.

    The launch proves that session (`calls.launch`), so the claim is a lease of
    it, live while it runs and released `leases.ENDED_GRACE` after it ends, and the
    session opens and ends under that one id. It is the client's identity when the
    launch knows it before the process exists, assigned or resumed
    (`runner.session_identity`); on a fresh run of a client that announces its own
    once it runs, it is the launch's id (`runner.new_launch_id`), and the identity
    the client announces is linked to the attempt for a resume and holds nothing.
    """

    session_id: str
    client: str
    #: Whether the session was not open before the claim: the launch opened it, so a
    #: launch that never started ends it again.
    opens: bool

    @classmethod
    def of(
        cls, conn: sqlite3.Connection, packet: runner.LaunchPacket, session_id: str
    ) -> _LaunchSession:
        row = conn.execute("SELECT status FROM sessions WHERE id = ?", (session_id,)).fetchone()
        opens = row is None or row[0] != "active"
        return cls(session_id, packet.client, opens)

    def proving(self) -> contextlib.AbstractContextManager[None]:
        """Make the writes inside this block the launch's call for its session."""

        return planning_calls.bind(planning_calls.launch(self.session_id, self.client), _TOOL)

    def open(self, conn: sqlite3.Connection) -> None:
        """Open the session in the claim's transaction, so the claim reads `live` from the start.

        A resumed session that ended or failed would read `stale`, and the sweep could
        release the claim before the process exists; `session_start` records the
        start itself once it runs.
        """

        if self.opens:
            sessions.transition(conn, self.session_id, "start", at=_now(), client=self.client)

    def close_unstarted(self, conn: sqlite3.Connection) -> None:
        """End the session this launch opened and never ran."""

        if self.opens:
            sessions.transition(conn, self.session_id, "end", at=_now())


#: The tool a launch's own call is recorded under.
_TOOL = "launch_work_item"


def _now() -> str:
    return datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def _start_note(packet: runner.LaunchPacket, started: dict, resumed_from: str) -> str:
    """What a launch looks like to somebody reading the item afterwards."""

    note = (
        f"launched on {packet.client} as {packet.role} in {packet.environment}"
        f" ({started['cwd']}); expected_effect={packet.expected_effect}"
    )
    if resumed_from:
        note += f"; resumed exact session {resumed_from}"
    if started["warnings"]:
        note += "\nwarnings: " + "; ".join(started["warnings"])
    return note


def _reference_parts(reference: str) -> tuple[str, int]:
    space_key, number = reference.split("-", 1)
    return space_key, int(number)


def _note(item: dict, result: dict, failed: bool) -> str:
    """The runner's verdict as one readable note, each part bounded."""

    note = (
        f"launch outcome={result['outcome']} exit_code={item['exit_code']}"
        f" structured={str(result['structured']).lower()}"
    )
    for label in ("delivery", "oracle", "unresolved"):
        if result[label]:
            note += f"\n{label}: {result[label][:1000]}"
    if result["review_verdict"]:
        note += f"\nreview verdict: {result['review_verdict']}"
    if result["dispositions"]:
        note += (
            "\ndispositions: "
            + json.dumps(result["dispositions"], ensure_ascii=False, separators=(",", ":"))[:1000]
        )
    if failed and item["detail"]:
        note += f"\nclient detail: {item['detail']}"
    return note


__all__ = ["launch_work_item", "reap_launches", "stop_work_item"]
