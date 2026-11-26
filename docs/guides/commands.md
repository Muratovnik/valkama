# Command reference

These commands cover the current CLI. From a checkout they run as
`python valkama.py <command>`; the stable command that `launcher status` names
runs the same commands as `valkama <command>`. Planning MCP tools use spaces and
work items; a Kanban card is one view of a work item.

```
python valkama.py <command> [options]
```

| Command | What it does |
| --- | --- |
| `mcp` | speak MCP over stdio — what the installed launcher runs for agent clients |
| `serve [--port 8642] [--on-demand] [--development-origin http://127.0.0.1:5173]` | serve the JSON API and Valkama UI; with `--on-demand`, hold the port and load the server on the first connection that needs it; `--development-origin` allows the fixed Vite origin, see [Building the web UI](development.md#building-the-web-ui) |
| `capabilities` | report public interfaces, MCP revisions and tool count as JSON without reading user data |
| `status [--launcher-directory DIR]` | report source, database, runtime and launcher state without opening the database |
| `launcher install [--revision REV] [--checkout DIR] [--releases DIR] [--directory DIR] [--force]` | pin a commit as a release and atomically install or repair the stable client command that runs it |
| `launcher status [--directory DIR]` | verify launcher ownership and hashes, and whether the installed desktop app packs the pinned release's `desktop/` sources (`desktop_app`) |
| `launcher listener status\|stop [--port 8642] [--directory DIR]` | inspect or stop only the Windows listener proven to run through the managed shim |
| `launcher autostart enable [--port PORT] [--force] \| disable [--force] \| status` | on Windows, keep an on-demand listener on the port from login; off until enabled. `--port` defaults to `VALKAMA_PORT`, then `8642`; see [`SERVICE.md`](../../SERVICE.md#holding-the-port-from-login) |
| `launcher uninstall [--directory DIR] [--force]` | remove only the managed launcher files, this launcher's autostart value and Valkama's three Git hooks (see [The Git commit hook](client-hooks.md#the-git-commit-hook)) |
| `skill install\|status\|uninstall [--client claude\|codex]... [--launcher-directory DIR] [--force]` | install, inspect or remove the Valkama skill where each client finds it; `--force` is for `install` and `uninstall`; see [`SERVICE.md`](../../SERVICE.md#install-the-skill) |
| `summary [--space KEY]` | a short Planning-space report, meant for session hooks |
| `released --space KEY --repo PATH --range A..B [--json]` | list the open work items whose attached commits went into a release range; see [`released`](#released) |
| `git-hook install\|status\|uninstall [--json] [--launcher-directory DIR]` | install, inspect or remove Valkama's Git commit hook in the global Git configuration; see [The Git commit hook](client-hooks.md#the-git-commit-hook) |
| `hook CLIENT EVENT` | record one client hook event from stdin without a running server; see [Client hooks](client-hooks.md) |
| `statusline [--source=statusline\|mod] [--previous=<base64>]` | Claude Code's status line command: record the quota reading it is given; see [The status line command](client-hooks.md#the-status-line-command) |
| `runtime` | print this checkout's backend and static identity |
| `projects list\|add\|update\|remove\|bind\|unbind\|check\|apply\|doctor\|rollback\|upgrade\|downgrade\|import\|map-items` | manage the local project inventory and its projection; `map-items` writes the file the work-model migration gives work items their projects by; see [Project registry](configuration.md#project-registry) |
| `config [--json]` | every setting, the layer it came from, and the value in use |
| `setup [--json] [--apply]` | what this installation needs, and the exact command for each gap |
| `adapter check --at URL \| --command ARGV \| --mcp ARGV \| --record FILE [--json]` | ask an adapter for its manifest, then probe it for the calls it should refuse |
| `adapter install --at URL \| --command ARGV \| --mcp ARGV \| --record FILE [--json] [--force]` | check it, then declare it for this installation |
| `adapter remove ADAPTER_ID` | stop declaring an installed adapter |
| `adapter list` | the adapters this installation declares |
| `doctor [--port 8642] [--json] [--no-probe]` | check this installation in four levels — Installation, Projects, Capabilities, Connections — and say what to do about each problem |
| `export [--section planning] [--space KEY]... [--output PATH]` | write every Planning space, every one of its work items and their questions as one JSON export; see [`export`](#export) |
| `transcripts purge [--session ID]... [--before DATE] [--dry-run]` | delete archived transcripts now, on request, whatever retention says; prints counts only; see [The transcript archive](client-hooks.md#the-transcript-archive) |
| `usage rebuild --session ID [--agent ID] \| --all [--dry-run] [--json]` | read a session's usage run again from its transcript; see [`usage rebuild`](#usage-rebuild) |
| `usage pauses [--since WHEN] [--until WHEN] [--client NAME]... [--project ID] [--json]` | how much of the prompt cache model requests read after pauses of each length, per client, role, model and sign-in; reads only; see [`usage pauses`](#usage-pauses) |
| `quota import --source FILE` | import subscription quota samples from a JSON-lines file, one window a line; importing again keeps nothing twice. The format is in [the connection contract](../connection-contract.md#subscription-quota-samples-and-accounts) |
| `migrate work-model [--item-projects FILE] [--dry-run [--into DIR]]` | carry a store Valkama 2.9 left to the work model, once, with every session stopped; see [Migrating a 2.9 store](store-upgrades.md#migrating-a-29-store) |
| `attach NAME PATH [--label TEXT]` | attach another database file as a scope |
| `detach NAME` | drop a scope from every view; the file is untouched |
| `scopes [--json]` | list attached scopes and their Planning spaces |

## `released`

`released --space KEY --repo PATH --range A..B [--json]` lists the open work
items whose attached commits went into a release range, and how each was found:
`hash` (the commit is in the range), `patch-id` (the same change arrived under
another hash), or one of two weak matches: `changed-patch` (the commit is outside
the range and not in the history before it, and a commit in the range has its
subject with another patch) and `subject` (the object is gone and the subject
recorded for it is that of a commit in the range). Only the commits of the
project registered at `--repo` are compared, and those attached with no
repository by their hash. A hint to check by hand when closing a release: partly
released work shows too, an item with no attached commit cannot, and it changes
neither the store nor the repository.

## `export`

`export [--section planning] [--space KEY]... [--output PATH]` writes every
Planning space, every one of its work items and their questions as one JSON
export; `planning` is the only section. `--space` (repeatable) narrows it to
those spaces and records them as `space_filter`; an unknown space exits
non-zero. `--output` writes the file whole through a temporary file beside it
and prints one summary line instead of the JSON. A space whose items do not add
up to its count stops the export.

## `usage pauses`

`usage pauses [--since WHEN] [--until WHEN] [--client NAME]... [--project ID] [--json]` reports,
for the model requests sent in a period, how much of each one's context was read
from the prompt cache and how much was written to it again, by the length of the
pause before it. It reads the runs the background usage reader knows and their
transcripts (or archived copies) again; it opens the store read-only and changes
nothing. Each run's file is read whole, so a long period over a large history
takes a while; `--client` and a shorter period read less.

`WHEN` is a date, the start of that day in UTC, or a time with its offset
(`2030-03-04T10:00+02:00`). `--until` defaults to now and `--since` to 30 days
before `--until`. The period is read in whole hours of UTC, `--since` rounded
down to its hour and `--until` up. `--client` (`claude`, `codex`, repeatable)
reads only that client's runs. `--project` (a project id, as `projects list` shows
it) reads only the runs with work in that project in the period, placed as the
Analytics usage read places work: by the planning space of the task the work was
on, or, for work on no task, by the project whose root holds the session's
working directory. A run is counted whole, its requests outside that project's
work included.

What is measured:

- A request is one usage a client's record reports: a Claude response by its
  message id, a Codex `token_usage_record`. An adviser's part is left out. The
  first request of each run has no pause and is counted in no bucket.
- The pause is the time from when the previous request in the same run was sent
  to when this one was sent: the age of the cache it could read. A request
  counts as sent at its last input record: the prompt, tool result, notice or
  hook message it answers.
- `wait` is what the pause waited on:
  - `wake`: a keep-warm wake, a hook message that starts with the literal
    `keepwarm:` (a Claude Stop hook's `asyncRewake` message, a Stop or
    SubagentStop `block` reason, or a Codex Stop `block` reason);
  - `person`: a person's prompt or the answer to a question put to a person;
  - `machine`: everything else.

  The `person` rows are the control sample, because those waits are never
  warmed.
- The buckets are `0-4m`, `4-5m`, `5-6m`, `6-30m`, `30-60m`, `60-70m`, `70m-3h`,
  `3-12h` and `12h+`. Each holds its lower edge and not its upper one. The edges
  sit on either side of the five-minute and one-hour cache lives, so a cliff at
  either one falls between two buckets.
- `auth` is `subscription` for an organization the subscription quota knows,
  and `null` where nothing says.

`--json` prints one object whose `interface_version` is `valkama-usage-pauses`.
Fields are only ever added to it:

| Field | Meaning |
| --- | --- |
| `from`, `to` | the hours read, UTC, `to` not included |
| `project` | the project id `--project` named, or `null` for every run |
| `buckets` | each bucket's `key`, `from_seconds` and `to_seconds` (`null` for the last), in order |
| `waits` | `machine`, `person`, `wake` |
| `cold_share` | a request that read less than this share of its context from the cache counts as cold (0.5) |
| `runs` | `read`, the runs read; `missing`, those with no transcript left to read |
| `rows` | one per environment, wait and bucket that had a request, as below |

Each row:

| Field | Meaning |
| --- | --- |
| `client`, `role`, `model`, `auth` | the environment: `claude` or `codex`; `main` (a session's own run) or `subagent`; the model that answered; `subscription` or `null` |
| `wait`, `bucket` | as above |
| `requests` | requests in the row |
| `context_tokens` | everything they sent: the next four added up |
| `input_tokens`, `cached_read_tokens`, `cache_write_5m_tokens`, `cache_write_1h_tokens` | what they sent by kind; Codex reports one write kind, kept as `cache_write_5m_tokens` |
| `read_share`, `write_share` | cache reads, and cache writes, over `context_tokens`; `null` with no tokens |
| `cold_requests` | requests that read less than `cold_share` of their own context from the cache |
| `estimated_api_cost_usd`, `unpriced_requests` | the estimate at public API prices of the requests with a price, and how many had none; on a `wake` row, what the wakes cost |
| `background_known` | whether the client's transcript shows background work: true for Claude, false for Codex |
| `background_requests`, `background_cold_requests` | requests sent while a background command or subagent the run started was still running, and how many of them were cold; `null` where `background_known` is false |

```json
{
 "interface_version": "valkama-usage-pauses",
 "from": "2030-03-01T00:00:00+00:00",
 "to": "2030-03-08T00:00:00+00:00",
 "project": null,
 "buckets": [{"key": "0-4m", "from_seconds": 0, "to_seconds": 240}],
 "waits": ["machine", "person", "wake"],
 "cold_share": 0.5,
 "runs": {"read": 42, "missing": 0},
 "rows": [
  {
   "client": "claude", "role": "subagent", "model": "claude-opus-5-5",
   "auth": "subscription", "wait": "machine", "bucket": "6-30m",
   "requests": 12, "context_tokens": 1450000, "input_tokens": 120,
   "cached_read_tokens": 150000, "cache_write_5m_tokens": 1299880,
   "cache_write_1h_tokens": 0, "read_share": 0.1034, "write_share": 0.8965,
   "cold_requests": 11, "estimated_api_cost_usd": 9.41, "unpriced_requests": 0,
   "background_known": true, "background_requests": 0,
   "background_cold_requests": 0
  }
 ]
}
```

(`buckets` is cut to its first entry here; the answer lists all nine.)

`GET /api/analytics/pauses` answers the same report under `pauses`, with the
period given as the usage read takes it (`from`, `to`, `utc_offset`), `project`
as `--project` takes it, and `space`, which narrows it to the runs with work a
planning space holds; the command has no option for a space. The Analytics
page's «Pauses» section draws it, narrowed to the space and project the page is
scoped to.

## `usage rebuild`

`usage rebuild --session ID [--agent ID] | --all [--dry-run] [--json]` reads a
session's usage run again from its transcript, the way the background reader
reads it, and replaces the run's segments in one transaction; `--agent` names a
subagent's or child thread's run instead.

Only a run still being read, whose transcript (or its archived copy) is there
and no shorter than what was read, is rebuilt: any other run is left as it is
and named with the reason, and without the liveness file beside the store
nothing is rebuilt, since its observed time would come back as estimated.

`--all` first takes a verified `usagerebuild` snapshot in `backups/` and copies
the liveness file beside it as `<snapshot>.liveness`; to restore, put the
snapshot back as [Restoring a snapshot](store-upgrades.md#restoring-a-snapshot)
describes and that copy beside the store as `<store>.liveness`. The snapshot
holds the store's writes off while it is taken, so on a large store hooks may
time out and spool: run `--all` while no agent session is working.

It prints each run's time, tokens and cost before and after, and each work
item's share of them where it moved; `--json` gives every item's. A rebuild
differs from what the reader made only where writes, permission requests, holds,
steps, labels or liveness arrived after the reader passed. `--dry-run` prints
the same and rebuilds nothing.

A rebuilt run is marked current, a run refused for any reason but a move
meanwhile keeps that reason until it is stale again, and a request another run
counts first is left to that run. A run that would give up a request it counted
is refused as `stranded` while a run that left that request to it can no longer
be read, so the request stays counted once. The background reader reads stale
runs again by itself under the same rules, so this command is for one run now or
for a report. Exits non-zero when anything was refused.
