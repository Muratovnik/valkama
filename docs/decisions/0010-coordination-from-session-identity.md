---
status: adopted
card: 1214
---

# ADR 0010: Valkama coordinates agent work from session identity, leases and two trees

## Context

Valkama exists so that one owner can see and steer the work of several coding
agents on one workstation: the volume of work by hierarchy with its history
and links; which agent is doing what right now, with a way into that live
session; the memory, comments and reports linked to a piece of work; owner
comments reaching the agent that works on it; agents working alone, handing
work over, messaging each other or running as an orchestrator with
executors; and, for every finished piece, a retrospective of active time,
calendar path, tokens, cost, problems and transcripts. Everything stays on
this workstation.

The previous model did not deliver the second of these at all, and the rest
depended on it. Observed state of the store before this decision:

- No lifecycle event named a work item, and the `executions` table was
  empty. The only link between a session and an item was a session ref an
  agent attached by hand, usually when the work was already done.
- One client's lifecycle hooks were lost in an incomplete migration and
  nothing reported the gap. Of 124 open claims, 10 named a session that
  could be confirmed; the rest looked held with nothing live behind them.
- The extension kernel (registry of Services, Adapters, Connections,
  Assignments, Grants, Actions and relations) had grown to about 11,500
  lines with no external adapter. Its one user-facing action, opening a
  memory reference, produced an `agentmemory://` URI that no handler on the
  workstation opens, behind a health probe that the memory service answers
  with 401.

Prototypes run before this decision (Claude Code 2.1.304, Codex Desktop
0.166, a standard-library echo MCP server):

- Claude Code: a `PreToolUse` hook that returns `updatedInput` delivers to the
  MCP server the same `session_id` the hooks see, and `agent_id` inside a
  subagent, in every permission mode tried and after `--continue` and
  `--resume`. The `CLAUDE_CODE_SESSION_ID` environment of the MCP process
  names the startup session after `--continue` and is not an identity.
- Codex: every `tools/call` carries `_meta.sessionId` (equal to the hooks'
  `session_id`) and `_meta.threadId` (the subagent's own thread inside a
  subagent); `updatedInput` works as in Claude Code.
- Neither client validates rewritten input against the tool's schema.
- Writing one event from a hook process costs about 155 ms (p50) through a
  light open of the current schema, most of it interpreter start and
  imports, against about 250 ms through the full store connection, whose
  integrity check alone costs about 67 ms and grows with the store.

## Decision

1. **Agents stay where they are; Valkama observes and coordinates.** Agents
   run in ordinary client sessions and report through the existing MCP
   tools and through client hooks. Valkama can also launch an agent for a
   work item with a session id assigned in advance, through Executions. It
   does not become the runtime that every agent must be started from.

2. **Session identity comes from the client, not from the agent.** A
   lifecycle event takes its session from the hook input. An MCP write takes
   it from the call: Codex `_meta.sessionId` and `_meta.threadId`; Claude
   Code an `_identity` argument added by a `PreToolUse` hook, which the
   server removes before schema validation and before the argument reaches
   any domain code. A write without verifiable identity is accepted and
   marked `unconfirmed`. The process environment of the MCP server and
   free-text author strings are not identity. This replaces the earlier
   invariant that provider hooks are observational feeds and never
   authoritative identity.

3. **A claim is a lease.** Claiming records the session that holds the item.
   The lease is `live` while that session's heartbeat (the last hook event)
   is recent, `stale` after the lease period, and `unconfirmed` when the claim
   was made without a confirmed session; claims recorded before this change
   become `unconfirmed` as they are, without rewriting history. A confirmed
   MCP write call also counts as that heartbeat, so a session that writes to
   Valkama stays live while its hooks are silent, and liveness follows the
   top-level session, never a subagent's own row. An expired
   lease is released with the reason `lease-expired`, recorded in the item's
   history like every other release.

4. **Two trees, linked at the moment of claiming.** The intent tree holds
   work items. The execution tree holds sessions, their subagents and turns;
   it is appended to and never edited, and the live state and the
   retrospective are computed from it. A claim or a delegation links a node
   of one tree to a node of the other by exact ids; the link is
   many-to-many, and an item created during a session records that session.
   A session's own working plan is a third, ephemeral layer and reaches the
   intent tree only by an explicit action.

5. **Hierarchy is open.** A persistent area (a project, a subproject) is a
   node type, and work nests to any depth below it; level names are labels,
   not a fixed epic/story scheme. Item numbers survive moves between areas,
   and earlier references keep resolving through aliases.

6. **Events are written without the server.** A `valkama hook` command
   writes a lifecycle event straight into the store through a light open of
   the current schema version. If the store is busy or its schema version
   differs, the event goes to a JSONL spool and the command exits
   successfully; the server ingests the spool. The full integrity check runs
   at migration, snapshot and restore, not on every open.

7. **Transcripts are archived locally.** A session's transcript is copied
   into Valkama's local storage when the session ends, kept while an open
   item refers to the session and for at least 90 days after it closes, and
   excluded from exports and publication artifacts. Transcripts can contain
   secrets and personal data; access and retention stay explicit.

8. **The extension kernel shrinks to the adapter contract.** What remains is
   the external adapter contract (manifest, health and invoke over HTTP, CLI
   or MCP, with a strictly validated short manifest) and a static list of
   modules in code. The registry and its tables are removed by one
   migration. The MCP tool `list_platform_modules` keeps its name and schema
   and answers from the static list.

9. **Owner comments reach a live session first through `Stop`.** A blocking
   `Stop` hook that returns the pending comment is the first delivery path,
   because it is guaranteed by both clients; client inboxes and queues are
   evaluated later.

## Consequences

- MCP tool names and input schemas do not change; new fields are optional.
  The server accepts and strips `_identity` before it validates arguments,
  which must land before any hook adds that argument.
- Identity and leases add columns and tables without changing the meaning of
  existing rows, so they do not raise the store schema version. Removing the
  registry does, and it goes through a verified backup, one forward migration
  and a tested restore.
- The component that installs client hooks gains a `PreToolUse` hook limited
  to Valkama's tools, synchronous lifecycle hooks and a blocking `Stop` hook.
  Hook trust stays with the client's own review; Valkama never writes trust
  state for the user.
- Codex `_meta` and Claude Code's `claudecode/toolUseId` in `_meta` are
  undocumented. The server treats them as inputs to verify, reports their
  absence in diagnostics, and falls back to hook identity with an
  `unconfirmed` mark.
- The product model's kernel vocabulary (Capability, Connection, Assignment
  and their resolution rules) and ADR 0009's split of modules, adapters,
  services and configuration are superseded for the registry when the
  registry is removed; the product model is updated in the same change.
- Rejected: making Valkama the only way to start agents (it breaks the
  owner's ordinary sessions); adopting an external tracker (none keeps
  atomic item and checklist claims, the item history and refs, and none
  solves session identity); keeping the registry (no external adapter uses
  it, and every read request wrote to the store through it).

## Order

The change lands in steps, each with its own acceptance: shrink the kernel
and fix the defects found on the way; make state truthful (identity on every
write, leases, hook writes without the server, transcript archive), accepted
on fourteen days of live data; open hierarchy with stable numbers; an
attention queue for the owner with comment delivery and links into live
sessions; collaboration (execution tree, ready queue, handoff). For the
retrospective, an existing local analyzer behind the adapter contract is
evaluated before anything is built.
