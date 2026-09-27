"""Launch a work item onto an agent, and stop it.

The runner owns process shape only: it spawns, polls and stops. What a finished
process meant for the work is `executions.results`, which owns the outcome and
review vocabularies, the result schema and the classification that reads one —
this module hands the schema to a client and hands the captured output back,
and forms no opinion about either. It never decides which model should do the
work either: the owner picks that when they launch, and the execution row stores
the choice. The one policy this module does enforce is the role contract of
ADR 0008:

* `executor` is a direct assignment, not delegation. Where the client can
  disable subagent spawning on the command line, it is disabled there rather
  than asked for in a prompt. Codex exposes no such switch, so an executor
  packet for it carries a warning saying the role is advisory on that client —
  an unenforceable contract has to be visible, not assumed.
* `orchestrator` exists only when the owner selects it. The spawned session then
  invokes `route-subagents` itself; nothing here routes anything.

Client binaries are configurable because a machine may keep them anywhere, and
that same configuration is what lets a smoke test point at a stub instead of
burning a real model call.
"""

from __future__ import annotations

import contextlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import uuid
from collections import deque
from collections.abc import Callable, Iterator, Mapping
from dataclasses import dataclass, field
from typing import IO, Protocol
from urllib.parse import quote

from . import git_worktrees, processes
from .executions import drivers, results

#: Which clients exist, and what each one accepts, is the drivers' answer. This
#: module keeps the launch policy that is the same whoever runs it.
CLIENTS = drivers.CLIENTS
ROLES = ("executor", "orchestrator")
ENVIRONMENTS = ("workdir", "worktree", "wsl")
# The working copy first, by owner decision: a worktree is opt-in per task and
# WSL is opt-in per project.
DEFAULT_ENVIRONMENT = "workdir"
MAX_PROMPT_CHARS = 8000
MAX_CAPTURE_LINES = 2048
# Models an orchestrator role is sensible on. Not a gate: a warning, because the
# owner may have a reason and this table will go stale before they do.
SENIOR_MODEL_HINTS = ("opus", "fable", "mythos", "gpt-5", "o3")


class LaunchError(ValueError):
    """The launch packet or the machine cannot support this launch."""


@dataclass(frozen=True)
class LaunchPacket:
    client: str
    role: str
    environment: str
    repo: str
    model: str = ""
    effort: str = ""
    prompt: str = ""
    branch: str = ""
    distro: str = ""
    expected_effect: str = "change_required"
    review_mode: str = ""
    interface_version: str = ""
    resume: bool = False
    warnings: tuple[str, ...] = field(default_factory=tuple)

    def as_dict(self) -> dict:
        return {
            "client": self.client,
            "role": self.role,
            "environment": self.environment,
            "repo": self.repo,
            "model": self.model,
            "effort": self.effort,
            "prompt": self.prompt,
            "branch": self.branch,
            "distro": self.distro,
            "expected_effect": self.expected_effect,
            "review_mode": self.review_mode,
            "interface_version": self.interface_version,
            "resume": self.resume,
        }


def client_binary(client: str) -> str:
    """Where this machine keeps the client, with an explicit override first."""
    override = os.environ.get(f"VALKAMA_{client.upper()}_BIN")
    if override:
        return override
    found = shutil.which(client)
    if not found:
        raise LaunchError(
            f"{client} is not on PATH; set VALKAMA_{client.upper()}_BIN to its absolute path"
        )
    return found


def _text(payload: dict, key: str, limit: int = 200) -> str:
    value = payload.get(key, "")
    if value is None:
        value = ""
    if not isinstance(value, str):
        raise LaunchError(f"launch {key} must be a string")
    return "".join(character for character in value.strip() if character >= " ")[:limit]


def _boolean(payload: dict, key: str) -> bool:
    value = payload.get(key, False)
    if not isinstance(value, bool):
        raise LaunchError(f"launch {key} must be a boolean")
    return value


def validate_packet(payload: dict) -> LaunchPacket:
    """Read one launch packet, refusing anything the runner cannot honour."""
    if not isinstance(payload, dict):
        raise LaunchError("a launch packet must be an object")
    client = _text(payload, "client", 32).lower()
    try:
        capabilities = drivers.capabilities_for(client)
    except drivers.DriverError as error:
        raise LaunchError(str(error)) from error
    role = (_text(payload, "role", 32) or "executor").lower()
    if role not in ROLES:
        raise LaunchError(f"unknown role {role!r}, use one of {list(ROLES)}")
    environment = (_text(payload, "environment", 32) or DEFAULT_ENVIRONMENT).lower()
    if environment not in ENVIRONMENTS:
        raise LaunchError(f"unknown environment {environment!r}, use one of {list(ENVIRONMENTS)}")
    repo = _text(payload, "repo", 512)
    if not repo:
        raise LaunchError("launch repo is required: a session runs somewhere")
    if not os.path.isdir(repo):
        raise LaunchError(f"launch repo is not a directory: {repo}")
    effort = _text(payload, "effort", 16).lower()
    # Per client, not shared: `max` is Claude Code's highest setting and Codex
    # refuses it, while `minimal` is Codex's lowest and Claude Code has none.
    if effort and effort not in capabilities.efforts:
        raise LaunchError(
            f"unknown effort {effort!r} for {client}, use one of {list(capabilities.efforts)}"
        )
    model = _text(payload, "model", 64)
    prompt = _text(payload, "prompt", MAX_PROMPT_CHARS)
    expected_effect = _text(payload, "expected_effect", 32).lower() or "change_required"
    if expected_effect not in results.EXPECTED_EFFECTS:
        raise LaunchError(
            f"unknown expected_effect {expected_effect!r},"
            f" use one of {list(results.EXPECTED_EFFECTS)}"
        )
    review_mode = _text(payload, "review_mode", 32).lower()
    if review_mode not in results.REVIEW_MODES:
        raise LaunchError(
            f"unknown review_mode {review_mode!r}, use one of {list(results.REVIEW_MODES)}"
        )

    warnings: list[str] = []
    if role == "executor" and not capabilities.mechanical_executor:
        warnings.append(
            f"executor role on {client}: this client has no switch that removes"
            " subagent spawning, so the role is advisory here and not enforced"
        )
    if (
        role == "orchestrator"
        and model
        and not any(hint in model.lower() for hint in SENIOR_MODEL_HINTS)
    ):
        warnings.append(
            f"orchestrator role on {model!r}: delegation is usually only worth it on a"
            " senior model, and this one is not in the local table"
        )
    if environment == "worktree":
        check = processes.run_text(["git", "-C", repo, "rev-parse", "--show-toplevel"])
        if check.returncode != 0:
            raise LaunchError("a worktree environment needs a Git repository")
    if environment == "wsl" and not _text(payload, "distro", 64):
        warnings.append("no WSL distro named; the default distribution will be used")
    return LaunchPacket(
        client=client,
        role=role,
        environment=environment,
        repo=repo,
        model=model,
        effort=effort,
        prompt=prompt,
        branch=_text(payload, "branch", 120),
        distro=_text(payload, "distro", 64),
        expected_effect=expected_effect,
        review_mode=review_mode,
        interface_version=_text(payload, "interface_version", 120),
        resume=_boolean(payload, "resume"),
        warnings=tuple(warnings),
    )


def client_argv(
    packet: LaunchPacket,
    *,
    client_session_id: str = "",
    schema_path: str = "",
    result_path: str = "",
) -> list[str]:
    """The exact command line, asked of the driver that owns this client.

    The delegation ban rides along as `no_delegation` rather than as a flag
    chosen here: a Claude executor is told nothing about not delegating, because
    the tool is simply removed, and a prompt-level instruction would be advice
    rather than a contract (ADR 0008, decision 4). A driver that cannot enforce
    it ignores the request, which is why `validate_packet` has already warned.
    """

    driver = drivers.driver_for(packet.client)
    capabilities = driver.capabilities()
    # A file-transport driver was given nowhere to write; ask for a run with no
    # enforced result shape rather than one whose schema goes nowhere.
    schema: dict | None = results.result_schema(packet.review_mode)
    if capabilities.result_transport == "file" and not (schema_path and result_path):
        schema = None
    try:
        return driver.argv(
            drivers.CommandRequest(
                binary=client_binary(packet.client),
                prompt=results.contract_prompt(
                    packet.prompt, packet.expected_effect, packet.review_mode
                ),
                model=packet.model,
                effort=packet.effort,
                schema=schema,
                schema_path=schema_path if schema is not None else "",
                result_path=result_path,
                session_id=client_session_id,
                resume=packet.resume,
                no_delegation=packet.role == "executor" and capabilities.mechanical_executor,
            )
        )
    except drivers.DriverError as error:
        raise LaunchError(str(error)) from error


def worktree_path(repo: str, reference: str) -> str:
    """Sibling directory, never inside the repository it checks out."""
    parent = os.path.dirname(os.path.abspath(repo))
    return os.path.join(parent, f"{os.path.basename(os.path.abspath(repo))}-card{reference}")


def _registered_worktrees(repo: str) -> dict[str, dict[str, str]]:
    try:
        return git_worktrees.registered_worktrees(repo)
    except git_worktrees.WorktreeListError as failure:
        raise LaunchError(f"cannot list Git worktrees: {failure}") from failure


def worktree_preflight(repo: str, reference: str, branch: str = "") -> dict:
    """Prove a worktree target is safe before creating or reusing it."""
    supplied = git_worktrees.canonical(repo)
    top = git_worktrees.git_text(repo, "rev-parse", "--show-toplevel")
    if top.returncode != 0:
        raise LaunchError("a worktree environment needs a Git repository")
    root = git_worktrees.canonical(top.stdout.strip())
    if supplied != root:
        raise LaunchError(
            f"worktree repo must be the Git top-level {top.stdout.strip()!r}, not {repo!r}"
        )
    superproject = git_worktrees.git_text(repo, "rev-parse", "--show-superproject-working-tree")
    parent_repo = superproject.stdout.strip() if superproject.returncode == 0 else ""
    if parent_repo:
        raise LaunchError(
            f"refusing automatic worktree creation for submodule {repo!r};"
            f" superproject is {parent_repo!r}"
        )

    target = os.path.abspath(worktree_path(root, reference))
    intended_parent = git_worktrees.canonical(os.path.dirname(root))
    if git_worktrees.canonical(os.path.dirname(target)) != intended_parent:
        raise LaunchError(f"worktree target escapes its intended parent: {target}")
    if git_worktrees.is_reparse_point(target):
        raise LaunchError(f"worktree target is a symlink or reparse point: {target}")

    registered = _registered_worktrees(root)
    target_key = git_worktrees.canonical(target)
    existing = os.path.exists(target)
    if existing and target_key not in registered:
        raise LaunchError(f"worktree target already exists but is not registered by Git: {target}")
    if existing and not os.path.isdir(target):
        raise LaunchError(f"worktree target is not a directory: {target}")
    if target_key in registered:
        target_top = git_worktrees.git_text(target, "rev-parse", "--show-toplevel")
        if (
            target_top.returncode != 0
            or git_worktrees.canonical(target_top.stdout.strip()) != target_key
        ):
            raise LaunchError(f"registered worktree identity mismatch: {target}")

    head = git_worktrees.git_text(root, "rev-parse", "HEAD")
    status = git_worktrees.git_text(root, "status", "--porcelain", "--branch")
    if head.returncode != 0 or status.returncode != 0:
        raise LaunchError("cannot capture the source worktree baseline")
    name = branch or f"card/{reference}"
    branch_check = git_worktrees.git_text(root, "rev-parse", "--verify", name)
    return {
        "repo": root,
        "target": target,
        "registered": target_key in registered,
        "branch": name,
        "branch_exists": branch_check.returncode == 0,
        "head": head.stdout.strip(),
        "dirty": any(line and not line.startswith("#") for line in status.stdout.splitlines()),
    }


def prepare_worktree(repo: str, reference: str, branch: str = "") -> tuple[str, dict]:
    """Add a verified worktree for this card, or reuse its exact registration."""
    preflight = worktree_preflight(repo, reference, branch)
    target = preflight["target"]
    if preflight["registered"]:
        return target, preflight
    name = branch or f"card/{reference}"
    command = ["git", "-C", repo, "worktree", "add"]
    command += [target, name] if preflight["branch_exists"] else [target, "-b", name]
    completed = processes.run_text(command)
    if completed.returncode != 0:
        raise LaunchError(
            f"cannot create a worktree for card {reference}: {completed.stderr.strip()}"
        )
    verified = worktree_preflight(repo, reference, branch)
    if not verified["registered"]:
        raise LaunchError(f"Git did not register the created worktree: {target}")
    return target, verified


def launch_directory(packet: LaunchPacket, reference: str) -> tuple[str, dict]:
    """The exact checkout this launch will run in, prepared if it is not there yet.

    Resolvable on its own, and separate from `Runner.launch`, because the caller
    has to know which checkout it is *before* the process exists: for a worktree
    environment the client edits a sibling checkout and not the repository the
    packet named, so evidence taken from `packet.repo` would describe a checkout
    the client never touches. Nothing here decides what the launch means — it
    answers where it will run, which is process shape.
    """

    if packet.environment == "worktree":
        return prepare_worktree(packet.repo, reference, packet.branch)
    return packet.repo, {}


def wsl_argv(argv: list[str], cwd: str, distro: str) -> list[str]:
    """Wrap a command for WSL, translating the Windows path it runs in."""
    wsl = shutil.which("wsl") or shutil.which("wsl.exe")
    if not wsl:
        raise LaunchError("WSL is not available on this machine")
    # A declared lenient boundary, unlike the Git calls above. wsl.exe writes
    # its own diagnostics in UTF-16 while the Linux child it wraps writes UTF-8,
    # so the two streams do not share a codec. Only the child's stdout is read,
    # and only when it succeeded; replacing on the rest keeps a missing distro a
    # LaunchError rather than a decode error from a path nobody was reading.
    translate = processes.run_text([wsl, "wslpath", "-a", cwd.replace("\\", "/")], errors="replace")
    linux_cwd = translate.stdout.strip() if translate.returncode == 0 else ""
    if not linux_cwd:
        raise LaunchError(f"cannot translate {cwd} into a WSL path")
    prefix = [wsl]
    if distro:
        prefix += ["-d", distro]
    return [*prefix, "--cd", linux_cwd, "--", *argv]


def launch_environment(
    base: dict[str, str],
    reference: str,
    launch_id: str,
    planning_space: str,
    correlation: Mapping[str, str] | None = None,
    *,
    telemetry_attributes: bool = False,
) -> dict[str, str]:
    """Environment the spawned session inherits, so its events find their item.

    The monitor adapter forwards the `VALKAMA_*` values, which is how a launched
    session appears on the right work item without guessing from a working
    directory that two sessions can share.

    `correlation` additionally travels as OpenTelemetry resource attributes when
    the client reads them from the environment. Telemetry is deliberately *not*
    turned on here — that is the owner's choice, and a launch that quietly
    started exporting would be making it for them. These attributes are inert
    until they do, and present the moment they do, which is the difference
    between a trace that names its work item and one that has to be matched to
    it by time.
    """
    environment = dict(base)
    environment.update(
        {
            "VALKAMA_LAUNCH_WORK_ITEM": reference,
            "VALKAMA_LAUNCH_ID": launch_id,
            "VALKAMA_LAUNCH_SPACE": planning_space,
        }
    )
    if correlation:
        environment["VALKAMA_EXECUTION_ID"] = correlation.get("valkama.execution.id", "")
        if telemetry_attributes:
            environment["OTEL_RESOURCE_ATTRIBUTES"] = _resource_attributes(
                base.get("OTEL_RESOURCE_ATTRIBUTES", ""), correlation
            )
    return environment


def _resource_attributes(existing: str, correlation: Mapping[str, str]) -> str:
    """Append Valkama's attributes to whatever the environment already carried.

    Appended rather than replaced: the variable is the standard way a machine
    labels everything it exports, so overwriting it would drop the owner's own
    labels on every launched session. Values are percent-encoded because the
    format forbids spaces, commas and equals signs inside a value, and a work
    item title is not asked to avoid them — it never appears here, but a
    project id from a registry the owner wrote might.
    """

    pairs = [
        f"{key}={quote(value, safe='')}" for key, value in sorted(correlation.items()) if value
    ]
    return ",".join([existing, *pairs]) if existing else ",".join(pairs)


@dataclass
class OutputCapture:
    """A bounded tail of what a process wrote, and the identity it announced.

    The tail is process shape and belongs here. What a line *says* does not:
    `read_event` is the driver's reader for the client that is running, so the
    words `thread.started` and `structured_output` stay in the two modules that
    own those clients.
    """

    lines: deque[str] = field(default_factory=lambda: deque(maxlen=MAX_CAPTURE_LINES))
    client_session_id: str = ""
    read_event: Callable[[Mapping[str, object]], drivers.StdoutReading] | None = None

    def append(self, raw: bytes | str) -> None:
        line = raw.decode("utf-8", "replace") if isinstance(raw, bytes) else raw
        line = line.strip()
        if not line:
            return
        self.lines.append(line[-results.MAX_RESULT_CHARS :])
        # An identity is minted or assigned once, so the first one this launch
        # has wins: a client that assigned its own before the process existed
        # must not be renamed by a line of its output.
        if self.read_event is None or self.client_session_id:
            return
        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            return
        if isinstance(event, dict):
            self.client_session_id = self.read_event(event).session_id


def _drain_output(stream, capture: OutputCapture) -> None:
    try:
        for line in iter(stream.readline, b""):
            capture.append(line)
    except (OSError, ValueError):
        return
    finally:
        with contextlib.suppress(OSError, ValueError):
            stream.close()


class LaunchProcess(Protocol):
    """What the runner needs from a process it spawned.

    Structural on purpose. `Runner(spawn=...)` exists so a test can inject a
    stub instead of a real client, and naming subprocess.Popen here would make
    every such stub a type error while changing nothing about what is used.
    """

    pid: int
    stdout: IO[bytes] | None

    def poll(self) -> int | None: ...

    def wait(self, timeout: float | None = None) -> int: ...

    def terminate(self) -> None: ...

    def kill(self) -> None: ...


@dataclass
class RunningLaunch:
    launch_id: str
    reference: str
    #: The stored attempt this process is running. Assigned before the spawn, so
    #: whatever the process reports later is attributed to a row that existed
    #: first rather than to whichever row looks closest afterwards.
    execution_id: str
    process: LaunchProcess
    packet: LaunchPacket
    cwd: str
    client_session_id: str = ""
    preflight: dict = field(default_factory=dict)
    capture: OutputCapture = field(default_factory=OutputCapture)
    reader: threading.Thread | None = None
    runtime: tempfile.TemporaryDirectory | None = None
    result_path: str = ""
    resumed_from: str = ""


class Runner:
    """The live launches this platform process owns, and how they are stopped.

    Two threads share that registry: a request thread starts and stops launches,
    and the watcher thread reaps the ones that ended. Both used to check the
    dictionary and then act on what they found, with nothing in between, so a
    stop that arrived while a reap was running could kill a process the reaper
    had already collected and then report a cancellation over its real verdict.
    The lock makes the claim atomic instead: whichever path removes a launch from
    `_running` owns its ending, and the other one finds nothing and says so.
    """

    def __init__(self, spawn=None) -> None:
        self._spawn = spawn or self._default_spawn
        self._running: dict[str, RunningLaunch] = {}
        self._starting: dict[str, object] = {}
        self._finished: deque[tuple[str, RunningLaunch, int]] = deque()
        # Reentrant because `launch` polls through its own accessor while
        # holding it, and a plain lock would deadlock on the second acquire.
        self._lock = threading.RLock()

    @contextlib.contextmanager
    def reserve(self, reference: str) -> Iterator[object]:
        """Keep one launch per item from claim through process registration."""

        token = object()
        with self._lock:
            live = self._running.get(reference)
            if reference in self._starting:
                raise LaunchError(f"work item {reference} already has a running launch")
            if live is not None:
                code = live.process.poll()
                if code is None:
                    raise LaunchError(f"work item {reference} already has a running launch")
                # A completed process can be relaunched before the watcher runs.
                # Keep its exact result and resources for the next reap instead
                # of letting the new registration overwrite its only owner.
                self._finished.append((reference, self._running.pop(reference), code))
            self._starting[reference] = token
        try:
            yield token
        finally:
            with self._lock:
                if self._starting.get(reference) is token:
                    del self._starting[reference]

    @staticmethod
    def _default_spawn(argv: list[str], cwd: str, environment: dict[str, str]):
        creation = 0
        if sys.platform == "win32":
            # Its own group, so stopping a launch stops the tree it started and
            # not this platform process with it.
            creation = subprocess.CREATE_NEW_PROCESS_GROUP
        return subprocess.Popen(
            argv,
            cwd=cwd,
            env=environment,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            creationflags=creation,
        )

    def launch(
        self,
        reference: str,
        payload: dict,
        planning_space: str = "",
        resume_session_id: str = "",
        *,
        execution_id: str = "",
        correlation: Mapping[str, str] | None = None,
        directory: tuple[str, dict] | None = None,
        reservation: object | None = None,
    ) -> dict:
        """Spawn one client for this work item.

        `directory` is the checkout a caller has already resolved through
        `launch_directory`, passed in so that the baseline it recorded and the
        directory this process runs in are the same value rather than two
        computations that agree by luck. A caller that has none resolves it here.
        """

        if reservation is None:
            with self.reserve(reference) as owned:
                return self.launch(
                    reference,
                    payload,
                    planning_space,
                    resume_session_id,
                    execution_id=execution_id,
                    correlation=correlation,
                    directory=directory,
                    reservation=owned,
                )
        with self._lock:
            if self._starting.get(reference) is not reservation:
                raise LaunchError(f"work item {reference} has no matching launch reservation")
        packet = validate_packet(payload)
        capabilities = drivers.capabilities_for(packet.client)
        if packet.resume and not resume_session_id:
            raise LaunchError("resume requires an exact client session id")
        if not packet.resume and resume_session_id:
            raise LaunchError("a resume session id was supplied for a fresh launch")
        launch_id = f"launch-{uuid.uuid4().hex[:12]}"
        client_session_id = resume_session_id
        # Asked of the capability rather than of the client's name: whether the
        # identity is chosen here or announced later is exactly what this field
        # says, and a name test here is a second answer that can drift from it.
        if capabilities.assigns_session_identity and not client_session_id:
            client_session_id = str(uuid.uuid4())
        runtime = None
        schema_path = ""
        result_path = ""
        # Same reason: a file transport is a client that needs somewhere to
        # write, and that is the fact, not which client it happens to be.
        try:
            cwd, preflight = (
                directory if directory is not None else launch_directory(packet, reference)
            )
            if capabilities.result_transport == "file":
                runtime = tempfile.TemporaryDirectory(prefix="valkama-launch-")
                schema_path = os.path.join(runtime.name, "result.schema.json")
                result_path = os.path.join(runtime.name, "result.json")
                with open(schema_path, "w", encoding="utf-8", newline="\n") as handle:
                    json.dump(
                        results.result_schema(packet.review_mode),
                        handle,
                        ensure_ascii=False,
                        separators=(",", ":"),
                    )
                    handle.write("\n")
            argv = client_argv(
                packet,
                client_session_id=client_session_id,
                schema_path=schema_path,
                result_path=result_path,
            )
            if packet.environment == "wsl":
                argv = wsl_argv(argv, cwd, packet.distro)
            environment = launch_environment(
                dict(os.environ),
                reference,
                launch_id,
                planning_space,
                correlation,
                telemetry_attributes=capabilities.telemetry_configuration == "environment",
            )
        except Exception as error:
            if runtime is not None:
                with contextlib.suppress(OSError):
                    runtime.cleanup()
            if isinstance(error, LaunchError):
                raise
            raise LaunchError(f"cannot prepare {packet.client} launch: {error}") from error
        try:
            process = self._spawn(argv, cwd, environment)
        except OSError as error:
            if runtime is not None:
                runtime.cleanup()
            raise LaunchError(f"cannot start {packet.client}: {error}") from error
        capture = OutputCapture(
            client_session_id=client_session_id,
            read_event=drivers.driver_for(packet.client).read_stdout_event,
        )
        reader = None
        if getattr(process, "stdout", None) is not None:
            reader = threading.Thread(
                target=_drain_output,
                args=(process.stdout, capture),
                name=f"valkama-output-{launch_id}",
                daemon=True,
            )
            reader.start()
        with self._lock:
            self._running[reference] = RunningLaunch(
                launch_id,
                reference,
                execution_id,
                process,
                packet,
                cwd,
                client_session_id,
                preflight,
                capture,
                reader,
                runtime,
                result_path,
                resume_session_id,
            )
        return {
            "launch_id": launch_id,
            "execution_id": execution_id,
            "reference": reference,
            "cwd": cwd,
            "packet": packet.as_dict(),
            "client_session_id": client_session_id,
            "resumed_from": resume_session_id,
            "worktree_preflight": preflight,
            "warnings": list(packet.warnings),
            # The shape proves which flags were used without echoing the prompt,
            # which can carry the whole task description.
            "argv_shape": [os.path.basename(argv[0])]
            + [item for item in argv[1:] if item.startswith("-") or item in ("exec", "resume")],
        }

    def poll(self, reference: str) -> int | None:
        with self._lock:
            live = self._running.get(reference)
        if live is None:
            return None
        return live.process.poll()

    def running(self) -> list[dict]:
        out = []
        with self._lock:
            live_now = list(self._running.items())
        for reference, live in live_now:
            code = live.process.poll()
            out.append(
                {
                    "reference": reference,
                    "launch_id": live.launch_id,
                    "execution_id": live.execution_id,
                    "client": live.packet.client,
                    "role": live.packet.role,
                    "environment": live.packet.environment,
                    "cwd": live.cwd,
                    "client_session_id": live.capture.client_session_id,
                    "resumed_from": live.resumed_from,
                    "running": code is None,
                    "exit_code": code,
                }
            )
        return out

    def stop(self, reference: str) -> dict:
        """Take this launch out of the registry and end its process tree.

        Removed first and killed afterwards: the removal is the claim, so a reap
        running at the same moment either finds the launch and owns its ending or
        finds nothing at all. Removing it after the kill left a window in which
        both paths reported the same launch, and the later of the two wrote its
        own account over the other's.
        """

        with self._lock:
            live = self._running.pop(reference, None)
        if live is None:
            raise LaunchError(f"work item {reference} has no launch in this platform process")
        code = live.process.poll()
        if code is not None:
            if live.runtime is not None:
                live.runtime.cleanup()
            return {
                "reference": reference,
                "stopped": False,
                "exit_code": code,
                "launch_id": live.launch_id,
                "execution_id": live.execution_id,
                "client_session_id": live.capture.client_session_id,
            }
        # A client spawns its own children; terminating it alone leaves them.
        stopped_tree = processes.stop_process_tree(live.process, wait_timeout=10)
        if live.runtime is not None:
            live.runtime.cleanup()
        return {
            "reference": reference,
            "stopped": True,
            "launch_id": live.launch_id,
            "execution_id": live.execution_id,
            "cwd": live.cwd,
            "client_session_id": live.capture.client_session_id,
            "tree": stopped_tree,
        }

    def reap(self) -> list[dict]:
        """Launches that ended since the last look, with their exit codes.

        Polling and claiming happen together under the lock — both are cheap and
        neither blocks — so a launch this reap is about to report cannot also be
        stopped from a request thread halfway through. Reading the result and
        clearing the runtime happen outside it, because those touch the disk.
        """

        with self._lock:
            claimed = list(self._finished)
            self._finished.clear()
            for reference, live in list(self._running.items()):
                code = live.process.poll()
                if code is None:
                    continue
                claimed.append((reference, live, code))
                self._running.pop(reference, None)
        finished = []
        for reference, live, code in claimed:
            if live.reader is not None:
                live.reader.join(timeout=1)
            # What the ending meant is `executions.results`; this hands over the
            # output and the exit code and forms no opinion about either.
            result = results.classify(
                client=live.packet.client,
                expected_effect=live.packet.expected_effect,
                review_mode=live.packet.review_mode,
                exit_code=code,
                lines=list(live.capture.lines),
                result_path=live.result_path,
            )
            detail = "\n".join(live.capture.lines)[-2000:]
            finished.append(
                {
                    "reference": reference,
                    "launch_id": live.launch_id,
                    "execution_id": live.execution_id,
                    "cwd": live.cwd,
                    "exit_code": code,
                    "client": live.packet.client,
                    "detail": detail,
                    "client_session_id": live.capture.client_session_id,
                    "resumed_from": live.resumed_from,
                    "result": result,
                }
            )
            if live.runtime is not None:
                live.runtime.cleanup()
        return finished


# One launcher for the whole process. A read reports whether a work item is
# running and the execution surface starts and stops them; both need the same
# instance, and neither owns the other.
RUNNER = Runner()
