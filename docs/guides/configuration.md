# Configuration

The settings in the first table below have a file. Everything else is an
environment variable, and the environment overrides the file for every setting,
so automation and a development shell never have to edit anything to change one
run.

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
| `transcript_roots` | `VALKAMA_TRANSCRIPT_ROOTS` | none | the only directories session transcripts are read from — for the archive, usage and session titles — separated by the path separator; without it, a transcript is read wherever its client said it is |
| `author` | `VALKAMA_AUTHOR` | `agent` | the name written into Planning claims and comments when an MCP tool call names no `author` |
| `notify` | `VALKAMA_NOTIFY` | `on` | `off` stops the client hooks telling a working agent what a person did on its work items, and the watcher that wakes an idle session; see the [hook contract](../hook-contract.md#telling-the-agent-what-a-person-did) |

## Environment-only variables

The rest are environment-only, because each is either a one-shot switch or
belongs to a process rather than to an installation:

| Variable | Default | What it changes |
| --- | --- | --- |
| `VALKAMA_NO_TRAY` | unset | set to anything to suppress the tray icon |
| `VALKAMA_PORT` | `8642` | the port the desktop app expects the server on, and the one a work item's `url` names |
| `VALKAMA_TRAY_MUTEX` | `Local\ValkamaTrayIcon` | the mutex tray sessions coordinate through |
| `VALKAMA_NO_ALERTS` | unset | set to anything to turn [Windows notifications](windows-notifications.md) off for that process |

`--port` on `serve` overrides the port for that process. `VALKAMA_PORT` tells the
*desktop app* where to look and an MCP session which address to hand out; set both
if you move the port.

## Project registry

The project registry is managed by Valkama's `projects` command, separate from
`config.json`. On Windows, Valkama keeps the authoritative project inventory at
`%LOCALAPPDATA%\Valkama\project-registry.toml` (format 2) and publishes a
schema-v4 projection at `%LOCALAPPDATA%\Valkama\projects.json`. Planning, Memory,
and the desktop read that complete projection. A missing or malformed projection
exposes no partial project list, and a projection of another schema version is
malformed.

A Planning space holds any number of projects, and exactly one of them is its
default project: the space's root is that project's root. In the projection
each binding names its space and says whether the project is its default:

```json
"planning_binding": {"default": true, "kind": "planning-space", "resource_id": "<opaque>"}
```

Use `projects add` to register an existing directory and
`projects bind ID --space KEY [--scope NAME] [--default]` to connect it to an
existing Planning space. The first project bound to a space becomes its
default; `--default` makes the project the default and takes the flag from the
previous one in the same change. Binding a project to another space moves its
home space; its work items stay where they are. `projects unbind ID` takes a
project out of its space and keeps it registered, with no space; the work items
that name it keep naming it. The default project of a space that keeps other
projects cannot leave it, by `bind`, `unbind` or `remove`: first make another
project the default with `projects bind OTHER --space KEY --default`.
`bind` reads only the space's identity from the store, so it also works on a
store that has not been migrated yet.

`projects update ID --name NAME` changes its display name; `--root ABS` moves
its root to an existing directory, even if the old root is gone.
`projects remove ID` removes only the registration and its binding, leaving the
Planning store untouched. `projects check` compares the inventory and
projection; `projects doctor` reports the same health result. Both also list
in `foreign_bindings` each planning binding whose space lives in neither the
main store nor an attached one, and `unreadable_stores` counts the stores, main
or attached, that could not be read. A foreign binding leaves `ok` unchanged,
since the inventory and projection still agree. `projects apply`
republishes the current inventory, and `projects rollback` restores the exact
inventory and projection bytes saved before the preceding change. It never
crosses a change of format.

A registry an earlier release wrote (inventory format 1, projection schema v3)
is carried across once with `projects upgrade`. It keeps, in
`projects.json.valkama.upgrade`, the exact former bytes of three files with
their SHA-256: the inventory, the projection and the one-write snapshot
`projects.json.valkama.rollback`, each recorded as absent when it was. On a
registry that is already format 4 it answers `{"changed": false}` and touches
nothing. On a machine with no registry it writes the empty registry of formats 2 and
4, and keeps the absence the same way. `projects downgrade` returns all three files to those bytes exactly,
removing a file that was absent, and removes the upgrade snapshot; changes made
after the upgrade are lost with it, and the earlier release's `rollback` again
undoes its own last write. Downgrade before installing the earlier release,
which cannot read format 4. For a one-time transfer from a former writer's
format-1 TOML inventory, use
`projects import --source <absolute-path-to-inventory>`: it writes inventory
format 2 and projection schema v4, and importing the same inventory again writes
nothing. Every first write onto a machine with no registry (an import, `add` or any other
write) keeps that state in the upgrade snapshot too, so `projects downgrade` later
returns the machine to no registry. Import refuses to overwrite an inventory or
projection with different project data. There is no project-registry path
override.

The first registration, and binding it to a Planning space, are step 3 of the
README's [Quick start](../../README.md#quick-start).
