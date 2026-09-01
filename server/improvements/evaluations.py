"""Disposable, before/after EvaluationPack execution.

Evaluation packs are data, not model-authored commands.  Every command is an
explicit argv list and is executed only in a detached Git worktree created by
this module.  The source checkout is never used as a command cwd and cleanup
will remove a directory only after Git proves that it is the exact worktree we
created.
"""

from __future__ import annotations

import contextlib
import hashlib
import os
import re
import subprocess
import sys
import tempfile
import threading
import uuid
from collections import deque
from collections.abc import Callable, Iterable, Iterator, Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any

from .. import git_worktrees, processes
from .evaluation_contract import (
    EVAL_PACK_INTERFACE_VERSION,
    MAX_ASSERTIONS,
    MAX_SCENARIOS,
    EvaluationContractError,
    canonical_evaluation_pack,
    evaluation_pack_hash,
    normalize_eval_run,
)

API_VERSION = "improvements-api"
DEFAULT_TIMEOUT = 30.0
DEFAULT_OUTPUT_CHARS = 16_000
# The scenario and assertion maxima have one owner, `evaluation_contract`, which
# already owns the canonical pack and its hash. This module used to declare a
# looser pair of its own, reachable only by direct `EvaluationPack(...)`
# construction, so the same concept had two numbers and the bound a pack met
# depended on which door it came through.
MAX_ARGV_ITEMS = 128
MAX_ARG_CHARS = 4_000
MAX_TIMEOUT = 3_600.0
_REF_RE = re.compile(r"^[^\x00\r\n\t ]+$")


class EvaluationError(ValueError):
    """The pack or repository cannot be evaluated safely."""


class EvaluationPreflightError(EvaluationError):
    """A repository, ref, or disposable target failed the safety preflight."""


class _OutputRing:
    def __init__(self, limit: int) -> None:
        self.limit = max(1, limit)
        self.chunks: deque[bytes] = deque()
        self.size = 0
        self.truncated = False
        self.lock = threading.Lock()

    def append(self, payload: bytes) -> None:
        with self.lock:
            self.chunks.append(payload)
            self.size += len(payload)
            while self.size > self.limit and self.chunks:
                removed = self.chunks.popleft()
                self.size -= len(removed)
                self.truncated = True

    def text(self) -> str:
        with self.lock:
            return b"".join(self.chunks).decode("utf-8", "replace")[-self.limit :]


@dataclass(frozen=True)
class EvaluationPack:
    """Versioned data shared byte-for-byte by baseline and candidate runs."""

    version: str
    scenarios: tuple[Any, ...] = ()
    assertions: tuple[Any, ...] = ()
    provenance: Mapping[str, Any] = field(default_factory=dict)
    failure_examples: tuple[Any, ...] = ()
    negative_control: Any = None

    def __post_init__(self) -> None:
        if (
            not isinstance(self.version, str)
            or not self.version
            or len(self.version) > MAX_ARG_CHARS
        ):
            raise EvaluationError("EvaluationPack.version is required")

        def require_safety_guards(value: Any) -> Any:
            """Force safety/guard assertions to be required in direct packs.

            Mapping input crossing ``from_dict`` is strictly validated by the
            shared contract (and therefore rejected when optional).  Direct
            dataclass construction predates that boundary; normalising it
            here keeps the historical runner seam fail-closed without
            allowing an optional safety assertion to affect pass/fail status.
            """
            if isinstance(value, Mapping):
                item = {key: require_safety_guards(raw) for key, raw in value.items()}
                kind = str(item.get("type", item.get("kind", ""))).lower()
                if item.get("safety") or item.get("guard") or kind in {"guard", "guard_regression"}:
                    item["required"] = True
                return item
            if isinstance(value, tuple):
                return tuple(require_safety_guards(item) for item in value)
            if isinstance(value, list):
                return [require_safety_guards(item) for item in value]
            return value

        object.__setattr__(
            self,
            "scenarios",
            tuple(require_safety_guards(item) for item in (self.scenarios or ())),
        )
        object.__setattr__(
            self,
            "assertions",
            tuple(require_safety_guards(item) for item in (self.assertions or ())),
        )
        object.__setattr__(self, "failure_examples", tuple(self.failure_examples or ()))
        object.__setattr__(self, "provenance", dict(self.provenance or {}))
        if len(self.scenarios) > MAX_SCENARIOS or len(self.assertions) > MAX_ASSERTIONS:
            raise EvaluationError("evaluation pack exceeds scenario/assertion limits")

    @classmethod
    def from_dict(cls, value: Mapping[str, Any]) -> EvaluationPack:
        try:
            canonical = canonical_evaluation_pack(value)
        except EvaluationContractError as error:
            # Preserve the runner's public exception while retaining the
            # canonical contract as the single validation/hash authority.
            raise EvaluationError(str(error)) from error
        return cls(
            version=canonical["version"],
            scenarios=tuple(canonical["scenarios"]),
            assertions=tuple(canonical["assertions"]),
            provenance=dict(canonical["provenance"]),
            failure_examples=tuple(canonical["failure_examples"]),
            negative_control=canonical["negative_control"],
        )

    def as_dict(self) -> dict[str, Any]:
        return canonical_evaluation_pack(
            {
                "interface_version": EVAL_PACK_INTERFACE_VERSION,
                "version": self.version,
                "scenarios": list(self.scenarios),
                "assertions": list(self.assertions),
                "provenance": dict(self.provenance),
                "failure_examples": list(self.failure_examples),
                "negative_control": self.negative_control,
            }
        )

    def digest(self) -> str:
        return evaluation_pack_hash(self.as_dict())


def _git_bytes(repo: str, *args: str) -> subprocess.CompletedProcess:
    """A patch is bytes: its hash must not depend on decoding it first."""
    return subprocess.run(["git", "-C", repo, *args], capture_output=True, shell=False, check=False)


def _registered_worktrees(repo: str) -> dict[str, dict[str, str]]:
    try:
        return git_worktrees.registered_worktrees(repo)
    except git_worktrees.WorktreeListError as failure:
        raise EvaluationPreflightError("cannot list registered Git worktrees") from failure


@contextlib.contextmanager
def _as_preflight_error() -> Iterator[None]:
    """Say a path or ref refusal in this module's own words, in one place.

    The checks themselves belong to `git_worktrees` — it owns what a canonical
    path is and what a reparse point is, and a second copy of either is how the
    junction check once had two answers. What is local is the vocabulary a
    caller of an evaluation gets back.
    """

    try:
        yield
    except git_worktrees.PathSafetyError as refusal:
        raise EvaluationPreflightError(str(refusal)) from refusal


def preflight_repo(repo: str, git_ref: str = "HEAD", target: str | None = None) -> dict[str, Any]:
    """Prove repository identity, immutable ref, and a safe target path."""
    with _as_preflight_error():
        return _preflight_repo(repo, git_ref, target)


def _preflight_repo(repo: str, git_ref: str, target: str | None) -> dict[str, Any]:
    supplied = git_worktrees.canonical(repo)
    if not os.path.isdir(supplied):
        raise EvaluationPreflightError("evaluation repo is not a directory")
    top = git_worktrees.git_text(supplied, "rev-parse", "--show-toplevel")
    if top.returncode:
        raise EvaluationPreflightError("evaluation repo is not a Git repository")
    root = git_worktrees.canonical(top.stdout.strip())
    if supplied != root:
        raise EvaluationPreflightError("repo must be the Git top-level directory")
    superproject = git_worktrees.git_text(root, "rev-parse", "--show-superproject-working-tree")
    if superproject.returncode == 0 and superproject.stdout.strip():
        raise EvaluationPreflightError("refusing a submodule working copy")
    ref = git_worktrees.safe_ref(git_ref)
    resolved = git_worktrees.git_text(root, "rev-parse", "--verify", f"{ref}^{{commit}}")
    if resolved.returncode:
        raise EvaluationPreflightError("git_ref does not resolve to a commit")
    commit = resolved.stdout.strip()
    registered = _registered_worktrees(root)
    info: dict[str, Any] = {
        "repo": root,
        "git_ref": commit,
        "requested_ref": ref,
        "registered": registered,
    }
    if target is not None:
        lexical_target = git_worktrees.lexical_path(target)
        intended = git_worktrees.canonical(lexical_target)
        if git_worktrees.contains(intended, root, equal=True):
            raise EvaluationPreflightError("disposable target must not be inside the source repo")
        if git_worktrees.is_reparse_point(intended):
            raise EvaluationPreflightError("disposable target is a symlink or reparse point")
        if intended in registered:
            raise EvaluationPreflightError("disposable target is already a registered worktree")
        if os.path.exists(intended):
            raise EvaluationPreflightError("disposable target already exists")
        parent = git_worktrees.canonical(os.path.dirname(intended))
        if not os.path.isdir(parent) or git_worktrees.is_reparse_point(parent):
            raise EvaluationPreflightError("disposable target parent is not a normal directory")
        info["target"] = intended
    return info


def _patch_hash(repo: str, commit: str) -> str:
    parent = git_worktrees.git_text(repo, "rev-parse", "--verify", f"{commit}^")
    if parent.returncode == 0:
        diff = _git_bytes(repo, "diff", "--binary", parent.stdout.strip(), commit)
    else:
        # ``git diff <fake-base>`` used to turn a root-commit failure into the
        # hash of an empty patch.  Ask Git for an explicit root diff instead and
        # fail closed if Git still cannot produce it.
        diff = _git_bytes(repo, "diff-tree", "--root", "--binary", "--no-commit-id", commit)
    if diff.returncode != 0 or not isinstance(diff.stdout, (bytes, bytearray)):
        raise EvaluationPreflightError("cannot compute immutable patch hash")
    payload = bytes(diff.stdout)
    return hashlib.sha256(payload).hexdigest()


def _argv(command: Any) -> tuple[str, ...]:
    if isinstance(command, (str, bytes)) or not isinstance(command, Sequence):
        raise EvaluationError("pack commands must be explicit argv arrays")
    value = tuple(command)
    if not value or any(not isinstance(part, str) or not part for part in value):
        raise EvaluationError("pack commands must contain non-empty strings")
    if len(value) > MAX_ARGV_ITEMS or any(len(part) > MAX_ARG_CHARS for part in value):
        raise EvaluationError("pack command exceeds argv limits")
    return value


def _safe_file(worktree: str, relative: Any) -> str:
    if not isinstance(relative, str) or not relative or os.path.isabs(relative):
        raise EvaluationError("assertion path must be a relative worktree path")
    candidate = git_worktrees.canonical(os.path.join(worktree, relative))
    if not git_worktrees.contains(candidate, worktree):
        raise EvaluationError("assertion path escapes the disposable worktree")
    return candidate


def _text(value: Any, limit: int) -> str:
    if isinstance(value, bytes):
        value = value.decode("utf-8", "replace")
    return str(value)[-limit:]


class EvaluationRunner:
    """Run one immutable pack in one disposable detached worktree."""

    @staticmethod
    def normalize_result(
        result: Mapping[str, Any],
        *,
        expected_phase: str | None = None,
        expected_pack_version: str | None = None,
        expected_pack_hash: str | None = None,
        expected_git_ref: str | None = None,
    ) -> dict[str, Any]:
        """Validate and redact one raw run for persistence.

        ``run`` deliberately retains bounded output and error details for an
        in-memory diagnostic.  Callers crossing the storage boundary must use
        this canonical normalizer, which strips those fields and fails closed
        on infrastructure or source-integrity failures.
        """
        return normalize_eval_run(
            result,
            expected_phase=expected_phase,
            expected_pack_version=expected_pack_version,
            expected_pack_hash=expected_pack_hash,
            expected_git_ref=expected_git_ref,
        )

    def __init__(
        self,
        *,
        command_runner: Callable[..., Mapping[str, Any]] | None = None,
        stop_tree: Callable[[Any], Any] | None = None,
        max_output_chars: int = DEFAULT_OUTPUT_CHARS,
        default_timeout: float = DEFAULT_TIMEOUT,
        temp_root_factory: Callable[..., str] | None = None,
        allowed_executables: Iterable[str] | Callable[[tuple[str, ...]], bool] | None = None,
        allow_command: Callable[[tuple[str, ...]], bool] | Iterable[str] | None = None,
    ) -> None:
        self._command_runner = command_runner
        self._stop_tree = stop_tree
        self.max_output_chars = max(1, int(max_output_chars))
        self.default_timeout = self._timeout(default_timeout)
        self._temp_root = temp_root_factory or tempfile.mkdtemp
        self._custom_temp_root_factory = temp_root_factory is not None
        policy = allow_command if allow_command is not None else allowed_executables
        self._command_policy_supplied = policy is not None
        self._executable_validator: Callable[[tuple[str, ...]], bool] | None
        if callable(policy):
            self._executable_validator = policy
            self._allowed_executables: set[str] | None = None
        else:
            self._executable_validator = None
            configured = set(policy or ())
            self._allowed_executables = {os.path.normcase(str(item)) for item in configured}

    preflight = staticmethod(preflight_repo)

    def _new_temp_root(self) -> tuple[str, str, bool]:
        """Create/validate a fresh private root; never trust a broad factory path."""
        prefix = f"valkama-eval-{uuid.uuid4().hex}-"
        try:
            produced = self._temp_root(prefix=prefix)
        except TypeError:
            produced = self._temp_root(prefix)
        if not isinstance(produced, (str, os.PathLike)):
            raise EvaluationPreflightError("temporary root factory returned no path")
        with _as_preflight_error():
            raw = git_worktrees.lexical_path(produced)
        if self._custom_temp_root_factory and not os.path.basename(
            os.path.normpath(raw)
        ).startswith(prefix):
            raise EvaluationPreflightError(
                "temporary root factory did not return a fresh unique path"
            )
        # Both the stdlib factory and a trusted test factory must return a
        # directory they just created, with no sentinel or surprise content.
        with _as_preflight_error():
            checked, canonical = git_worktrees.safe_temp_root(raw, require_empty=True)
        return checked, canonical, not self._custom_temp_root_factory

    def _add_worktree(self, repo: str, commit: str, target: str) -> None:
        checked = preflight_repo(repo, commit, target)
        parent = os.path.dirname(checked["target"])
        if git_worktrees.canonical(parent) != git_worktrees.canonical(os.path.dirname(target)):
            raise EvaluationPreflightError("target changed during preflight")
        os.makedirs(parent, exist_ok=False) if not os.path.isdir(parent) else None
        added = git_worktrees.git_text(repo, "worktree", "add", "--detach", target, commit)
        if added.returncode:
            raise EvaluationPreflightError("Git could not create the disposable worktree")
        registered = _registered_worktrees(repo)
        key = git_worktrees.canonical(target)
        if key not in registered:
            raise EvaluationPreflightError("Git did not register the disposable worktree")
        top = git_worktrees.git_text(target, "rev-parse", "--show-toplevel")
        if top.returncode or git_worktrees.canonical(top.stdout.strip()) != key:
            raise EvaluationPreflightError("disposable worktree identity mismatch")

    def _cleanup(self, repo: str, target: str, temp_root: str, *, remove_root: bool = True) -> bool:
        """Remove only a worktree whose registration and identity still match."""
        try:
            lexical_root = git_worktrees.lexical_path(temp_root)
            lexical_target = git_worktrees.lexical_path(target)
            key = git_worktrees.canonical(lexical_target)
            registered = _registered_worktrees(repo)
            if key not in registered:
                return False
            top = git_worktrees.git_text(target, "rev-parse", "--show-toplevel")
            if top.returncode or git_worktrees.canonical(top.stdout.strip()) != key:
                return False
            removed = git_worktrees.git_text(repo, "worktree", "remove", "--force", target)
            if removed.returncode or os.path.exists(target):
                return False
            root = git_worktrees.canonical(lexical_root)
            if not git_worktrees.contains(key, root):
                return False
            if remove_root:
                # The root was proved empty before worktree creation.  Use a
                # non-recursive remove so a surprise file can never be erased.
                os.rmdir(lexical_root)
                return not os.path.lexists(lexical_root)
            return True
        except (OSError, EvaluationPreflightError):
            return False

    def _stop(self, process: Any) -> None:
        if self._stop_tree is not None:
            self._stop_tree(process)
            return
        processes.stop_process_tree(process)

    def _command(self, command: Any) -> tuple[str, ...]:
        value = _argv(command)
        if not self._command_policy_supplied:
            raise EvaluationError("command assertions require an integration allow_command policy")
        if self._executable_validator is not None:
            try:
                allowed = bool(self._executable_validator(value))
            except Exception as error:
                raise EvaluationError(f"executable policy failed: {error}") from error
        else:
            executable = os.path.normcase(value[0])
            basename = os.path.normcase(os.path.basename(value[0]))
            allowed = executable in (self._allowed_executables or set()) or basename in (
                self._allowed_executables or set()
            )
        if not allowed:
            raise EvaluationError(f"executable {value[0]!r} is not allowed by the eval policy")
        return value

    @staticmethod
    def _timeout(value: Any) -> float:
        try:
            selected = float(value)
        except (TypeError, ValueError) as error:
            raise EvaluationError("assertion timeout must be numeric") from error
        if selected <= 0 or selected > MAX_TIMEOUT:
            raise EvaluationError("assertion timeout is outside the permitted bounds")
        return selected

    def _run_command(
        self, command: Sequence[str], cwd: str, timeout: float, env: Mapping[str, str] | None = None
    ) -> dict[str, Any]:
        if self._command_runner is not None:
            try:
                result = self._command_runner(tuple(command), cwd, timeout, env)
            except TypeError:
                # Keep the seam convenient for tests that only need argv/cwd/
                # timeout while production callers may also inspect env.
                result = self._command_runner(tuple(command), cwd, timeout)
            if not isinstance(result, Mapping):
                raise EvaluationError("command runner must return an object")
            return dict(result)
        flags = getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0) if sys.platform == "win32" else 0
        process = subprocess.Popen(
            list(command),
            cwd=cwd,
            env=dict(env) if env is not None else None,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            creationflags=flags,
            start_new_session=sys.platform != "win32",
            shell=False,
        )
        ring = _OutputRing(self.max_output_chars)

        def drain() -> None:
            stream = process.stdout
            if stream is None:
                return
            try:
                while True:
                    chunk = stream.read(4096)
                    if not chunk:
                        break
                    ring.append(chunk)
            except (OSError, ValueError):
                return
            finally:
                with contextlib.suppress(OSError, ValueError):
                    stream.close()

        reader = threading.Thread(target=drain, name="eval-output", daemon=True)
        reader.start()
        try:
            process.wait(timeout=timeout)
            timed_out = False
        except subprocess.TimeoutExpired:
            self._stop(process)
            timed_out = True
        reader.join(timeout=2)
        output = ring.text().encode("utf-8", "replace")
        return {
            "exit_code": None if timed_out else process.returncode,
            "timed_out": timed_out,
            "output": _text(output, self.max_output_chars),
            "truncated": ring.truncated,
        }

    def _scenarios(self, pack: EvaluationPack) -> list[Mapping[str, Any]]:
        if pack.scenarios:
            result = []
            for item in pack.scenarios:
                if not isinstance(item, Mapping):
                    raise EvaluationError("each evaluation scenario must be an object")
                result.append(item)
            if pack.negative_control is not None:
                result.append(self._negative_control(pack.negative_control))
            if len(result) > MAX_SCENARIOS:
                raise EvaluationError("evaluation pack exceeds scenario limit")
            return result
        # A pack may consist solely of assertions; run those as one scenario.
        result = [{"name": "default", "assertions": list(pack.assertions)}]
        if pack.negative_control is not None:
            result.append(self._negative_control(pack.negative_control))
        return result

    @staticmethod
    def _negative_control(value: Any) -> Mapping[str, Any]:
        if isinstance(value, Mapping):
            control = dict(value)
            control.setdefault("name", "negative_control")
            return control
        if isinstance(value, Sequence) and not isinstance(value, (str, bytes)):
            return {
                "name": "negative_control",
                "command": list(value),
                "assertions": [{"type": "command_exit", "expected": 0}],
            }
        raise EvaluationError("negative_control must be a scenario object or argv")

    def _assertions_for(
        self, pack: EvaluationPack, scenario: Mapping[str, Any]
    ) -> list[Mapping[str, Any]]:
        values = scenario.get("assertions", pack.assertions)
        if values is None:
            return []
        if not isinstance(values, Sequence) or isinstance(values, (str, bytes)):
            raise EvaluationError("scenario assertions must be an array")
        assertions = []
        for assertion in values:
            if not isinstance(assertion, Mapping):
                raise EvaluationError("each evaluation assertion must be an object")
            assertions.append(assertion)
        return assertions

    @staticmethod
    def _failure_designations(pack: EvaluationPack) -> set[str]:
        names: set[str] = set()
        for example in pack.failure_examples:
            if isinstance(example, str):
                names.add(example)
            elif isinstance(example, Mapping):
                for key in ("name", "assertion", "case_key"):
                    if isinstance(example.get(key), str):
                        names.add(example[key])
        return names

    def _run_scenario(
        self,
        worktree: str,
        pack: EvaluationPack,
        scenario: Mapping[str, Any],
        *,
        judge: Callable[..., Any] | None,
    ) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        assertions = self._assertions_for(pack, scenario)
        command_cache: dict[tuple[str, ...], dict[str, Any]] = {}
        results: list[dict[str, Any]] = []
        deferred: list[dict[str, Any]] = []
        scenario_command = scenario.get("command", scenario.get("argv"))
        for assertion in assertions:
            kind = str(assertion.get("type", assertion.get("kind", ""))).lower()
            required = bool(assertion.get("required", True))
            if (
                assertion.get("safety")
                or assertion.get("guard")
                or kind
                in (
                    "guard",
                    "guard_regression",
                )
            ):
                required = True
            base = {
                "name": str(assertion.get("name", kind)),
                "type": kind,
                "required": required,
                "safety": bool(assertion.get("safety", False)),
                "guard": bool(assertion.get("guard", False)),
                "baseline_failure": bool(assertion.get("baseline_failure", False)),
                "expected_failure": bool(assertion.get("expected_failure", False)),
            }
            if kind in ("judge", "cli_judge", "non_deterministic"):
                deferred.append({**base, "assertion": assertion})
                continue
            detail = dict(base)
            if kind in ("command_exit", "exit"):
                raw_command = assertion.get("command", scenario_command)
                if raw_command is None:
                    detail.update({"passed": False, "error": "command is required"})
                else:
                    command = self._command(raw_command)
                    if command not in command_cache:
                        timeout = self._timeout(
                            assertion.get("timeout", scenario.get("timeout", self.default_timeout))
                        )
                        command_cache[command] = self._run_command(command, worktree, timeout)
                    observed = command_cache[command]
                    expected = assertion.get("expected", assertion.get("exit_code", 0))
                    passed = (
                        not observed.get("timed_out", False)
                        and observed.get("exit_code") == expected
                    )
                    detail.update(
                        {
                            "passed": bool(passed),
                            "expected": expected,
                            "observed": observed.get("exit_code"),
                            "timed_out": bool(observed.get("timed_out", False)),
                            "output": _text(observed.get("output", ""), self.max_output_chars),
                            "truncated": bool(observed.get("truncated", False)),
                        }
                    )
            elif kind in ("file_contains", "file_not_contains"):
                try:
                    path = _safe_file(worktree, assertion.get("path", ""))
                    # Strict on purpose: this text routes a pass/fail decision,
                    # so a byte that is not UTF-8 must be reported rather than
                    # replaced. Decoding it leniently turned an unreadable byte
                    # into U+FFFD, which can hide a needle or invent one, and an
                    # evaluation cannot honestly say a needle is absent from
                    # bytes it never read.
                    with open(path, encoding="utf-8", errors="strict") as handle:
                        content = handle.read(self.max_output_chars + 1)
                    if len(content) > self.max_output_chars:
                        content = content[-self.max_output_chars :]
                        detail["truncated"] = True
                    needle = assertion.get(
                        "text", assertion.get("contains", assertion.get("needle", ""))
                    )
                    if not isinstance(needle, str):
                        raise EvaluationError("file assertion text must be a string")
                    found = needle in content
                    passed = found if kind == "file_contains" else not found
                    detail.update({"passed": passed, "path": assertion.get("path"), "found": found})
                except UnicodeDecodeError as error:
                    detail.update(
                        {
                            "passed": False,
                            "path": assertion.get("path"),
                            "error": f"file is not valid UTF-8: {error}",
                        }
                    )
                except (OSError, EvaluationError) as error:
                    detail.update({"passed": False, "error": str(error)})
            else:
                detail.update({"passed": False, "error": "unknown deterministic assertion"})
            results.append(detail)

        deterministic_failed = any(
            item.get("required") and not item.get("passed", False) for item in results
        )
        if deferred and not deterministic_failed:
            for item in deferred:
                detail = {key: value for key, value in item.items() if key != "assertion"}
                assertion = item["assertion"]
                try:
                    if judge is not None:
                        judged = judge(worktree, assertion)
                    elif assertion.get("command") is not None:
                        command = self._command(assertion["command"])
                        timeout = self._timeout(assertion.get("timeout", self.default_timeout))
                        judged = self._run_command(command, worktree, timeout)
                        judged = {
                            "passed": judged.get("exit_code") == assertion.get("expected", 0)
                            and not judged.get("timed_out", False),
                            **judged,
                        }
                    else:
                        judged = {"passed": False, "error": "judge unavailable"}
                    if isinstance(judged, Mapping):
                        detail.update(dict(judged))
                    else:
                        detail["passed"] = bool(judged)
                except Exception as error:
                    detail.update({"passed": False, "error": str(error)})
                results.append(detail)
        else:
            results.extend(
                {key: value for key, value in item.items() if key != "assertion"}
                | {"passed": False, "skipped": True, "error": "deterministic assertion failed"}
                for item in deferred
            )
        return results, deferred

    def run(
        self,
        pack: EvaluationPack | Mapping[str, Any],
        repo: str,
        git_ref: str = "HEAD",
        phase: str = "baseline",
        *,
        judge: Callable[..., Any] | None = None,
        target_dir: str | None = None,
        temp_root: str | None = None,
        job_id: str = "",
    ) -> dict[str, Any]:
        if not isinstance(pack, EvaluationPack):
            pack = EvaluationPack.from_dict(pack)
        if phase not in ("baseline", "candidate"):
            raise EvaluationError("evaluation phase must be baseline or candidate")
        source = (
            preflight_repo(repo, git_ref, target_dir)
            if target_dir
            else preflight_repo(repo, git_ref)
        )
        source_head = git_worktrees.git_text(source["repo"], "rev-parse", "HEAD").stdout.strip()
        source_status = git_worktrees.git_text(source["repo"], "status", "--porcelain").stdout
        registered_before = set(source["registered"])
        refs_before_result = git_worktrees.git_text(
            source["repo"], "for-each-ref", "--format=%(refname)=%(objectname)"
        )
        if refs_before_result.returncode:
            raise EvaluationPreflightError("cannot capture source refs")
        refs_before = refs_before_result.stdout
        patch_hash = _patch_hash(source["repo"], source["git_ref"])
        root_owned = temp_root is None
        if temp_root is None:
            temp_root, canonical_root, root_owned = self._new_temp_root()
        else:
            with _as_preflight_error():
                lexical_root, canonical_root = git_worktrees.safe_temp_root(
                    temp_root, require_empty=False
                )
            temp_root = lexical_root
        target_input = target_dir or os.path.join(temp_root, "worktree")
        with _as_preflight_error():
            lexical_target = git_worktrees.lexical_path(target_input)
        target = git_worktrees.canonical(lexical_target)
        if git_worktrees.is_reparse_point(lexical_target):
            raise EvaluationPreflightError("worktree target is a symlink or reparse point")
        if not git_worktrees.contains(target, canonical_root):
            raise EvaluationPreflightError("worktree target escapes its temporary root")
        if os.path.exists(target):
            raise EvaluationPreflightError("worktree target already exists")
        created = False
        cleanup_verified = False
        assertions: list[dict[str, Any]] = []
        error_code = ""
        infrastructure_failure = False
        failure_names = self._failure_designations(pack)
        try:
            self._add_worktree(source["repo"], source["git_ref"], target)
            created = True
            for scenario in self._scenarios(pack):
                scenario_results, _ = self._run_scenario(target, pack, scenario, judge=judge)
                assertions.extend(
                    {"scenario": str(scenario.get("name", "default")), **detail}
                    for detail in scenario_results
                )
            for assertion in assertions:
                if assertion.get("name") in failure_names:
                    assertion["baseline_failure"] = True
            required_failures = [
                item
                for item in assertions
                if item.get("required") and not item.get("passed", False)
            ]
            safety_regressions = [item["name"] for item in required_failures if item.get("safety")]
            guard_regressions = [
                item["name"]
                for item in required_failures
                if item.get("guard") or item.get("type") in ("guard", "guard_regression")
            ]
            passed = not required_failures
            expected_baseline_failure = any(
                (
                    item.get("baseline_failure")
                    or item.get("expected_failure")
                    or item.get("name") in failure_names
                )
                and not item.get("passed", False)
                and not item.get("error")
                and not item.get("timed_out", False)
                and item.get("type")
                in ("command_exit", "exit", "file_contains", "file_not_contains")
                for item in assertions
            )
            infrastructure_failure = any(
                item.get("required")
                and not item.get("passed", False)
                and (
                    item.get("error")
                    or item.get("timed_out", False)
                    or item.get("type")
                    not in (
                        "command_exit",
                        "exit",
                        "file_contains",
                        "file_not_contains",
                        "judge",
                        "cli_judge",
                        "non_deterministic",
                    )
                )
                for item in assertions
            )
            error_code = (
                "evaluation_error"
                if infrastructure_failure
                else (
                    ""
                    if phase == "baseline" and expected_baseline_failure
                    else ("assertion_failed" if not passed else "")
                )
            )
        except EvaluationPreflightError:
            raise
        except (EvaluationError, OSError, subprocess.SubprocessError) as error:
            error_code = "evaluation_error"
            assertions.append(
                {
                    "name": "runner",
                    "type": "runner",
                    "required": True,
                    "passed": False,
                    "error": str(error),
                }
            )
            passed = False
            safety_regressions = []
            guard_regressions = []
            infrastructure_failure = True
        finally:
            if created:
                cleanup_verified = self._cleanup(
                    source["repo"], target, temp_root, remove_root=root_owned
                )
            else:
                # ``git worktree add`` can register a directory and then fail
                # during our verification.  Probe registration before removing
                # the private temp root; a verified partial worktree is cleaned
                # with the same guarded path, otherwise the target is left for
                # an operator rather than recursively deleting a surprise.
                try:
                    if git_worktrees.canonical(target) in _registered_worktrees(source["repo"]):
                        cleanup_verified = self._cleanup(
                            source["repo"], target, temp_root, remove_root=root_owned
                        )
                except (EvaluationPreflightError, OSError):
                    cleanup_verified = False
            if not cleanup_verified and root_owned and os.path.isdir(temp_root):
                # No Git worktree was created; the fresh private temp root is safe
                # to remove, but never recursively remove a caller-owned root.
                try:
                    lexical_root = git_worktrees.lexical_path(temp_root)
                    root = git_worktrees.canonical(lexical_root)
                    temp_parent = git_worktrees.canonical(tempfile.gettempdir())
                    if git_worktrees.contains(root, temp_parent) and git_worktrees.canonical(
                        target
                    ) not in _registered_worktrees(source["repo"]):
                        os.rmdir(lexical_root)
                except (OSError, EvaluationPreflightError):
                    pass
        source_after = git_worktrees.git_text(source["repo"], "rev-parse", "HEAD").stdout.strip()
        status_after = git_worktrees.git_text(source["repo"], "status", "--porcelain").stdout
        registered_after = set(_registered_worktrees(source["repo"]))
        refs_after_result = git_worktrees.git_text(
            source["repo"], "for-each-ref", "--format=%(refname)=%(objectname)"
        )
        refs_unchanged = (
            refs_after_result.returncode == 0 and refs_before == refs_after_result.stdout
        )
        registrations_unchanged = registered_before == registered_after
        source_unchanged = (
            source_head == source_after
            and source_status == status_after
            and refs_unchanged
            and registrations_unchanged
        )
        designated_failures = [
            item
            for item in assertions
            if (
                item.get("baseline_failure")
                or item.get("expected_failure")
                or item.get("name") in failure_names
            )
            and not item.get("passed", False)
            and not item.get("error")
            and not item.get("timed_out", False)
            and item.get("type") in ("command_exit", "exit", "file_contains", "file_not_contains")
        ]
        # A candidate may fail the same assertion that is designated as the
        # baseline reproduction, but only the baseline run can carry the
        # designation across the persistence boundary.
        baseline_failure_designated = phase == "baseline" and bool(designated_failures)
        reproduced_failure = (
            phase == "baseline"
            and baseline_failure_designated
            and not infrastructure_failure
            and not error_code
            and cleanup_verified
            and source_unchanged
        )
        try:
            pack_hash = pack.digest()
        except EvaluationContractError:
            # Directly constructed packs can contain a legacy unknown
            # assertion kind.  Keep the diagnostic result available to the
            # caller, but leave its hash empty so the canonical persistence
            # normalizer rejects it rather than persisting an unverifiable
            # representation.
            pack_hash = ""
        return {
            "interface_version": API_VERSION,
            "job_id": job_id,
            "phase": phase,
            "pack_version": pack.version,
            "pack_hash": pack_hash,
            "git_ref": source["git_ref"],
            "patch_hash": patch_hash,
            "assertions": assertions,
            "passed": passed,
            "baseline_failure_designated": baseline_failure_designated,
            "infrastructure_failure": infrastructure_failure,
            "reproduced_failure": reproduced_failure,
            "safety_regressions": safety_regressions,
            "guard_regressions": guard_regressions,
            "error_code": error_code,
            "cleanup_verified": cleanup_verified,
            "source_unchanged": source_unchanged,
            "registrations_unchanged": registrations_unchanged,
            "refs_unchanged": refs_unchanged,
        }

    def run_before_after(
        self,
        pack: EvaluationPack | Mapping[str, Any],
        repo: str,
        baseline_ref: str,
        candidate_ref: str,
        *,
        judge: Callable[..., Any] | None = None,
        job_id: str = "",
    ) -> dict[str, Any]:
        """Run the identical pack before and after and return the guard facts."""
        if not isinstance(pack, EvaluationPack):
            pack = EvaluationPack.from_dict(pack)
        baseline = self.run(pack, repo, baseline_ref, "baseline", judge=judge, job_id=job_id)
        candidate = self.run(pack, repo, candidate_ref, "candidate", judge=judge, job_id=job_id)
        safety = list(candidate.get("safety_regressions", ()))
        guards = list(candidate.get("guard_regressions", ()))
        baseline_clean = (
            bool(baseline.get("cleanup_verified"))
            and bool(baseline.get("source_unchanged"))
            and bool(baseline.get("registrations_unchanged"))
            and bool(baseline.get("refs_unchanged"))
            and not baseline.get("error_code")
        )
        candidate_clean = (
            bool(candidate.get("cleanup_verified"))
            and bool(candidate.get("source_unchanged"))
            and bool(candidate.get("registrations_unchanged"))
            and bool(candidate.get("refs_unchanged"))
            and not candidate.get("error_code")
        )
        return {
            "interface_version": API_VERSION,
            "job_id": job_id,
            "pack_version": pack.version,
            "pack_hash": pack.digest(),
            "baseline": baseline,
            "candidate": candidate,
            "baseline_failed": bool(baseline.get("reproduced_failure")) and baseline_clean,
            "candidate_passed": bool(candidate.get("passed")) and candidate_clean,
            "safety_regressions": safety,
            "guard_regressions": guards,
            "passed": bool(baseline.get("reproduced_failure"))
            and baseline_clean
            and bool(candidate.get("passed"))
            and candidate_clean
            and not safety
            and not guards,
            "source_unchanged": bool(baseline.get("source_unchanged"))
            and bool(candidate.get("source_unchanged")),
        }


def run_evaluation(
    pack: EvaluationPack | Mapping[str, Any],
    repo: str,
    git_ref: str = "HEAD",
    phase: str = "baseline",
    **kwargs: Any,
) -> dict[str, Any]:
    """Functional convenience wrapper for integrations that do not retain a runner."""
    policy = kwargs.pop("allow_command", kwargs.pop("allowed_executables", None))
    return EvaluationRunner(allow_command=policy).run(pack, repo, git_ref, phase, **kwargs)


def normalize_evaluation_result(
    result: Mapping[str, Any],
    *,
    expected_phase: str | None = None,
    expected_pack_version: str | None = None,
    expected_pack_hash: str | None = None,
    expected_git_ref: str | None = None,
) -> dict[str, Any]:
    """Canonical persistence boundary for a raw :class:`EvaluationRunner` result."""
    return normalize_eval_run(
        result,
        expected_phase=expected_phase,
        expected_pack_version=expected_pack_version,
        expected_pack_hash=expected_pack_hash,
        expected_git_ref=expected_git_ref,
    )


def run_before_after(
    pack: EvaluationPack | Mapping[str, Any],
    repo: str,
    baseline_ref: str,
    candidate_ref: str,
    **kwargs: Any,
) -> dict[str, Any]:
    policy = kwargs.pop("allow_command", kwargs.pop("allowed_executables", None))
    return EvaluationRunner(allow_command=policy).run_before_after(
        pack, repo, baseline_ref, candidate_ref, **kwargs
    )


__all__ = [
    "API_VERSION",
    "EvaluationError",
    "EvaluationPack",
    "EvaluationPreflightError",
    "EvaluationRunner",
    "normalize_eval_run",
    "normalize_evaluation_result",
    "preflight_repo",
    "run_before_after",
    "run_evaluation",
]
