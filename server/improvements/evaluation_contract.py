"""Canonical, privacy-bounded EvaluationPack and EvalRun contracts.

Storage and the disposable runner both import this module.  Keeping hashing and
normalisation here prevents a queued pack from being evaluated or persisted
under a different representation.
"""

from __future__ import annotations

import hashlib
import json
import math
import re
from collections.abc import Mapping, Sequence
from typing import Any

API_VERSION = "improvements-api"
EVAL_PACK_INTERFACE_VERSION = "improvements-eval"
MAX_SCENARIOS = 64
MAX_ASSERTIONS = 256
MAX_FAILURE_EXAMPLES = 128
MAX_COMMAND_PARTS = 64
MAX_ARG_CHARS = 1024
MAX_COMMAND_CHARS = 8192
MAX_TEXT_CHARS = 4096
MAX_TIMEOUT_SECONDS = 600.0
MAX_RESULT_ASSERTIONS = 512
MAX_RAW_OUTPUT_CHARS = 16_000

_HEX_HASH = re.compile(r"^[0-9a-f]{64}$")
_GIT_OBJECT = re.compile(r"^[0-9a-f]{40,64}$")
_CONTROL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")
_SENSITIVE_PARTS = {
    "prompt",
    "transcript",
    "reasoning",
    "message",
    "messages",
    "output",
    "error",
    "model_message",
    "raw_output",
    "tool_input",
    "tool_result",
    "tool_output",
    "stdout",
    "stderr",
}


class EvaluationContractError(ValueError):
    """The supplied pack or run cannot cross the Improvements boundary."""


def _mapping(value: Any, path: str) -> Mapping[str, Any]:
    if not isinstance(value, Mapping):
        raise EvaluationContractError(f"{path} must be an object")
    return value


def _known(value: Mapping[str, Any], allowed: set[str], path: str) -> None:
    unknown = sorted(set(value) - allowed)
    if unknown:
        raise EvaluationContractError(f"{path}.{unknown[0]} is not a whitelisted field")


def _string(value: Any, path: str, *, limit: int = MAX_TEXT_CHARS, nonempty: bool = False) -> str:
    if not isinstance(value, str):
        raise EvaluationContractError(f"{path} must be a string")
    if _CONTROL.search(value):
        raise EvaluationContractError(f"{path} contains control characters")
    if nonempty and not value:
        raise EvaluationContractError(f"{path} is required")
    if len(value) > limit:
        raise EvaluationContractError(f"{path} exceeds {limit} characters")
    return value


def _bool(value: Any, path: str) -> bool:
    if not isinstance(value, bool):
        raise EvaluationContractError(f"{path} must be boolean")
    return value


def _ephemeral_text(value: Any, path: str, *, limit: int) -> None:
    """Validate a bounded transient string without copying it to persistence."""
    if not isinstance(value, str):
        raise EvaluationContractError(f"{path} must be a string")
    if len(value) > limit:
        raise EvaluationContractError(f"{path} exceeds {limit} characters")


def _timeout(value: Any, path: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise EvaluationContractError(f"{path} must be a finite number")
    result = float(value)
    if not math.isfinite(result) or result <= 0 or result > MAX_TIMEOUT_SECONDS:
        raise EvaluationContractError(f"{path} must be within (0,{MAX_TIMEOUT_SECONDS}]")
    return result


def _argv(value: Any, path: str) -> list[str]:
    if isinstance(value, (str, bytes)) or not isinstance(value, Sequence):
        raise EvaluationContractError(f"{path} must be an argv array")
    if not value or len(value) > MAX_COMMAND_PARTS:
        raise EvaluationContractError(f"{path} must contain 1..{MAX_COMMAND_PARTS} entries")
    result = [
        _string(item, f"{path}[{index}]", limit=MAX_ARG_CHARS, nonempty=True)
        for index, item in enumerate(value)
    ]
    if sum(len(item) for item in result) > MAX_COMMAND_CHARS:
        raise EvaluationContractError(f"{path} exceeds the command size limit")
    return result


def _safe_scalar(value: Any, path: str) -> Any:
    if value is None or isinstance(value, (str, bool, int)):
        return _string(value, path) if isinstance(value, str) else value
    if isinstance(value, float):
        if not math.isfinite(value):
            raise EvaluationContractError(f"{path} must be finite")
        return value
    raise EvaluationContractError(f"{path} must be a JSON scalar")


def _metadata(value: Any, path: str, depth: int = 0) -> Any:
    if depth > 4:
        raise EvaluationContractError(f"{path} exceeds metadata depth")
    if isinstance(value, Mapping):
        if len(value) > 64:
            raise EvaluationContractError(f"{path} has too many fields")
        result: dict[str, Any] = {}
        for raw_key in sorted(value, key=lambda item: str(item)):
            key = _string(raw_key, f"{path}.key", limit=64, nonempty=True)
            normalized_key = re.sub(r"[^a-z0-9]+", "_", key.lower()).strip("_")
            key_parts = set(normalized_key.split("_"))
            if normalized_key in _SENSITIVE_PARTS or key_parts & {
                "prompt",
                "transcript",
                "reasoning",
                "message",
                "messages",
                "output",
                "error",
                "stdout",
                "stderr",
            }:
                raise EvaluationContractError(f"{path}.{key} is sensitive")
            result[key] = _metadata(value[raw_key], f"{path}.{key}", depth + 1)
        return result
    if isinstance(value, Sequence) and not isinstance(value, (str, bytes)):
        if len(value) > 64:
            raise EvaluationContractError(f"{path} has too many items")
        return [_metadata(item, f"{path}[{index}]", depth + 1) for index, item in enumerate(value)]
    return _safe_scalar(value, path)


_ASSERTION_FIELDS = {
    "name",
    "type",
    "kind",
    "required",
    "safety",
    "guard",
    "guard_regression",
    "baseline_failure",
    "expected_failure",
    "timeout",
    "command",
    "argv",
    "expected",
    "exit_code",
    "path",
    "text",
    "contains",
    "needle",
}
_ASSERTION_TYPES = {
    "command_exit",
    "exit",
    "file_contains",
    "file_not_contains",
    "judge",
    "cli_judge",
    "non_deterministic",
    "guard",
    "guard_regression",
}


def _assertion(value: Any, path: str) -> dict[str, Any]:
    item = _mapping(value, path)
    _known(item, _ASSERTION_FIELDS, path)
    if "command" in item and "argv" in item:
        raise EvaluationContractError(f"{path} cannot contain both command and argv")
    result: dict[str, Any] = {}
    for key in ("name", "path", "text", "contains", "needle"):
        if key in item:
            limit = 1024 if key in {"name", "path"} else MAX_TEXT_CHARS
            result[key] = _string(item[key], f"{path}.{key}", limit=limit)
    for key in ("type", "kind"):
        if key in item:
            kind = _string(item[key], f"{path}.{key}", limit=64, nonempty=True).lower()
            if kind not in _ASSERTION_TYPES:
                raise EvaluationContractError(f"{path}.{key} is unsupported")
            result[key] = kind
    if "type" in result and "kind" in result and result["type"] != result["kind"]:
        raise EvaluationContractError(f"{path}.type and kind disagree")
    for key in (
        "required",
        "safety",
        "guard",
        "guard_regression",
        "baseline_failure",
        "expected_failure",
    ):
        if key in item:
            result[key] = _bool(item[key], f"{path}.{key}")
    if (
        any(bool(result.get(key)) for key in ("safety", "guard", "guard_regression"))
        and item.get("required") is False
    ):
        raise EvaluationContractError(f"{path} safety and guard assertions must be required")
    if "timeout" in item:
        result["timeout"] = _timeout(item["timeout"], f"{path}.timeout")
    for key in ("command", "argv"):
        if key in item:
            result[key] = _argv(item[key], f"{path}.{key}")
    for key in ("expected", "exit_code"):
        if key in item:
            result[key] = _safe_scalar(item[key], f"{path}.{key}")
    if "type" not in result and "kind" not in result:
        raise EvaluationContractError(f"{path}.type is required")
    return result


def _scenario(value: Any, path: str) -> dict[str, Any]:
    item = _mapping(value, path)
    allowed = {"name", "command", "argv", "timeout", "assertions"}
    _known(item, allowed, path)
    if "command" in item and "argv" in item:
        raise EvaluationContractError(f"{path} cannot contain both command and argv")
    result: dict[str, Any] = {}
    if "name" in item:
        result["name"] = _string(item["name"], f"{path}.name", limit=1024, nonempty=True)
    for key in ("command", "argv"):
        if key in item:
            result[key] = _argv(item[key], f"{path}.{key}")
    if "timeout" in item:
        result["timeout"] = _timeout(item["timeout"], f"{path}.timeout")
    if "assertions" in item:
        assertions = item["assertions"]
        if isinstance(assertions, (str, bytes)) or not isinstance(assertions, Sequence):
            raise EvaluationContractError(f"{path}.assertions must be an array")
        if len(assertions) > MAX_ASSERTIONS:
            raise EvaluationContractError(f"{path}.assertions exceeds the limit")
        result["assertions"] = [
            _assertion(assertion, f"{path}.assertions[{index}]")
            for index, assertion in enumerate(assertions)
        ]
    return result


def canonical_evaluation_pack(value: Any) -> dict[str, Any]:
    pack = _mapping(value, "pack")
    allowed = {
        "interface_version",
        "version",
        "scenarios",
        "assertions",
        "provenance",
        "failure_examples",
        "negative_control",
    }
    _known(pack, allowed, "pack")
    interface_version = pack.get("interface_version", EVAL_PACK_INTERFACE_VERSION)
    if interface_version != EVAL_PACK_INTERFACE_VERSION:
        raise EvaluationContractError("pack.interface_version is unsupported")
    version = _string(pack.get("version"), "pack.version", limit=128, nonempty=True)
    scenarios = pack.get("scenarios", []) or []
    assertions = pack.get("assertions", []) or []
    failures = pack.get("failure_examples", []) or []
    for name, items, limit in (
        ("scenarios", scenarios, MAX_SCENARIOS),
        ("assertions", assertions, MAX_ASSERTIONS),
        ("failure_examples", failures, MAX_FAILURE_EXAMPLES),
    ):
        if isinstance(items, (str, bytes)) or not isinstance(items, Sequence) or len(items) > limit:
            raise EvaluationContractError(f"pack.{name} must be an array within its limit")
    canonical_failures: list[Any] = []
    for index, example in enumerate(failures):
        path = f"pack.failure_examples[{index}]"
        if isinstance(example, str):
            canonical_failures.append(_string(example, path, nonempty=True))
        else:
            item = _mapping(example, path)
            _known(item, {"name", "assertion", "case_key"}, path)
            canonical_failures.append(
                {key: _string(item[key], f"{path}.{key}", nonempty=True) for key in sorted(item)}
            )
    negative = pack.get("negative_control")
    canonical_negative: dict | list[str] | None
    if negative is None:
        canonical_negative = None
    elif isinstance(negative, Mapping):
        canonical_negative = _scenario(negative, "pack.negative_control")
    else:
        canonical_negative = _argv(negative, "pack.negative_control")
    canonical_scenarios = [
        _scenario(item, f"pack.scenarios[{index}]") for index, item in enumerate(scenarios)
    ]
    canonical_assertions = [
        _assertion(item, f"pack.assertions[{index}]") for index, item in enumerate(assertions)
    ]
    if canonical_scenarios:
        result_assertion_count = sum(
            len(scenario.get("assertions", canonical_assertions))
            for scenario in canonical_scenarios
        )
    else:
        result_assertion_count = len(canonical_assertions)
    if isinstance(canonical_negative, Mapping):
        result_assertion_count += len(canonical_negative.get("assertions", canonical_assertions))
    elif canonical_negative is not None:
        result_assertion_count += 1
    if result_assertion_count > MAX_RESULT_ASSERTIONS:
        raise EvaluationContractError("pack can produce too many assertion results")
    return {
        "interface_version": EVAL_PACK_INTERFACE_VERSION,
        "version": version,
        "scenarios": canonical_scenarios,
        "assertions": canonical_assertions,
        "provenance": _metadata(pack.get("provenance", {}) or {}, "pack.provenance"),
        "failure_examples": canonical_failures,
        "negative_control": canonical_negative,
    }


def _canonical_json(value: Any) -> bytes:
    return json.dumps(
        value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False
    ).encode("utf-8")


def evaluation_pack_hash(value: Any) -> str:
    return hashlib.sha256(_canonical_json(canonical_evaluation_pack(value))).hexdigest()


_RUN_FIELDS = {
    "interface_version",
    "job_id",
    "phase",
    "pack_version",
    "pack_hash",
    "git_ref",
    "patch_hash",
    "assertions",
    "passed",
    "baseline_failure_designated",
    "infrastructure_failure",
    "reproduced_failure",
    "safety_regressions",
    "guard_regressions",
    "error_code",
    "cleanup_verified",
    "source_unchanged",
    "registrations_unchanged",
    "registered_worktrees_unchanged",
    "refs_unchanged",
}
_RUN_ASSERTION_FIELDS = {
    "scenario",
    "name",
    "type",
    "required",
    "safety",
    "guard",
    "guard_regression",
    "baseline_failure",
    "expected_failure",
    "passed",
    "error",
    "expected",
    "observed",
    "timed_out",
    "truncated",
    "path",
    "found",
    "skipped",
    "exit_code",
    "output",
}


def _run_assertion(value: Any, path: str) -> dict[str, Any]:
    item = _mapping(value, path)
    _known(item, _RUN_ASSERTION_FIELDS, path)
    for required_key in ("name", "type", "required", "passed"):
        if required_key not in item:
            raise EvaluationContractError(f"{path}.{required_key} is required")
    result: dict[str, Any] = {}
    for key in ("scenario", "name", "type", "path"):
        if key in item:
            result[key] = _string(item[key], f"{path}.{key}", limit=1024)
    for key in ("required", "passed"):
        result[key] = _bool(item[key], f"{path}.{key}")
    for key in ("safety", "guard", "guard_regression", "baseline_failure", "expected_failure"):
        result[key] = _bool(item.get(key, False), f"{path}.{key}")
    for key in ("timed_out", "truncated", "found", "skipped"):
        if key in item:
            result[key] = _bool(item[key], f"{path}.{key}")
    if (
        item.get("safety")
        or item.get("guard")
        or item.get("guard_regression")
        or item.get("type") in {"guard", "guard_regression"}
    ) and item.get("required") is not True:
        raise EvaluationContractError(f"{path} safety and guard results must be required")
    if "error" in item:
        # Validate the runner boundary, but never persist an exception message:
        # it may contain paths, command arguments, or tool output.
        _ephemeral_text(item["error"], f"{path}.error", limit=512)
    for key in ("expected", "observed", "exit_code"):
        if key in item:
            scalar = _safe_scalar(item[key], f"{path}.{key}")
            # String observations may contain arbitrary judge output.  The
            # boolean result is the durable evidence; keep only scalar facts
            # that cannot carry free-form text.
            if not isinstance(scalar, str):
                result[key] = scalar
    # Raw command output is deliberately accepted at the runner boundary but
    # never copied into the persistent normal form.
    if "output" in item:
        _ephemeral_text(item["output"], f"{path}.output", limit=MAX_RAW_OUTPUT_CHARS)
    return result


def _regressions(value: Any, path: str) -> list[str]:
    if isinstance(value, (str, bytes)) or not isinstance(value, Sequence) or len(value) > 128:
        raise EvaluationContractError(f"{path} must be a bounded array")
    return [
        _string(item, f"{path}[{index}]", limit=512, nonempty=True)
        for index, item in enumerate(value)
    ]


def normalize_eval_run(
    value: Any,
    *,
    expected_phase: str | None = None,
    expected_pack_version: str | None = None,
    expected_pack_hash: str | None = None,
    expected_git_ref: str | None = None,
) -> dict[str, Any]:
    run = _mapping(value, "run")
    _known(run, _RUN_FIELDS, "run")
    if run.get("interface_version") != API_VERSION:
        raise EvaluationContractError("run.interface_version is unsupported")
    phase = _string(run.get("phase"), "run.phase", limit=16, nonempty=True)
    if phase not in {"baseline", "candidate"}:
        raise EvaluationContractError("run.phase is invalid")
    pack_version = _string(
        str(run.get("pack_version", "")), "run.pack_version", limit=128, nonempty=True
    )
    pack_hash = _string(run.get("pack_hash"), "run.pack_hash", limit=64, nonempty=True)
    git_ref = _string(run.get("git_ref"), "run.git_ref", limit=64, nonempty=True)
    patch_hash = _string(run.get("patch_hash"), "run.patch_hash", limit=64, nonempty=True)
    if (
        not _HEX_HASH.fullmatch(pack_hash)
        or not _HEX_HASH.fullmatch(patch_hash)
        or not _GIT_OBJECT.fullmatch(git_ref)
    ):
        raise EvaluationContractError("run hashes or immutable git_ref are invalid")
    expected_values = (
        ("phase", phase, expected_phase),
        ("pack_version", pack_version, expected_pack_version),
        ("pack_hash", pack_hash, expected_pack_hash),
        ("git_ref", git_ref, expected_git_ref),
    )
    for field, actual, expected in expected_values:
        if expected is not None and actual != str(expected):
            raise EvaluationContractError(f"run.{field} does not match the queued request")
    assertions = run.get("assertions", [])
    if (
        isinstance(assertions, (str, bytes))
        or not isinstance(assertions, Sequence)
        or len(assertions) > MAX_RESULT_ASSERTIONS
    ):
        raise EvaluationContractError("run.assertions must be a bounded array")
    error_code = _string(run.get("error_code", ""), "run.error_code", limit=128)
    infrastructure_failure = _bool(
        run.get("infrastructure_failure", False), "run.infrastructure_failure"
    )
    if "registrations_unchanged" in run and "registered_worktrees_unchanged" in run:
        if run["registrations_unchanged"] != run["registered_worktrees_unchanged"]:
            raise EvaluationContractError("run registration integrity facts disagree")
    registrations = run.get("registrations_unchanged", run.get("registered_worktrees_unchanged"))
    safety_facts = {
        "cleanup_verified": _bool(run.get("cleanup_verified"), "run.cleanup_verified"),
        "source_unchanged": _bool(run.get("source_unchanged"), "run.source_unchanged"),
        "registrations_unchanged": _bool(registrations, "run.registrations_unchanged"),
        "refs_unchanged": _bool(run.get("refs_unchanged"), "run.refs_unchanged"),
    }
    if error_code not in {"", "assertion_failed"}:
        raise EvaluationContractError("run.error_code is unsupported")
    if infrastructure_failure or not all(safety_facts.values()):
        raise EvaluationContractError("run failed infrastructure or source-integrity checks")
    passed = _bool(run.get("passed"), "run.passed")
    reproduced_failure = _bool(run.get("reproduced_failure"), "run.reproduced_failure")
    baseline_failure_designated = _bool(
        run.get("baseline_failure_designated", False),
        "run.baseline_failure_designated",
    )
    safety_regressions = _regressions(run.get("safety_regressions", []), "run.safety_regressions")
    guard_regressions = _regressions(run.get("guard_regressions", []), "run.guard_regressions")
    if passed and (error_code or safety_regressions or guard_regressions):
        raise EvaluationContractError("a passing run cannot contain failures")
    if error_code == "assertion_failed" and passed:
        raise EvaluationContractError("assertion_failed cannot be passing")
    if reproduced_failure and (phase != "baseline" or passed or not baseline_failure_designated):
        raise EvaluationContractError("run.reproduced_failure is inconsistent")
    if phase == "candidate" and baseline_failure_designated:
        raise EvaluationContractError("candidate cannot designate a baseline failure")
    normalized_assertions = [
        _run_assertion(item, f"run.assertions[{index}]") for index, item in enumerate(assertions)
    ]
    required_failures = [
        item for item in normalized_assertions if item["required"] and not item["passed"]
    ]
    expected_safety_regressions = [item["name"] for item in required_failures if item["safety"]]
    expected_guard_regressions = [
        item["name"]
        for item in required_failures
        if item["guard"]
        or item["guard_regression"]
        or item["type"] in {"guard", "guard_regression"}
    ]
    if passed != (not required_failures):
        raise EvaluationContractError("run.passed disagrees with required assertions")
    if safety_regressions != expected_safety_regressions:
        raise EvaluationContractError("run.safety_regressions disagree with assertions")
    if guard_regressions != expected_guard_regressions:
        raise EvaluationContractError("run.guard_regressions disagree with assertions")
    designated_failures = [
        item for item in required_failures if item["baseline_failure"] or item["expected_failure"]
    ]
    expected_designation = phase == "baseline" and bool(designated_failures)
    if baseline_failure_designated != expected_designation:
        raise EvaluationContractError("run.baseline_failure_designated disagrees with assertions")
    expected_reproduction = expected_designation and error_code == ""
    if reproduced_failure != expected_reproduction:
        raise EvaluationContractError("run.reproduced_failure disagrees with baseline assertions")
    result: dict[str, Any] = {
        "interface_version": API_VERSION,
        "job_id": _string(str(run.get("job_id", "")), "run.job_id", limit=256, nonempty=True),
        "phase": phase,
        "pack_version": pack_version,
        "pack_hash": pack_hash,
        "git_ref": git_ref,
        "patch_hash": patch_hash,
        "assertions": normalized_assertions,
        "passed": passed,
        "baseline_failure_designated": baseline_failure_designated,
        "infrastructure_failure": False,
        "reproduced_failure": reproduced_failure,
        "safety_regressions": safety_regressions,
        "guard_regressions": guard_regressions,
        "error_code": error_code,
        **safety_facts,
    }
    result["result_hash"] = hashlib.sha256(_canonical_json(result)).hexdigest()
    return result


__all__ = [
    "API_VERSION",
    "EVAL_PACK_INTERFACE_VERSION",
    "MAX_ASSERTIONS",
    "MAX_SCENARIOS",
    "EvaluationContractError",
    "canonical_evaluation_pack",
    "evaluation_pack_hash",
    "normalize_eval_run",
]
