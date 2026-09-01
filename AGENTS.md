# Valkama repository instructions

This is an independent Git repository holding one product, Valkama, and it ships
on its own.

What must hold in every session lives in this file. The deep halves — why each
gate exists, the subprocess boundary, the store's names and migrations, the web
grammar — live one topic per file under `.agents/rules/`, and the pointers below
say when a topic stops being optional.

A machine may carry a local overlay as `AGENTS.local.md`. It is not tracked
here, it never contradicts this file, and its absence changes nothing: this file
is complete on its own.

- Read `README.md` before changing a tool. `CONTRIBUTING.md` states the same
  gates for a human contributor.
- Preserve supported external MCP handshake and tool schemas. Preserve existing
  local data through a verified backup, one forward-only migration, and a
  tested restore path. A migrated store has one runtime schema: never add a
  dual-read, dual-write, alias, or compatibility data layer.
- This server is dual-era: one process serves revision 2026-07-28 and the
  `initialize` handshake it replaced, choosing from how the client opens. The
  mechanics live in `docs/connection-contract.md`; the rule that lives here is
  about the legacy door. Modern-only was tried and reverted in the same
  afternoon — Claude Code opened with `initialize` at the time and could not
  fall forward, so the board vanished from every agent session on the next
  restart. `LEGACY_PROTOCOLS` may only be emptied once the clients in use stop
  sending `initialize`, which is verified by restarting them, not by reading a
  changelog.
- Every schema or destructive data operation requires a tested backup and
  rollback path.
- `store.STORE_SCHEMA_VERSION` is a ratchet, not a release number. Raise it in
  the same commit that changes what an existing row means, and a build made
  before that change refuses the store instead of misreading it. Migrations here
  are forward-only and idempotent, so an added table or column does not need it;
  a changed meaning does. It is read before the first write, so it governs a
  server that was spawned old. A server that went stale while it ran still holds
  its connection, and `static_assets.SourceWatch` is what warns about that one.
- For Valkama changes run:

```powershell
python -m ruff check .
python -m ruff format --check .
python .github/relkit.pyz audit --history
typos
vulture server tests valkama.py vulture_whitelist.py --min-confidence 60
mypy
lint-imports --cache-dir .cache/import-linter
semgrep scan --config p/python --config p/security-audit --metrics off --error server valkama.py
python -m coverage run -m unittest discover -s . -p "test_*.py"
python -m coverage report
cd web
npm test
npm run typecheck
npm run build
cd ../desktop
npm test
```

On the owner workstation, also install and verify the private-value gate before
the first push: `python .github/relkit.pyz protect install`, then
`python .github/relkit.pyz audit --history --owner`.

`npm run build` is mandatory, and it is not the last step. The server serves the
snapshot of `web/dist` it read when it started, so a browser check against a
listener that predates the build inspects the bundle that build replaced, and a
green screenshot means nothing. Rebuild, then restart the listener actually in
use — the one on port 8642 — before verifying anything live and again before
handing the task over. Leaving it stale is not a cosmetic loss: the tray
compares runtime identities, so a stale listener makes it refuse every click,
and the refusal used to be silent. When anything under `desktop/` changed, run
`npm run dist` there as well; the installed app is a separate artifact that no
web build touches, and reporting a desktop change as delivered without it hands
the owner their previous binary.

Every tool above is a development dependency pinned in `requirements-dev.txt`,
configured in `pyproject.toml`. The server itself imports nothing outside the
standard library and must keep it that way, because the desktop app launches the
system Python with no virtualenv.

What each gate runs, what each ratchet measures, and the traps that earned their
sentences live in `.agents/rules/quality-gates.md`, to read before touching the
toolchain, the tests, or a number a gate compares against. Two rules from it are
always in force:

- Ratchets only tighten. The mypy overrides list only empties, the coverage
  floor `fail_under` only rises, and a module or test absent from a list is
  checked, not skipped.
- Dead code fails the gate on both sides: knip for the web, vulture for the
  Python server.

Before adding a `subprocess.run`, read `.agents/rules/subprocess-encoding.md`.
On Windows `text=True` swallows decode failures, so subprocess text goes through
`processes.run_text` — bytes in, decoded with a named codec and error policy —
and a source guard holds every decoding call to naming both.

The top level is five owned directories, one entry point, and the configuration
a repository root has to carry — `server/`, `web/`, `desktop/`, `windows/`,
`tests/`, plus `docs/` and the `.agents/rules/` this file routes to.
`README.md` states what each owns. A new file at the top level needs an argument
for why it belongs to none of them; the usual answer is that it belongs to
`windows/`, which holds what exists only because the host is Windows — the tray
script, the icon, the generator that renders it, and the installer.

The server lives in `server/`, split into domain and surfaces. Domain modules
answer questions about the store and know nothing about who asked: `store`,
`sessions`, `federation`, `refs`, `documents`, `runner`, `processes`,
`git_worktrees`, `static_assets`, `watchers`, plus the `planning/`,
`executions/`, `platform/`, `analytics/`, `improvements/`, `memory/`,
`projects/`, `ops/`, `telemetry/` and `skills/` subpackages. The three
surfaces own no domain rule: `mcp_surface`, `http_surface` and `cli`.

`store` keeps what only it can own — the schema, the ratchet, the store's own
path, and the order a store is brought up in, read top to bottom in `connect()`.
The mechanics each step needs sit beside it: `store_adoption` moves a directory
an earlier generation wrote, `store_backups` makes and verifies the recovery
point, `store_lock` serializes the processes doing any of it, and `store_rename`
carries a store off the former product name. Those four take what they need as
arguments, because a second answer to "where is the store" is the failure the
one configuration resolution exists to end.

Planning is the domain the Board era left behind, and it lives in `planning/`:
one space, its workflow, its work items and the links between them. `board.py`,
`launches.py` and `graph.py` are gone — the first two replaced by
`planning/service.py` and `executions/`, and the third by a projection every
view takes from one read model rather than a second fetch. `planning/service.py`
writes and `planning/read_model.py` shapes what a caller sees; the dependency
runs that way only.

Every write there names the revision it read, in the `WHERE` clause of the one
UPDATE `service._write` issues, which is why it takes the row rather than the id.
A read takes no lock, so without that clause two agents both saw an unheld item
and both wrote their own name into it — the claim the tool contract calls atomic
was neither, and nothing failed loudly. `tests/test_planning_concurrency.py` is
the only suite here with two connections, and it is what proves the guard.

One attempt at a work item is `executions/`: its own tables, its lifecycle, the
Git baseline it started from, and one driver per agent client. A driver owns that
client end to end — the command line, whether the identity is assigned or
observed, which effort values it takes, where its structured result arrives — so
nothing else branches on a client name. Two callers used to, and their copies had
drifted. `runner` keeps process shape only: it spawns, polls and stops, and knows
nothing about what any of that means for the work.

Imports run one way and this is the invariant to protect: a surface may import
domain, domain may never import a surface, and no surface imports another. `cli`
is the single exception by construction — choosing between the other two is what
it is for.

Read a shared mutable singleton through its own module, never by binding it:
`runner.RUNNER` and `watchers.IMPROVEMENTS_RUNTIME`, not `from .runner import
RUNNER`. A test that swaps one in has to reach every reader, and `from X import
Y` gives each importer a private copy that the swap cannot see.

`valkama.py` is the source entry-point shim and stays at the repository root.
Agent clients must register the service-owned command installed by
`python valkama.py launcher install`; the user-facing command path is stable and
contains no checkout path. Only the managed launcher shim records the current
source entry point and interpreter. The desktop installer and tray may keep their
own service-owned install records. Moving the repository therefore requires one
launcher reinstall and, for the desktop app, one rebuild/reinstall — not edits in
every client and project configuration. Tests mirror the package under `tests/`,
and they import from the module that owns what they exercise rather than through
one facade.

The product is Valkama; planning is one of its seven modules. A module is a
row in `platform_modules`, and the Kernel writes the ones this build declares
that the store has never known — so adding one is a code change rather than a
code change plus a hand-written INSERT. A row that was removed stays removed:
the audit is what tells a removal apart from a module that is new.

The product has now been renamed twice — Kanban, then Agent Hub, then this —
and the lesson of the second one is written into the gates here: it renamed the
sources and stopped, leaving the tray looking for its script beside the wrong
module and the desktop launcher pointing at an install path that no longer
existed. Neither failed loudly. A rename is finished when the runtime agrees,
not when the strings do.

The public configuration has one resolution, in `server/ops/configuration.py`:
environment, then `~/.valkama/config.json`, then the caller's own default. A
value in the file may be a `${VAR}` or `${VAR:-default}` reference, which is
Claude Code's `.mcp.json` syntax including its behaviour for an unresolved
one — the text stays and the failure is reported rather than going blank.
Add a setting there and nowhere else; a second reader once moved the Kernel's
view of the projects registry and nothing else's. Defaults stay with the module that owns them, so
the store's path is not in a module the store imports.

The kernel names the module platform, not a former product: `server/platform/`
is the package, `platform_*` the tables, `platform.*` the i18n key space, and
`valkama-*` the interface ids, none with a version suffix. Four literals are
deliberately still spelled the old way because they name what earlier
generations wrote on real disks; that list, the migration that renamed
everything else, and the store-adoption and ownership rules live in
`.agents/rules/store-and-naming.md`, to read before touching a table name, an
interface id, `LEGACY_LAYOUTS`, or anything under `%USERPROFILE%\.valkama`.

The web app in `web/src` is laid out in Feature-Sliced Design layers — `app`,
`pages`, `widgets`, `features`, `entities`, `shared`, from the top down. The
full grammar — what each layer owns, slices and segments, the token system and
the scoped-CSS rules — lives in `.agents/rules/web-architecture.md`, to read
before changing anything under `web/src`. Three invariants from it are always in
force, and the gates hold each:

- A file imports only from a layer strictly below its own, and never a sibling
  slice of its own layer; cross-file imports use the `@/` alias, never relative
  chains. `npm run check:ui-system` fails a breach and a runtime import cycle.
- Styling is one system — semantic tokens plus named classes; there is no
  utility framework, and the guard rejects one reappearing.
- A component is a black box: a scoped style block names only classes its own
  file writes, and `:deep()`/`:global()` are held to a list of files with a
  reason each.

- Live behavior must be verified through at least one MCP or CLI call after
  configuration changes.
- Keep generated `node_modules`, release bundles, databases, WAL files, logs,
  and user runtime state out of Git. The one deliberate exception is `web/dist`,
  committed so a clone serves the built UI with no build step; rebuild and
  commit it whenever `web/src` changes.
- Commit subjects are Conventional Commits with the Angular type set: `build`,
  `chore`, `ci`, `docs`, `feat`, `fix`, `perf`, `refactor`, `revert`, `style`,
  `test`, an optional lowercase scope, and `!` for a break.
- Do not commit or push unless the user explicitly requests it.

## Artifact placement

- This repository's documentation: `docs/` here. Every document under `docs/`
  declares its lifecycle in frontmatter — `status: draft | adopted | superseded`
  and the `card:` ids of the work it belongs to.
  `tests/test_docs_lifecycle.py` refuses an orphan; `README.md` files describe a
  directory rather than one piece of work and are exempt.
- The deep halves of `AGENTS.md`: `.agents/rules/`, one topic per file, each
  reached by a pointer in this file. They are instructions, not lifecycle
  documents, so they carry no frontmatter; a topic file nothing points to is
  dead and should be folded back or deleted.
- Public-facing files — `README.md`, `SERVICE.md`, `CONTRIBUTING.md`,
  `CHANGELOG.md`, `DESIGN.md`, the contracts in `docs/` — must stand alone. A
  reader of a fresh clone has no planning trail and no local overlay, so those
  files may not reference one.
- Databases, WAL files, release bundles, logs, and `node_modules`: outside Git,
  as above; `web/dist` is the one committed exception.

## Response style

Lead with the practical result or exact blocker. Distinguish confirmed facts,
reasoned conclusions, and unverified hypotheses. Report validation precisely,
and give absolute paths in handoffs.