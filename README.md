# Valkama

**A local workspace for planning, executing, and reviewing agent work.**

Valkama connects projects, work items, agent executions, and results in one web
and desktop workspace. Work brings board, list, and graph views over one
Planning read model; Settings holds preferences and the installation's health
checks.
Memory and session references stay with the work item they support.

It is built for one person: whoever runs a local development loop and is tired
of the work living in three places at once. There is no account, no cloud and no
service to keep alive. Durable state stays in local SQLite stores in your home
directory, and the MCP server only exists while a client is talking to it.

## What it does

- **Planning with Kanban, list, and graph views.** Its MCP tools create, move,
  claim, comment, link, and summarise work; `claim_work_item` refuses a
  competing claim on the current Planning wire. A claim is a lease held by the
  agent session that took it, so it lapses once that session is gone, 12 hours
  after an ordinary end so that a resumed session keeps its work.
- **Execution tracking on work items.** Launches carry an explicit delivery
  contract, and outcomes are typed results rather than exit codes. The card's
  Execution tab is off by default; turn it on under Settings → General → Interface.
- **Task finder** with Ctrl/Cmd+K across mapped projects. Results retain their
  exact store and space; unavailable sources and truncated results stay visible.
- **Colours for task types.** Epics are purple by default, bugs rose, improvements
  turquoise and tasks grey-blue, on a type's icon and word only: state colours stay as
  they are. Change them under Settings → General → Task type colors; a change applies at
  once. The choice is kept in `localStorage`, on the device, so a browser and the desktop
  app each remember their own.
- **Questions and decisions** in the task's discussion and a shared inbox. Agents
  create typed requests; the owner answers, in their own words if they prefer, or
  declines the exact request, and can change an answer while the task is open.
  Expired requests stop accepting
  answers, and sending an answer does not automatically resume an execution.
- **Memory that points rather than copies.** Each project's knowledge is
  searched through whichever provider answers for it, and what is attached to
  a work item is a pointer with a stored label — so it still reads when the
  source behind it cannot be reached.
- **A live local UI** at `http://127.0.0.1:8642/`, in English or Russian, updated
  over Server-Sent Events. The question inbox also refreshes every 30 seconds
  while visible and when the window regains focus.
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

### 1. Get the source

Clone the repository or download `valkama-<version>-source.zip` from a release
and extract it. The source archive includes the Python service and built web UI;
it does not need Node.js to run. From the resulting directory:

```bash
python valkama.py serve
```

For a Git clone, first run `git clone https://github.com/Muratovnik/valkama.git`
and `cd valkama`.

Open `http://127.0.0.1:8642/`. You should see Work and Settings navigation and
an empty Planning directory. Stop the server with `Ctrl+C` — agents spawn their own copy
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

The user-facing command contains no source-checkout path. It runs a pinned
release: the checkout's current commit, copied out with `git archive` and never
edited, so uncommitted work in the checkout never reaches a client session or
the store it opens. Run `launcher install` again to publish newer commits, or
with `--revision <commit>` to go back to an earlier release (a release from
before `valkama hook` is answered by the shim with silence and exit 0 when a
client hook calls it; see `SERVICE.md`). A managed Python
shim beside the command is the durable process identity; its manifest records
the release's `valkama.py`, the pinned commit, the interpreter and managed
hashes. Agent clients, the tray and the desktop all use that verified pair.
After moving the checkout, run `launcher install` once from the new location;
client configuration and listener ownership remain unchanged. See
[`SERVICE.md`](SERVICE.md) for releases, ownership, safe listener
reconciliation, drift handling, uninstall and relocation details.

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

`VALKAMA_AUTHOR` is the name Planning claims and comments are signed with when an
MCP tool call names no `author` of its own. Give each client a different one in
its registration. Without the variable, the `author` in `config.json` applies; with
neither, the name is `agent`.

Then give the agents the procedure that goes with the tools — finding and
claiming an item, keeping its checklist, merging duplicates, closing it:

```bash
python valkama.py skill install
```

It writes the Valkama skill for each client this user has, where that client
finds its user's skills (`~/.claude/skills/valkama`, `~/.agents/skills/valkama`),
from the release the launcher pins, and `launcher install` keeps it in step. It
edits no client configuration; see
[`SERVICE.md`](SERVICE.md#install-the-skill).

### 4. Check that it worked

Restart the client, then ask it to list Planning spaces. In Claude Code:

```
> use the valkama mcp server to list planning spaces
```

You should get an empty list rather than an error. If the tools are missing,
`/mcp` shows the server's status; a server that failed to start needs a new
conversation, not a reconnect.

For local diagnostics without opening or migrating the database:

```bash
python valkama.py status
```

### 5. Register a project for project views

Valkama keeps a local project inventory. Register an existing directory, using
your own lowercase project id, display name, and absolute path. Replace the
example values, including the path, with your project's values:

```powershell
python valkama.py projects add my-project --name "My Project" --root "C:\path\to\my-project"
python valkama.py projects check
```

The check reports `"ok": true` when Valkama's inventory and the projection
used by its modules agree. To connect the project to Planning, use the MCP
`create_planning_space` tool with `project_id` set to `my-project`, then bind
the returned space key:

```powershell
python valkama.py projects bind my-project --space MY
```

Replace `MY` with the key returned for your Planning space. A binding must
point to a space whose project id matches the registered project. Run
`python valkama.py projects list` to inspect the result.

### 6. Optional: the desktop app (Windows)

The release's `Valkama-Setup-<version>.exe` installs the desktop window. It
requires the source service, Python 3.11+, and the managed launcher from step 2;
the installer does not bundle a Python backend. For a fresh installation, run
the installer after installing the launcher. If an older Agent Kanban or Agent
Hub desktop app is installed, use the migration script below from the source
directory to remove those registered copies before installing the new one.

To build the desktop installer from source:

```powershell
cd desktop
npm ci
npm run dist                            # builds release/Valkama Setup <version>.exe
cd ..
.\windows\install-desktop.ps1 -WhatIf   # show what would change
.\windows\install-desktop.ps1 -Build    # rebuild, remove older copies, install
```

The migration script is needed across past renames because each changed the NSIS
`appId`, so a new installer lands *beside* the old copy instead of over it.
`install-desktop.ps1` reads what is actually registered under `HKCU`, stops
anything running from those directories, runs each old copy's own uninstaller,
and installs the current one. It only ever touches something registered under
one of this product's names *and* installed under `%LOCALAPPDATA%\Programs`;
anything else is reported and left alone.

## Commands

These commands cover the current CLI. Planning MCP tools use spaces and work
items; a Kanban card is one view of a work item.

```
python valkama.py <command> [options]
```

| Command | What it does |
| --- | --- |
| `mcp` | speak MCP over stdio — what the installed launcher runs for agent clients |
| `serve [--port 8642] [--on-demand]` | serve the JSON API and Valkama UI; with `--on-demand`, hold the port and load the server on the first connection that needs it |
| `capabilities` | report public interfaces, MCP revisions and tool count as JSON without reading user data |
| `status [--launcher-directory DIR]` | report source, database, runtime and launcher state without opening the database |
| `launcher install [--revision REV] [--checkout DIR] [--releases DIR] [--directory DIR] [--force]` | pin a commit as a release and atomically install or repair the stable client command that runs it |
| `launcher status [--directory DIR]` | verify launcher ownership and hashes |
| `launcher listener status\|stop [--port 8642]` | inspect or stop only the Windows listener proven to run through the managed shim |
| `launcher autostart enable\|disable\|status [--port 8642] [--force]` | on Windows, keep an on-demand listener on the port from login; off until enabled, see [`SERVICE.md`](SERVICE.md#holding-the-port-from-login) |
| `launcher uninstall [--directory DIR] [--force]` | remove only the managed launcher files and this launcher's autostart value |
| `summary [--space KEY]` | a short Planning-space report, meant for session hooks |
| `released --space KEY --repo PATH --range A..B [--json]` | list the open work items whose commit refs went into a release range, and how each was found: `hash` (the commit is in the range), `patch-id` (the same change arrived under another hash), or one of two weak matches: `changed-patch` (the commit is outside the range and not in the history before it, and a commit in the range has its subject with another patch) and `subject` (the object is gone and the ref's label has the subject of a commit in the range). A hint to check by hand when closing a release: partly released work shows too, an item with no commit ref cannot, and it changes neither the store nor the repository |
| `hook CLIENT EVENT` | record one client hook event from stdin without a running server; see [Client hooks](#client-hooks) |
| `runtime` | print this checkout's backend and static identity |
| `projects list\|add\|update\|remove\|bind\|check\|apply\|doctor\|rollback\|import` | manage the local project inventory and its projection; see [Project registry](#project-registry) |
| `config [--json]` | every setting, the layer it came from, and the value in use |
| `setup [--json] [--apply]` | what this installation needs, and the exact command for each gap |
| `adapter check --at URL \| --command ARGV \| --mcp ARGV \| --record FILE` | ask an adapter for its manifest, then probe it for the calls it should refuse |
| `adapter install --at URL \| --command ARGV \| --mcp ARGV \| --record FILE [--force]` | check it, then declare it for this installation |
| `adapter remove ADAPTER_ID` | stop declaring an installed adapter |
| `adapter list` | the adapters this installation declares |
| `doctor [--json] [--no-probe]` | check this installation in four levels — Installation, Projects, Capabilities, Connections — and say what to do about each problem |
| `export [--section planning] [--space KEY]... [--output PATH]` | write every Planning space, every one of its work items and their questions as one JSON export; `planning` is the only section. `--space` (repeatable) narrows it to those spaces and records them as `space_filter`; an unknown space exits non-zero. `--output` writes the file whole through a temporary file beside it and prints one summary line instead of the JSON. A space whose items do not add up to its count stops the export |
| `transcripts purge [--session ID]... [--before DATE] [--dry-run]` | delete archived transcripts now, on request, whatever retention says; prints counts only |
| `migrate planning-model [--dry-run]` | explicitly convert a Board-era store to Planning once; dry run converts a copy |
| `attach NAME PATH [--label TEXT]` | attach another database file as a scope |
| `detach NAME` | drop a scope from every view; the file is untouched |
| `scopes [--json]` | list attached scopes and their Planning spaces |

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

**A manifest names the adapter and nothing else.** It has exactly four fields,
all required:

```json
{
  "contract_version": "valkama-adapter",
  "adapter_id": "example-notes",
  "version": "1.0.0",
  "capabilities": ["notes.search", "notes.open"]
}
```

`version` is a semantic version, and each capability is a dotted lowercase id
the adapter chooses for an operation it answers. A manifest carrying any other
field is refused with that field's name rather than read in part, and so is a
path or an argv anywhere in it. Where an adapter lives is therefore something
you supply — which is also the only order that works, since the destination is
how the manifest gets fetched. Installing pairs the two in a record under
`~/.valkama/adapters/`.

This is not what a *backend* does. Phoenix, Langfuse and Jaeger are other
people's products with their own APIs; Valkama reaches one through a provider
written on this side that knows that product's shape. Asking a backend to
answer the three calls above would be asking it to become a Valkama plugin.

`adapter check` needs a destination: `--at`, `--command`, `--mcp`, or an installed
record supplied with `--record`. It fetches and validates the manifest, then
probes the running adapter for calls it should refuse, such as an undeclared
capability or a payload that is not an object. It also checks that the manifest
still identifies the adapter at that destination. A record describing one
adapter while its destination runs another cannot establish a valid connection.

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

Installing writes a record to `~/.valkama/adapters/`, one file per adapter,
holding the manifest and the transport and nothing else. That file is the whole
declaration: no table holds an installed adapter, so `adapter remove` deletes
the file and nothing else. Installing an adapter whose check failed is refused;
`--force` overrides and says so.

`adapter list` reads the records back and names every file it refuses, with the
reason, and `doctor` asks each installed adapter for its health under
Connections. A record written for the earlier, longer manifest is refused with
the names of the fields this contract does not have; check and install that
adapter again. No module calls an installed adapter yet: today the contract is
what an adapter is checked, declared and health-reported against.

## Configuration

Five settings have a file. Everything else is an environment variable, and the
environment overrides the file for every setting, so automation and a
development shell never have to edit anything to change one run.

The file is `~/.valkama/config.json`, and it may not exist. This example puts
the store on another drive and points at Claude Code journals; it is not the
default configuration:

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
| `author` | `VALKAMA_AUTHOR` | `agent` | the name written into Planning claims and comments when an MCP tool call names no `author` |
| `notify` | `VALKAMA_NOTIFY` | `on` | `off` stops the client hooks telling a working agent what a person did on its work items, and the watcher that wakes an idle session; see the [hook contract](docs/hook-contract.md#telling-the-agent-what-a-person-did) |

### Project registry

The project registry is managed by Valkama's `projects` command, separate from
`config.json`. On Windows, Valkama keeps the authoritative project inventory at
`%LOCALAPPDATA%\Valkama\project-registry.toml` and publishes a schema-v3
projection at `%LOCALAPPDATA%\Valkama\projects.json`. Planning, Memory,
and the desktop read that complete projection. A missing or malformed projection
exposes no partial project list.

Use `projects add` to register an existing directory and `projects bind` to
connect it to an existing Planning space. `projects update ID --name NAME`
changes its display name; `--root ABS` moves its root to an existing directory,
even if the old root is gone. `projects remove ID` removes only the registration,
leaving the Planning store untouched. `projects check` compares the inventory
and projection; `projects doctor` reports the same health result.
`projects apply` republishes the current inventory, and `projects rollback`
restores the exact inventory and projection bytes saved before the preceding
change. For a one-time transfer from an existing schema-1 TOML inventory, use
`projects import --source <absolute-path-to-inventory>`. Import refuses to
overwrite an inventory or projection with different project data. There is no
project-registry path override.

The rest are environment-only, because each is either a one-shot switch or
belongs to a process rather than to an installation:

| Variable | Default | What it changes |
| --- | --- | --- |
| `VALKAMA_NO_TRAY` | unset | set to anything to suppress the tray icon |
| `VALKAMA_PORT` | `8642` | the port the desktop app expects the server on, and the one a work item's `url` names |
| `VALKAMA_TRAY_MUTEX` | `Local\ValkamaTrayIcon` | the mutex tray sessions coordinate through |

`--port` on `serve` overrides the port for that process. `VALKAMA_PORT` tells the
*desktop app* where to look and an MCP session which address to hand out; set both
if you move the port.

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

One column per state of the space's workflow. A new space gets seven: Backlog,
Todo, Dev, Review, Done, Blocked and Cancelled. Done is for finished work;
Cancelled is for work closed as not needed, duplicated or superseded, and needs
a closing summary that says why but no ticked checklist.

A card becomes an **epic** when other cards point `parent_id` at it. The board
keeps a persistent index of epics and renders one selected view;
inside each lane, children are grouped under their epic instead of repeating the
epic id on every card.

Three things make a card honest about its own progress:

- **A checklist with stable ids.** Agents claim a step with
  `claim_work_item_checklist_item` and complete it by id with
  `tick_work_item_checklist_item`. No invented percentages, and two agents
  splitting a work item each hold their own step.
  `comment_work_item` accepts an optional `checklist_item_id`: the saved comment
  keeps a quote of that step even after it is renamed or removed.
- **Typed refs** — commit hashes, memory entry ids, urls — attached with
  `attach_work_item_ref`, so the next agent reads pointers instead of doing
  archaeology. An agent's own session needs no ref: Valkama records the
  confirmed session behind every write, and `get_work_item` lists those
  sessions.
- **An activity trace.** Creations, moves, claims, takeovers, releases,
  completions and link changes are all recorded with an author. `get_work_item`
  returns the newest of it, and all of it with `full: true`, so nobody has to
  guess who did what. Reordering within a lane is deliberately *not* history.

An agent that finishes a step usually makes several writes to one card: tick it,
attach the commit, comment, record the summary, move the card.
`apply_work_item_changes` does them in one call, in a fixed order and all or
nothing, so a closing move sees the ticks and the summary sent with it. The
exact shapes are in
[the connection contract](docs/connection-contract.md#several-changes-in-one-call).

Two items filed for one change — the same finding twice, or one cause found in
two places — are folded together with `merge_work_items`. The surviving item
takes their steps, discussion, refs and links, and each merged item closes as
its duplicate with its own history intact
([details](docs/connection-contract.md#merging-items-that-are-one-change)).

A claim also says whether anyone is still behind it. When the client proves its
session, the claim is a lease on that session: `live` while the session is
active and has shown a sign of life — a hook event or a Valkama write — in the
last 14 days, `stale` once it ended or went quiet, and `unconfirmed` when no
session was proved, which is also how every older claim and every claim made in
the browser reads. Another session needs `force` to take a live claim, even when
it signs with the same author. A stale claim is released by whoever meets it
next, and taking it over needs no `force`; the history shows the expiry as a
`released` event by `valkama`. The board marks stale claims, and the inspector
shows the lease and when it expires. The exact rules are in
[the connection contract](docs/connection-contract.md#claims-are-leases).

The inspector keeps editable descriptions and a shared discussion. A comment can
target a checklist step, and a reply stands under the comment, report or question
it answers, one level deep. A thread can be marked resolved with a one-line
decision, by a person in the card or by an agent with `resolve_work_item_comment`,
and `get_work_item` with `unresolved: true` reads the threads still open
([details](docs/connection-contract.md#threads-and-the-resolved-mark)). Work
reports are what agents publish with `report_work_item`; they show in the
discussion with “What was done / Why / What
comes next”, and any of them can be selected as the task outcome. Closing a task
that has no outcome asks a person for one: what was done and what comes next. System
and execution history have filters, date groups and expandable details. Their
search covers the records loaded for that task.

Use `create_work_item_request` for a question or decision that needs an explicit
answer. Each request has 1–12 named fields: text, one choice, multiple choices or
a boolean. Optional execution and session bindings must belong to the task.
`get_work_item_request` and `list_work_item_requests` expose the current status;
`answer_work_item_request`, `decline_work_item_request` and
`expire_work_item_request` require that request's `expected_revision`. A terminal
task, ended execution or elapsed deadline closes the pending request. An option
can explain itself in a `description` and be `recommended`. A field with options
is answered with an option or the person's own variant, and may carry a comment;
a note comments on the whole question and does not answer a required field. While
the task is open, a given answer can be changed, in the card or with
`answer_work_item_request` and `change: true`, and the answers it replaced are
kept ([details](docs/connection-contract.md#questions-and-decisions)). Answers are
stored separately from comments and do not change the task's workflow.

Work items relate to each other the way
[beads](https://github.com/steveyegge/beads) proved useful for agents. A
`blocks` link keeps unfinished dependencies out of `claim_ready_work_item`,
which chooses and claims a ready item in one step. `discovered-from` records
where work found en route came from, and `create_work_item` takes that link and
the claim in the call that files the item. Blockers that are not work items stay
comments.

Guards refuse a move the board could not honestly report: `dev` needs an
executor, `done` needs every checklist item closed and a summary, `blocked`
needs a linked blocker or a stated reason. A refusal names its guard, and
`force=true` carries the move through as a recorded override.

**Concurrent moves are resolved, not raced.** A drag or a keyboard move sends
the revision of the card as the board last read it. If an agent has moved or
edited the card since, the server answers `409` with the revision it is at, the
board says so, and the card stays where the next read of the space puts it
rather than silently undoing the agent's work.

**The board's order is the order work is taken in.** Dragging a card up or down
its column, or pressing Alt+↑ or Alt+↓ on a focused card, places it among the
cards of its state; the move is announced to a screen reader. Dropping it in
another column moves it there at the place it was dropped. Agents see the same
order: `claim_ready_work_item` takes the first ready item of it,
`list_work_items` lists each state in it, and `update_work_item` and
`transition_work_item` take a `rank` (`first`, `last`, `before:<item>` or
`after:<item>`) to place an item themselves. Priority only breaks a tie. The
order is the item's `position`, which every store already holds, so it needs
no new schema; the exact rules are in
[the connection contract](docs/connection-contract.md#the-order-of-work).

**The board reads by epic.** Grouped by epic, each epic is a lane with its
reference, title, open and closed counts and a fold; a lane with nothing open
starts folded, and the board remembers the lanes you fold or unfold, per space,
in the browser. Work under no epic comes last. A lane's Chain action narrows the
board to that epic's chain, and the chain stays when you switch to List or
Graph; its chip leaves it in every view.

### Migrating an older store

A store written by an older schema is upgraded the first time a newer build
opens it, after a verified snapshot (see below). From then on a build of the
older schema refuses the store rather than read it, so restart every agent
client after pinning the newer release with `launcher install`: each one
starts its own server, and the first to open the store upgrades it. Schema 9
dropped the extension registry's tables, the module rows and the integration
switches; its snapshot is labelled `preschema9`. Schema 10 lets a comment be a
reply under another one or under a question and carry a resolve mark, numbers a
question's answer and keeps the answers it replaced, records where a session
was last opened, and adds the owner's Windows notification settings
(`owner_alert_settings`, empty until they are saved); its snapshot is labelled
`preschema10`. A store older than 9 takes both steps in one open, under the
`preschema9` (or `preproductmodel`) snapshot.

The order of work took no migration of its own. A placement is written to the
item's `position`, a column every schema-9 store already has, so no snapshot was
taken for it, and an earlier schema-9 build opens a schema-9 store that holds
placements and lists its states in the placed order. Such a build still puts a
moved item last in its new state, and a later placement works from there.

Notes on answers and option descriptions took no migration either. A schema-9
build from before them opens a schema-9 store that holds them, and its tools read
and answer those questions, with the note among the `answers` as `_note`. Its web
interface is strict about what it reads, so it reports that it could not update
the questions: on the card of a question with a note or a described option, and for
the whole "waiting for my answer" list while a pending question has a described
option. Everything else in that build works.

To go back to a build at schema 8, first stop every process that holds the
store: the listener and every agent client, since each one runs its own server.
Pin the earlier release with `launcher install --revision <commit>`. Then
either stamp the store back with `PRAGMA user_version=8`, which keeps
every row including those written since the upgrade (a schema-8 build creates
the dropped tables again, empty), or put the `preschema9` snapshot in its place,
which loses everything written since. Before replacing the file, delete the
`-wal` and `-shm` files beside it: a write-ahead log left behind would be
applied to the snapshot on the next open.

Going back to a build at schema 9 has one way, and its order matters. Stop every
process that holds the store, delete the `-wal` and `-shm` files, put the
`preschema10` snapshot in place of the store, and only then pin the earlier
release with `launcher install --revision <commit>`. Pinned first, the release
reaches every running session through its stdio front within seconds and
refuses the store that is still at 10, so the board disappears from all of
them. Everything written since the upgrade is lost. Stamping the store back to
9 is not a way back here: a schema-9 build would show a reply as a comment of
its own and misread the new keys in an answer.

The hook spool changed in the same release. A session start that has to wait in
the spool is written as spool version 2, which carries where the session is open;
every other event keeps version 1. After going back, the earlier build delivers a
version-1 file left in the spool and sets a version-2 one aside as `*.rejected`,
which `doctor` counts until the file is deleted. That session start belonged to
the upgraded store going back discards, so nothing more is lost.

A store that still contains the Board-era model refuses to open until you
authorize its one-way conversion. Inspect the conversion first, then apply it:

```bash
python valkama.py migrate planning-model --dry-run
python valkama.py migrate planning-model
```

The dry run converts a temporary copy. Before changing the actual store, the
migration takes a clean SQLite snapshot in the `backups/` directory beside the
configured database. The generated filename begins `valkama-` and includes a
migration label such as `preschema9`, `preproductmodel` or `preupgrade`. To
check recovery without replacing your working store, copy the snapshot to a
separate path, set `VALKAMA_DB` to the copy, and run the same dry run and
migration there. The database path may differ from the default when `store` or
`VALKAMA_DB` is configured. Generated snapshots retain the last five files per
migration label. A snapshot that a retry would reuse but that cannot be read --
half a file left by a process killed while writing it -- is renamed with the
suffix `.unverified`, kept, and replaced by a fresh snapshot; remove it by hand
once you no longer need it.

## Planning: launching agents from a card

The launch dialog opens from the card's Execution tab, which is off by default.
Turn it on under Settings → General → Interface, on each device you use; it takes
effect at once. With the tab off, a card does not offer launching and does not read
attempts, and launching itself keeps working as described here.

The launch dialog records a delivery contract, not just a command: an
`expected_effect` (`change_required`, `no_change_acceptable` or
`read_only_finding`), an optional review mode, and an interface version.

Both clients get an enforced JSON result schema. The persisted outcome is one of
`launch_failed`, `refused`, `expected_no_change`, `unexpected_no_change`,
`partial` or `complete` — **exit code zero is not delivery.** Only `complete`, or
an `expected_no_change` the contract allows, moves Dev to Review. A spawn failure
restores the pre-launch lane and claim while they still belong to that launch.
If someone changed the item meanwhile, their state is preserved and the failed
attempt records why compensation was skipped.

Resume works only with the client's own stored session identity: a generated
UUID for fresh Claude launches, the thread id from Codex's JSON event stream.
The runner never guesses which task to continue from a title, a directory, a
timestamp or `--last`.

Worktree launches run a preflight before mutating anything: the path must be a
repository top level and not a submodule, and the sibling target must not
escape, traverse a symlink or junction, or already exist without a real worktree
registration.

## Session context on a work item

Execution history, launch, stop, resume, and native session opening belong to
work-item context. A session reference retains the client's exact stored
identity; resume never chooses a session by title, directory, time, or recency.

`GET /api/session?id=<id>` resolves compact session context by exact identity
or a unique stored prefix. A successful
response has `resolved: true` and includes `session`, `client_family`,
`work_item`, `space_root`, `status`, `detail`, and `at`. Missing or ambiguous
identity returns `resolved: false` with the corresponding status. This endpoint
does not return an event feed.

Planning owns `POST /api/ingest`, which accepts only `session_start`,
`session_end`, `attention`, and `turn_end` lifecycle events. The standalone
session fleet, inbox, tool stream, `/api/sessions`, `/api/session-seen`, and
Sessions SSE view are retired. Analytics dashboards and exports, Improvements,
and the Skills catalogue and activation API are also retired. This does not
change installed skill files or agent-client settings.

## Project documents

A path to a project's file or folder in a work item's text, or a Markdown link to
one, can be pressed. A Markdown file opens in Valkama's document viewer, read-only and
at the `#kb:…` anchor, heading or `:42` line the path names: beside the card or the
panel of open questions where the window has room for both, over them where it does
not. Beside them, F6 moves between the two and the first Escape closes the document.
A link in it to another Markdown file opens in the same place, and Back returns. The
viewer's head opens the file in your editor at the line you are reading, and moves the
document to a window of its own at `/doc?project=<id>&path=<relative>`, a browser tab
or a second window of the desktop app, where a reload keeps your place. Any other file
opens in the editor Settings names, at its line, and a folder in that editor, through
the open plan described below. A path that cannot be opened is copied, and the notice
says why. A work item's `source`, its plan anchor, opens in
the viewer at the anchor, from the mark in the card's head and from its row in
Relations, in a browser and in the desktop app alike.

A path in a work item's text is a candidate on the page, and the server says
what it is. `web/tests/fixtures/document-path-samples.json` is the table of what
a text becomes: strong, weak, copy-only or nothing, and what a click copies when
the path cannot be opened. Three shapes stay text: a run holding a character no
Windows name can hold (`tmp/<task>/`, `docs/*.md`) is a template, neither it nor
any part of it a path, though a tag the path does not go on through (`docs/a.md<br>`)
only ends it; a drive's root alone (`C:\`) names nothing; and two
backslashes are a network path only before a server and a share
(`\\server\share`), never in `\\n`. A path is opened only when it lies inside the root of
a registered project, after `..`, symbolic links and junctions are followed,
and the path that comes out is compared with the root as the disk spells both: in
a folder Windows keeps case-sensitive, `proj` beside `Proj` is a sibling and
outside. Anything else the page only copies, and a network path never reaches the server.

Both routes are `GET`, read files and write nothing. Unlike the other reads they
require the request to come from the page itself: an `Origin`, when there is one,
must be allowed (`origin_refused`) and `Sec-Fetch-Site` must be `same-origin`
(`fetch_metadata_refused`), both 403. Every answer carries
`Cache-Control: no-store` and `X-Content-Type-Options: nosniff`. A refusal is
`{"error": {"code": ...}}` from the closed list below and never carries the text
of an operating-system error.

`GET /api/documents/resolve?space=<id>&path=<p>&path=<p>...` takes up to 64 paths
and only asks the file system whether each exists; it opens no file. `space` is
the planning space's exact identity, the same value `GET /api/ref` takes, and is
only the base of a relative path. Inside a document the page shows, the base is
that document's project instead: `project=<id>` in place of `space`, the id
`resolve` answered with. Its root is the one the registry gives that id, a
project registered inside it is asked after it, as from a space, and the boundary
stays every registered root. The page has already read a link in the document
from the document's folder into a path from the project's root, so no folder is
sent, and it adds `exact=1` for those links: a project registered inside the root
is not asked for them, since their author wrote them from that folder. A `project`
the registry does not know is `project_unknown` for the whole
request, and naming both `space` and `project` is `invalid_request`. Each path is sent as written, without its
`:42` or `#...` suffix, and comes back unchanged in `path`, so an answer is matched
without parsing it. A request line may not pass 64 KiB (the listener answers 414),
so a batch of long paths is split sooner than 64:

```json
{"paths": [
  {"path": "docs/plan.md", "status": "file", "project": "example-project",
   "relative": "docs/plan.md", "markdown": true},
  {"path": "src/a.ts", "status": "file", "project": "example-project",
   "relative": "src/a.ts", "markdown": false},
  {"path": "./docs/../docs/plan.md", "status": "file", "project": "example-project",
   "relative": "docs/plan.md", "markdown": true},
  {"path": "docs/plans/", "status": "directory", "project": "example-project",
   "relative": "docs/plans"},
  {"path": "C:/projects/example/services/example-service/web", "status": "directory",
   "project": "example-service", "relative": "web"},
  {"path": "D:/outside/.valkama", "status": "refused", "code": "outside_root"},
  {"path": "../outside.md", "status": "refused", "code": "outside_root"},
  {"path": "docs/gone.md", "status": "missing"},
  {"path": "src/index.ts", "status": "ambiguous"},
  {"path": "docs/x.md", "status": "space_unbound"}
]}
```

| `status` | Meaning |
| --- | --- |
| `file`, `directory` | It exists. `project` is the deepest registered root it lies in and `relative` its path from that root, which is what `read` and the opener take. `markdown` comes with `file` |
| `missing` | Nothing there, under the space's root or under a project registered inside that root |
| `ambiguous` | A relative path found in two or more of the projects registered inside the space's root, and not under the root itself. The projects are not named |
| `space_unbound` | A relative path in a space the registry does not bind to one existing root. An absolute path in the same request still resolves |
| `refused` | `code` is `invalid_path` (not a local path Windows would take as written: a network or device path, a drive-relative path, a reserved name or character, longer than 1024 characters), `outside_root` (outside every registered root, answered the same whether anything is there), `not_a_file` (a device or a pipe) or `unreadable` (the operating system refused to say) |

A relative path is taken from the space's root first. Only when nothing is there
is it looked for in the projects registered inside that root, so a nested project
never overrides the root. The server does not send back an absolute path it
worked out; an absolute path the page sent comes back as sent. A registry that
cannot be read leaves no roots, so a relative path is `space_unbound` and an
absolute one `outside_root`.

`GET /api/documents/read?project=<id>&path=<relative>` reads one Markdown file,
taking `project` and `relative` from `resolve`. The path is checked again, inside
that project and no other, and once more on the file it opened, before a byte is
read: a folder on the way swapped for a junction out in between is `outside_root`.

```json
{"project": "example-project", "path": "docs/plan.md", "markdown": "...", "size": 65145,
 "modified_at": "2026-11-03T15:12:09Z", "revision": "9f2c41d0a7b3e655"}
```

`revision` is the first 16 hexadecimal digits of the SHA-256 of the bytes read.
The text is strict UTF-8 with a leading byte order mark removed and its line
endings untouched.

| Code | HTTP | When |
| --- | --- | --- |
| `invalid_request` | 400 | Either route: no `path`, more than 64 paths, no `project` for `read`, both `space` and `project` for `resolve`, or a `space` that is not a planning space's identity |
| `invalid_path` | 400 | The path's form, as in `resolve` |
| `project_unknown` | 404 | `project` is not in the registry, for either route |
| `outside_root` | 403 | Outside every registered root |
| `not_found` | 404 | Nothing there |
| `directory`, `not_a_file` | 422 | Not a regular file |
| `not_markdown` | 415 | Not `.md` or `.markdown` |
| `too_large` | 413 | Over 512 KiB; the answer also carries `size` and `limit` |
| `binary`, `not_utf8` | 415 | A NUL in the bytes, or bytes that are not UTF-8 |
| `unreadable` | 503 | The operating system refused the read; its text goes to the server's log |

### Targets the opener takes

Opening a file or a folder in the editor goes through the same plan as opening a
session (`docs/connection-contract.md`, "What a click opens"), and the page names
the target only by what `resolve` answered:

```text
GET /api/open-plan?target=file&project=<id>&path=<relative>[&line=<n>]&surface=desktop|browser[&fallback=<editor>]
GET /api/open-plan?target=folder&project=<id>&path=<relative>&surface=desktop|browser[&fallback=<editor>]
```

`fallback` names the editor: `vscode`, `vscode-insiders`, `cursor` or `windsurf`,
VS Code when it is absent or names no editor. When that editor is not installed
the plan opens VS Code instead and says so in `opens.missed`; with VS Code missing
too it only explains, `explain {reason: "not-installed", host}`. The steps depend
on the surface:

| Target | In the desktop app | In a browser |
| --- | --- | --- |
| `file` | `focus-folder {ide, folder}` on the project's root, then `open-file {ide, path, line}` | `open-file {ide, path, line, link}` |
| `folder` | `focus-folder {ide, folder}` | `focus-folder {ide, folder, link}` |

The desktop app starts the editor on the folder and then on the file, so both
steps run on one click. A browser follows `link`, `vscode://file/<path>:<line>:1`
for a file and `vscode://file/<path>` for a folder, with the editor's own scheme in
place of `vscode` and the path encoded as Python's `Path.as_uri` encodes it.

The planner checks both targets with the same path check as `read`, inside the
named project, and the answer carries the absolute path it found, because a link
needs one. A folder's rule for a session (an existing absolute local folder, not
a network path, without `..`) stays as it is, and this target adds that it lies
inside a registered root.

A target that opens nothing is not an HTTP error. The plan answers 200 with one
step, `explain {reason: "path-refused", code}`, where `code` is one of `read`'s
codes or one the opener adds:

| `code` | When |
| --- | --- |
| `project_unknown` | `project` is not in the registry |
| `invalid_path`, `outside_root`, `not_found`, `not_a_file`, `unreadable` | As in `read` |
| `directory` | A `file` target that is a folder |
| `not_a_folder` | A `folder` target that is not one |

Only a request outside the closed values, such as no `project`, is refused with
HTTP 400 `invalid_request`.

## Client hooks

`valkama hook <client> <event>` is the command Claude Code and Codex hooks run.
It reads the hook input from stdin and records the session event straight into
the store, so sessions stay visible while neither `serve` nor an MCP session is
running. When the store is busy, missing or at another schema version, the
event goes to a spool beside the store and lands later. The command always
exits 0, and a lifecycle event prints nothing of its own, so it never blocks a
client session.

```
valkama hook claude session-start   < hook-input.json
valkama hook codex stop             < hook-input.json
valkama hook claude pre-tool-use    < hook-input.json
```

The events are `session-start`, `session-end`, `subagent-start`,
`subagent-stop`, `stop`, `user-prompt-submit` and `pre-compact` for both
clients, plus `notification` and `post-tool-use` for Claude Code. Each one updates
the session row that `GET /api/session` and work-item context read.
`claude post-tool-use` names the agent an Agent tool call started. `claude
pre-tool-use` adds the session identity to a Valkama tool call. `session-start`
also records where the session is open — an IDE extension, its terminal, a
terminal, Claude Desktop or the Codex app — from a few named environment
variables and, on Windows, the names of the programs above the hook, which is
where a click on the session opens it. What is kept is the kind of place, the
product, the folder the session started in and Claude Desktop's own id for it,
never a variable's value
([details](docs/hook-contract.md#where-a-session-is-open)). Only an
allowlisted set of fields is kept: never the prompt, tool arguments other than an
Agent call's short description, or assistant text.

The same hooks tell a working agent what a person did in the interface on the
work its session holds. `post-tool-use`, `user-prompt-submit` and `stop` answer
with a short notice when there is news: a comment, an answer, a status change, a
cancel. The orchestrator hears about everything its session holds, a subagent
about the items where it holds the claim or a step and about replies in its own
threads and answers to its own questions, each event once. `claude watch`,
registered with Claude Code's `asyncRewake`, wakes an orchestrator that is idle,
for example while it waits for a background subagent. Codex is told at its
next prompt or tool call. `notify` switches this off (see
[Configuration](#configuration)), and
[the hook contract](docs/hook-contract.md#telling-the-agent-what-a-person-did)
says who is told, what a notice holds and what it costs.

When a session ends, the hook also copies the session's transcript, and a
subagent's own transcript when the client reports one, into `transcripts/`
beside the store, and records the copy's sha256. The copy survives the client
deleting its original. A transcript too large to copy within the hook's time
budget is left for the transcript sweep to copy later. Copies stay on this
machine and never appear in an export. They are kept while an open work item
refers to the session, and for at least 90 days after the later of the
session's last activity and the closing of the last item that refers to it.
Transcripts can contain secrets and personal data, so treat the store's
directory accordingly. To delete copies when someone asks, without waiting for
retention:

```text
valkama transcripts purge --session <id> [--session <id> ...] [--dry-run]
valkama transcripts purge --before 2026-01-01 [--dry-run]
```

`--session` names sessions by exact id; `--before` takes the sessions whose
last activity is earlier than that date (UTC) or time. Given both, a session
must match both. The copies go even while an open work item refers to the
session, and the command says how many such items there were. A copy still
owed for those sessions is never made. The store keeps only the fact of each
deletion and the copy's hash, never its content, and the command prints counts
of sessions, files and bytes, never a session id or a path. `--dry-run`
prints the same counts and changes nothing.

`doctor` reports spool files still waiting, rejected spool files, the last
hook event from each client, and the transcript archive: copies kept, copies
still owed and files no record names. The fields, the spool format, the session
rules and the archive's retention are in
[the client hook contract](docs/hook-contract.md).

## The desktop app and the tray

`desktop/` is a thin Electron shell. Its window opens at once, on a starting
page in the workspace's palette and language; behind it the app verifies the
managed launcher, reuses the managed server or starts one, and then shows
Valkama in that window with its own process, taskbar entry and icon. When it
cannot, the same window says why and offers the remedy: a stale managed server
is offered a restart there, and only a listener the launcher proves its own is
ever stopped. It runs `runtime` and `serve` through the stable shim, whose
manifest selects the release pinned from this repository; there is no second
desktop source record or checkout-path fallback. Each step of opening the
window is logged, with its time, to `%TEMP%\valkama-desktop.log`.

With the app installed on Windows, a link to a work item followed from outside a
browser page opens the card in this window, at first start or on top of a running
window, and the browser tab closes itself where the browser allows it. The window
comes up above what is in use; while you are working elsewhere, Windows keeps the
keyboard there until you click it. The page in the tab offers to open the item in
the browser instead;
[the address of a work item](docs/connection-contract.md#the-address-of-a-work-item)
states when this happens.

```bash
cd desktop
npm ci
npm start        # run the window from source
npm run dist     # build the installer into release/
```

`release/` is git-ignored — a 90 MB installer does not belong in a repository.
Rebuild and reinstall after changing `desktop/main.js`; UI-only changes just
need `npm run build` in `web/`.

**The tray icon** appears while an agent holds an MCP session and disappears when
the last one ends, so it answers "is anybody working here right now?". Clicking
it always does something visible. With the desktop app installed it starts the
app and nothing else, and the app decides the rest in its own window. Without
the app it opens a browser, starts the server, offers a restart, or explains the
refusal in a dialog, deciding off the icon's thread. When a listener owned by
the managed shim is older than the launcher's current source, the dialog says
which half drifted and offers to restart it. A listener whose managed process
ownership cannot be verified is refused and left untouched — holding the port
or returning Valkama-shaped JSON is not stop authority. Clicks, the steps they
took and how they ended are logged to `%TEMP%\valkama-tray.log`.

`launcher install` moves the icon along with the session that holds it: its script
restarts from the new release, so two icons can stand side by side for up to two
seconds. An icon hidden from its menu stays hidden.

Set `VALKAMA_NO_TRAY=1` to turn it off.

> Running `electron` from a VS Code terminal fails with `app is undefined`,
> because VS Code exports `ELECTRON_RUN_AS_NODE=1`. Clear that variable first.
> The installed app is unaffected.

## Windows notifications

When an agent asks you a question or asks for a decision, or moves work to review,
Valkama shows a Windows notification, so you need not watch the board or the chats. It
works with Valkama's window closed, because the process that wrote the event shows it.
A launch from Valkama that fails can notify you too; that one is off until you turn it on.

**What it needs:**

- **The desktop app.** Its installer puts the Valkama shortcut in the Start menu, whose
  identity the notifications are shown under, and registers the `valkama:` scheme a click
  opens. Without the shortcut Windows drops a notification and reports no error, so
  without the app there are no notifications.
- **.NET Framework 4,** which Windows includes. A notification is shown by a small C#
  program, `windows/toast.cs`, compiled on first use into
  `%LOCALAPPDATA%\Valkama\toast`. The repository holds no binary and you need no SDK.
- **Notifications on in Windows,** under Settings → System → Notifications, for the system
  and for Valkama. Do Not Disturb is respected: there is no banner and the notification
  waits in the notification centre, unless you make Valkama a priority app.

A click starts the app if it is closed, and the app starts the server, so nothing has to
hold the port and `launcher autostart` is not needed for this. With autostart on, the
listener answers a notification's one question without loading the server.

**What it does:**

- A click opens the item; a click on a notification about a question goes on to that
  question, with the keyboard on its first field. Several items within a few seconds become
  one notification,
  and a click on that one opens the panel «Needs my answer» when any of them is a question.
- A question already on your screen, in a focused Valkama page, shows nothing. Another
  screen in the same window does not count as showing it.
- A newer notification about an item replaces the older one. It is taken away when the
  item has no open question left or is closed.
- A notification is shown at most once. A process killed before showing one loses it, and
  the question still waits in the panel.

Settings → Windows notifications chooses the events and how much the text reveals, and
sends a trial notification. The lock screen shows the same text unless you turn on
Windows' "Hide content when notifications are on lock screen" for Valkama. `doctor`
reports the shortcut, the helper and autostart in one line, without compiling anything or
showing a notification; it cannot see whether Windows has blocked Valkama, which the
settings screen asks Windows directly. `VALKAMA_NO_ALERTS=1` turns notifications off for
a process, for tests and for machines with no desktop.

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
`GET /api/modules` is the module list this build declares in code, and
`GET /api/platform/context` the store's identity and the project directory with
each project's binding state, which the shell reads before any module renders.
No endpoint serves integration definitions or loads third-party browser code.

### Local HTTP security

The listener accepts only the exact authority `127.0.0.1:<bound-port>`. Browser
writes bootstrap a fresh process-scoped session credential and send it in
`X-Valkama-Session`; the UI keeps it only in memory and retries one write after
a server restart. The bootstrap and every write with that credential must carry
`Sec-Fetch-Site: same-origin`, which a browser adds to its own same-origin
requests and a plain HTTP client does not, so a local script that just asks is
refused (`fetch_metadata_refused`); the trust boundary is stated in
[the connection contract](docs/connection-contract.md#call-identity). Originless `/api/ingest` adapters instead read the persistent
installation bearer from `~/.valkama/installation-token`. These credentials are
not interchangeable, never belong in URLs, cookies, browser storage, argv, or
environment variables, and every write must be an explicitly framed UTF-8 JSON
object. Vite development is the only extra browser origin and must be enabled by
the exact `--development-origin http://127.0.0.1:5173` flag shown above.

Every page the listener answers, the app's own and the document page alike, carries
`Content-Security-Policy: frame-ancestors 'none'` and `X-Frame-Options: DENY`: no
site, Valkama included, may show one in a frame, where another page could be laid
over a click.

`POST /api/hooks/message-display`, Claude Code's display hook, writes nothing and
takes neither credential: it answers a local process, and refuses any request with
`Origin` or `Sec-Fetch-Site`, which a browser cannot leave out. See
[the hook contract](docs/hook-contract.md#work-item-numbers-as-links-on-the-screen).

A Planning write that passes the browser credential is the owner's: its call is
recorded as `confirmed` with source `browser` and no agent session, and when the
request names no `author` it is signed `user`, so a claim, a checklist tick or a
comment made by hand reads as the owner's. `/api/ingest` is not such a write.
How agent calls are identified is in
[the connection contract](docs/connection-contract.md#call-identity).

The token file is atomically created with the restrictive file mode supported
by the Python standard library. This boundary protects the loopback web surface
from hostile sites and DNS rebinding; it does not isolate malicious native code
already running as the same OS user, which can read the same user-owned runtime
files and process memory.

## How the repository is laid out

| Path | Owns |
| --- | --- |
| `valkama.py` | the source entry point — it prepares `sys.path` and hands off to `server/cli.py`, or for `hook` to `server/hooks/entry.py` and for `serve --on-demand` to `server/on_demand.py` before the command line is imported |
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

The maintained product contracts are:

- [`SERVICE.md`](SERVICE.md) — launcher ownership, client registration and
  relocation.
- [`DESIGN.md`](DESIGN.md) — the design system, and the authority for every
  visual decision.
- [`docs/product-model.md`](docs/product-model.md) — the product vocabulary and
  the distinctions between modules, views, adapters, and runtime records.
- [`docs/platform-contract.md`](docs/platform-contract.md) — the two operating
  levels, what each module means on them, and what an adapter may do.
- [`docs/connection-contract.md`](docs/connection-contract.md) — what a client
  learns on connect, and how the server refuses to answer from a stale build.
- [`docs/hook-contract.md`](docs/hook-contract.md) — what `valkama hook` keeps
  from a client hook, the spool, what each event does to a session, and the
  transcript archive.

The superseded Improvements and session-event contracts remain in `docs/` as
historical records; they do not describe supported endpoints.

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
