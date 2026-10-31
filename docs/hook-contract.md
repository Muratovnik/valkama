---
status: adopted
card: 1214
---

# The client hook contract

How a client hook reports a session to Valkama, and what Valkama keeps. It
replaces the [session event contract](session-event-contract.md), whose only
transport was an HTTP post to a running server: while the server was down,
every event was lost. The decision behind this is
[ADR 0010](decisions/0010-coordination-from-session-identity.md), points 2 and 6.

## The command

```
valkama hook <client> <event>
```

The client registers this command, through the managed launcher, for each
event below. The command reads the hook input as one JSON object on stdin. It
does not need `serve` or an MCP session to be running.

Two rules hold in every case, including malformed input, a missing or locked
store, and an internal error:

- **Exit status 0.** A hook never fails or blocks its client because of
  Valkama.
- **Nothing on stdout**, except the identity output of `claude pre-tool-use`.
  Claude Code adds `SessionStart` stdout to the model's context, and Codex reads
  stdout of `Stop` and `SubagentStop` as JSON, so a stray line there changes the
  session. Diagnostics go to stderr.

## Clients and events

| `<event>` | Client hook | Recorded `kind` | Claude Code | Codex |
| --- | --- | --- | --- | --- |
| `session-start` | `SessionStart` | `session_start` | yes | yes |
| `session-end` | `SessionEnd` | `session_end` | yes | yes |
| `subagent-start` | `SubagentStart` | `subagent_start` | yes | yes |
| `subagent-stop` | `SubagentStop` | `subagent_stop` | yes | yes |
| `stop` | `Stop` | `turn_end` | yes | yes |
| `user-prompt-submit` | `UserPromptSubmit` | `prompt` | yes | yes |
| `pre-compact` | `PreCompact` | `compact` | yes | yes |
| `notification` | `Notification` | `attention` | yes | no such hook |
| `pre-tool-use` | `PreToolUse` | nothing: the identity transform | yes | not needed |

An event a client does not have, an unknown client, or input whose
`hook_event_name` names a different hook than the command line is ignored, with
a line on stderr for a command-line mistake. Input without a `session_id` is
ignored: an event that names no session is not evidence of one.

## What is kept

Only these fields are read from the input. A string is kept after control
characters are removed and surrounding space is trimmed. A value longer than
its limit is treated as not reported, because a truncated id or path names
something else.

| Field | From | Limit |
| --- | --- | --- |
| `session_id` | every event; inside a subagent, the parent's | 128 |
| `agent_id`, `agent_type` | events inside a subagent, `SubagentStart`, `SubagentStop` | 128 |
| `turn_id` | Codex `turn_id`, Claude Code `prompt_id` | 128 |
| `permission_mode` | every event that carries it | 32 |
| `model` | every event that carries it | 128 |
| `cwd`, `transcript_path` | every event | 4096 |
| `source` | `SessionStart` only (`startup`, `resume`, `clear`, …) | 32 |
| `reason` | `SessionEnd` only | 64 |
| `agent_transcript_path` | `SubagentStop` only | 4096 |

Paths lose the Windows extended-length prefix: `\\?\C:\x` is kept as `C:\x`, and
`\\?\UNC\host\share` as `\\host\share`.

Nothing else is read. That rules out the user's prompt, tool arguments, the last
assistant message, notification text, and Codex turn metadata, which lists
workspaces and remote URLs. None of these reaches the store or the spool.

Each event also gets an `event_uid` (a random UUID) and `occurred_at` (UTC with
milliseconds, from the hook process's clock) once the hook has read its input.

## Where an event goes

### Directly into the store

The hook opens the store at the configured path (`VALKAMA_DB`, or `store` in
`~/.valkama/config.json`, or the default). It writes directly only when all of
these hold:

- the file exists, because a hook never creates a store;
- `PRAGMA user_version` equals the build's store schema version, because a hook
  never migrates a store;
- a write transaction starts within one second;
- the insert succeeds.

The write is one transaction: one row in `execution_events` and the session
rows the event belongs to (see below). The row has `identity_state =
'confirmed'`, `identity_source = 'hook'`, `delivery = 'direct'`, and the hook
name in `hook_event`. The write takes no migration lock and runs no integrity
check.

### Otherwise into the spool

If any condition fails, the event goes to the spool: `spool/` beside the store
file. Each hook process writes one file named
`<occurred_ns>-<event_uid>.jsonl`, through a temporary name and a rename, so a
reader never sees a partial file. Each line is the normalized event plus three
fields:

```json
{"v": 1, "event_uid": "…", "occurred_at": "2026-10-31T10:00:00.250Z",
 "client": "claude", "hook_event": "Stop", "kind": "turn_end",
 "session_id": "…", "cwd": "C:\\work", "…": "…",
 "spooled_at": "2026-10-31T10:00:01.300Z", "spool_reason": "busy"}
```

`spool_reason` is `missing`, `schema`, `busy` or `error`.

The hook creates only `spool/`, never the store's own directory. Whether that
directory exists is how the first full open decides that no store from an
earlier product name is waiting to be adopted. A hook that created it would
make that open start an empty store. Until the directory exists, an event that
cannot be written directly is lost, with a line on stderr.

### Draining the spool

Spool files are delivered in filename order, which is the order the events
happened, one transaction per file, with `delivery = 'spooled'` and
`spooled_at` from the line. A file is deleted only after its transaction
commits. Two callers drain the spool:

- every hook, after its own direct write, for at most 50 files or 300 ms;
- the start-up of an MCP server and of `serve`, which drains everything
  pending once, before the first request, and then releases the Planning
  leases that went stale. A failure there is reported on stderr and does not
  stop the process from starting.

Opening the store never drains it: a doctor, an export or a test that opens it
writes nothing.

Delivery is idempotent. `event_uid` is unique in `execution_events`, and an
event that is already there inserts nothing and changes no session. A drain
that commits and dies before deleting its file therefore replays as no-ops.

A file that cannot be read back is renamed to `*.rejected`, kept, and never
retried. This covers a line that is not JSON, an unknown `v`, an unknown key, a
value that is not a string (a list or an object included), or a value outside
the shapes above, and a file whose events fail to apply for any reason other
than the store itself. A file's content never stops a drain or the start-up
that runs it. A store at a different schema version leaves files pending until
a build at that version opens it.

## What an event does to a session

Every event updates the session it names in `sessions`, the table every session
reader uses, with the same lifecycle as events posted to `/api/ingest`:

| Kind | Session row |
| --- | --- |
| `session_start` | `active`; attention and end cleared; `client` set |
| `session_end` | `ended` with `ended_at`; a `failed` session stays `failed` |
| `turn_end` | attention `waiting`, only while active |
| `attention` | attention `blocked`, only while active |
| `prompt` | attention cleared, only while active |
| `compact` | heartbeat only |
| `subagent_start`, `subagent_stop` | the subagent's own row becomes `active` or `ended` |

A missing row is created, and `started_at` and `last_seen` are set to the event's
time.

**Order.** `last_seen` becomes the later of its current value and the event's
`occurred_at`, kept to the second. It is never set to the delivery time.
An event older than the row's `last_seen` changes no other column and no state,
so it is recorded as history only. Draining old events therefore cannot make an
ended session look live.

**Tool calls.** A confirmed Planning write call is a sign of life as well: it
moves `last_seen` of its top-level session forward the same way, to the time
the call arrived, and creates the row when it is missing. It changes no state,
so it cannot reopen an ended session. A claim's lease is read from this
column; see [Claims are leases](connection-contract.md#claims-are-leases).

**Subagents.** Inside a subagent, a client reports the parent's `session_id`
plus the subagent's `agent_id`. The parent row is updated first (heartbeat
only), then the subagent's own row, `<session_id>:<agent_id>`, with
`parent_session_id` and `agent_id` set. The event's transition applies to the
subagent row. `SubagentStop` ends that row and records the subagent's
transcript path. `session_start` and `session_end` always apply to the
top-level session.

## The identity transform

`valkama hook claude pre-tool-use` is a pure stdin-to-stdout transform for
Claude Code's `PreToolUse` hook on Valkama's MCP tools (`mcp__valkama__*`). It
never opens the store and never spools, because it runs on every Valkama tool
call. For an MCP tool call it prints:

```json
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "updatedInput": {
      "...": "the call's original arguments, unchanged",
      "_identity": {
        "session_id": "<session_id>",
        "tool_use_id": "<tool_use_id>",
        "agent_id": "<agent_id, inside a subagent>",
        "agent_type": "<agent_type, when reported>"
      }
    }
  }
}
```

`updatedInput` replaces the whole input, so it carries every original argument.
An `_identity` that the model wrote itself is replaced. The output has no
`permissionDecision`: changing the input does not need one, and `allow` would
skip a permission prompt the user configured.

The argument is meant for a server that removes `_identity` before it validates
arguments and checks `tool_use_id` against the call's own metadata. A server
that does not refuses the call with an unknown-argument error, so register this
hook only together with such a server.

The transform prints nothing for anything it cannot use: input that is not a
JSON object, a tool that is not an MCP tool, arguments that are not an object, or
a missing `session_id` or `tool_use_id`. The call then proceeds and is recorded
as unconfirmed.

Codex needs no transform. It sends the session and thread in the `_meta` of
every MCP call.

## The transcript archive

When a session ends, Valkama keeps its own copy of the session's transcript, so
the record survives the client deleting the original. The decision behind it is
ADR 0010, point 7. Transcripts hold whatever the session saw, including secrets
and personal data, so the copy stays on this machine and is kept only as long
as the retention rule below allows.

### What is copied

| Event | Copied | Archive file |
| --- | --- | --- |
| `session_end` | `transcript_path` | `<session>/main-<hash>.jsonl` |
| `subagent_stop` | `agent_transcript_path`, only when the client reports it | `<session>/agent-<agent>-<hash>.jsonl` |

The archive is `transcripts/` beside the store file, created owner-only where
the OS supports file modes. `<hash>` is the first 16 hex digits of the copy's
sha256. `<session>` and `<agent>` are the ids when they consist only of
`A-Z a-z 0-9 . _ -` and have at most 128 characters; any other id (`..`, a name
Windows reserves, a trailing dot) is replaced by the first 32 hex digits of its
sha256. Because names follow the content, archiving the same content again
reuses the file, and a resumed session that ends again with more content adds
a file.

The source path loses the Windows extended-length prefix before it is read,
like every path the hook keeps.

### How a copy is made

The source is streamed into a `*.partial` file in the destination directory
while it is hashed, flushed to disk, and then renamed to its final name. A
final name therefore always holds a complete copy. Then one row is appended to
`execution_events`:

| Column | Value |
| --- | --- |
| `kind` | `transcript_archived` |
| `identity_state`, `identity_source` | `confirmed`, `valkama` |
| `session_id`, `agent_id` | the session, and the agent for a subagent's copy |
| `transcript_path` | the source path |
| `archive_path` | the file, relative to `transcripts/`, with `/` separators |
| `archive_sha256` | the sha256 of the copy |

The content itself never enters the store, the spool, a log or `doctor`.

### In the hook, or later

The hook copies only after it has written the event directly, so a copy never
costs the event. It copies only when the source is at most 8 MiB and the copy
finishes within 1.2 seconds of the hook starting its delivery. Codex gives
`SessionEnd` about three seconds; that bound keeps the hook's worst case, with
its busy waits and drain, near 2.7 seconds.

Anything else stays **owed**: an end with no `transcript_archived` row for the
same session, agent and path after it. That covers a larger source, a slow
copy, a source the hook could not read, an event that went to the spool, and a
row the store would not take. The hook still exits 0 with nothing on stdout.

`transcripts.sweep(conn)`, run from a long-lived process, makes every owed copy
whatever its size. A source that no longer exists ends the debt with a
`transcript_archived` row whose `archive_path` is empty and whose `reason` is
`source-missing`. If the copy for that end is already in place because the
hook renamed it but could not append the row, and its content matches its name,
the sweep records that file instead. A source that cannot be read stays owed.
The start-up of `serve` and the MCP server runs the sweep after the spool drain
and the lease expiry. It starts no new step after two seconds, because a client
waits for the MCP server it launched; a copy already under way still finishes,
and what the sweep did not reach waits for the next start.

### Retention

A session's copies are kept while any work item that refers to the session is
not in a terminal state. After that they are kept for at least 90 days, counted
from the later of the session's `last_seen` and the newest terminal transition
of any item that refers to it. An item refers to a session when:

- it has a `session` ref whose value is the session id, a prefix of it, or
  `<session>:<agent>`;
- a Planning write call made in the session acted on it;
- its current claim was taken by a call made in the session.

The sweep removes a copy by appending a `transcript_purged` row (with
`archive_path`, `archive_sha256` and `reason` `retention`) and only then
deleting the file. The sweep deletes only two other kinds of file, once they
are more than ten minutes old: a copy whose newest row is its
`transcript_purged` (a crash came between the row and the delete), and an
abandoned `*.partial`. A copy that no row names at all is never deleted. A store
restored from a snapshot older than its archive, or another store in the same
directory, has no rows for files that may be the only copies left: the sweep
records such a file when an owed end matches its name and content, and
otherwise leaves it for `doctor` to report.

### What never leaves

The installation export reads neither the archive nor its rows, and lists
"transcript archive" among what it excludes. Store snapshots copy the database,
which holds paths and hashes, never the archive directory.

## What `doctor` shows

Under Installation → Store:

- **Hook spool**: pending files, with the oldest event time. This is a warning
  while any file waits.
- **Rejected hook events**: the number of `*.rejected` files, when there are any.
- **Spooled hook events**: rows delivered through the spool in the last 14 days.
- **Planning write identity**: Planning write calls in the last 14 days, counted
  by `identity_state` and `identity_source`.
- **Last hook event**: the latest hook event per client. This is a warning when
  no hook has written to this store.
- **Transcript archive**: copies kept and their total size, copies owed with the
  oldest owed end, files no row names, and recorded copies missing from disk.
  This is a warning when a file has no row, a recorded copy is missing, or a
  copy has been owed for more than a day.

## Not covered

- An event a hook process never got to write is lost. That happens when the
  client kills the hook before the spool file is renamed into place, when the
  store's directory does not exist yet, or when the spool cannot be written.
  Doctor's last event per client shows the gap.
- `client_version` stays empty: neither client reports its version in hook
  input.
- The HTTP `POST /api/ingest` path is unchanged and still accepts the four
  lifecycle events of the earlier contract.
