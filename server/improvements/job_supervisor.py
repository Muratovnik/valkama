"""Generic subprocess jobs used by the Improvements module.

The supervisor deliberately knows nothing about work items, SQLite, or what a
particular kind of job is allowed to return.  A store (or a pair of store
callbacks) owns persistence, the injected event publisher owns the Sessions
projection, and a job that has a result contract declares it as its own
``result_parser``.  This keeps analysis/evaluation jobs from manufacturing card
ids while retaining the same small process seams as ``runner.Runner``.

The analyzer envelope, its schema and its client argv used to live here too,
which made the paragraph above false: process-lifecycle correctness and what an
analyzer run may say change for entirely different reasons.  They are now
``analyzer_contract``, which imports this module rather than the other way
round.

The event payloads emitted here carry the ``improvements-events`` interface
version frozen in ``docs/improvements-contract.md``.
"""

from __future__ import annotations

import contextlib
import inspect
import json
import subprocess
import sys
import threading
import time
import uuid
from collections import deque
from collections.abc import Callable, Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

from .. import processes

EVENTS_VERSION = "improvements-events"
KINDS = ("analysis", "eval")
STATES = ("queued", "running", "succeeded", "failed", "cancelled")
MAX_RESULT_CHARS = 64_000
MAX_OUTPUT_CHARS = 16_000


class JobError(ValueError):
    """A job request or lifecycle operation is invalid."""


class JobConflictError(JobError):
    """The store rejected a conflicting queued/running analysis job."""


class JobNotFoundError(JobError):
    """No job with the supplied opaque id exists."""


class JobResultError(JobError):
    """A finished job did not return the result contract it declared.

    The supervisor knows only that the contract was violated; which contract
    that was belongs to whoever declared it, so a caller may raise a subclass
    of its own from its ``result_parser`` (``AnalyzerOutputError`` does) and
    still be reaped as one malformed result.
    """


def _utc(clock: Callable[[], Any] | None = None) -> str:
    value = clock() if clock else datetime.now(UTC)
    if isinstance(value, str):
        return value
    if isinstance(value, (int, float)):
        value = datetime.fromtimestamp(value, UTC)
    if not isinstance(value, datetime):
        value = datetime.now(UTC)
    if value.tzinfo is None:
        value = value.replace(tzinfo=UTC)
    return value.astimezone(UTC).replace(microsecond=0).isoformat().replace("+00:00", "Z")


class BoundedCapture:
    """A bounded tail capture for client stdout/stderr.

    Clients are allowed to be noisy, but job records must never grow with a
    model transcript.  ``text`` is therefore capped even when the process
    writes one huge line instead of newline-delimited JSON.
    """

    def __init__(self, limit: int = MAX_OUTPUT_CHARS) -> None:
        self.limit = max(1, int(limit))
        self._chunks: deque[str] = deque()
        self._size = 0
        self.truncated = False
        self._lock = threading.Lock()

    def append(self, raw: bytes | str) -> None:
        value = raw.decode("utf-8", "replace") if isinstance(raw, bytes) else str(raw)
        with self._lock:
            self._chunks.append(value)
            self._size += len(value)
            while self._size > self.limit and self._chunks:
                removed = self._chunks.popleft()
                self._size -= len(removed)
                self.truncated = True

    @property
    def text(self) -> str:
        with self._lock:
            return "".join(self._chunks)[-self.limit :]

    def as_dict(self) -> dict[str, Any]:
        return {"text": self.text, "truncated": self.truncated}


def _drain(stream: Any, capture: BoundedCapture) -> None:
    """Drain a text or bytes stream without assuming a concrete Popen type."""
    try:
        while True:
            reader = getattr(stream, "read", None)
            chunk = reader(4096) if reader is not None else stream.readline()
            if not chunk:
                break
            capture.append(chunk)
    except (OSError, ValueError, AttributeError):
        return
    finally:
        with contextlib.suppress(OSError, ValueError, AttributeError):
            stream.close()


def _json_from_output(text: str) -> Any:
    """Read the last JSON object/array line from bounded process output."""
    for line in reversed(text.splitlines()):
        candidate = line.strip()
        if not candidate:
            continue
        try:
            value = json.loads(candidate)
            if isinstance(value, dict):
                for key in ("structured_output", "structuredOutput", "result"):
                    nested = value.get(key)
                    if isinstance(nested, dict):
                        return nested
                    if isinstance(nested, str):
                        try:
                            parsed = json.loads(nested)
                        except json.JSONDecodeError:
                            continue
                        if isinstance(parsed, (dict, list)):
                            return parsed
            return value
        except json.JSONDecodeError:
            continue
    raise JobResultError("no valid JSON result was returned")


@dataclass
class Job:
    id: str
    scope: str
    kind: str
    client: str = ""
    state: str = "queued"
    created_at: str = ""
    started_at: str = ""
    finished_at: str = ""
    error_code: str = ""
    result_summary: Any = field(default_factory=dict)
    command: tuple[str, ...] = field(default_factory=tuple, repr=False)
    cwd: str = field(default="", repr=False)
    env: dict[str, str] | None = field(default=None, repr=False)
    timeout_seconds: float | None = field(default=None, repr=False)
    result_parser: Callable[[Any, Job], Any] | None = field(default=None, repr=False)
    result_handler: Callable[[dict[str, Any], Job], Any] | None = field(default=None, repr=False)
    result_path: str = field(default="", repr=False)
    metadata: dict[str, Any] = field(default_factory=dict)
    process: Any = field(default=None, repr=False)
    capture: BoundedCapture | None = field(default=None, repr=False)
    reader: threading.Thread | None = field(default=None, repr=False)
    started_monotonic: float | None = field(default=None, repr=False)

    def as_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "scope": self.scope,
            "kind": self.kind,
            "state": self.state,
            "client": self.client,
            "created_at": self.created_at,
            "started_at": self.started_at,
            "finished_at": self.finished_at,
            "error_code": self.error_code,
            "result_summary": self.result_summary,
            **({"metadata": self.metadata} if self.metadata else {}),
        }


class MemoryJobStore:
    """Small callback-compatible store for tests and an in-process default."""

    def __init__(self) -> None:
        self.jobs: dict[str, dict[str, Any]] = {}

    def reserve_job(self, scope: str, kind: str, job_id: str | None = None) -> bool:  # noqa: ARG002
        if kind != "analysis":
            return True
        for job in self.jobs.values():
            if (
                job.get("scope") == scope
                and job.get("kind") == kind
                and job.get("state") in ("queued", "running")
            ):
                return False
        return True

    def create_job(self, job: Mapping[str, Any]) -> None:
        self.jobs[str(job["id"])] = dict(job)

    def update_job(self, job_id: str, **fields: Any) -> None:
        if job_id in self.jobs:
            self.jobs[job_id].update(fields)

    def get_job(self, job_id: str) -> dict[str, Any] | None:
        value = self.jobs.get(job_id)
        return dict(value) if value is not None else None

    def list_jobs(self, scope: str | None = None) -> list[dict[str, Any]]:
        values = self.jobs.values()
        return [dict(value) for value in values if scope is None or value.get("scope") == scope]


def _valid_command(command: Sequence[str] | None) -> tuple[str, ...]:
    if command is None:
        return ()
    if isinstance(command, (str, bytes)):
        raise JobError("job command must be an argv sequence, never a shell string")
    values = tuple(command)
    if not values or any(not isinstance(item, str) or not item for item in values):
        raise JobError("job command must contain non-empty string argv values")
    return values


class JobSupervisor:
    """Own and reap analysis/evaluation processes without touching a DB."""

    def __init__(
        self,
        store: Any | None = None,
        event_callback: Callable[[dict[str, Any]], Any] | None = None,
        *,
        emit: Callable[[dict[str, Any]], Any] | None = None,
        spawn: Callable[..., Any] | None = None,
        stop_tree: Callable[[Any], Any] | None = None,
        clock: Callable[[], Any] | None = None,
        monotonic: Callable[[], float] | None = None,
        max_output_chars: int = MAX_OUTPUT_CHARS,
        reserve_job: Callable[..., Any] | None = None,
        job_loader: Callable[[Mapping[str, Any]], Mapping[str, Any] | None] | None = None,
    ) -> None:
        self.store = store or MemoryJobStore()
        self.event_callback = event_callback or emit
        self._spawn = spawn or self._default_spawn
        self._stop_tree = stop_tree
        self._clock = clock
        self._monotonic = monotonic or time.monotonic
        self.max_output_chars = max(1, int(max_output_chars))
        self._reserve_callback = reserve_job
        self._job_loader = job_loader
        self._jobs: dict[str, Job] = {}
        self._lock = threading.RLock()

    @staticmethod
    def _default_spawn(
        command: Sequence[str], cwd: str = "", env: Mapping[str, str] | None = None
    ) -> Any:
        flags = 0
        if sys.platform == "win32":
            flags = getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)
        return subprocess.Popen(
            list(command),
            cwd=cwd or None,
            env=dict(env) if env is not None else None,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            creationflags=flags,
            start_new_session=sys.platform != "win32",
            shell=False,
        )

    def _persist_create(self, job: Job) -> None:
        callback = (
            getattr(self.store, "create_job", None)
            or getattr(self.store, "insert_job", None)
            or getattr(self.store, "put_job", None)
        )
        if callback:
            try:
                callback(job.as_dict())
            except TypeError:
                callback(**job.as_dict())

    def _persist_update(self, job: Job, **fields: Any) -> None:
        callback = getattr(self.store, "update_job", None) or getattr(self.store, "set_job", None)
        if callback:
            try:
                callback(job.id, **fields)
            except TypeError:
                # Some stores accept a complete row rather than keyword fields.
                callback(job.as_dict())

    def _reserve(self, scope: str, kind: str, job_id: str) -> bool:
        callback = self._reserve_callback
        if callback is None:
            for name in (
                "reserve_job",
                "reserve_analysis_job",
                "claim_analysis",
                "can_queue",
            ):
                callback = getattr(self.store, name, None)
                if callback is not None:
                    break
        if callback is None and callable(self.store):
            callback = self.store
        if callback is None:
            return True
        try:
            signature = inspect.signature(callback)
            parameters = list(signature.parameters.values())
            required = [
                parameter
                for parameter in parameters
                if parameter.default is inspect.Parameter.empty
                and parameter.kind
                in (inspect.Parameter.POSITIONAL_ONLY, inspect.Parameter.POSITIONAL_OR_KEYWORD)
            ]
            value = callback(scope, kind, job_id) if len(required) >= 3 else callback(scope, kind)
        except (TypeError, ValueError):
            # Builtins and permissive callbacks may not expose a signature.
            try:
                value = callback(scope, kind, job_id)
            except TypeError:
                value = callback(scope, kind)
        if value is None:
            return True
        if isinstance(value, Mapping) and value.get("ok") is False:
            return False
        return bool(value)

    def queue(self, *args: Any, **kwargs: Any) -> dict[str, Any]:
        with self._lock:
            return self._queue_unlocked(*args, **kwargs)

    def _queue_unlocked(
        self,
        scope: str,
        kind: str,
        client: str = "",
        command: Sequence[str] | None = None,
        *,
        argv: Sequence[str] | None = None,
        cwd: str = "",
        env: Mapping[str, str] | None = None,
        timeout: float | None = None,
        timeout_seconds: float | None = None,
        result_parser: Callable[[Any, Job], Any] | None = None,
        result_handler: Callable[[dict[str, Any], Job], Any] | None = None,
        result_path: str = "",
        metadata: Mapping[str, Any] | None = None,
        job_id: str | None = None,
    ) -> dict[str, Any]:
        if not isinstance(scope, str) or not scope:
            raise JobError("job scope is required")
        if kind not in KINDS:
            raise JobError(f"unknown job kind {kind!r}; use analysis or eval")
        command = command if command is not None else argv
        command_tuple = _valid_command(command)
        identifier = job_id or f"job-{uuid.uuid4().hex}"
        if not isinstance(identifier, str) or not identifier:
            raise JobError("job id must be an opaque non-empty string")
        if identifier in self._jobs:
            raise JobConflictError(f"job {identifier!r} already exists")
        if not self._reserve(scope, kind, identifier):
            raise JobConflictError(
                f"an {kind} job is already queued or running for scope {scope!r}"
            )
        selected_timeout = timeout_seconds if timeout_seconds is not None else timeout
        if selected_timeout is not None and float(selected_timeout) <= 0:
            raise JobError("job timeout must be positive")
        now = _utc(self._clock)
        job = Job(
            id=identifier,
            scope=scope,
            kind=kind,
            client=str(client or ""),
            created_at=now,
            command=command_tuple,
            cwd=str(cwd or ""),
            env=dict(env) if env is not None else None,
            timeout_seconds=float(selected_timeout) if selected_timeout is not None else None,
            result_parser=result_parser,
            result_handler=result_handler,
            result_path=str(result_path or ""),
            metadata=dict(metadata or {}),
        )
        self._jobs[identifier] = job
        try:
            self._persist_create(job)
        except Exception:
            self._jobs.pop(identifier, None)
            raise
        self._emit(job, "queued")
        return job.as_dict()

    def _get(self, job_id: str) -> Job:
        job = self._jobs.get(job_id)
        if job is None:
            raise JobNotFoundError(f"unknown job {job_id!r}")
        return job

    def get(self, job_id: str) -> dict[str, Any]:
        with self._lock:
            return self._get(job_id).as_dict()

    def jobs(self, scope: str | None = None) -> list[dict[str, Any]]:
        with self._lock:
            return [
                job.as_dict() for job in self._jobs.values() if scope is None or job.scope == scope
            ]

    def join_readers(self, timeout: float = 1) -> None:
        """Boundedly join every output reader owned by this supervisor."""

        with self._lock:
            readers = [job.reader for job in self._jobs.values() if job.reader is not None]
        for reader in readers:
            reader.join(timeout=timeout)

    def start(self, job_id: str, process: Any | None = None) -> dict[str, Any]:
        with self._lock:
            return self._start_unlocked(job_id, process)

    def _start_unlocked(self, job_id: str, process: Any | None = None) -> dict[str, Any]:
        job = self._get(job_id)
        if job.state != "queued":
            raise JobError(f"job {job_id!r} is {job.state}, not queued")
        try:
            live = process
            if live is None:
                if not job.command:
                    raise JobError("queued job has no command")
                live = self._spawn(job.command, job.cwd, job.env)
        except Exception as error:
            self._finish(job, "failed", error_code="launch_failed", result_summary={})
            raise JobError(f"cannot start job {job.id}: {error}") from error
        job.process = live
        job.capture = BoundedCapture(self.max_output_chars)
        stream = getattr(live, "stdout", None)
        if stream is not None and hasattr(stream, "readline"):
            job.reader = threading.Thread(
                target=_drain, args=(stream, job.capture), name=f"job-output-{job.id}", daemon=True
            )
            job.reader.start()
        job.started_monotonic = self._monotonic()
        job.started_at = _utc(self._clock)
        job.state = "running"
        try:
            self._persist_update(job, state=job.state, started_at=job.started_at)
        except Exception as error:
            self._stop(job)
            job.process = None
            job.capture = None
            job.reader = None
            job.started_monotonic = None
            job.started_at = ""
            job.state = "queued"
            raise JobError(f"cannot persist job start: {error}") from error
        self._emit(job, "started")
        return job.as_dict()

    def _stop(self, job: Job) -> None:
        process = job.process
        if process is None:
            return
        try:
            if process.poll() is not None:
                return
        except (AttributeError, OSError):
            pass
        if self._stop_tree is not None:
            self._stop_tree(process)
            return
        processes.stop_process_tree(process)

    def cancel(self, job_id: str) -> dict[str, Any]:
        with self._lock:
            return self._cancel_unlocked(job_id)

    def _cancel_unlocked(self, job_id: str) -> dict[str, Any]:
        job = self._get(job_id)
        if job.state in ("succeeded", "failed", "cancelled"):
            return job.as_dict()
        if job.state == "running":
            self._stop(job)
        self._finish(job, "cancelled", error_code="cancelled", result_summary=job.result_summary)
        return job.as_dict()

    def timeout(self, job_id: str) -> dict[str, Any]:
        with self._lock:
            return self._timeout_unlocked(job_id)

    def _timeout_unlocked(self, job_id: str) -> dict[str, Any]:
        job = self._get(job_id)
        if job.state != "running":
            return job.as_dict()
        self._stop(job)
        self._finish(job, "failed", error_code="timeout", result_summary=job.result_summary)
        return job.as_dict()

    def check_timeouts(self, now: float | None = None) -> list[dict[str, Any]]:
        with self._lock:
            moment = self._monotonic() if now is None else float(now)
            expired: list[dict[str, Any]] = [
                self._timeout_unlocked(job.id)
                for job in list(self._jobs.values())
                if job.state == "running"
                and job.timeout_seconds is not None
                and job.started_monotonic is not None
                and moment - job.started_monotonic >= job.timeout_seconds
            ]
            return expired

    def _read_result(self, job: Job) -> Any:
        if job.result_path:
            try:
                with open(job.result_path, encoding="utf-8") as handle:
                    raw = handle.read(MAX_RESULT_CHARS + 1)
                if len(raw) > MAX_RESULT_CHARS:
                    raise JobResultError("result file exceeds bounded output limit")
                return json.loads(raw)
            except (OSError, UnicodeError, json.JSONDecodeError) as error:
                raise JobResultError(f"malformed result file: {error}") from error
        output = job.capture.text if job.capture is not None else ""
        return _json_from_output(output)

    def _result_for(self, job: Job, exit_code: int) -> Any:
        # Non-zero exit is a process failure regardless of any JSON diagnostics.
        if exit_code != 0:
            return {
                "exit_code": exit_code,
                "output_chars": len(self._bounded_output(job)),
                "truncated": bool(job.capture and job.capture.truncated),
            }
        if job.result_parser is not None or job.result_handler is not None:
            candidate = self._read_result(job)
            # A declared parser runs before the domain handler, so a result that
            # violates its contract fails its job without any handler seeing it.
            if job.result_parser is not None:
                candidate = job.result_parser(candidate, job)
            if job.result_handler is not None:
                handled = job.result_handler(candidate, job)
                return candidate if handled is None else handled
            return candidate
        text = self._bounded_output(job)
        return {
            "exit_code": 0,
            "output_chars": len(text),
            "truncated": bool(job.capture and job.capture.truncated),
        }

    def _bounded_output(self, job: Job) -> str:
        if job.capture is None:
            return ""
        return job.capture.text[-MAX_RESULT_CHARS:]

    def _finish(
        self,
        job: Job,
        state: str,
        *,
        error_code: str = "",
        result_summary: Any = None,
    ) -> None:
        if state not in STATES or state in ("queued", "running"):
            raise JobError(f"invalid terminal state {state!r}")
        if job.state in ("succeeded", "failed", "cancelled"):
            return
        previous = (job.state, job.error_code, job.result_summary, job.finished_at)
        job.state = state
        job.error_code = error_code
        job.result_summary = {} if result_summary is None else result_summary
        job.finished_at = _utc(self._clock)
        try:
            self._persist_update(
                job,
                state=job.state,
                finished_at=job.finished_at,
                error_code=job.error_code,
                result_summary=job.result_summary,
            )
        except Exception as error:
            job.state, job.error_code, job.result_summary, job.finished_at = previous
            raise JobError(f"cannot persist job completion: {error}") from error
        self._emit(job, state)

    def _forget_terminal_unlocked(self) -> None:
        """Drop jobs whose terminal outcome the store already owns.

        ``_finish`` records a terminal state only after its persist succeeded,
        and the store is the authority from there on: the sidecar
        reconciliation the runtime performs afterwards reads the persisted row,
        never this table.  Sweeping one reap late is deliberate -- the terminal
        event callback and the cancel path both look a job up immediately after
        it finishes, and both must still find it -- while bounding a table that
        used to hold every finished job's captured output, command and
        environment for the life of the process.
        """
        for identifier, job in list(self._jobs.items()):
            if job.state not in ("succeeded", "failed", "cancelled"):
                continue
            if job.reader is not None and job.reader.is_alive():
                # Its reader still owns the capture buffer, and `join_readers`
                # reaches a reader only through this table. A later reap forgets
                # the job once that thread has ended.
                continue
            self._jobs.pop(identifier, None)

    def reap(self, now: float | None = None) -> list[dict[str, Any]]:
        with self._lock:
            return self._reap_unlocked(now)

    def _reap_unlocked(self, now: float | None = None) -> list[dict[str, Any]]:
        self._forget_terminal_unlocked()
        # Every reap enforces the declared timeouts.  This used to run only when
        # a caller supplied `now`, and the one production caller never did, so a
        # hung analyzer or eval held its per-scope slot and its OS-backed scope
        # lease until the server restarted.  `now` stays accepted so a test can
        # still drive time.
        self.check_timeouts(now)
        finished: list[dict[str, Any]] = []
        for job in list(self._jobs.values()):
            if job.state != "running" or job.process is None:
                continue
            try:
                exit_code = job.process.poll()
            except (AttributeError, OSError):
                exit_code = None
            if exit_code is None:
                continue
            if job.reader is not None:
                job.reader.join(timeout=1)
            try:
                result = self._result_for(job, int(exit_code))
            except JobResultError as error:
                self._finish(
                    job,
                    "failed",
                    error_code="malformed_output",
                    result_summary={"reason": str(error)[:400]},
                )
                finished.append(job.as_dict())
                continue
            try:
                if int(exit_code) != 0:
                    self._finish(job, "failed", error_code="process_exit", result_summary=result)
                else:
                    self._finish(job, "succeeded", result_summary=result)
            except JobError:
                # Persistence remains authoritative.  Keep the job running in
                # memory so a later retry can commit one terminal transition;
                # never emit a terminal event for an uncommitted state.
                continue
            finished.append(job.as_dict())
        return finished

    @staticmethod
    def _job_from_record(record: Mapping[str, Any]) -> Job:
        command = record.get("command", ())
        try:
            command_tuple = _valid_command(command) if command else ()
        except JobError:
            command_tuple = ()
        return Job(
            id=str(record.get("id", "")),
            scope=str(record.get("scope", "")),
            kind=str(record.get("kind", "")),
            client=str(record.get("client", "")),
            state=str(record.get("state", "queued")),
            created_at=str(record.get("created_at", "")),
            started_at=str(record.get("started_at", "")),
            finished_at=str(record.get("finished_at", "")),
            error_code=str(record.get("error_code", "")),
            result_summary=record.get("result_summary", {}),
            command=command_tuple,
            cwd=str(record.get("cwd", "")),
            timeout_seconds=record.get("timeout_seconds"),
            metadata=dict(record.get("metadata", {}) or {}),
        )

    def recover_orphans(
        self,
        loader: Callable[[Mapping[str, Any]], Mapping[str, Any] | None] | None = None,
    ) -> list[dict[str, Any]]:
        """Fail persisted running jobs after a platform restart; queued jobs survive."""
        with self._lock:
            records: Iterable[Mapping[str, Any]]
            callback = getattr(self.store, "list_jobs", None) or getattr(
                self.store, "all_jobs", None
            )
            if callback:
                try:
                    records = callback()
                except TypeError:
                    records = callback(None)
            else:
                records = [job.as_dict() for job in self._jobs.values()]
            load = loader or self._job_loader
            recovered: list[dict[str, Any]] = []
            for raw in records:
                if not isinstance(raw, Mapping):
                    continue
                record = raw
                if record.get("state") == "queued" and load is not None:
                    loaded = load(record)
                    if loaded is not None:
                        record = loaded
                identifier = str(record.get("id", ""))
                if not identifier:
                    continue
                job = self._jobs.get(identifier)
                if job is None and record.get("state") in ("queued", "running"):
                    job = self._job_from_record(record)
                    self._jobs[identifier] = job
                if record.get("state") != "running" or job is None:
                    continue
                self._finish(job, "failed", error_code="platform_restarted", result_summary={})
                recovered.append(job.as_dict())
            return recovered

    recover = recover_orphans

    def _emit(self, job: Job, action: str) -> None:
        if self.event_callback is None:
            return
        event = {
            "interface_version": EVENTS_VERSION,
            "event": f"module.improvements.job.{action}",
            "name": f"module.improvements.job.{action}",
            "action": action,
            "entity": "job",
            "entity_id": job.id,
            "id": job.id,
            "job_id": job.id,
            "scope": job.scope,
            "kind": job.kind,
            "client": job.client,
            "state": job.state,
            "error_code": job.error_code,
            "session_event": f"job_{action}",
            "at": _utc(self._clock),
        }
        try:
            self.event_callback(event)
        except Exception:
            # Event publication must not turn a committed lifecycle transition
            # into a second state transition.  The caller can instrument its
            # callback if delivery diagnostics are needed.
            return


__all__ = [
    "EVENTS_VERSION",
    "BoundedCapture",
    "Job",
    "JobConflictError",
    "JobError",
    "JobNotFoundError",
    "JobResultError",
    "JobSupervisor",
    "MemoryJobStore",
]
