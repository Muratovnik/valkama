"""Isolated subprocess entry point for one Improvements evaluation job."""

from __future__ import annotations

import json
import os
import sys

# The supervisor launches this file as a script, so it has no package context
# of its own and cannot use relative imports. It puts the platform directory on
# the path and imports the package by name, which also works when the test
# suite imports it as a module.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from server.improvements.evaluation_contract import (
    normalize_eval_run,
)
from server.improvements.evaluations import EvaluationRunner


def _trusted_recipes() -> set[tuple[str, ...]]:
    raw = os.environ.get("VALKAMA_EVAL_RECIPES", "[]")
    try:
        values = json.loads(raw)
    except json.JSONDecodeError as error:
        raise SystemExit(f"VALKAMA_EVAL_RECIPES is invalid JSON: {error}") from error
    if not isinstance(values, list):
        raise SystemExit("VALKAMA_EVAL_RECIPES must be an array of argv arrays")
    recipes: set[tuple[str, ...]] = set()
    for value in values:
        if (
            not isinstance(value, list)
            or not value
            or any(not isinstance(part, str) or not part for part in value)
        ):
            raise SystemExit("each trusted eval recipe must be a non-empty argv array")
        recipes.add(tuple(value))
    return recipes


def _normalize_result(result: dict, request: dict) -> dict:
    """Drop raw output and bind the run to the exact queued pack snapshot."""
    normalized = normalize_eval_run(
        result,
        expected_phase=request["phase"],
        expected_pack_version=request["pack_version"],
        expected_pack_hash=request["pack_hash"],
        expected_git_ref=request["git_ref"],
    )
    # Storage computes and verifies the canonical hash inside its transaction.
    # Keeping the derived field out makes this safe envelope valid input to
    # that same normalizer instead of asking it to trust a caller-owned hash.
    normalized.pop("result_hash", None)
    return normalized


def main() -> int:
    if len(sys.argv) != 2:
        raise SystemExit("one evaluation input path is required")
    with open(sys.argv[1], encoding="utf-8") as handle:
        request = json.load(handle)
    recipes = _trusted_recipes()
    result = EvaluationRunner(allow_command=lambda argv: tuple(argv) in recipes).run(
        request["pack"],
        request["repo"],
        request["git_ref"],
        request["phase"],
        job_id=str(request["job_id"]),
    )
    # The supervisor launches this as a script and reads its stdout, so the
    # printed line is the return value rather than a message about one.
    print(  # noqa: T201
        json.dumps(_normalize_result(result, request), ensure_ascii=False, separators=(",", ":"))
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
