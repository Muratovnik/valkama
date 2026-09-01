# Valkama

**A local, modular control surface for agent work and its supporting tools.**

Valkama connects Claude Code, Codex, and local services through one web and
desktop workspace. Planning, Sessions, Analytics, Improvements, Skills, Memory,
and Settings are modules over the same Kernel contracts. Kanban is one Planning
view, not the definition of the product.

It is built for one person: whoever runs a local development loop and is tired
of the work living in three places at once. There is no account, no cloud and no
service to keep alive. Durable state stays in local SQLite stores in your home
directory, and the MCP server only exists while a client is talking to it.

## What it does

- **Planning with Kanban, list, and graph views.** Its MCP tools create, move,
  claim, comment, link, and summarise work; `claim_card` remains atomic on the
  current Planning wire.
- **Sessions and execution tracking.** Launches carry an explicit delivery
  contract, and outcomes are typed results rather than exit codes.
- **A visible integration registry.** Settings distinguishes Modules, Adapters,
  Services, Connections, and Assignments, including health and ownership.
- **Analytics and Improvements.** Missing history stays unknown, and recurring
  failures retain bounded evidence instead of raw private transcripts.
- **Memory that points rather than copies.** Each project's knowledge is
  searched through whichever provider answers for it, and what is attached to
  a work item is a pointer with a stored label — so it still reads when the
  source behind it cannot be reached.
- **A live local UI** at `http://127.0.0.1:8642/`, in English or Russian, updated
  over Server-Sent Events rather than polling.
- **A desktop window and tray icon** on Windows, so Valkama is an application
  rather than a browser tab and active agent work remains visible.

## Requirements

| | Needed for | Version |
| --- | --- | --- |
| Python | the server, the MCP tools, the CLI | 3.11 or newer |
| Node.js | rebuilding the web UI or the desktop app | 20.19+ or 22.12+ — Vite 7's floor (only if you build) |
| Git | cloning | any |

The server and launcher import **nothing outside the Python standard library** —
no `pip install` step, no virtualenv. That is deliberate: your agent client
launches Valkama with the selected system Python, and a missing dependency would
otherwise appear only as a missing control surface.

The built UI is committed to the repository, so a fresh clone serves Valkama
without Node installed at all.

**Platforms.** Developed and used on Windows 11. The service launcher is tested
on Windows and Linux. The server's other platform-specific branches should run
on macOS and Linux, but the tray icon, desktop installer and session-root lookup
are Windows-only by design — see [Limitations](#limitations).

## Install

### 1. Clone it

```bash
git clone https://github.com/Muratovnik/valkama.git
cd valkama
python valkama.py serve
```

Open `http://127.0.0.1:8642/`. You should see the module navigation and an empty
Planning directory. Stop the server with `Ctrl+C` — agents spawn their own copy
and do not need this one running.

### 2. Install the stable launcher

```bash
python valkama.py launcher install
python valkama.py launcher status
```

The status output is JSON. Its `command` field is the path agent clients should
register:

- Windows: `%LOCALAPPDATA%\Valkama\bin\valkama.cmd`
- macOS/Linux: `$XDG_BIN_HOME/valkama` or `~/.local/bin/valkama`

The user-facing command contains no source-checkout path. A managed Python shim
beside it is the durable process identity; its manifest records the current
`valkama.py`, interpreter and managed hashes. Agent clients, the tray and the
desktop all use that verified pair. After moving the checkout, run `launcher
install` once from the new location; client configuration and listener
ownership remain unchanged. See [`SERVICE.md`](SERVICE.md) for ownership, safe
listener reconciliation, drift handling, uninstall and relocation details.

### 3. Register it with your agent

**Claude Code** — PowerShell example, user scope so every project gets it:

```powershell
$launcher = (python .\valkama.py launcher status | ConvertFrom-Json).command
claude mcp add valkama --scope user --env VALKAMA_AUTHOR=claude --env PYTHONUTF8=1 --env PYTHONIOENCODING=utf-8 -- $launcher mcp
```

**Codex** — use the exact `command` returned by `launcher status` in
`~/.codex/config.toml`:

```toml
[mcp_servers.valkama]
command = "C:/Users/<user>/AppData/Local/Valkama/bin/valkama.cmd"
args = ["mcp"]
env = { VALKAMA_AUTHOR = "codex", PYTHONUTF8 = "1", PYTHONIOENCODING = "utf-8" }
```

This absolute path belongs to the installed service launcher, not to the source
checkout.

`VALKAMA_AUTHOR` is what Planning claims and comments are signed with. Give each
client a different one, or every Planning card will say `agent`.

### 4. Check that it worked

Restart the client, then ask it to list Planning boards. In Claude Code:

```
> use the valkama mcp server to list boards
```

You should get an empty list rather than an error. If the tools are missing,
`/mcp` shows the server's status; a server that failed to start needs a new
conversation, not a reconnect.

For local diagnostics without opening or migrating the database:

```bash
python valkama.py status
```

### 5. Optional: the desktop app (Windows)

```powershell
cd desktop
npm ci
npm run dist                            # builds release/Valkama Setup <version>.exe
cd ..
.\windows\install-desktop.ps1 -WhatIf   # show what would change
.\windows\install-desktop.ps1 -Build    # rebuild, remove older copies, install
```

The installer is not a double-click because each past rename changed the NSIS
`appId`, so a new installer lands *beside* the old copy instead of over it.
`install-desktop.ps1` reads what is actually registered under `HKCU`, stops
anything running from those directories, runs each old copy's own uninstaller,
and installs the current one. It only ever touches something registered under
one of this product's names *and* installed under `%LOCALAPPDATA%\Programs`;
anything else is reported and left alone.

## Commands

The board- and card-named commands below are the current Planning-specific CLI
and MCP wire. They do not define Kernel entities used by other modules.

```
python valkama.py <command> [options]
```

| Command | What it does |
| --- | --- |
| `mcp` | speak MCP over stdio — what the installed launcher runs for agent clients |
| `serve [--port 8642]` | serve the JSON API and Valkama UI |
| `capabilities` | report public interfaces, MCP revisions and tool count as JSON without reading user data |
| `status [--launcher-directory DIR]` | report source, database, runtime and launcher state without opening the database |
| `launcher install [--directory DIR] [--force]` | atomically install or repair the stable client command |
| `launcher status [--directory DIR]` | verify launcher ownership and hashes |
| `launcher listener status\|stop [--port 8642]` | inspect or stop only the Windows listener proven to run through the managed shim |
| `launcher uninstall [--directory DIR] [--force]` | remove only the managed launcher files |
| `summary [--board NAME]` | a short text report, meant for session hooks |
| `runtime` | print this checkout's backend and static identity |
| `config [--json]` | every setting, the layer it came from, and the value in use |
| `setup [--json] [--apply]` | what this installation needs, and the exact command for each gap |
| `adapter check --at URL \| --command ARGV \| --mcp ARGV \| --record FILE` | ask an adapter for its manifest, then probe it for the calls it should refuse |
| `adapter install --at URL \| --command ARGV \| --mcp ARGV \| --record FILE [--force]` | check it, then declare it for this installation |
| `adapter remove ADAPTER_ID` | stop declaring an installed adapter |
| `adapter list` | the adapters this installation declares |
| `doctor [--json] [--no-probe]` | check this installation in four levels — Installation, Projects, Capabilities, Connections — and say what to do about each problem |
| `dump [--out FILE]` | export the whole database as JSONL |
| `graph [--board NAME] [--format mermaid\|json]` | the dependency graph of one board |
| `merge-boards --target NAME --source OLD [--source ...]` | consolidate boards, keeping every id |
| `attach NAME PATH [--label TEXT]` | attach another database file as a scope |
| `detach NAME` | drop a scope from every view; the file is untouched |
| `scopes [--json]` | list attached scopes and their boards |
| `purge-stream [--session ID] [--include-active] [--retention]` | delete purgeable stream events; analytics rows stay |
| `import-routa FILE` | import a Routa export |

## External adapters

An adapter is a service written to be reached by Valkama. It answers three
calls, over HTTP under a namespaced prefix so it stays free to serve anything
else on the same port:

```text
GET  {base}/valkama/v1/manifest   its own manifest, which is how discovery finds it
GET  {base}/valkama/v1/health     {"status": "ready" | "degraded" | "unavailable"}
POST {base}/valkama/v1/invoke     {"capability_id": ..., "payload": {...}}
```

or as a process, one JSON request on stdin and one answer on stdout:

```text
{"call": "manifest"}
{"call": "health"}
{"call": "invoke", "capability_id": ..., "payload": {...}}
```

or, if it is already an MCP server, as tools — `valkama.manifest`,
`valkama.health`, and one named for each capability it declares. There is no
second protocol to implement: a tool is how an MCP server offers anything, and
a tool whose name is not a Valkama capability is simply not one, so a
general-purpose server can serve Valkama without becoming only that. Valkama
opens a session per call and owns no process between them.

Nothing goes on the command line, because argv is readable by every process on
the machine. An answer carrying `{"error": "..."}` is a refusal on either
transport: stdin and stdout have no status line, and a refusal only one
transport could make is one the conformance tool would miss.

**A manifest carries no destination.** It is published to the browser and the
contract refuses a path or an argv anywhere in one, so where an adapter lives
is something you supply — which is also the only order that works, since the
destination is how the manifest gets fetched. Installing pairs the two in a
record under `~/.valkama/adapters/`.

This is not what a *backend* does. Phoenix, Langfuse and Jaeger are other
people's products with their own APIs; Valkama reaches one through a provider
written on this side that knows that product's shape. Asking a backend to
answer the three calls above would be asking it to become a Valkama plugin.

```
python valkama.py adapter check manifest.json
```

The manifest half of the check is offline. The half that matters needs the
adapter running, and every case in it is a refusal: a capability the manifest
never declared, a payload that is not an object. An adapter that answers those
cheerfully is the one that produces a plausible wrong result months later, when
it is already in a projection and nothing says which call made it. The check
also compares the manifest it was handed against the one the address serves — a
file describing one adapter while the endpoint runs another installs a
registration that reaches somewhere else.

Check a maintained adapter at the destination its owner documents, then install
that same destination only after the check passes:

```
python valkama.py adapter check --at http://127.0.0.1:8770
python valkama.py adapter install --at http://127.0.0.1:8770
```

Process and MCP adapters use their owner-supplied command directly:

```
python valkama.py adapter check --command ADAPTER_COMMAND ARG...
python valkama.py adapter install --command ADAPTER_COMMAND ARG...
python valkama.py adapter check --mcp MCP_COMMAND ARG...
python valkama.py adapter install --mcp MCP_COMMAND ARG...
```

Installing writes a record to `~/.valkama/adapters/`, one file per adapter. That
is the whole mechanism: a built-in adapter is declared in code, an installed one
is declared by a file, and both then travel the identical path that turns a
declaration into registry rows and a Connection. Installing an adapter whose
check failed is refused; `--force` overrides and says so.

`adapter remove` deletes the file. The registry rows written on an earlier start
stay, so a ref pointing at that adapter still resolves and its Connection reads
`unavailable` — a ref whose target evaporated reads as data loss, and an
unavailable Connection reads as what it is.

An installed adapter claims no core ref kind. Claiming one binds every ref of
that kind to it and only one provider may, so a manifest able to claim `memory`
would displace the provider you already have, at install time, without you
deciding anything.

## Configuration

Four settings have a file. Everything else is an environment variable, and the
environment overrides the file for every setting, so automation and a
development shell never have to edit anything to change one run.

The file is `~/.valkama/config.json`, and it may not exist — the defaults below
are what you get:

```json
{
  "store": "D:/valkama/valkama.sqlite3",
  "claude_session_root": "~/.claude/projects"
}
```

A value may be a reference instead of a literal: `${VAR}` takes the environment
variable, `${VAR:-fallback}` takes it or the fallback. This is the same syntax
`.mcp.json` uses, including the same behaviour when a reference cannot be
resolved — the text stays as written and the failure is reported, rather than
the value quietly becoming empty. Use a reference for anything you would not
want written down.

`python valkama.py config` prints every setting, the layer its value came from,
and the value the product actually uses. A malformed file stops the product
rather than falling back to a default, and `python valkama.py doctor` says why.

| Setting | Variable | Default | What it changes |
| --- | --- | --- | --- |
| `store` | `VALKAMA_DB` | `~/.valkama/valkama.sqlite3` | where the database lives |
| `document_roots` | `VALKAMA_DOC_ROOTS` | none | document roots to search, separated by the path separator |
| `claude_session_root` | `VALKAMA_CLAUDE_SESSION_ROOT` | none | where Claude Code keeps its session journals |
| `codex_rollout_root` | `VALKAMA_CODEX_ROLLOUT_ROOT` | none | where Codex keeps its rollout journals |

The project registry is not Valkama configuration. Host Runtime is its only
writer and recovery owner, at the fixed path
`%LOCALAPPDATA%\Valkama\projects.json`. Valkama reads those bytes without
rewriting them and accepts the project set only when the complete file matches
the canonical schema. An absent or malformed file therefore exposes no partial
projects to Planning, Memory, Skills, or desktop launchers. Recover it through
Host Runtime's `tools/workflow_sync.py sync --apply --project <root>` and
`tools/workflow_sync.py doctor`; there is no Valkama path override or legacy
registry import.

The rest are environment-only, because each is either a one-shot switch or
belongs to a process rather than to an installation:

| Variable | Default | What it changes |
| --- | --- | --- |
| `VALKAMA_AUTHOR` | `agent` | the name written into claims and comments |
| `VALKAMA_NO_TRAY` | unset | set to anything to suppress the tray icon |
| `VALKAMA_PORT` | `8642` | the port the desktop app expects the server on |
| `VALKAMA_TRAY_MUTEX` | `Local\ValkamaTrayIcon` | the mutex tray sessions coordinate through |

`--port` on `serve` overrides the port for that process. `VALKAMA_PORT` tells the
*desktop app* where to look; set both if you move the port.

## Setting it up again, or checking that it is right

```
python valkama.py setup
```

It reports what this installation has — Python, Git, a verified stable launcher,
and whether each agent client runs that launcher with its required author and
UTF-8 environment — and prints the exact command sequence for anything missing
or stale. It changes nothing until you add `--apply`.

It never edits `~/.claude.json` or `~/.codex/config.toml`. Both clients own
their registration through their own CLI, so this reads through `claude mcp get`
and `codex mcp list --json` and writes through `claude mcp add` and
`codex mcp add`, which know their own file's format and scopes.

The check worth having is not "is a server registered" but "does it use the
verified service launcher": a registration left pointing at a checkout that
moved keeps working until it does not, and says nothing in between. A stale
registration is removed before its launcher-backed replacement is added.

## Planning: Kanban view

Six fixed columns: Backlog, Todo, Dev, Review, Done, Blocked.

A card becomes an **epic** when other cards point `parent_id` at it. The board
keeps a persistent index of epics and renders one selected six-column view;
inside each lane, children are grouped under their epic instead of repeating the
epic id on every card.

Three things make a card honest about its own progress:

- **A checklist with stable ids.** Agents claim an item (`claim_checklist_item`)
  and complete it by id (`tick_item`). No invented percentages, and two agents
  splitting a card each hold their own item.
- **Typed refs** — commit hashes, session ids, memory entry ids — attached with
  `attach_ref`, so the next agent reads pointers instead of doing archaeology.
- **An activity trace.** Creations, moves, claims, takeovers, releases,
  completions and link changes are all recorded with an author. `get_card`
  returns it, so nobody has to guess who did what. Reordering within a lane is
  deliberately *not* history.

Cards relate to each other the way [beads](https://github.com/steveyegge/beads)
proved useful for agents. `blocked_by` / `blocks` feed `list_cards(ready=true)`
— the take-next queue of cards that are queued, unclaimed and unblocked.
`discovered_from` records where work found en route came from. Blockers that
aren't cards stay comments.

Guards refuse a move the board could not honestly report: `dev` needs an
executor, `done` needs every checklist item closed and a summary, `blocked`
needs a linked blocker or a stated reason. A refusal names its guard, and
`force=true` carries the move through as a recorded override.

**Concurrent moves are resolved, not raced.** A drag sends the column the card
was in when you grabbed it. If it has since moved, the server answers `409` with
who moved it where, and the drop is refused rather than silently undoing an
agent's work.

### Rolling back a merge

`merge-boards` writes a clean SQLite backup before it touches anything. To undo
one: stop every client, delete any `-wal` / `-shm` file beside
`~/.valkama/valkama.sqlite3`, then copy the `kanban-premerge-*.sqlite3` snapshot
named in that merge's own result over the database.
`test_a_merge_can_be_rolled_back_from_the_snapshot_it_takes` runs exactly that
sequence, so the path is tested rather than assumed.

Schema upgrades snapshot the database into `~/.valkama/backups/` before any
`ALTER` runs, keeping the last five.

## Planning: launching agents from a card

The launch dialog records a delivery contract, not just a command: an
`expected_effect` (`change_required`, `no_change_acceptable` or
`read_only_finding`), an optional review mode, and an interface version.

Both clients get an enforced JSON result schema. The persisted outcome is one of
`launch_failed`, `refused`, `expected_no_change`, `unexpected_no_change`,
`partial` or `complete` — **exit code zero is not delivery.** Only `complete`, or
an `expected_no_change` the contract allows, moves Dev to Review. A spawn failure
restores the exact pre-launch lane and claim and stays visible on the card.

Resume works only with the client's own stored session identity: a generated
UUID for fresh Claude launches, the thread id from Codex's JSON event stream.
The runner never guesses which task to continue from a title, a directory, a
timestamp or `--last`.

Worktree launches run a preflight before mutating anything: the path must be a
repository top level and not a submodule, and the sibling target must not
escape, traverse a symlink or junction, or already exist without a real worktree
registration.

## Analytics dashboard

`?board=<name>&view=dashboard` is a read-only projection over the same cards and
events: status visits, flow, throughput, cycle/reopen/blocked KPIs, and an
`as_of` timestamp.

Its rule is that missing history stays missing. Coverage is reported as
`confirmed`, `inferred`, `partial` or `unknown`; a gap is `null` or a lower
bound, never a made-up zero. A contradictory move invalidates the preceding
segment at the gap and resumes at the observed destination, so no duration is
fabricated across a hole.

The optional usage panel reads local Codex rollout or Claude JSONL journals,
if you configure the roots. It is deliberately conservative: exact card-linked
session refs only, no newest-file heuristics, data marked
`source=local_journal`. Cost appears only when a journal states it. Sessions
linked to several cards are labelled non-exclusive and counted once.

## The desktop app and the tray

`desktop/` is a thin Electron shell. It verifies the managed launcher, checks
that its Python server is listening, then shows Valkama in a real window with
its own process, taskbar entry and icon. It runs `runtime` and `serve` through
the stable shim, whose manifest selects this repository; there is no second
desktop source record or checkout-path fallback.

```bash
cd desktop
npm ci
npm start        # run the window from source
npm run dist     # build the installer into release/
```

`release/` is git-ignored — a 90 MB installer does not belong in a repository.
Rebuild and reinstall after changing `desktop/main.js`; UI-only changes just
need `npm run build` in `web/`.

The window can open a Markdown source at an exact `#kb:` anchor through VS Code's
URL handler. Each click carries only `{source, resource_ref}`; Electron re-reads
the fixed project registry and accepts only the exact existing `canonical_root`
mapped to that Planning-space resource. An absent, malformed, unavailable or
ambiguous mapping is refused, and renderer paths, process directories, launcher
paths, titles and environment overrides never choose another root. Plain browser
mode has no local-file authority and copies the source pointer instead.

**The tray icon** appears while an agent holds an MCP session and disappears when
the last one ends, so it answers "is anybody working here right now?". Clicking
it always does something visible: it opens the app, opens a browser, starts the
server, offers a restart, or explains the refusal in a dialog. When a listener
owned by the managed shim is older than the launcher's current source, the
dialog says which half drifted and offers to restart it. A listener whose
managed process ownership cannot be verified is refused and left untouched —
holding the port or returning Valkama-shaped JSON is not stop authority.

Set `VALKAMA_NO_TRAY=1` to turn it off.

> Running `electron` from a VS Code terminal fails with `app is undefined`,
> because VS Code exports `ELECTRON_RUN_AS_NODE=1`. Clear that variable first.
> The installed app is unaffected.

## Building the UI

```bash
python valkama.py serve --development-origin http://127.0.0.1:5173
cd web
npm ci
npm run dev      # Vite on :5173, proxying /api to the Python server on :8642
npm run build    # refresh web/dist
```

Vue 3 + Vite + TypeScript. `web/dist` is committed on purpose, so a clone serves
the built UI with no build step — **rebuild and commit it whenever `web/src`
changes.**

The Python side serves `web/dist` plus the module and Planning APIs.
`GET /api/modules` is the canonical persisted module registry;
`GET /api/platform/registry` returns normalized integration definitions,
Connections, Assignments, health, and ownership without loading third-party
browser code.

### Local HTTP security

The listener accepts only the exact authority `127.0.0.1:<bound-port>`. Browser
writes bootstrap a fresh process-scoped session credential and send it in
`X-Valkama-Session`; the UI keeps it only in memory and retries one write after
a server restart. Originless `/api/ingest` adapters instead read the persistent
installation bearer from `~/.valkama/installation-token`. These credentials are
not interchangeable, never belong in URLs, cookies, browser storage, argv, or
environment variables, and every write must be an explicitly framed UTF-8 JSON
object. Vite development is the only extra browser origin and must be enabled by
the exact `--development-origin http://127.0.0.1:5173` flag shown above.

The token file is atomically created with the restrictive file mode supported
by the Python standard library. This boundary protects the loopback web surface
from hostile sites and DNS rebinding; it does not isolate malicious native code
already running as the same OS user, which can read the same user-owned runtime
files and process memory.

## How the repository is laid out

| Path | Owns |
| --- | --- |
| `valkama.py` | the source entry point — it prepares `sys.path` and hands off to `server/cli.py` |
| `server/` | the Python server, managed launcher, domain modules, and CLI/HTTP/MCP surfaces |
| `web/` | the Vue application, its build and its tests |
| `desktop/` | the Electron window — its own npm package, tests and release output |
| `windows/` | what exists only because the host is Windows: the tray script, the icon, its generator, the installer |
| `tests/` | the Python suite, mirroring `server/` |
| `docs/` | the product's written contracts |

`windows/` is separate from `desktop/` because they answer different questions.
`desktop/` is an application — JavaScript, npm, an asar. `windows/` is
PowerShell, an `.ico` and an NSIS installer, and the Electron app is one of its
consumers rather than its owner.

Seven documents state what code cannot:

- [`SERVICE.md`](SERVICE.md) — launcher ownership, client registration and
  relocation.
- [`DESIGN.md`](DESIGN.md) — the design system, and the authority for every
  visual decision.
- [`docs/product-model.md`](docs/product-model.md) — the product vocabulary and
  the distinctions between modules, views, adapters, and runtime records.
- [`docs/platform-contract.md`](docs/platform-contract.md) — the two operating
  levels and the object kinds a module may not confuse.
- [`docs/connection-contract.md`](docs/connection-contract.md) — what a client
  learns on connect, and how the server refuses to answer from a stale build.
- [`docs/improvements-contract.md`](docs/improvements-contract.md) and
  [`docs/session-event-contract.md`](docs/session-event-contract.md) — the
  improvements payload and the session event.

## Limitations

Worth knowing before you adopt it:

- **Single user, single machine.** There is no account system, multi-tenancy, or
  remote access. Loopback HTTP uses local browser and installation credentials,
  but malicious native code running as the same OS user remains trusted.
- **Windows is the exercised product platform.** The service launcher is tested
  on Windows and Linux; the tray, installer and session-root registry lookup
  remain Windows-only. The rest of the server should run on macOS and Linux,
  but nobody has proven the full product there.
- **No MCP prompts or resources.** Planning tools manage work; project context
  belongs somewhere else.
- **No hosted anything.** No sync between machines, no shared installation, no backup
  other than the snapshots it takes locally.
- **The MCP server is spawned by your client**, so it lives as long as the
  session and does not update itself. See
  [`docs/connection-contract.md`](docs/connection-contract.md) for how version
  skew is made visible instead of silent.

## Development

Every change runs all of these, from the repository root. The Python toolchain
is pinned in `requirements-dev.txt` and configured in `pyproject.toml`; none of
it is a runtime dependency.

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

An owner checkout additionally runs `python .github/relkit.pyz protect install`
once and `python .github/relkit.pyz audit --history --owner` before publication.

`npm run build` is not optional and not last. The server serves the snapshot of
`web/dist` it read at startup, so a browser check against a listener that
predates the build inspects the bundle that build replaced. Rebuild, restart the
listener, *then* verify anything live.

Issues and pull requests are welcome — [`CONTRIBUTING.md`](CONTRIBUTING.md) has
the setup, the commit convention, and the handful of architectural rules that
would otherwise send a pull request back. Released changes are recorded in
[`CHANGELOG.md`](CHANGELOG.md).

## License

[MIT](LICENSE).
