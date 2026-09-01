"""What one analyzer run is allowed to say, and the command that produces it.

The result envelope, the small JSON-Schema subset that checks it, the strict
parser every analyzer result crosses before a domain callback sees it, and the
shell-free client argv that asks for it. All four change when the analyzer
contract changes. `job_supervisor` changes when process supervision does, and it
used to carry both halves behind a docstring that claimed to know nothing about
either.

This is a sibling of `evaluation_contract` rather than part of it. That module is
imported by `improvements_eval_worker`, which runs as a disposable subprocess to
execute one pack; the argv below reaches `executions.drivers` and
`runner.client_binary`, the client half of the platform, which that worker has no
business loading in order to hash a pack.

The interface version in the envelope is the ``improvements-api`` contract
frozen in ``docs/improvements-contract.md``.
"""

from __future__ import annotations

import json
from collections.abc import Callable, Mapping
from typing import Any

from ..executions import drivers
from ..runner import client_binary
from .job_supervisor import Job, JobError, JobResultError

API_VERSION = "improvements-api"


class AnalyzerOutputError(JobResultError):
    """The analyzer did not return the strict typed result contract."""


def validate_typed_json(value: Any, schema: Mapping[str, Any], path: str = "$") -> list[str]:
    """Validate the small JSON-Schema subset used by job result contracts.

    The implementation intentionally handles the keywords that matter for
    local client output and rejects unknown object fields when a schema says
    ``additionalProperties: false``.  It has no dependency on jsonschema.
    """
    errors: list[str] = []
    expected = schema.get("type")
    type_ok = True
    if expected == "object":
        type_ok = isinstance(value, dict)
    elif expected == "array":
        type_ok = isinstance(value, list)
    elif expected == "string":
        type_ok = isinstance(value, str)
    elif expected == "integer":
        type_ok = isinstance(value, int) and not isinstance(value, bool)
    elif expected == "number":
        type_ok = isinstance(value, (int, float)) and not isinstance(value, bool)
    elif expected == "boolean":
        type_ok = isinstance(value, bool)
    elif expected == "null":
        type_ok = value is None
    if expected and not type_ok:
        return [f"{path} must be {expected}"]

    if "const" in schema and value != schema["const"]:
        errors.append(f"{path} must equal {schema['const']!r}")
    if "enum" in schema and value not in schema["enum"]:
        errors.append(f"{path} is not one of the permitted values")
    if isinstance(value, str):
        if "minLength" in schema and len(value) < schema["minLength"]:
            errors.append(f"{path} is shorter than minLength")
        if "maxLength" in schema and len(value) > schema["maxLength"]:
            errors.append(f"{path} exceeds maxLength")
    if isinstance(value, list):
        if "minItems" in schema and len(value) < schema["minItems"]:
            errors.append(f"{path} has fewer than minItems")
        if "maxItems" in schema and len(value) > schema["maxItems"]:
            errors.append(f"{path} exceeds maxItems")
        item_schema = schema.get("items")
        if isinstance(item_schema, Mapping):
            for index, item in enumerate(value):
                errors.extend(validate_typed_json(item, item_schema, f"{path}[{index}]"))
    if isinstance(value, dict):
        properties = schema.get("properties", {})
        required = schema.get("required", [])
        errors.extend(f"{path}.{name} is required" for name in required if name not in value)
        if schema.get("additionalProperties") is False:
            errors.extend(
                f"{path}.{name} is not permitted" for name in value if name not in properties
            )
        for name, child_schema in properties.items():
            if name in value and isinstance(child_schema, Mapping):
                errors.extend(validate_typed_json(value[name], child_schema, f"{path}.{name}"))
    return errors


def structured_output_schema(schema: Mapping[str, Any]) -> dict[str, Any]:
    """Make optional object fields nullable for strict structured-output clients."""

    def clone(node: Any) -> Any:
        if isinstance(node, Mapping):
            result = {key: clone(value) for key, value in node.items()}
            if node.get("type") == "object" and node.get("additionalProperties") is False:
                properties = node.get("properties", {})
                originally_required = set(node.get("required", []))
                result["required"] = list(properties)
                for name in properties:
                    if name in originally_required:
                        continue
                    child = result["properties"][name]
                    child_type = child.get("type")
                    if isinstance(child_type, str):
                        child["type"] = [child_type, "null"]
            return result
        if isinstance(node, list):
            return [clone(item) for item in node]
        return node

    return clone(schema)


def _remove_optional_nulls(value: Any, schema: Mapping[str, Any]) -> Any:
    if isinstance(value, dict) and schema.get("type") == "object":
        properties = schema.get("properties", {})
        required = set(schema.get("required", []))
        result = {}
        for name, child in value.items():
            if child is None and name in properties and name not in required:
                continue
            result[name] = _remove_optional_nulls(child, properties.get(name, {}))
        return result
    if isinstance(value, list):
        item_schema = schema.get("items", {})
        return [_remove_optional_nulls(item, item_schema) for item in value]
    return value


_ANALYZER_TARGETS = [
    "instructions",
    "skill",
    "tool-contract",
    "hook-lifecycle",
    "validator-eval",
    "documentation-process",
]


_ANALYZER_PROPOSAL_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "required": ["targets", "recommended_change", "acceptance_criteria"],
    "properties": {
        "targets": {
            "type": "array",
            "minItems": 1,
            "maxItems": 6,
            "items": {
                "type": "string",
                "enum": _ANALYZER_TARGETS,
                "maxLength": 64,
            },
        },
        "root_cause": {"type": "string", "maxLength": 1200},
        "recommended_change": {"type": "string", "minLength": 1, "maxLength": 4000},
        "risk": {"type": "string", "maxLength": 2000},
        "rollback": {"type": "string", "maxLength": 2000},
        "acceptance_criteria": {"type": "string", "minLength": 1, "maxLength": 4000},
    },
}

_ANALYZER_ASSERTION_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "required": ["name", "type", "required"],
    "properties": {
        "name": {"type": "string", "minLength": 1, "maxLength": 1024},
        "type": {
            "type": "string",
            "enum": [
                "command_exit",
                "exit",
                "file_contains",
                "file_not_contains",
                "judge",
                "cli_judge",
                "non_deterministic",
                "guard",
                "guard_regression",
            ],
        },
        "required": {"type": "boolean"},
        "safety": {"type": "boolean"},
        "guard": {"type": "boolean"},
        "guard_regression": {"type": "boolean"},
        "baseline_failure": {"type": "boolean"},
        "expected_failure": {"type": "boolean"},
        "timeout": {"type": "number"},
        "argv": {
            "type": "array",
            "minItems": 1,
            "maxItems": 64,
            "items": {"type": "string", "minLength": 1, "maxLength": 1024},
        },
        "path": {"type": "string", "maxLength": 1024},
        "text": {"type": "string", "maxLength": 4096},
        "contains": {"type": "string", "maxLength": 4096},
        "needle": {"type": "string", "maxLength": 4096},
    },
}

_ANALYZER_PACK_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "required": ["assertions"],
    "properties": {
        "assertions": {
            "type": "array",
            "minItems": 1,
            "maxItems": 64,
            "items": _ANALYZER_ASSERTION_SCHEMA,
        },
        "failure_examples": {
            "type": "array",
            "maxItems": 64,
            "items": {"type": "string", "minLength": 1, "maxLength": 1024},
        },
    },
}

# The result is deliberately an envelope rather than a free-form transcript.
ANALYZER_RESULT_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "required": ["interface_version", "scope", "cases"],
    "properties": {
        "interface_version": {"type": "string", "const": API_VERSION},
        "scope": {"type": "string", "minLength": 1, "maxLength": 128},
        "cases": {
            "type": "array",
            "maxItems": 100,
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": [
                    "case_key",
                    "title",
                    "severity",
                    "category",
                    "signal_ids",
                    "proposal",
                    "evaluation_pack",
                ],
                "properties": {
                    "case_key": {"type": "string", "minLength": 1, "maxLength": 256},
                    "title": {"type": "string", "minLength": 1, "maxLength": 400},
                    "severity": {
                        "type": "string",
                        "enum": ["low", "medium", "high", "critical"],
                    },
                    "category": {
                        "type": "string",
                        "enum": _ANALYZER_TARGETS,
                    },
                    "summary": {"type": "string", "maxLength": 4000},
                    "signal_ids": {"type": "array", "items": {"type": "integer"}},
                    "session_ids": {"type": "array", "items": {"type": "string"}},
                    "proposal": _ANALYZER_PROPOSAL_SCHEMA,
                    "evaluation_pack": _ANALYZER_PACK_SCHEMA,
                },
            },
        },
    },
}


def parse_analyzer_result(
    raw: Any, *, scope: str | None = None, schema: Mapping[str, Any] | None = None
) -> dict[str, Any]:
    """Parse and strictly validate analyzer JSON before any domain callback."""
    value = raw
    if isinstance(raw, (bytes, bytearray)):
        raw = bytes(raw).decode("utf-8", "replace")
        value = raw
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except json.JSONDecodeError as error:
            raise AnalyzerOutputError(f"malformed analyzer JSON: {error.msg}") from error
    if not isinstance(value, dict):
        raise AnalyzerOutputError("analyzer result must be a JSON object")
    selected = schema or ANALYZER_RESULT_SCHEMA
    value = _remove_optional_nulls(value, selected)
    errors = validate_typed_json(value, selected)
    if scope is not None and value.get("scope") != scope:
        errors.append("$.scope does not match the job scope")
    if errors:
        raise AnalyzerOutputError("malformed analyzer result: " + "; ".join(errors[:8]))
    return value


def analyzer_result_parser(
    schema: Mapping[str, Any] | None = None,
) -> Callable[[Any, Job], dict[str, Any]]:
    """The supervisor's ``result_parser`` for an analysis job.

    The supervisor runs this before the domain result handler, so a malformed
    envelope fails its job without any handler seeing it. It is a job-scoped
    callable rather than a schema the supervisor interprets, because what a
    result may say is this module's decision and not the supervisor's.
    """

    def parse(candidate: Any, job: Job) -> dict[str, Any]:
        return parse_analyzer_result(candidate, scope=job.scope, schema=schema)

    return parse


def analyzer_client_argv(
    client: str,
    prompt: str,
    *,
    schema_path: str = "",
    result_path: str = "",
    model: str = "",
    effort: str = "",
    binary: str | None = None,
) -> list[str]:
    """Build a shell-free analyzer command through the driver that owns the client.

    This used to carry its own copy of the branch in `runner.client_argv`, and
    the copies had drifted: this one left `--json` off the Codex command, so an
    analyzer run produced no `thread.started` line and its session could not be
    identified afterwards. One driver per client is what removes the second copy
    rather than synchronising it.

    Tests can supply a fake ``binary``; production resolves the configured path.
    """

    try:
        driver = drivers.driver_for(client)
    except drivers.DriverError as error:
        raise JobError(str(error)) from error
    if not isinstance(prompt, str) or not prompt:
        raise JobError("analyzer prompt is required")
    model = str(model or "").strip()
    effort = str(effort or "").strip().lower()
    if len(model) > 120 or any(ord(character) < 32 or ord(character) == 127 for character in model):
        raise JobError("analyzer model exceeds its finite safe bound")
    schema = None
    if schema_path:
        with open(schema_path, encoding="utf-8") as handle:
            schema = json.load(handle)
    try:
        return driver.argv(
            drivers.CommandRequest(
                binary=binary or client_binary(driver.capabilities().client),
                prompt=prompt,
                model=model,
                effort=effort,
                schema=schema,
                schema_path=schema_path,
                result_path=result_path,
            )
        )
    except drivers.DriverError as error:
        raise JobError(str(error)) from error


__all__ = [
    "ANALYZER_RESULT_SCHEMA",
    "API_VERSION",
    "AnalyzerOutputError",
    "analyzer_client_argv",
    "analyzer_result_parser",
    "parse_analyzer_result",
    "structured_output_schema",
    "validate_typed_json",
]
