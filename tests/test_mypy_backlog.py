"""The test modules' typing backlog in `pyproject.toml` only shrinks.

mypy checks every module under `tests`, and the modules that had errors when the
test modules joined are named in one `[[tool.mypy.overrides]]` whose errors it
ignores. The list is a ratchet: a module leaves it once its errors are fixed, and
none joins it. Here a module added to it fails, as do one that no longer exists
and one that mypy, run without the exemption, finds nothing wrong with, so a
module that became clean leaves the list and is checked from then on.

`BASELINE` is the list as it was adopted. It only loses names, in the commit that
takes them off the list; when the list empties, the override goes with it.
"""

from __future__ import annotations

import re
import tempfile
import tomllib
import unittest
from pathlib import Path
from typing import Any

from mypy import api

ROOT = Path(__file__).resolve().parents[1]
PYPROJECT = ROOT / "pyproject.toml"

#: The cache of the run without the exemption. It stays apart from `mypy`'s own,
#: because the listed modules carry other options there, and sharing one cache
#: would make each of the two runs check those modules again after the other.
CACHE = ROOT / ".cache" / "mypy-backlog"

#: `[tool.mypy]` keys that say what to check and where to keep the cache, rather
#: than how to check; the run without the exemption names its own.
NOT_OPTIONS = frozenset({"files", "cache_dir", "overrides"})

ERROR = re.compile(r"^(?P<path>.+?\.py):\d+: error:")

BASELINE = frozenset(
    {
        "tests.fixtures.fake_mcp_release",
        "tests.planning_fixtures",
        "tests.quota.test_forecast",
        "tests.quota.test_poll",
        "tests.test_adapter_check",
        "tests.test_adapters",
        "tests.test_affected",
        "tests.test_alerts_messages",
        "tests.test_alerts_reaper",
        "tests.test_analytics_cost",
        "tests.test_analytics_uses_http",
        "tests.test_app_shell",
        "tests.test_atomic_files",
        "tests.test_commits_manual",
        "tests.test_commits_pickup",
        "tests.test_commits_rewrite",
        "tests.test_desktop_app_sources",
        "tests.test_docs_lifecycle",
        "tests.test_documents",
        "tests.test_executions",
        "tests.test_heavy_gate",
        "tests.test_hooks",
        "tests.test_hooks_agent_notices",
        "tests.test_hooks_marks",
        "tests.test_hooks_notify",
        "tests.test_hooks_place",
        "tests.test_hooks_tree_cost",
        "tests.test_hooks_tree_notices",
        "tests.test_http_security",
        "tests.test_journal",
        "tests.test_launcher",
        "tests.test_launcher_on_demand",
        "tests.test_mcp_front",
        "tests.test_mcp_surface",
        "tests.test_memory",
        "tests.test_module_manifest",
        "tests.test_module_registry",
        "tests.test_ops_git_hook",
        "tests.test_parallel",
        "tests.test_planning_agents",
        "tests.test_planning_api",
        "tests.test_planning_apply_groups",
        "tests.test_planning_card",
        "tests.test_planning_chain",
        "tests.test_planning_claim_moves",
        "tests.test_planning_close",
        "tests.test_planning_composed",
        "tests.test_planning_consent",
        "tests.test_planning_decisions",
        "tests.test_planning_deferral",
        "tests.test_planning_discussion",
        "tests.test_planning_domain",
        "tests.test_planning_exact_api",
        "tests.test_planning_executors",
        "tests.test_planning_goal_volumes",
        "tests.test_planning_held",
        "tests.test_planning_holders",
        "tests.test_planning_interactions_migration",
        "tests.test_planning_item_projects",
        "tests.test_planning_item_projects_migration",
        "tests.test_planning_label_edits",
        "tests.test_planning_leases",
        "tests.test_planning_merge",
        "tests.test_planning_participants",
        "tests.test_planning_pending_actions",
        "tests.test_planning_person_events",
        "tests.test_planning_question_reads",
        "tests.test_planning_question_reviews",
        "tests.test_planning_questions",
        "tests.test_planning_queue",
        "tests.test_planning_recommendation_why",
        "tests.test_planning_requests",
        "tests.test_planning_resolve",
        "tests.test_planning_retired_words",
        "tests.test_planning_schema_limits",
        "tests.test_planning_scope_http",
        "tests.test_planning_session_requests",
        "tests.test_planning_space_projects",
        "tests.test_planning_space_reads",
        "tests.test_planning_space_window",
        "tests.test_planning_states",
        "tests.test_planning_sweep",
        "tests.test_planning_threads",
        "tests.test_planning_tools",
        "tests.test_planning_triage",
        "tests.test_planning_triage_groups",
        "tests.test_planning_triage_review",
        "tests.test_planning_volume_flow",
        "tests.test_planning_volumes",
        "tests.test_planning_words",
        "tests.test_planning_work_model_history",
        "tests.test_planning_work_model_migration",
        "tests.test_planning_work_model_surfaces",
        "tests.test_planning_work_model_write",
        "tests.test_platform_core",
        "tests.test_processes",
        "tests.test_project_registry",
        "tests.test_quota_samples",
        "tests.test_quota_seats",
        "tests.test_refs",
        "tests.test_registry_owner",
        "tests.test_relates_once_migration",
        "tests.test_release",
        "tests.test_runner",
        "tests.test_server",
        "tests.test_session_open",
        "tests.test_skills",
        "tests.test_static_assets",
        "tests.test_store_bringup",
        "tests.test_store_migration",
        "tests.test_subprocess_encoding",
        "tests.test_toast_contract",
        "tests.test_transcript_roots",
        "tests.test_transcripts",
        "tests.test_tray_session",
        "tests.test_usage_claims",
        "tests.test_usage_collect",
        "tests.test_usage_item_analytics",
        "tests.test_usage_item_parts",
        "tests.test_usage_pauses",
        "tests.test_usage_prices",
        "tests.test_usage_read",
        "tests.test_usage_rebuild",
        "tests.test_usage_reread",
        "tests.test_usage_tokens",
        "tests.test_web_contract_fixtures",
        "tests.test_work_focus_migration",
        "tests.usage_fixtures",
        "tests.web_fixture_closed",
    }
)


def mypy_table() -> dict[str, Any]:
    table: dict[str, Any] = tomllib.loads(PYPROJECT.read_text(encoding="utf-8"))["tool"]["mypy"]
    return table


def backlog(table: dict[str, Any]) -> list[str]:
    """The modules of the one override that ignores errors, in their written order."""
    ignoring = [o for o in table.get("overrides", []) if o.get("ignore_errors")]
    if len(ignoring) > 1:
        raise AssertionError(f"{len(ignoring)} overrides ignore errors; the backlog is one list")
    if not ignoring:
        return []
    modules = ignoring[0]["module"]
    return [modules] if isinstance(modules, str) else list(modules)


def module_file(module: str) -> Path:
    return ROOT.joinpath(*module.split(".")).with_suffix(".py")


def ini_value(value: object) -> str:
    if isinstance(value, bool):
        return str(value)
    if isinstance(value, str):
        return value
    raise AssertionError(f"no mypy.ini spelling for {value!r}")


def modules_with_errors(table: dict[str, Any], modules: list[str]) -> set[str]:
    """Which of `modules` mypy finds an error in, with the options of `table` and no override."""
    options = "".join(
        f"{key} = {ini_value(value)}\n" for key, value in table.items() if key not in NOT_OPTIONS
    )
    with tempfile.TemporaryDirectory() as scratch:
        config = Path(scratch) / "mypy.ini"
        config.write_text("[mypy]\n" + options, encoding="utf-8")
        report, problems, status = api.run(
            [
                "--config-file",
                str(config),
                "--cache-dir",
                str(CACHE),
                "--show-absolute-path",
                *(str(module_file(module)) for module in modules),
            ]
        )
    if status not in (0, 1):
        raise AssertionError(f"mypy did not finish its check (exit {status}):\n{problems}{report}")
    files = {Path(m["path"]).resolve() for m in map(ERROR.match, report.splitlines()) if m}
    return {module for module in modules if module_file(module).resolve() in files}


class MypyBacklogTests(unittest.TestCase):
    def setUp(self) -> None:
        self.table = mypy_table()
        self.listed = backlog(self.table)

    def test_mypy_checks_every_module_under_tests(self) -> None:
        self.assertIn("tests", self.table["files"])

    def test_the_list_is_sorted_and_names_each_module_once(self) -> None:
        self.assertEqual(sorted(set(self.listed)), self.listed)

    def test_each_listed_module_is_a_file(self) -> None:
        missing = [module for module in self.listed if not module_file(module).is_file()]
        self.assertEqual([], missing, "take a module that no longer exists off the list")

    def test_no_module_joins_the_list(self) -> None:
        added = sorted(set(self.listed) - BASELINE)
        self.assertEqual([], added, "a module joining the backlog is fixed instead")

    def test_each_listed_module_still_has_errors(self) -> None:
        if not self.listed:
            self.skipTest("the backlog is empty")
        clean = sorted(set(self.listed) - modules_with_errors(self.table, self.listed))
        self.assertEqual(
            [], clean, "mypy finds no error in these: take them off the list and out of BASELINE"
        )


if __name__ == "__main__":
    unittest.main()
