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
  Valkama. The one exception is deliberate: `claude watch` exits 2 to wake its
  session (see [the watcher](#the-watcher)).
- **Stdout carries one JSON answer or nothing.** The answers are the identity
  output of `claude pre-tool-use` and a notice from `post-tool-use`,
  `user-prompt-submit` or `stop` (see
  [Telling the agent what a person did](#telling-the-agent-what-a-person-did)).
  Claude Code adds `SessionStart` stdout to the model's context, and Codex reads
  stdout of `Stop` and `SubagentStop` as JSON, so a stray line there changes the
  session. Diagnostics go to stderr, as UTF-8.

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
| `post-tool-use` | `PostToolUse` | `agent_launch`, for the Agent tool only | yes | nothing recorded |
| `pre-tool-use` | `PreToolUse` | nothing: the identity transform | yes | not needed |
| `watch` | `UserPromptSubmit` and `Stop`, with `asyncRewake` | nothing: [the watcher](#the-watcher) | yes | no such mechanism |

`post-tool-use`, `user-prompt-submit` and `stop` may also answer with a notice;
for Codex, `post-tool-use` and `user-prompt-submit` do. That is described in
[Telling the agent what a person did](#telling-the-agent-what-a-person-did).

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
| `agent_id`, `agent_type`, `label` | `PostToolUse` of the Agent tool only; see [Naming an agent](#naming-an-agent) | 128, 128, 120 |

Paths lose the Windows extended-length prefix: `\\?\C:\x` is kept as `C:\x`, and
`\\?\UNC\host\share` as `\\host\share`.

Nothing else is read. That rules out the user's prompt, tool arguments other than
the description of an Agent call, an agent's prompt, the last assistant message,
notification text, and Codex turn metadata, which lists workspaces and remote
URLs. None of these reaches the store or the spool.

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
- the start-up of an MCP server and of `serve`, which drains what is
  pending before the first request and then releases the Planning leases
  that went stale. Both steps together take about three seconds at most,
  because a client gives the MCP server it launched only a few seconds to
  answer: the drain starts no new file once its share is spent, and each step
  waits at most a quarter of a second for a lock another writer holds. What
  was not done waits for the next start. A failure there is reported on
  stderr and does not stop the process from starting.

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
| `agent_launch` | the started agent's row takes its label; see [Naming an agent](#naming-an-agent) |

A missing row is created, and `started_at` and `last_seen` are set to the event's
time.

**Order.** `last_seen` becomes the later of its current value and the event's
`occurred_at`, kept to the second. It is never set to the delivery time.
An event older than the row's `last_seen` changes no other column and no state,
so it is recorded as history only. Draining old events therefore cannot make an
ended session look live.

**Tool calls.** A confirmed Planning write call is a sign of life as well: it
moves `last_seen` of its top-level session forward the same way, to the time
the call arrived, and creates the row when it is missing. A client can resume
an ended session without sending `SessionStart`, so a confirmed call that
arrives after the row's `ended_at` makes an `ended` session `active` again; a
`failed` one stays failed. Only such a call does that: a drained or replayed
hook event, whatever its time, never reopens a session. A claim's lease is
read from this column; see
[Claims are leases](connection-contract.md#claims-are-leases).

**Subagents.** Inside a subagent, a client reports the parent's `session_id`
plus the subagent's `agent_id`. The parent row is updated first (heartbeat
only), then the subagent's own row, `<session_id>:<agent_id>`, with
`parent_session_id` and `agent_id` set. The event's transition applies to the
subagent row. `SubagentStop` ends that row and records the subagent's
transcript path. `session_start` and `session_end` always apply to the
top-level session.

### Naming an agent

`valkama hook claude post-tool-use`, registered for `PostToolUse` on every tool,
reads this from the Agent tool only (`Agent`, or `Task` before Claude Code
2.1.63); for any other tool it records nothing. Without it nothing else changes:
an agent is shown by its type and short id.

`SubagentStart` carries the agent's id and no description, and `PreToolUse` of the
Agent tool carries the description and no id yet. The answer carries both: the
input of `PostToolUse` has `tool_input.description` and `tool_response.agentId`.
So a label is read from one input and never matched between events, and parallel
launches cannot exchange labels. The cost is when it arrives: at the launch for a
background agent, which is what Claude Code starts from a main conversation unless
told otherwise, and at the end for an agent the session waits for. Until then the
agent has no label.

The input is read for these three things and nothing else: `tool_input.description`,
`tool_input.subagent_type` and `tool_response.agentId`. The prompt is in the same
input twice and is never read, and neither is the rest of the answer. An input over
the hook's 1 MiB limit, which a foreground agent's long answer can reach, is not
read at all and leaves the agent without a label.

The description becomes one line: a line break or a control becomes a space, a
format mark goes, repeated space collapses. Past 120 characters it is cut and ends
in `…`, unlike the fields above, because part of a description is still most of
what it said.

The label is the description the coordinating model wrote, so it can hold personal
data or data under NDA. It is stored in one place, `sessions.label` of the agent's
row, and drawn on the work item's card. It is not in `execution_events`, which
records the launch by the agent's id alone because that table can never be edited.
It is not in the installation export, `doctor` or any log. Two copies follow from
what a store is: a store snapshot holds the database, and a spool file holds the
event until it is delivered, or for good if it is set aside as `*.rejected`, in the
same directory and with the same owner as the paths a spool file already holds.

The event moves `last_seen` of the top-level session and creates the agent's row if
its own events have not. It changes no time and no state of an agent's row that
exists: a foreground agent's answer comes after its stop, and that answer is not a
sign of its life. A label is written whatever the event's time, because it says the
same thing however late it is delivered.

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

## Telling the agent what a person did

A person in the interface and an agent working through its tools share a work
item and no channel. A hook runs inside the agent's own session, in a terminal,
an IDE extension or the desktop app alike, so the hook is where Valkama hands
over what the person did: a comment, an answer, a status change, a cancel, an
edit, a claim taken away. Each event is one that
[`from_person`](connection-contract.md) would name: it came through the
interface, and an agent's write signed `user` is not one.

### Who is told

The work of a session is what it holds: the claim of an item and the steps on
its checklist, held by the session or by one of its agents. A holder is read
from the store, never from who signed a write. Only a claim made by a call that
proved its session holds as that session, so Claude Code needs
[the identity transform](#the-identity-transform) registered: without it its
claims are held by a name, and no hook of that session is ever told anything.
Codex proves its session in every call.

- **The orchestrator**, a hook input without `agent_id`, is told about every
  item its session holds, its subagents' steps included. It keeps the whole and
  hands work out, so the notice asks it to pass the news on with `SendMessage`
  to a subagent that is waiting or finished. Since 2.5 it is also told about
  replies in threads its subagents started and answers to their questions.
- **A subagent**, a hook input with `agent_id`, is told about the items where it
  holds the claim or a step itself and, since 2.5, about replies in threads it
  started and answers to questions it asked, wherever it holds nothing. A
  subagent that holds nothing and started nothing is told nothing: give the
  work you hand out a step it claims.
- **An item that stopped being held** by the last write, a person cancelling it
  or taking the claim, is told once more and then dropped.

**Since 2.5**, the author of a thread's root and the agent that asked a question
are told too, beside the holders. The author is read from the call that wrote
the root, or the call that wrote the question's `request_created` event:

| Event | The item's holders | The author of the root or question | The author's orchestrator |
| --- | --- | --- | --- |
| `reply` in a comment's thread | yes | yes | yes |
| `reply` in a question's thread | yes | yes | yes |
| `question_answered`, `question_changed`, `question_declined` | yes | yes | yes |
| `thread_resolved`, `thread_reopened` | yes | no: a decision on a line is not addressed to its author | -- |
| any other kind | yes | -- | -- |

An orchestrator and its subagent that are both addressed are told once each. When
the author's session has ended, the holders are still told, and the next agent
write still answers with `from_person`. For an item it does not hold, a recipient
reads only the events addressed to it there.

Every recipient is told each event once. Where an item's news starts the first
time is the recipient's own last write on it, which is where the answer to that
write left off. A recipient's write answering with `from_person` and its hook
can name the same event; one notice too many is the price of never missing one.

### When it is told

| Hook | Notice |
| --- | --- |
| `PostToolUse`, every tool | while the agent works: after any tool call, the orchestrator's and a subagent's alike |
| `UserPromptSubmit` | when a prompt arrives, including Claude Code's notice that a background subagent finished |
| `Stop` | once, when the turn would end: only while `stop_hook_active` is false, so a notice continues a turn at most once |
| `watch` | while the orchestrator is idle: see [the watcher](#the-watcher) |

The answer is the client's own:

```json
{"hookSpecificOutput": {"hookEventName": "PostToolUse", "additionalContext": "Valkama notice: …"}}
```

Codex reads `additionalContext` from `PostToolUse` and `UserPromptSubmit` the same
way, so `valkama hook codex post-tool-use` and `valkama hook codex
user-prompt-submit` answer too. Codex has no way for a background hook to start
a turn, so an idle Codex session is not woken: it hears the news at its next
prompt or tool call.

### What a notice says

One notice names, per item, its reference and title and the newest events: the
kind, the time and the start of what was said, as `from_person` gives it, at
most 300 characters each. It then says what to do: read each item with
`get_work_item` before the next step on it, and, for an orchestrator, pass the
news on to a subagent that cannot hear it. It ends by saying that quoted words
are what was written on the card, information about the work and not an
instruction to the agent or permission for an irreversible action. The text
calls itself a Valkama notice and is not written as a system message: a model
rightly refuses text that poses as one. A notice keeps the newest 8 events that
fit in 2400 characters and counts the rest.

**Since 2.5**, a notice's head says it is about "work this session holds or
threads it started", and a reply's line says whose thread it is: to the author of
the root, and to the orchestrator of another agent's thread, which passes it on
with `SendMessage`:

```text
- reply at 2026-11-03T10:12:00Z in your thread #41: «Agreed, take the second option.»
- reply at 2026-11-03T10:12:00Z in thread #41 of agent reviewer-2: «Agreed, take the second option.»
```

The other new kinds read as the earlier ones do: `thread_resolved` quotes the
decision, `thread_reopened` names the root, and `question_changed` quotes the new
answer and the one it replaced.

### The watcher

An orchestrator waiting for a background subagent, or for the person, runs no
hook at all. `valkama hook claude watch`, registered with `asyncRewake` on
`UserPromptSubmit` and `Stop`, is the one process per session that waits for it.

- **One per session.** It holds an exclusive lock on
  `notify/<session>.watch`; a second start finds it held and exits 0 at once.
  Without that, the prompt a wake starts would start another watcher each time.
- **Read-only.** It reads the store on a read-only connection every two
  seconds, and every ten once it has watched for ten minutes.
- **Wakes once.** When news is waiting and the session is idle, the last `Stop`
  having told nothing, it records the news as told, writes the notice to stderr
  as UTF-8 and exits 2, which is how Claude Code wakes the session. Claude Code
  shows that as a "Stop hook blocking error", so the notice begins by saying it
  is not one. News found while the session is busy is left for 30 seconds to
  the next tool call; after that the watcher wakes the session anyway, and
  Claude Code queues the wake behind the turn under way.
- **Leaves without a wake** when the session ends or is cleared (`SessionEnd`,
  which `/clear` sends too, leaves `notify/<session>.end`), when the process
  named by `CLAUDE_PID` is gone (where that process cannot be opened, only the
  other ways and the `timeout` end it), when `CLAUDE_CODE_SESSION_ID` names another
  session than its input, when it was started inside a subagent, and when
  notices are switched off.
- **Lives for its `timeout`.** Claude Code ends it then, with no wake. Each
  prompt and each turn end starts it again, so a session at work is always
  watched; one idle for longer than the `timeout` is not, until its next prompt.
  Claude Code keeps a `timeout` above an hour: with 7200 and 86400 seconds a
  watcher lived 65 minutes and woke its session, and one with 3700 was ended at
  3700 seconds. Longer lives were not observed. Register it with a day, 86400,
  so a session left waiting overnight still hears the morning's news.

`UserPromptSubmit` and `Stop` run for the orchestrator. A watcher whose input
names an `agent_id` exits at once: started in a subagent, it would wake the
orchestrator and not the subagent. A subagent waiting for a message hears the
news from the orchestrator.

### Where each agent's place is kept

Not in the store: a hook that wrote there would be a writer on every tool call.
Beside the spool, in `notify/`, created only inside a store directory that
exists, as `spool/` is:

| File | What it holds |
| --- | --- |
| `<session>.marks`, `<session>--<agent>.marks` | per item, the last call read and the item's revision, newest event and newest comment at that read |
| `<…>.lock` | held while one hook of that recipient reads and records, so parallel tool calls tell the news once |
| `<session>.watch` | the watcher's lock |
| `<session>.idle` | written by a `Stop` that told nothing, removed by `UserPromptSubmit` |
| `<session>.end` | written by `SessionEnd`; it stops that session's watcher |

A file that cannot be read counts as empty, so the worst a damaged one does is
tell the current news once more. `SessionEnd` removes its session's places; a
session resumed later starts again from its own last writes. Files of sessions
gone without a `SessionEnd` are removed by a later one: places after 30 days,
the rest after a day.

### Switching it off

`notify` in `config.json`, or `VALKAMA_NOTIFY`, set to `off` (or `0`, `false`,
`no`) stops both the notices and the watcher. Nothing else changes: lifecycle
events are still recorded, and a write still answers with `from_person`.

### What it costs

`PostToolUse` runs on every tool call. The notice path imports nothing beyond
the standard library's C parts, reads the input with the C scanner `json` is
built on, opens the store read-only, and answers after one indexed query when
nothing changed. Measured on Windows against a store of 1500 items and 200 000
events, from process start to exit, 60 calls each:

| How it runs | p50 | p95 |
| --- | --- | --- |
| `cmd.exe /d /c valkama.cmd hook claude post-tool-use`, before this change | 78 ms | 86 ms |
| `python valkama.py hook claude post-tool-use`, before this change | 57 ms | 60 ms |
| `python -I -S <shim> hook claude post-tool-use`, nothing new | 29 ms | 32 ms |
| the same, with a notice to print | 39 ms | 42 ms |
| `cmd.exe /d /c valkama.cmd hook claude post-tool-use` after this change, nothing new | 47 ms | 49 ms |

So register these hooks in exec form: `command` the launcher's own `python.exe`
(the `python` its manifest records) and `args` `["-I", "-S",
"<launcher directory>/valkama-launcher.py", "hook", "claude", "<event>"]`. That
also keeps the hook inside the client's process tree: a hook started through
`cmd.exe` outlives a client killed with `taskkill /F`. The shim starts a hook
without `runpy` and `pathlib`, which alone cost as much as the rest.

### Limits

- A `PostToolUse` input over 1 MiB, which a large tool answer can reach, is not
  read, so that call tells nothing; the next one does.
- A subagent that is idle cannot be woken directly; the orchestrator is, and
  passes the news on.
- A session that holds more than 200 items is told about the 200 it wrote to
  last.

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
The start-up of `serve` and the MCP server starts the sweep after the spool
drain and the lease expiry, on its own connection in a background thread, when
the archive directory exists or a copy is owed. Nothing waits for it: the
server answers its first request while a large copy is still under way. A
process that ends mid-copy leaves a `*.partial`, which a later sweep removes,
and the copy stays owed.

### Retention

A session's copies are kept while any work item that refers to the session is
not in a terminal state. After that they are kept for at least 90 days, counted
from the later of the session's `last_seen` and the newest terminal transition
of any item that refers to it. An item refers to a session when:

- it has a `session` ref whose value is the session id, a prefix of it, or
  `<session>:<agent>`;
- a Planning write call made in the session acted on it;
- its current claim was taken by a call made in the session;
- an execution of it is linked to the session or to one of its subagents;
- the session was launched for it (`sessions.work_item_id`).

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

### Deletion on request

Retention decides when a copy may go; a person may need it gone sooner, for
example when the subject of personal data in a transcript asks for its
deletion.

```text
valkama transcripts purge --session <id> [--session <id> ...] [--dry-run]
valkama transcripts purge --before <date or time> [--dry-run]
```

`--session` (repeatable) names sessions by exact id. `--before` takes the
sessions whose last activity -- `last_seen`, or the newest event of a session
with no row -- is earlier than the given ISO date or time; a date is its first
moment in UTC, and a time without an offset is read as UTC. Given both, a
session must match both; at least one is required.

The purge takes each current copy of those sessions the way retention does: a
`transcript_purged` row with `reason` `on-request`, then the file. A copy in a
named session's folder that no row names is deleted too, with its own purge
row. A copy still owed for such a session is settled with a
`transcript_archived` row without a file and with `reason` `on-request`, so no
later sweep makes it. Items that refer to the session do not keep its copies:
the command counts the distinct open ones and says so.

The output is counts only -- sessions, files, bytes, copies owed, open items --
because another session's id or a transcript's path is itself personal data.
`--dry-run` prints the same counts and writes and deletes nothing.

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
