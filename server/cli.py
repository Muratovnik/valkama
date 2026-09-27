"""The command-line surface: every subcommand the entry point dispatches to.

  mcp                      MCP stdio server (what the stable launcher runs)
  serve [--port 8642]      JSON API plus the built web UI and session ingest
  capabilities             machine-readable public interfaces and protocol versions
  status                   read-only source, data and launcher status
  launcher ...             install, inspect and supervise the stable service command
  runtime                  canonical backend/static identity for this checkout
  summary [--space KEY]    short planning-space report for session hooks
  purge-stream             drop purgeable stream session events (analytics stay)
  scopes | attach | detach attachable database files, federated at read time
  migrate planning-model   one-way Board -> Planning conversion, once, on request
                           (--dry-run converts a copy and reports)

This is the one module allowed to import more than one surface: choosing
between them is exactly what it is for.
"""

from __future__ import annotations

import argparse
import contextlib
import json
import os
import shutil
import sqlite3
import sys
import tempfile
from pathlib import Path
from typing import Any

from . import documents, launcher, static_assets, store
from .analytics import journal
from .federation import federated_spaces
from .http_surface import serve_main
from .mcp_surface import LEGACY_PROTOCOLS, MODERN_PROTOCOL, catalogue, mcp_main
from .ops import adapter_check, configuration, doctor, export, setup
from .planning import service as planning_service
from .planning import views as planning_views
from .platform import core as platform_core
from .platform import installed
from .platform import scope as platform_scope
from .platform.contracts import planning_space_entity
from .projects import registry_owner, scopes
from .sessions import purge_stream_events
from .static_assets import DIST_DIR, SOURCE_ROOT
from .store import connect, data_root, db_path

# --- session-probe summary and routa import ---------------------------------


def summary_main(space: str | None) -> None:
    """One planning space in a few lines, for a terminal or a hook."""

    conn = connect()
    payload = planning_views.planning_payload(conn, space=space)
    identity = payload["planning_space"]
    if identity is None:
        print("- no planning space exists yet")
        return
    items = payload["work_items"]
    by_state: dict[str, int] = {}
    for item in items:
        by_state[item["state"]["name"]] = by_state.get(item["state"]["name"], 0) + 1
    counts = ", ".join(f"{name} {count}" for name, count in by_state.items())
    print(f"- space '{identity['name']}' ({identity['key']}): {counts or 'no work items'}.")
    epics = [item for item in items if item["kind"] == "epic"]
    if epics:
        listed = "; ".join(
            f"'{item['title']}' [{item['state']['name']}] {item['reference']}" for item in epics
        )
        print(f"- epics: {listed}")
    ready = [
        item
        for item in items
        if item["claim_ref"] == "" and item["state"]["category"] in {"backlog", "queued"}
    ]
    if ready:
        listed = "; ".join(f"'{item['title']}' {item['reference']}" for item in ready[:5])
        print(f"- ready to take (unclaimed, in a startable state): {listed}")
    held = [item for item in items if item["claim_ref"]]
    if held:
        listed = "; ".join(f"{item['reference']} {item['claim_ref']}" for item in held[:5])
        print(f"- held: {listed}")


def migrate_main(target: str, *, dry_run: bool = False) -> None:
    """Authorise the one-way conversion, then let `connect()` perform it.

    The permission is set here and nowhere else. `connect()` refuses a Board-era
    store without it, because the alternative — converting whatever store a
    process happens to open — converted the owner's live database from a test run
    and again from every session an MCP client respawned afterwards.

    A dry run copies the store and converts the copy. The Board era rolled a
    transaction back instead, which is a weaker promise: a rollback still opened
    the real file for writing, and a crash mid-way left its journal behind. A
    copy cannot reach the original at all.
    """

    if target != "planning-model":
        raise SystemExit(f"unknown migration target {target!r}")
    source = db_path()
    if dry_run:
        with tempfile.TemporaryDirectory() as scratch:
            copy = os.path.join(scratch, "dry-run.sqlite3")
            shutil.copyfile(source, copy)
            print(json.dumps({"dry_run": True, **_convert(copy)}, ensure_ascii=False, indent=1))
        return
    print(json.dumps({"dry_run": False, **_convert(source)}, ensure_ascii=False, indent=1))


def _convert(path: str) -> dict:
    """Convert one store and report what it now holds."""

    with (
        mock_environment(store.CUTOVER_ENV, "1"),
        mock_environment("VALKAMA_DB", path),
    ):
        conn = connect()
        try:
            # Literal names, one statement each: the count is a report, and a
            # generated table name is not worth a generated query.
            return {
                "planning_spaces": conn.execute("SELECT COUNT(*) FROM planning_spaces").fetchone()[
                    0
                ],
                "work_items": conn.execute("SELECT COUNT(*) FROM work_items").fetchone()[0],
                "links": conn.execute("SELECT COUNT(*) FROM work_item_links").fetchone()[0],
                "comments": conn.execute("SELECT COUNT(*) FROM work_item_comments").fetchone()[0],
                "refs": conn.execute("SELECT COUNT(*) FROM work_item_refs").fetchone()[0],
                "events": conn.execute("SELECT COUNT(*) FROM work_item_events").fetchone()[0],
            }
        finally:
            conn.close()


@contextlib.contextmanager
def mock_environment(name: str, value: str):
    """One environment value for the length of a block, restored afterwards."""

    previous = os.environ.get(name)
    os.environ[name] = value
    try:
        yield
    finally:
        if previous is None:
            os.environ.pop(name, None)
        else:
            os.environ[name] = previous


def runtime_main() -> None:
    """Print the canonical identity a new server process would expose."""

    print(static_assets.canonical_json(static_assets.runtime_identity(SOURCE_ROOT, DIST_DIR)))


def capabilities_main() -> None:
    """Publish stable component identity without reading or creating user data."""

    payload = {
        "schema_version": 1,
        "component": "valkama",
        "interfaces": {
            "mcp": {
                "modern_protocol": MODERN_PROTOCOL,
                "legacy_protocols": list(LEGACY_PROTOCOLS),
                "tools": len(catalogue()),
            },
            "http": {"bind": "127.0.0.1", "default_port": 8642},
            "desktop": {"platform": "windows"},
        },
        "commands": [
            "capabilities",
            "status",
            "launcher",
            "mcp",
            "serve",
            "runtime",
            "summary",
            "config",
            "setup",
            "doctor",
            "adapter",
            "export",
            "migrate",
            "scopes",
            "attach",
            "detach",
            "purge-stream",
        ],
    }
    print(static_assets.canonical_json(payload))


def status_main(launcher_directory: str | None) -> None:
    """Report service-owned paths without opening or migrating the database."""

    database = db_path()
    try:
        launcher_status = launcher.status(launcher_directory)
    except launcher.LauncherError as error:
        launcher_status = {"state": "unavailable", "detail": str(error)}
    payload = {
        "schema_version": 1,
        "component": "valkama",
        "source": {
            "root": SOURCE_ROOT,
            "entry_point": os.path.join(SOURCE_ROOT, "valkama.py"),
        },
        "database": {
            "root": data_root(),
            "path": database,
            "exists": os.path.isfile(database),
        },
        "runtime": static_assets.runtime_identity(SOURCE_ROOT, DIST_DIR),
        "launcher": launcher_status,
    }
    print(static_assets.canonical_json(payload))


def _write_utf8() -> None:
    """Say what this process writes instead of letting the console decide.

    A planning space is full of Cyrillic titles and arrows. Redirect this output
    on a CP1251 console and the encoder raises on the first character it has no
    room for, which is what `summary` did from its first commit: the session
    hooks that run it were one arrow in a title away from failing. Card #292.

    The same statement this project makes for authored text and for protocol
    bytes, applied to the one surface a console gets to re-encode.
    """
    for stream in (sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if reconfigure is not None:
            with contextlib.suppress(OSError, ValueError):
                reconfigure(encoding="utf-8", errors="strict")


def _adapter_command(options) -> None:
    """The four things an owner does with an adapter, and the rule between them."""

    if options.adapter_command == "list":
        records, refusals = installed.read_records()
        for record in records:
            manifest, transport = record["manifest"], record["transport"]
            where = transport.get("base_url") or " ".join(transport.get("command", []))
            print(f"{manifest['adapter_id']}  {manifest['version']}  {where}")
        for refusal in refusals:
            print(f"refused {refusal['path']}: {refusal['reason']}")
        if not records and not refusals:
            print("no external adapters are declared")
        return
    if options.adapter_command == "remove":
        # The registry first, because it is the half that can refuse. It does so
        # while an assignment still selects the lineage, and deleting the
        # declaration before asking left the exact debris the paired flow exists
        # to prevent: declaration gone, rows present, and no file left to
        # install again to reach them.
        with contextlib.closing(store.connect()) as conn:
            platform = platform_core.Platform(conn, store.db_path())
            outcome = platform.unregister_external_adapter(options.adapter_id)
        print(
            f"unregistered {options.adapter_id}"
            if outcome["removed"]
            else f"not unregistered: {outcome['reason']}"
        )
        if not outcome["removed"] and outcome["code"] == "assignments-select-it":
            # A refusal leaves both halves in place. Nothing registered under
            # that id is not a refusal: a declaration written since the last
            # start has no rows yet and is still the owner's to remove.
            raise SystemExit(1)
        declared = installed.remove(options.adapter_id)
        print(
            f"removed the declaration of {options.adapter_id}"
            if declared
            else f"{options.adapter_id} was not declared here"
        )
        return
    if options.adapter_command not in ("check", "install"):
        raise SystemExit("valkama adapter check|install|remove|list")

    # A different name from the `record` the listing loop binds: mypy infers
    # that one as a plain dict, and reusing it here hid the optional.
    report, installation = _adapter_report(options)
    print(
        json.dumps(report, ensure_ascii=False, indent=1)
        if options.json
        else adapter_check.render(report)
    )
    if options.adapter_command == "check":
        # Same rule as the doctor: a warning is a normal adapter, a failure is
        # one that answered something it should have declined.
        if report["status"] == "fail":
            raise SystemExit(1)
        return
    if report["status"] == "fail" and not options.force:
        raise SystemExit("refusing to install an adapter that failed its check; --force overrides")
    if installation is None:
        raise SystemExit("nothing to install: the adapter served no usable manifest")
    path = installed.install(installation["manifest"], installation["transport"])
    print(f"declared at {path}")
    print("It becomes a Connection on the next start of the server or the tray.")


def _adapter_report(options) -> tuple[dict, dict | None]:
    """One report, and the record it was made from when there is one."""

    if options.record:
        report = adapter_check.check_file(options.record)
        try:
            return report, adapter_check.read_record_file(options.record)
        except Exception:  # noqa: BLE001 — the report already carries the reason
            return report, None
    if options.at:
        transport = {"kind": "http", "base_url": options.at}
        where = options.at
    elif options.mcp_argv:
        transport = {"kind": "mcp", "command": list(options.mcp_argv)}
        where = " ".join(options.mcp_argv)
    else:
        transport = {"kind": "cli", "command": list(options.adapter_argv)}
        where = " ".join(options.adapter_argv)
    report = adapter_check.check_source(transport, where)
    try:
        return report, adapter_check.record_from_source(transport)
    except Exception:  # noqa: BLE001 — the report already carries the reason
        return report, None


def _launcher_parser(commands: argparse._SubParsersAction) -> None:
    launcher_command = commands.add_parser(
        "launcher",
        help="install, inspect or supervise the stable service command",
    )
    actions = launcher_command.add_subparsers(dest="launcher_action", required=True)
    for name in ("install", "status", "uninstall"):
        action = actions.add_parser(name)
        action.add_argument("--directory", default=None)
        if name in {"install", "uninstall"}:
            action.add_argument("--force", action="store_true")
    listener = actions.add_parser(
        "listener",
        help="inspect or stop the HTTP listener owned by the managed launcher",
    )
    listener_actions = listener.add_subparsers(dest="listener_action", required=True)
    for name in ("status", "stop"):
        action = listener_actions.add_parser(name)
        action.add_argument("--directory", default=None)
        action.add_argument("--port", type=int, default=8642)


def _launcher_main(parser: argparse.ArgumentParser, options: argparse.Namespace) -> None:
    try:
        if options.launcher_action == "install":
            result = launcher.install(options.directory, force=options.force)
        elif options.launcher_action == "uninstall":
            result = launcher.uninstall(options.directory, force=options.force)
        elif options.launcher_action == "listener" and options.listener_action == "stop":
            result = launcher.stop_listener(options.directory, port=options.port)
        elif options.launcher_action == "listener":
            result = launcher.listener_status(options.directory, port=options.port)
        else:
            result = launcher.status(options.directory)
    except launcher.LauncherError as error:
        parser.error(str(error))
    print(json.dumps(result, ensure_ascii=False, indent=1, sort_keys=True))


def _projects_main(options: argparse.Namespace) -> None:
    inventory = registry_owner.inventory_path()
    target = registry_owner.projection_path()
    command = options.projects_command
    try:
        payload: dict[str, Any]
        if command == "list":
            raw = inventory.read_bytes()
            payload = {"projects": registry_owner.parse_inventory(raw)}
        elif command in {"check", "doctor"}:
            payload = registry_owner.check(inventory, target)
        elif command == "rollback":
            payload = {"changed": registry_owner.rollback(inventory, target)}
        elif command == "import":
            payload = {
                "changed": registry_owner.update(
                    inventory, target, source=Path(options.source).expanduser()
                )
            }
        elif command == "add":
            payload = {
                "changed": registry_owner.update(
                    inventory,
                    target,
                    add={
                        "project_id": options.project_id,
                        "display_name": options.name,
                        "canonical_root": options.root,
                        "planning_binding": None,
                    },
                )
            }
        elif command == "update":
            payload = {
                "changed": registry_owner.update(
                    inventory,
                    target,
                    edit=(options.project_id, options.name, options.root),
                )
            }
        elif command == "remove":
            payload = {
                "changed": registry_owner.update(inventory, target, remove=options.project_id)
            }
        elif command == "bind":
            selected = next(
                (entry for entry in scopes.load(db_path()) if entry["name"] == options.scope),
                None,
            )
            if selected is None or (
                not selected["primary"] and not os.path.isfile(selected["path"])
            ):
                raise registry_owner.RegistryOwnerError(
                    f"data scope is unavailable: {options.scope}"
                )
            database = Path(selected["path"])
            with contextlib.closing(
                sqlite3.connect(database.as_uri() + "?mode=ro", uri=True)
            ) as conn:
                conn.row_factory = sqlite3.Row
                space = planning_service.get_planning_space(conn, options.space)
                if space["project_id"] != options.project_id:
                    raise registry_owner.RegistryOwnerError(
                        "planning space belongs to a different project id"
                    )
                metadata = platform_scope.read_store_metadata(conn)
            binding = planning_space_entity(
                {"data_scope_id": metadata["data_scope_id"], "space_key": space["key"]}
            )
            payload = {
                "changed": registry_owner.update(
                    inventory, target, bind=(options.project_id, binding)
                ),
                "planning_binding": binding,
            }
        else:
            payload = {"changed": registry_owner.update(inventory, target)}
        print(json.dumps(payload, ensure_ascii=False, indent=1, sort_keys=True))
        if command in {"check", "doctor"} and not payload["ok"]:
            raise SystemExit(1)
    except (OSError, ValueError, sqlite3.Error) as error:
        raise SystemExit(f"projects: {error}") from error


def main(argv: list[str] | None = None) -> None:
    """Route one command line. `argv` defaults to this process's, as usual.

    Named rather than read straight from `sys.argv` so the surface can be
    driven by a test: every command below reached production through a
    subprocess and nothing else, which is why the module had no coverage at all
    while its behavior was assumed.
    """
    _write_utf8()
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command")
    commands.add_parser("mcp")
    serve = commands.add_parser("serve")
    serve.add_argument("--port", type=int, default=8642)
    serve.add_argument(
        "--development-origin",
        choices=("http://127.0.0.1:5173",),
        help="allow the fixed Vite development origin",
    )
    commands.add_parser("capabilities")
    status = commands.add_parser("status")
    status.add_argument("--launcher-directory", default=None)
    _launcher_parser(commands)
    commands.add_parser(
        "runtime",
        help="print the canonical backend/static identity for the local checkout",
    )
    projects_cmd = commands.add_parser("projects", help="manage the local project inventory")
    projects_sub = projects_cmd.add_subparsers(dest="projects_command", required=True)
    projects_sub.add_parser("list", help="list registered projects")
    add_cmd = projects_sub.add_parser("add", help="register an existing project root")
    add_cmd.add_argument("project_id")
    add_cmd.add_argument("--name", required=True)
    add_cmd.add_argument("--root", required=True)
    update_cmd = projects_sub.add_parser("update", help="change a project name or root")
    update_cmd.add_argument("project_id")
    update_details = update_cmd.add_argument_group("changes")
    update_details.add_argument("--name")
    update_details.add_argument("--root")
    remove_cmd = projects_sub.add_parser("remove", help="remove only the project registration")
    remove_cmd.add_argument("project_id")
    bind_cmd = projects_sub.add_parser("bind", help="bind an existing Planning space")
    bind_cmd.add_argument("project_id")
    bind_cmd.add_argument("--space", required=True)
    bind_cmd.add_argument("--scope", default=scopes.PRIMARY_SCOPE)
    projects_sub.add_parser("check", help="compare inventory and projection")
    projects_sub.add_parser("apply", help="project the current inventory")
    projects_sub.add_parser("doctor", help="report inventory and projection health")
    projects_sub.add_parser("rollback", help="restore exact prior inventory and projection bytes")
    import_cmd = projects_sub.add_parser("import", help="import an existing inventory once")
    import_cmd.add_argument("--source", required=True)
    summary = commands.add_parser("summary")
    summary.add_argument("--space", default=None)
    scopes_cmd = commands.add_parser(
        "scopes", help="list attached database scopes and their planning spaces"
    )
    scopes_cmd.add_argument("--json", action="store_true")
    attach_cmd = commands.add_parser("attach", help="attach another database file")
    attach_cmd.add_argument("name")
    attach_cmd.add_argument("path")
    attach_cmd.add_argument("--label", default="")
    detach_cmd = commands.add_parser(
        "detach", help="remove a scope from every view; the file is untouched"
    )
    detach_cmd.add_argument("name")
    purge_cmd = commands.add_parser(
        "purge-stream",
        help="delete purgeable stream session events; analytics rows stay",
    )
    purge_cmd.add_argument("--session", default=None)
    purge_cmd.add_argument(
        "--include-active",
        action="store_true",
        help="also purge live sessions' stream tails (default: ended only)",
    )
    purge_cmd.add_argument(
        "--retention",
        action="store_true",
        help="apply this scope's configured stream_retention_days instead of purging all",
    )
    doctor_cmd = commands.add_parser(
        "doctor",
        help="check this installation and say what to do about each problem",
    )
    doctor_cmd.add_argument("--port", type=int, default=8642)
    doctor_cmd.add_argument("--json", action="store_true")
    doctor_cmd.add_argument(
        "--no-probe",
        action="store_true",
        help="skip the loopback runtime check; everything else is local",
    )
    setup_cmd = commands.add_parser(
        "setup",
        help="report what this installation needs, and the exact command for each gap",
    )
    setup_cmd.add_argument("--json", action="store_true")
    setup_cmd.add_argument(
        "--apply",
        action="store_true",
        help="run the proposed registration commands; without it nothing is changed",
    )
    adapter_cmd = commands.add_parser(
        "adapter",
        help="check whether an external adapter conforms to the contract",
    )
    adapter_sub = adapter_cmd.add_subparsers(dest="adapter_command")
    for name, help_text in (
        ("check", "ask an adapter for its manifest, then probe it for its refusals"),
        ("install", "check an adapter, then declare it for this installation"),
    ):
        command = adapter_sub.add_parser(name, help=help_text)
        # A destination rather than a manifest file, because the manifest no
        # longer carries one: it is published to the browser and may not hold a
        # path or an argv. The owner says where, the adapter says what it is.
        source = command.add_mutually_exclusive_group(required=True)
        source.add_argument("--at", metavar="URL", help="an adapter serving http(s)")
        source.add_argument(
            "--command",
            # An explicit dest: the top-level subcommand already uses `command`,
            # and without this the argv list overwrote it, so the dispatcher
            # matched nothing and the program exited silently with status zero.
            dest="adapter_argv",
            nargs=argparse.REMAINDER,
            metavar="ARG",
            help="an adapter run as a process; everything after this is its argv",
        )
        source.add_argument(
            "--mcp",
            dest="mcp_argv",
            nargs=argparse.REMAINDER,
            metavar="ARG",
            help="an adapter that is already an MCP server; everything after is its argv",
        )
        source.add_argument(
            "--record", metavar="FILE", help="an installation record already on disk"
        )
        command.add_argument("--json", action="store_true")
        if name == "install":
            command.add_argument(
                "--force",
                action="store_true",
                help="install despite a failing check; the failures print either way",
            )
    remove_cmd = adapter_sub.add_parser("remove", help="stop declaring an installed adapter")
    remove_cmd.add_argument("adapter_id")
    adapter_sub.add_parser("list", help="the adapters this installation declares")
    config_cmd = commands.add_parser(
        "config",
        help="show every setting, the layer it came from, and the value in use",
    )
    config_cmd.add_argument("--json", action="store_true")
    export_cmd = commands.add_parser(
        "export",
        help="write the planning trail, relations, settings and decisions as one file",
    )
    export_cmd.add_argument(
        "--section",
        action="append",
        choices=export.SECTIONS,
        help="export only this section; repeatable, default is everything",
    )
    migrate_cmd = commands.add_parser(
        "migrate", help="run one named forward-only data migration, once"
    )
    migrate_cmd.add_argument("target", choices=("planning-model",))
    migrate_cmd.add_argument(
        "--dry-run",
        action="store_true",
        help="convert a copy and report what would move; the store is untouched",
    )
    options = parser.parse_args(argv)
    if options.command == "serve":
        serve_main(options.port, development_origin=options.development_origin)
    elif options.command == "capabilities":
        capabilities_main()
    elif options.command == "status":
        status_main(options.launcher_directory)
    elif options.command == "launcher":
        _launcher_main(parser, options)
    elif options.command == "runtime":
        runtime_main()
    elif options.command == "projects":
        _projects_main(options)
    elif options.command == "export":
        conn = connect()
        try:
            sections = tuple(options.section or export.SECTIONS)
            print(
                export.render(
                    export.export_installation(conn, sections=sections, db_path=db_path())
                )
            )
        finally:
            conn.close()
    elif options.command == "setup":
        # The reading is what `--apply` runs, rather than a fresh one: a second
        # inspection could propose a different set from the one just shown.
        reading = setup.inspect()
        applied = setup.apply(reading) if options.apply else None
        if options.json:
            print(json.dumps({**reading, "applied": applied}, ensure_ascii=False, indent=1))
        else:
            print(setup.render(reading, applied))
        if reading["status"] == "fail" and not options.apply:
            raise SystemExit(1)
    elif options.command == "config":
        # The effective values come from the modules that own them rather than
        # from a second copy here: a configuration report that computed its own
        # store path would be exactly the disagreement it exists to find.
        journals = journal.LocalJournalUsageProvider()
        reading = configuration.report(
            {
                "store": db_path(),
                "document_roots": os.pathsep.join(documents.doc_roots()),
                "claude_session_root": os.pathsep.join(journals.claude_roots),
                "codex_rollout_root": os.pathsep.join(journals.codex_roots),
            }
        )
        print(
            json.dumps(reading, ensure_ascii=False, indent=1)
            if options.json
            else configuration.render(reading)
        )
    elif options.command == "doctor":
        report = doctor.diagnose(port=options.port, probe=not options.no_probe)
        print(
            json.dumps(report, ensure_ascii=False, indent=1)
            if options.json
            else doctor.render(report)
        )
        # The exit code is the summary a script reads. A warning is not a
        # failure: an unconfigured optional source is a normal installation.
        if report["status"] == "fail":
            raise SystemExit(1)
    elif options.command == "adapter":
        _adapter_command(options)
    elif options.command == "migrate":
        migrate_main(options.target, dry_run=options.dry_run)
    elif options.command == "summary":
        summary_main(options.space)
    elif options.command == "scopes":
        listing = federated_spaces()
        if options.json:
            print(json.dumps(listing, ensure_ascii=False, indent=1))
        else:
            for scope in listing["scopes"]:
                mark = "primary" if scope["primary"] else "attached"
                state = "ok" if scope["available"] else f"UNAVAILABLE: {scope['detail']}"
                print(f"{scope['name']:<16} {mark:<9} {state}  {scope['path']}")
            for space in listing["planning_spaces"]:
                print(
                    f"  {space['scope']}#{space['key']}: {space['work_items']} items,"
                    f" {space['open']} open, {space['active']} active"
                )
    elif options.command == "attach":
        attached = scopes.attach(db_path(), options.name, options.path, options.label)
        print(json.dumps([item["name"] for item in attached]))
    elif options.command == "detach":
        remaining = scopes.detach(db_path(), options.name)
        print(json.dumps([item["name"] for item in remaining]))
    elif options.command == "purge-stream":
        conn = connect()
        days = None
        if options.retention:
            days = scopes.find(db_path(), scopes.PRIMARY_SCOPE)["stream_retention_days"]
        print(json.dumps(purge_stream_events(conn, options.session, options.include_active, days)))
    else:
        mcp_main()


if __name__ == "__main__":
    main()
