# Valkama

**A local workspace for planning, executing, and reviewing agent work.**

Valkama connects projects, work items, agent executions, and results in one web
and desktop workspace. Your agents file, claim, update and close work items
through its MCP tools; you follow and steer the same items on a board, a list or
a graph, and answer the questions agents ask you there. It works with Claude Code
and Codex.

It is built for one person: whoever runs a local development loop and is tired
of the work living in three places at once. There is no account, no cloud and no
service to keep alive. Durable state stays in local SQLite stores in your home
directory, and the MCP server only exists while a client is talking to it.

## Requirements

| | Needed for | Version |
| --- | --- | --- |
| Python | the server, the MCP tools, the CLI | 3.11 or newer |
| Git | cloning, and `launcher install`, which pins a commit of the clone | any |
| Node.js | rebuilding the web UI or the desktop app | 22.22.2+ or 24.15+ (only if you build) |

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

```bash
git clone https://github.com/Muratovnik/valkama.git
cd valkama
```

The launcher in the next step pins a commit of this clone, so it needs a Git
clone. A release's `valkama-<version>-source.zip` holds the Python service and
the built web UI without Git history; it does not need Node.js to run, but
`launcher install` refuses a directory that is not a Git checkout.

### 2. Install the stable launcher

```bash
python valkama.py launcher install
python valkama.py launcher status
```

The status output is JSON. Its `command` field is the path agent clients should
register:

- Windows: `%LOCALAPPDATA%\Valkama\bin\valkama.cmd`
- macOS/Linux: `$XDG_BIN_HOME/valkama` or `~/.local/bin/valkama`

That command runs a pinned release, a copy of the clone's current commit, so
uncommitted work never reaches a client session. Run `launcher install` again to
publish newer commits. [Installation and setup](docs/guides/installation.md#what-the-launcher-pins)
explains releases, going back to one and moving the clone.

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

`VALKAMA_AUTHOR` is the name a client's claims and comments are signed with, so
give each client a different one.

### 4. Install the skill

Give the agents the procedure that goes with the tools — finding and claiming an
item, keeping its checklist, merging duplicates, closing it:

```bash
python valkama.py skill install
```

It writes a copy where each client finds its user's skills, and edits no client
configuration; see [`SERVICE.md`](SERVICE.md#install-the-skill).

To have Valkama attach the commits an agent makes to the task it holds, install
its Git hook too
([details](docs/guides/client-hooks.md#the-git-commit-hook)):

```bash
python valkama.py git-hook install
```

## Quick start

1. **Check the tools.** Restart the client, then ask it to list Planning spaces.
   In Claude Code:

   ```
   > use the valkama mcp server to list planning spaces
   ```

   You should get an empty list rather than an error. If the tools are missing,
   `/mcp` shows the server's status; a server that failed to start needs a new
   conversation, not a reconnect.

2. **Open the workspace.** From the clone:

   ```bash
   python valkama.py serve
   ```

   Open `http://127.0.0.1:8642/`. You should see Work, Analytics and Settings
   navigation and an empty Planning directory. Stop the server with `Ctrl+C` —
   agents spawn their own copy and do not need this one running. On Windows the
   [desktop app](docs/guides/installation.md#the-desktop-app-windows) starts the
   server for you.

3. **Connect your project.** Valkama keeps a local project inventory. Register an
   existing directory, using your own lowercase project id, display name, and
   absolute path. Replace the example values, including the path, with your
   project's values:

   ```powershell
   python valkama.py projects add my-project --name "My Project" --root "C:\path\to\my-project"
   python valkama.py projects check
   ```

   The check reports `"ok": true` when Valkama's inventory and the projection
   used by its modules agree. To connect the project to Planning, create a space
   with the MCP `create_planning_space` tool, giving it a name no other space has
   (a key is derived from the name unless you give one); a space holds no project
   until one is bound to it. Then bind the project to the returned space key:

   ```powershell
   python valkama.py projects bind my-project --space MY
   ```

   Replace `MY` with the key returned for your Planning space. The first project
   bound to a space becomes its default project; see
   [Project registry](docs/guides/configuration.md#project-registry) for several
   projects in one space. Run `python valkama.py projects list` to inspect the
   result.

From here your agents file and work the items of that space, and the skill
tells them how. If something is missing later, `python valkama.py setup` says
what and prints the command for each gap; see
[Checking an installation](docs/guides/installation.md#checking-an-installation).

## What you can do

### Plan work on a board, a list or a graph

One column per workflow state, goals as lanes, checklists with stable ids, typed
refs and a full activity trace. A claim is a lease on the agent session that
took it, so work whose session is gone can be taken over; guards refuse a move
the board could not honestly report. → [Kanban planning](docs/guides/planning.md)

### Answer agents' questions

Agents ask you typed questions and ask for decisions on a work item; you answer
them in the card or in a shared inbox, in your own words if you prefer, and can change an
answer while the task is open.
→ [Questions and decisions](docs/guides/planning.md#questions-and-decisions)

### Launch agents from a card

A launch records a delivery contract, and its outcome is a typed result rather
than an exit code; resume uses the client's own stored session identity. The
card's Execution tab is off by default.
→ [Launching agents from a card](docs/guides/launching-agents.md)

### Project documents

A path or a Markdown link in a work item's text opens: a Markdown file in
Valkama's read-only viewer, anything else in your editor, as long as it lies
inside a registered project. → [Project documents](docs/guides/project-documents.md)

### Follow sessions through client hooks

Claude Code and Codex hooks keep each session visible on the work it serves,
record subscription quota through the status line or Valkama's Claude Code mod,
tell a working agent what you did on its items, and archive transcripts locally.
→ [Client hooks](docs/guides/client-hooks.md)

### Find and label work in the workspace

A live local UI in English or Russian, a task finder on Ctrl/Cmd+K across mapped
projects, colours for task types, names for billing accounts, and memory
attached to a work item as a pointer rather than a copy.
→ [The workspace](docs/guides/workspace.md)

### Use it as a desktop app

On Windows, Valkama runs in its own window, and a tray icon shows while an agent
holds an MCP session. → [The desktop app and the tray](docs/guides/desktop-and-tray.md)

### Windows notifications

A Windows notification when an agent asks you something or moves work to review,
and a warning before a subscription quota window runs out.
→ [Windows notifications](docs/guides/windows-notifications.md)

### Connect external adapters

Check and declare a service written to answer Valkama's adapter contract over
HTTP, as a process or as an MCP server. No module calls an installed adapter
yet. → [External adapters](docs/guides/external-adapters.md)

## Limitations

Worth knowing before you adopt it:

- **Single user, single machine.** There is no account system, multi-tenancy, or
  remote access. Loopback HTTP uses local browser and installation credentials,
  but malicious native code running as the same OS user remains trusted; see
  [Local HTTP security](docs/guides/http-security.md).
- **Windows is the exercised product platform.** The service launcher is tested
  on Windows and Linux; the tray, installer and session-root registry lookup
  remain Windows-only. The rest of the server should run on macOS and Linux,
  but nobody has proven the full product there.
- **No MCP prompts or resources.** Planning tools manage work; project context
  belongs somewhere else.
- **No hosted anything.** No sync between machines, no shared installation, no backup
  other than the snapshots it takes locally.
- **The MCP server is spawned by your client**, so it lives as long as the
  session; nothing runs in the background between sessions. A running session
  moves to the release `launcher install` pins
  ([Pinned releases](SERVICE.md#pinned-releases)), and
  [`docs/connection-contract.md`](docs/connection-contract.md) says how version
  skew is made visible instead of silent.

## Documentation

The guides, one topic each:

| Guide | What it covers |
| --- | --- |
| [Installation and setup](docs/guides/installation.md) | what the launcher pins, client registration, checking an installation, the desktop app |
| [Configuration](docs/guides/configuration.md) | `~/.valkama/config.json`, the settings and environment variables, the project registry |
| [Command reference](docs/guides/commands.md) | every `valkama.py` command and its options |
| [Kanban planning](docs/guides/planning.md) | the board, checklists, refs, claims, questions, links, guards and the order of work |
| [Launching agents from a card](docs/guides/launching-agents.md) | the Execution tab, delivery contracts, outcomes, resume and session context |
| [Upgrading the store and going back](docs/guides/store-upgrades.md) | schema upgrades, snapshots, restoring one, going back to an earlier build |
| [Project documents](docs/guides/project-documents.md) | which paths open and where, and the document routes |
| [Client hooks](docs/guides/client-hooks.md) | hook events, the status line, the quota mod, notices to agents, the transcript archive |
| [The workspace](docs/guides/workspace.md) | the live UI, the task finder, task type colours, account names, memory |
| [The desktop app and the tray](docs/guides/desktop-and-tray.md) | the Windows window and the tray icon |
| [Windows notifications](docs/guides/windows-notifications.md) | what notifies you, what it needs, quota warnings |
| [External adapters](docs/guides/external-adapters.md) | the adapter contract, its manifest, checking and installing an adapter |
| [Local HTTP security](docs/guides/http-security.md) | what the listener serves and accepts, and what that boundary protects |
| [Building and development](docs/guides/development.md) | running the web UI and the desktop app from source |
| [How the repository is laid out](docs/guides/repository-layout.md) | what each top-level directory owns |

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
historical records; they do not describe supported endpoints. Released changes
are recorded in [`CHANGELOG.md`](CHANGELOG.md).

## Contributing

Issues and pull requests are welcome — [`CONTRIBUTING.md`](CONTRIBUTING.md) has
the setup, the gates every change runs, the commit convention, and the handful
of architectural rules that would otherwise send a pull request back.
[Building and development](docs/guides/development.md) covers running the web UI
and the desktop app from source.

## License

Valkama is licensed under the
[Apache License 2.0 with the Commons Clause License Condition v1.0](LICENSE),
from release 2.9.0 on. You may use, change and redistribute it under Apache 2.0,
including in commercial work. You may not sell Valkama, or a product or service
whose value derives entirely or substantially from it, including hosting or
support. Releases up to 2.8.0 remain under the MIT License.
