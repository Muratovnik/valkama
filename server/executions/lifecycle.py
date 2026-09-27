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

A resume still reads the exact session row the previous launch wrote rather than
searching for one that looks related; correlating an attempt to a task by
anything less exact stays forbidden.
"""

from __future__ import annotations

import contextlib
import json
import sqlite3
import sys

from .. import runner
from ..planning import model as planning_model
from ..planning import service as planning_service
from ..sessions import op_ingest_session_event
from . import service as execution_service
from .drivers import capabilities_for

#: An accepted delivery moves to the first state a review happens in. It is not
#: a terminal state: the work has finished being written, not finished being
#: checked, and a terminal state needs a summary the runner cannot write.
_REVIEW_CATEGORY = "review"
#: A launch runs from a state somebody works inside, so that is the only place a
#: reaped launch may move an item from, and the place a starting launch moves an
#: item to when it was merely queued.
_ACTIVE_CATEGORY = "active"
#: The categories a launch is allowed to start an item out of.
_STARTABLE_CATEGORIES = ("backlog", "queued")


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
        resume_session_id = _resumable_session(conn, record, packet.client) if packet.resume else ""
        state_before = str(record["state"]["key"])
        claim_before = str(record["claim_ref"] or "")
        planning_service.claim_work_item(
            conn, reference, author=actor, force=bool(payload.get("force"))
        )
        if record["state"]["category"] in _STARTABLE_CATEGORIES:
            started_state = _first_state(conn, record, _ACTIVE_CATEGORY)
            if started_state is not None:
                planning_service.transition_work_item(
                    conn, reference, started_state, author=actor, reason="launched"
                )
        launched = planning_service.get_work_item(conn, reference)
        execution_service.open_execution(
            conn,
            execution_id=execution_id,
            work_item_id=str(record["work_item_id"]),
            project_id=_project_id(conn, str(record["planning_space_id"])),
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
        directory = runner.launch_directory(packet, reference)
        execution_service.record_baseline(
            conn, execution_id, execution_service.observe_baseline(directory[0])
        )
        conn.commit()
    except Exception as error:
        # Baseline preparation can fail outside LaunchError (for example Git or
        # SQLite). No process exists yet. Discard any partial baseline write
        # before compensation starts its own guarded transaction.
        conn.rollback()
        _restore(conn, reference, state_before, claim_before, launched, actor, execution_id, error)
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
        )
    except runner.LaunchError as error:
        # A process that never started must not leave a phantom executor or a
        # false move into an active state. The launch-owned revision decides
        # whether restoring the prior state and claim is still safe.
        _restore(conn, reference, state_before, claim_before, launched, actor, execution_id, error)
        raise

    session_identity = started["client_session_id"] or started["launch_id"]
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


def _project_id(conn: sqlite3.Connection, planning_space_id: str) -> str:
    """Which project this space belongs to, or an empty string when none does."""

    row = conn.execute(
        "SELECT project_id FROM planning_spaces WHERE planning_space_id = ?",
        (planning_space_id,),
    ).fetchone()
    return str(row[0] or "") if row is not None else ""


def _correlation(conn: sqlite3.Connection, execution_id: str, record: dict) -> dict[str, str]:
    """The exact identities a spawned client should stamp on whatever it exports.

    Named in OpenTelemetry's resource-attribute form because that is where they
    go. There is no installation attribute: this build has no installation
    identity, and inventing one here would put a value in every exported trace
    that nothing else in the product could resolve.
    """

    return {
        "valkama.execution.id": execution_id,
        "valkama.project.id": _project_id(conn, str(record["planning_space_id"])),
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
    op_ingest_session_event(
        conn,
        {
            "session_id": stopped.get("client_session_id")
            or stopped.get("launch_id")
            or f"launch-unknown-{reference}",
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
    """Record every launch that ended: session status, a note, and a review move.

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
    failed = result["outcome"] in ("launch_failed", "refused")
    accepted = result["outcome"] in ("complete", "expected_no_change")
    session_identity = item["client_session_id"] or item["launch_id"]
    op_ingest_session_event(
        conn,
        {
            "session_id": session_identity,
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
        # the first moment a Codex attempt can be bound to its session. The
        # link is idempotent, so a client that assigned its identity up
        # front is simply linked once.
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
    planning_service.comment_work_item(
        conn, reference, _note(item, result, failed), author="runner"
    )
    conn.commit()  # the transition below starts its own
    if accepted:
        conn.execute("BEGIN IMMEDIATE")
        try:
            # A completed launch may be reaped after a newer launch has already
            # started on the same item. Its delivery closes its own attempt,
            # but must not move the newer attempt's active work to review.
            work_item = planning_service.get_work_item(conn, reference)
            newer_open = conn.execute(
                "SELECT 1 FROM executions WHERE work_item_id = ? AND ended_at IS NULL LIMIT 1",
                (str(work_item["work_item_id"]),),
            ).fetchone()
            if newer_open is None:
                _move_to_review(conn, reference)
            conn.commit()  # finish this attempt before the next session-end ingest
        except Exception:
            conn.rollback()
            raise


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

    This reads the session row the previous launch wrote and linked to this
    item; it does not search for a session that merely looks related. A launch
    with no such row cannot be resumed, which is the honest answer.
    """

    row = conn.execute(
        "SELECT id FROM sessions WHERE work_item_id = ? AND client = ?"
        " ORDER BY started_at DESC, rowid DESC LIMIT 1",
        (str(record["work_item_id"]), client),
    ).fetchone()
    if row is None:
        raise runner.LaunchError(
            f"{record['reference']} has no exact resumable {client} session;"
            " heuristic task correlation is forbidden"
        )
    return str(row[0])


def _restore(
    conn: sqlite3.Connection,
    reference: str,
    state: str,
    claim: str,
    launched: dict,
    actor: str,
    execution_id: str,
    error: BaseException,
) -> None:
    """Compensate only the unchanged launch-owned item, with the write lock held."""

    conn.execute("BEGIN IMMEDIATE")
    try:
        current = planning_service.get_work_item(conn, reference)
        owned = (
            current["revision"] == launched["revision"]
            and current["state"]["state_id"] == launched["state"]["state_id"]
            and current["claim_ref"] == launched["claim_ref"] == actor
        )
        if owned:
            restored = planning_service.transition_work_item(
                conn,
                reference,
                state,
                author=actor,
                reason="launch_failed",
                force=True,
                expected_revision=int(launched["revision"]),
            )
            if claim:
                planning_service.claim_work_item(
                    conn,
                    reference,
                    author=claim,
                    force=True,
                    expected_revision=int(restored["revision"]),
                )
            else:
                planning_service.claim_work_item(
                    conn,
                    reference,
                    author=actor,
                    release=True,
                    expected_revision=int(restored["revision"]),
                )
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


def _move_to_review(conn: sqlite3.Connection, reference: str) -> None:
    """Move an item the launch was working on into review, if the workflow allows.

    The state is asked of the workflow by category rather than named, so a space
    that calls its review state something else still receives the move, and a
    workflow with no review state at all simply gets none.
    """

    record = planning_service.get_work_item(conn, reference)
    if record["state"]["category"] != _ACTIVE_CATEGORY:
        return
    target = _first_state(conn, record, _REVIEW_CATEGORY)
    if target is None:
        return
    try:
        planning_service.transition_work_item(conn, reference, target, author="runner")
    except planning_model.WorkflowGuardError:
        pass  # a guard knows better than the runner does


def _first_state(conn: sqlite3.Connection, record: dict, category: str) -> str | None:
    row = conn.execute(
        "SELECT s.key FROM workflow_states s"
        " JOIN work_items w ON w.workflow_id = s.workflow_id"
        " WHERE w.work_item_id = ? AND s.category = ? ORDER BY s.position LIMIT 1",
        (str(record["work_item_id"]), category),
    ).fetchone()
    return str(row[0]) if row is not None else None


__all__ = ["launch_work_item", "reap_launches", "stop_work_item"]
