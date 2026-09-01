"""Everything that can be wrong with this installation, each with what to do.

A red status is not a diagnosis. §19.4 says every result carries an actionable
fix, and that requirement is what shapes this file: a check that cannot say what
to do about its own failure is a check that makes somebody read source code, and
they will read it at the worst moment.

The checks are not invented. Every one of them is a failure this product has
actually had, most of them more than once:

* a listener serving a bundle older than the checkout, so a green screenshot
  proved the build it replaced;
* a store written by a newer build than the one opening it;
* attempts left `running` by a process that no longer exists, making the newest
  attempt on an item look live forever;
* a client binary that is not on PATH, discovered when a launch failed rather
  than when it was configured.

Read-only throughout. A diagnosis that changes the thing it is diagnosing is one
nobody can run twice, and the first thing anybody does with a doctor is run it
again after the fix.
"""

from __future__ import annotations

import json
import os
import sqlite3
from collections.abc import Callable, Mapping
from datetime import UTC, datetime
from urllib import error, request

from .. import runner, static_assets, store
from ..executions import drivers as execution_drivers
from ..memory import service as memory_service
from ..platform import providers as platform_providers
from ..projects import project_registry
from . import configuration

#: What a check can conclude. `warn` is a real answer, not a soft failure: a
#: store with no recent snapshot works perfectly until the day it matters.
STATUSES = ("ok", "warn", "fail", "unknown")

#: How long the runtime probe waits. A listener that cannot answer in this is
#: not one an operator is about to use.
PROBE_TIMEOUT = 0.5


def _check(
    identifier: str,
    title: str,
    status: str,
    detail: str,
    fix: str = "",
    *,
    presentation_code: str,
    parameters: Mapping[str, object] | None = None,
) -> dict:
    if status not in STATUSES:
        raise ValueError(f"unknown doctor status {status!r}")
    return {
        "id": identifier,
        "title": title,
        "status": status,
        "detail": detail,
        "fix": fix,
        # The CLI keeps the complete English diagnosis above. The browser owns
        # localization and progressive disclosure, so it receives a stable
        # semantic code plus bounded facts rather than parsing those sentences.
        "presentation": {
            "code": presentation_code,
            "parameters": dict(parameters or {}),
        },
    }


#: OPS-005's four levels, and the groups of checks each one answers with.
#:
#: The order is causal, not cosmetic. A store that cannot be opened makes every
#: capability underneath it unknowable, and a project root that has moved makes
#: its adapters answer about nothing, so a reader who works down this list fixes
#: a cause before its symptoms. That is why the levels keep their order even
#: when a later one is the red thing on the screen: worst-first is right inside
#: a level and wrong across them, because across them it invites somebody to
#: start at the end.
LEVELS: tuple[tuple[str, str, tuple[str, ...]], ...] = (
    ("installation", "Installation", ("configuration", "store", "runtime")),
    ("projects", "Projects", ("projects",)),
    ("capabilities", "Capabilities", ("drivers",)),
    ("connections", "Connections", ("adapters",)),
)


def diagnose(*, port: int = 8642, probe: bool = True) -> dict:
    """Run every check and summarise. Nothing here writes anything."""

    # Each group is guarded, because a diagnostic that dies on the problem it
    # exists to name is worse than no diagnostic: a malformed configuration
    # file stops the product on purpose, and it used to stop the doctor with
    # it — leaving a traceback where a sentence and a fix belonged.
    groups = {
        "configuration": _guarded("configuration", "Configuration file", _configuration_checks),
        "store": _guarded("store", "Store", _store_checks),
        "runtime": _guarded("runtime", "Runtime", lambda: _runtime_checks(port, probe=probe)),
        "drivers": _guarded("drivers", "Execution drivers", _driver_checks),
        "adapters": _guarded("adapters", "Adapters", _adapter_checks),
        "projects": _guarded("projects", "Projects", _project_checks),
    }
    # A group nobody's level names would simply not appear, and a diagnostic
    # that quietly stops asking a question reads exactly like one that asked it
    # and got a pass. So the two lists have to agree, and disagreeing is an
    # error here rather than a gap a reader has to notice.
    named = {name for _, _, names in LEVELS for name in names}
    if named != set(groups):
        raise RuntimeError(f"doctor levels do not cover {sorted(set(groups) ^ named)}")
    levels: list[dict] = []
    for identifier, title, names in LEVELS:
        checks = [check for name in names for check in groups[name]]
        levels.append(
            {"id": identifier, "title": title, "status": worst_of(checks), "checks": checks}
        )
    every = [check for level in levels for check in level["checks"]]
    return {
        "interface_version": "valkama-doctor",
        "checked_at": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
        # Levels rather than a flat list with a level field: the grouping is the
        # answer, and a reader that had to assemble it would be assembling a
        # second one that could differ from this.
        "levels": levels,
        "summary": {
            status: sum(1 for item in every if item["status"] == status) for status in STATUSES
        },
        "status": worst_of(every),
    }


def worst_of(checks: list[dict]) -> str:
    """One word for a set of checks, chosen by its worst member.

    Nine greens and one failure is a failure, not ninety percent. An empty set
    is `unknown` rather than `ok`: nothing was asked, so nothing passed.
    """

    if not checks:
        return "unknown"
    for status in ("fail", "warn", "unknown"):
        if any(check["status"] == status for check in checks):
            return status
    return "ok"


def _guarded(identifier: str, title: str, run: Callable[[], list[dict]]) -> list[dict]:
    """One group of checks, or one check saying the group could not run.

    A doctor is what somebody reaches for when the installation is already
    broken, so a group that raises has to become a finding rather than a
    traceback. The exception text is the detail: it is the most specific thing
    anyone has about a failure nothing anticipated.
    """

    try:
        return run()
    # A diagnostic may not choose which failures it survives: the whole reason
    # it is being run is that something unanticipated is wrong.
    except Exception as error:  # noqa: BLE001
        return [
            _check(
                identifier,
                title,
                "fail",
                f"this check could not run: {type(error).__name__}: {error}",
                "Fix what the message names, or report it: a check that cannot"
                " run leaves everything it covers unknown.",
                presentation_code="check-failed",
                parameters={"group": title},
            )
        ]


def _configuration_checks() -> list[dict]:
    """Whether the configuration file can be read, and whether it resolved.

    §19.4 lists missing secrets among the things a doctor checks, and a
    reference to a variable nobody set is exactly that: the value is not blank,
    it is a piece of text that looks like a path and is not one. Nothing else
    in the product would notice — a store path of `${VALKAMA_DB_PATH}` is a
    filename SQLite will happily create.
    """

    try:
        file = configuration.read_file()
    except configuration.ConfigurationError as error:
        return [
            _check(
                "configuration",
                "Configuration file",
                "fail",
                str(error),
                "Fix the file or remove it; every setting has a default and an"
                " environment override.",
                presentation_code="configuration-invalid",
                parameters={"path": str(configuration.config_path())},
            )
        ]
    if not file:
        return [
            _check(
                "configuration",
                "Configuration file",
                "ok",
                f"no file at {configuration.config_path()}; defaults and environment only",
                presentation_code="configuration-defaults",
                parameters={"path": str(configuration.config_path())},
            )
        ]
    reading = configuration.report({})
    unresolved = [item for item in reading["settings"] if not item["resolved"]]
    if unresolved:
        names = ", ".join(item["key"] for item in unresolved)
        return [
            _check(
                "configuration",
                "Configuration file",
                "fail",
                f"unresolved reference for {names}: {unresolved[0]['reason']}",
                "Set the variable the reference names, or give the reference a ${VAR:-default}.",
                presentation_code="configuration-unresolved",
                parameters={"names": names},
            )
        ]
    named = ", ".join(sorted(file))
    return [
        _check(
            "configuration",
            "Configuration file",
            "ok",
            f"{configuration.config_path()} sets {named}",
            presentation_code="configuration-file",
            parameters={"names": named, "path": str(configuration.config_path())},
        )
    ]


def _store_checks() -> list[dict]:
    path = store.db_path()
    if not os.path.exists(path):
        return [
            _check(
                "store",
                "Primary store",
                "warn",
                f"no store at {path}",
                "Start Valkama once; the store is created on first open.",
                presentation_code="store-missing",
                parameters={"path": path},
            )
        ]
    try:
        stored = int(
            sqlite3.connect(f"file:{os.path.abspath(path)}?mode=ro", uri=True)
            .execute("PRAGMA user_version")
            .fetchone()[0]
        )
    except sqlite3.Error as failure:
        return [
            _check(
                "store",
                "Primary store",
                "fail",
                f"{path} cannot be opened read-only: {failure}",
                "Close anything holding the file and check the disk; a restore is in ~/.valkama/backups.",
                presentation_code="store-unreadable",
                parameters={"path": path},
            )
        ]

    checks = []
    if stored > store.STORE_SCHEMA_VERSION:
        checks.append(
            _check(
                "store-schema",
                "Store schema",
                "fail",
                f"the store is at schema {stored} and this build understands"
                f" {store.STORE_SCHEMA_VERSION}",
                "Restart the client so it spawns the server from the current checkout.",
                presentation_code="store-schema-newer",
                parameters={"stored": stored, "supported": store.STORE_SCHEMA_VERSION},
            )
        )
    else:
        checks.append(
            _check(
                "store-schema",
                "Store schema",
                "ok",
                f"schema {stored}, understood by this build",
                presentation_code="store-schema-supported",
                parameters={"stored": stored},
            )
        )
    checks.append(_backup_check(path))
    checks.append(_open_execution_check())
    return checks


def _backup_check(path: str) -> dict:
    backups = os.path.join(os.path.dirname(path), "backups")
    try:
        copies = [name for name in os.listdir(backups) if name.endswith(".sqlite3")]
    except OSError:
        copies = []
    if not copies:
        return _check(
            "store-backups",
            "Recovery point",
            "warn",
            "no snapshot exists beside the store",
            "A snapshot is taken before any migration; run one, or copy the store with"
            " `VACUUM INTO` before the next schema change.",
            presentation_code="backups-missing",
        )
    return _check(
        "store-backups",
        "Recovery point",
        "ok",
        f"{len(copies)} snapshot(s) in {backups}",
        presentation_code="backups-available",
        parameters={"count": len(copies), "path": backups},
    )


def _open_execution_check() -> dict:
    """Attempts a previous process left running, which nothing can now reap."""

    try:
        conn = store.connect()
    except Exception as failure:  # noqa: BLE001 -- the store check above names the cause
        return _check(
            "executions-open",
            "Open attempts",
            "unknown",
            f"the store could not be opened: {failure}",
            "Fix the store check above first.",
            presentation_code="attempts-store-unavailable",
        )
    try:
        rows = conn.execute("SELECT COUNT(*) FROM executions WHERE ended_at IS NULL").fetchone()
        open_count = int(rows[0]) if rows else 0
    except sqlite3.Error as failure:
        return _check(
            "executions-open",
            "Open attempts",
            "unknown",
            f"attempts could not be read: {failure}",
            "",
            presentation_code="attempts-unreadable",
        )
    finally:
        conn.close()
    if not open_count:
        return _check(
            "executions-open",
            "Open attempts",
            "ok",
            "no attempt is left open",
            presentation_code="attempts-clear",
        )
    return _check(
        "executions-open",
        "Open attempts",
        "warn",
        f"{open_count} attempt(s) have no end, and a launch cannot outlive its process",
        "Start the server once: it closes attempts it can no longer poll, stop or reap.",
        presentation_code="attempts-open",
        parameters={"count": open_count},
    )


def _runtime_checks(port: int, *, probe: bool) -> list[dict]:
    snapshot = static_assets.capture_runtime_snapshot(
        static_assets.SOURCE_ROOT, static_assets.DIST_DIR
    )
    checks = [
        _check(
            "web-build",
            "Built interface",
            "ok",
            f"{static_assets.DIST_DIR} carries a build",
            presentation_code="web-build-available",
            parameters={"path": static_assets.DIST_DIR},
        )
        if "index.html" in snapshot.assets
        else _check(
            "web-build",
            "Built interface",
            "fail",
            f"{static_assets.DIST_DIR} has no index.html",
            "Run `npm ci && npm run build` in web/.",
            presentation_code="web-build-missing",
            parameters={"path": static_assets.DIST_DIR},
        )
    ]
    if not probe:
        return checks
    checks.append(_listener_check(port, snapshot.identity))
    return checks


def _listener_check(port: int, identity: Mapping[str, object]) -> dict:
    """Whether the listener on this port serves the checkout it was started from.

    The failure this exists for: a server serves the `web/dist` snapshot it read
    at startup, so a browser check against a listener that predates the build
    inspects the bundle that build replaced. The tray compares runtime
    identities and refuses every click when they differ, and that refusal used
    to be silent.
    """

    url = f"http://127.0.0.1:{int(port)}/api/runtime"
    try:
        # A loopback URL built from an integer port. No caller supplies a scheme.
        # nosemgrep: python.lang.security.audit.dynamic-urllib-use-detected.dynamic-urllib-use-detected
        with request.urlopen(url, timeout=PROBE_TIMEOUT) as response:
            served = json.loads(response.read(64 * 1024).decode("utf-8"))
    except (error.URLError, TimeoutError, OSError, ValueError):
        return _check(
            "listener",
            "Listener identity",
            "warn",
            f"nothing is answering on port {port}",
            f"Start it with `python -B valkama.py serve --port {port}`.",
            presentation_code="listener-offline",
            parameters={"port": port},
        )
    if served.get("identity") == identity.get("identity"):
        return _check(
            "listener",
            "Listener identity",
            "ok",
            f"the listener on {port} serves this checkout",
            presentation_code="listener-current",
            parameters={"port": port},
        )
    return _check(
        "listener",
        "Listener identity",
        "fail",
        f"the listener on {port} serves a different build than this checkout",
        "Stop that process and start it again from here; until then a browser check"
        " inspects the bundle the last build replaced.",
        presentation_code="listener-stale",
        parameters={"port": port},
    )


def _driver_checks() -> list[dict]:
    checks = []
    for capability in execution_drivers.all_capabilities():
        try:
            binary = runner.client_binary(capability.client)
            checks.append(
                _check(
                    f"driver-{capability.client}",
                    f"{capability.client} driver",
                    "ok",
                    f"found at {binary}",
                    presentation_code="driver-available",
                    parameters={"client": capability.client, "path": binary},
                )
            )
        except Exception as failure:  # noqa: BLE001 -- the runner names its own refusal
            checks.append(
                _check(
                    f"driver-{capability.client}",
                    f"{capability.client} driver",
                    "warn",
                    str(failure),
                    f"Install {capability.client}, or set"
                    f" VALKAMA_{capability.client.upper()}_BIN to its absolute path."
                    " Launching without it is simply unavailable.",
                    presentation_code="driver-missing",
                    parameters={
                        "client": capability.client,
                        "variable": f"VALKAMA_{capability.client.upper()}_BIN",
                    },
                )
            )
    return checks


#: What to do about a diagnostic an adapter reports, where the answer is
#: specific. A generic "this capability is unavailable" is true and useless for
#: the case an operator can actually fix in one line.
_ADAPTER_FIXES = {
    "source_not_configured": (
        "The journal readers are opt-in by design and never crawl a home directory."
        " Point them at the clients' own folders. For good, in"
        " ~/.valkama/config.json:"
        # A tilde rather than `${USERPROFILE}`, which exists only on Windows:
        # a clean Linux run printed this advice verbatim and following it would
        # have written a reference nothing could resolve. The tilde is expanded
        # for these settings on every platform, so the one form is correct
        # everywhere and needs no variable at all.
        ' {"claude_session_root": "~/.claude/projects",'
        ' "codex_rollout_root": "~/.codex/sessions"}.'
        " For one run, VALKAMA_CLAUDE_SESSION_ROOT and VALKAMA_CODEX_ROLLOUT_ROOT."
        " Until then Usage reads `not observed` rather than zero."
    ),
    "provider_unavailable": (
        "The capability this adapter provides is unavailable until it answers;"
        " nothing else is affected."
    ),
}


def _adapter_checks() -> list[dict]:
    checks = []
    for provider in platform_providers.ProviderCatalog().seed_providers():
        state, diagnostics = provider.health()
        status = {"ready": "ok", "degraded": "warn", "unavailable": "warn"}.get(state, "unknown")
        code = str((diagnostics or {}).get("code", ""))
        presentation_code = (
            "adapter-ready"
            if status == "ok"
            else "adapter-unconfigured"
            if code == "source_not_configured"
            else "adapter-unavailable"
        )
        checks.append(
            _check(
                f"adapter-{provider.adapter_lineage_id}",
                f"Adapter {provider.adapter_id}",
                status,
                (diagnostics or {}).get("message", state),
                ""
                if status == "ok"
                else _ADAPTER_FIXES.get(code, _ADAPTER_FIXES["provider_unavailable"]),
                presentation_code=presentation_code,
                parameters={"adapter": provider.adapter_id},
            )
        )
    return checks


def _project_checks() -> list[dict]:
    listing = project_registry.read_registry()
    projects = listing.get("projects", [])
    checks = [
        _check(
            "registry",
            "Project registry",
            "ok" if listing.get("status") == "available" else "warn",
            f"{len(projects)} project(s) from {project_registry.registry_path()}",
            ""
            if listing.get("status") == "available"
            else "The registry is written by the workflow tooling; check that the file exists"
            " and is valid JSON.",
            presentation_code=(
                "registry-available"
                if listing.get("status") == "available"
                else "registry-unavailable"
            ),
            parameters={
                "count": len(projects),
                "path": str(project_registry.registry_path()),
            },
        )
    ]

    missing = [
        str(project["project_id"])
        for project in projects
        if not os.path.isdir(str(project.get("canonical_root") or ""))
    ]
    checks.append(
        _check(
            "project-roots",
            "Project roots",
            "ok",
            "every mapped root exists",
            presentation_code="project-roots-available",
        )
        if not missing
        else _check(
            "project-roots",
            "Project roots",
            "warn",
            f"missing root for {', '.join(missing)}",
            "The project was moved or removed; update its canonical_root in the registry.",
            presentation_code="project-roots-missing",
            parameters={"projects": ", ".join(missing)},
        )
    )

    without_knowledge = [
        str(project["project_id"])
        for project in projects
        if memory_service.knowledge_root(str(project["project_id"]))["status"] != "mapped"
    ]
    checks.append(
        _check(
            "knowledge-roots",
            "Knowledge roots",
            "ok",
            "every project has a docs/ folder",
            presentation_code="knowledge-roots-available",
            parameters={"directory": memory_service.DEFAULT_KNOWLEDGE_DIRECTORY},
        )
        if not without_knowledge
        else _check(
            "knowledge-roots",
            "Knowledge roots",
            "warn",
            f"no {memory_service.DEFAULT_KNOWLEDGE_DIRECTORY}/ in {', '.join(without_knowledge)}",
            "Memory search answers nothing for these projects. Create the folder, or accept"
            " that this project keeps its knowledge elsewhere.",
            presentation_code="knowledge-roots-missing",
            parameters={
                "directory": memory_service.DEFAULT_KNOWLEDGE_DIRECTORY,
                "projects": ", ".join(without_knowledge),
            },
        )
    )
    return checks


def render(report: dict) -> str:
    """The report as a person reads it: by level, worst first inside each."""

    order = {"fail": 0, "warn": 1, "unknown": 2, "ok": 3}
    lines = [f"valkama doctor: {report['status']}"]
    for level in report.get("levels", []):
        lines.append(f"  {level['title']} [{level['status']}]")
        for check in sorted(level["checks"], key=lambda item: order[item["status"]]):
            lines.append(f"    [{check['status']:<7}] {check['title']}: {check['detail']}")
            if check["fix"] and check["status"] != "ok":
                lines.append(f"              fix: {check['fix']}")
    return "\n".join(lines)


__all__ = ["LEVELS", "PROBE_TIMEOUT", "STATUSES", "diagnose", "render", "worst_of"]
