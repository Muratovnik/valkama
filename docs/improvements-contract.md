---
status: adopted
card: 217, 351
---

# Valkama Improvements contract

This document freezes the single canonical interface used by the backend and
web packets for the built-in Continuous Improvements module. The established
canonical evaluation payload is unchanged.

## Interfaces and module registry

- Module registry: `valkama-modules`.
- HTTP/read-model API: `improvements-api`.
- Sidecar schema family: `improvements-store`.
- Internal event family: `improvements-events`.
- Canonical evaluation payload: `improvements-eval`.

`GET /api/modules` returns the canonical persisted registrations:

```json
{
  "interface_version": "valkama-modules",
  "modules": [
    {
      "manifest": {"interface_version":"valkama-modules","module_id":"improvements"},
      "state":"enabled",
      "mutable":true,
      "revision":1,
      "updated_at":"ISO-8601"
    }
  ]
}
```

The manifest above is abbreviated; the validated response carries the complete
module manifest. Persisted server rows are the runtime authority, including
enablement and optimistic revision. A registration never contains a filesystem
import, package entry point, executable path, or remotely supplied browser code.

## Scope and storage

Every Improvements request names exactly one existing scope. The primary scope
is `personal`; attached scope ids come from `/api/scopes`. Unknown scope is a
404 before any file is created.

For a Planning Kanban database `<dir>/<stem>.sqlite3`, its sidecar is
`<dir>/<stem>.modules/improvements.sqlite3`. It is created only by an explicit
profile enable write. Disabled GETs must not create a directory, DB, WAL,
backup or migration. Each sidecar has its own additive migration and
pre-upgrade snapshot path.

An existing sidecar that predates source-kind ingress is upgraded in one
transaction after a verified SQLite backup is written. Existing signals are
preserved as `session_event` records, and rollback restores only a quiescent,
identity-matched snapshot. Migration and restore acquire the active-job runtime
lease without waiting and return `store_busy` while any runtime owns the scope;
the same operation may proceed after that lease is released by completion or
process exit. No migration is tested against the live Planning store.

Attached Planning Kanban databases remain read-only. Their Improvements
sidecars are writable, but approval creates a planning card only in the profile's explicit
`planning_board` in the primary Kanban DB. The planning card carries a stable
scope/case marker and no evidence excerpt or fingerprint.

## Profile

`GET /api/modules/improvements/profile?scope=<id>` returns:

```json
{
  "interface_version":"improvements-api",
  "scope":"personal",
  "revision":0,
  "enabled":false,
  "purpose":"",
  "expected_behavior":"",
  "allowed_targets":["instructions","skill","tool-contract","hook-lifecycle","validator-eval","documentation-process"],
  "excluded_targets":["product-code"],
  "analyzer_client":"codex",
  "analyzer_model":"",
  "reasoning_effort":"",
  "planning_board":"",
  "schedule":{"mode":"manual","interval_hours":24},
  "limits":{"lookback_days":30,"max_sessions":20,"max_chars":60000},
  "capabilities":{"can_analyze":false,"can_approve":false},
  "signal_summary":{"total":0,"source_counts":{"session_event":0,"agentmemory_lesson":0,"user_feedback":0},"session_count":0,"last_recorded_at":null}
}
```

`PUT /api/modules/improvements/profile` accepts the writable fields above plus
`scope` and `expected_revision`. `analyzer_client` is `codex|claude`;
`analyzer_model` is an optional bounded client model id, and
`reasoning_effort` is empty for the client default or one of
`low|medium|high|xhigh|max`. The two values are persisted with the profile and
passed as shell-free client arguments for every analysis job;
`schedule.mode` is `manual|scheduled`, and scheduled remains opt-in. Enabling
requires non-empty purpose, expected behavior and a primary planning board.

## Read models

Case state is one of `collecting`, `open`, `watching`, `snoozed`, `approved`,
`implementing`, `validating`, `resolved`, `effective`, `false_positive`,
`regressed`. Severity is `low|medium|high|critical`. Top category is one of the
six allowed targets.

Evidence is always:

```json
{"id":1,"source_kind":"session_event","pointer":"session:<id>/event:<id>","at":"ISO-8601","client":"codex","session_id":"...","event_type":"tool_end","severity":"medium","excerpt":"redacted <= 1200 chars","source_hash":"sha256 of the redacted excerpt"}
```

It never contains a full transcript, prompt, command, tool input/result or
model reasoning. A case summary contains `id`, `case_key`, `title`, `state`,
`severity`, `category`, `signal_count`, `session_count`, `first_seen`,
`last_seen`, `trend`, `planning_card_id`, and `updated_at`.

`GET /api/modules/improvements/cases?scope=<id>&state=<optional>&limit=<1..100>`
returns `{interface_version,scope,cases,signal_summary}`. `GET .../cases/<id>?scope=<id>` adds
`evidence`, `proposal`, `evaluation_pack`, `eval_runs`, `history`, and
`monitoring`.

Every Improvements GET envelope and the Improvements SSE read model includes
the top-level sanitized `signal_summary` shown in the profile example. It
contains no evidence excerpts, pointers, hashes, or private data.

## Sanitized signal ingress

There is exactly one write surface in each protocol:

- HTTP: `POST /api/modules/improvements/signals`;
- MCP: `record_improvement_signal`.

Both accept the same allowlisted object and no aliases:

```json
{"scope":"personal","signals":[{"source_kind":"agentmemory_lesson","pointer":"memory:lesson:<opaque-id>","category":"validator-eval","severity":"high","excerpt":"bounded evidence","at":"ISO-8601","client":"codex"}]}
```

The packet is at most 16KB and contains 1..100 signals. Required signal fields
are `source_kind`, `pointer`, `category`, `severity`, and `excerpt`; the only
optional fields are `at`, `client`, `event_type`, and `session_id`. Excerpts are
1..1200 characters. Categories use the fixed workflow-target enum and source
kind is `session_event|agentmemory_lesson|user_feedback`.

Unknown fields and private/raw trees are rejected before mutation, including
prompt, transcript, context, tool input/result, and source-id trees. The server
redacts the excerpt and hashes the redacted value. Idempotency is the
scope-bound `(pointer, source_hash)` pair, and the whole packet commits in one
sidecar transaction. Change publication occurs only after commit.

Session-event pointers are `session:<id>/event:<id>` and must reference that
exact event in a real session in the resolved scope. Lesson pointers are
`memory:lesson:<opaque-id>`; feedback pointers are `feedback:<opaque-id>` and
never contain feedback text. Lessons and feedback cannot claim `session_id`,
never create a synthetic session, and do not contribute to session promotion
thresholds. AgentMemory retrieval happens outside Planning; a retrieval failure
therefore makes no Planning call and cannot create or mutate the sidecar.

## Jobs and analysis

`POST /api/modules/improvements/analyze` accepts
`{"scope":"personal","trigger":"manual"}` and returns a job. Trigger is
`manual|scheduled`; the scheduled value is accepted only for an enabled
scheduled profile. One queued/running analyzer job per scope is enforced.

A job contains `id`, `scope`, `kind` (`analysis|eval`), `state`
(`queued|running|succeeded|failed|cancelled`), `client`, `created_at`,
`started_at`, `finished_at`, `error_code`, and `result_summary`. Jobs emit
 normalized session lifecycle events, appear in the Improvements Jobs panel,
 and are reflected in Sessions. A restart marks an
orphan running job failed with `error_code=platform_restarted`; queued jobs remain
eligible.

`POST /api/modules/improvements/jobs/<id>/cancel` with `{"scope":"personal"}`
and the additive `improvements_cancel_job` MCP tool cancel only a queued or
running job in that scope. Process-tree termination and the authoritative
sidecar transition precede temporary-file cleanup.

Analysis is strictly per-scope. Deterministic normalization/fingerprinting runs
before CLI summarization and semantic clustering. Promotion requires, within
30 days: at least 3 signals, 2 sessions, severity weight >=8, last signal <=14
days, and no active duplicate/planning card. Weights are low=1, medium=2,
high=4, critical=8.

Every analyzer case carries a bounded workflow proposal and canonical
EvaluationPack. Storage resolves the semantic case and applies its signals,
proposal, pack, result ledger, and successful job transition in one idempotent
transaction. Product-code targets and private prompt/tool payload fields are
rejected before persistence.

Analyzer candidates prioritize the already-sanitized signals persisted by the
public ingress, including feedback and lessons, before bounded primary session
events. Sidecar candidate ids are negative and therefore disjoint from primary
session-event ids. A session pointer already present in the sidecar is not
selected again from the primary journal. Persisted category and source-kind
provenance are fixed inputs to clustering; non-session signals never consume or
inflate the profile's session bound. Applying analysis to a persisted signal
updates its existing case with the proposal and EvaluationPack without inserting
the evidence again.

Every active scope's supervisor holds an OS-backed runtime lease for the full
job lifetime. Recovery skips a scope while another live process holds that
lease; the operating system releases it on process death, after which recovery
may honestly mark an orphan running job failed and resume queued recipes. A
runtime-local reference count safely shares one scope lease across its jobs.

## Case actions and Planning

`POST /api/modules/improvements/cases/<id>/actions` accepts:

```json
{"scope":"personal","action":"approve","reason":"optional","target_case_id":null,"signal_ids":[],"snooze_until":null,"expected_revision":3}
```

Actions are `merge|split|false_positive|snooze|watch|approve|reopen`.
`merge` requires `target_case_id`; `split` requires non-empty `signal_ids`;
false-positive/snooze require a reason, and snooze requires an ISO timestamp.

Approve is idempotent and returns:

```json
{"interface_version":"improvements-api","case":{},"created":true,"epic_card_id":1,"todo_card_id":2,"launched":false}
```

Planning identities use exact immutable source markers, never titles:

- epic: `improvement://planning/<board-hash>/epic`;
- work card: `improvement://<scope>/<case_key>`.

The Planning service performs ensure-by-source under `BEGIN IMMEDIATE` and a
partial unique index for `improvement://` sources. A crash between the primary
DB and sidecar is reconciled by repeating ensure-by-source; approval never
calls the launch API.

## Evaluation and transition guard

`POST /api/modules/improvements/eval-runs` accepts
`{scope,case_id,phase,repo,git_ref}` where phase is `baseline|candidate`; the
case's versioned EvaluationPack owns scenarios/assertions. Baseline and
candidate run the same pack in disposable detached worktrees. Deterministic
assertions run first; an optional CLI judge runs only for non-deterministic
assertions. The result records immutable ref/patch hash, assertion results,
safety regressions and job id.

At queue time the job snapshots the pack revision, semantic version and
canonical SHA-256. Storage and the disposable runner both use the
`improvements-eval` serializer; a result is rejected if any snapshot field
differs. The durable result recomputes `passed`, safety/guard regressions and
baseline reproduction from bounded assertion facts. Raw command output and
exception text are accepted only as transient bounded runner input and are not
persisted. Eval insertion and the job's terminal transition are one idempotent
sidecar transaction keyed by the normalized result hash.

For a Planning card with an `improvement://` source, the existing transition
choke point adds guard `improvement_eval`:

- medium/high Done requires a reproduced baseline failure, every required
  candidate assertion passing, no safety/guard regression and a linked eval
  run;
- low Done accepts the same eval or monitoring started plus an explicit closing
  summary;
- `force=true` retains existing behavior and records `overridden`.

Monitoring observes 10 comparable sessions or 30 days. Effective means
recurrence falls by at least 50% with no high/critical repeat. One critical or
two matches within 7 days yields regressed.

## Events, SSE and errors

Internal events are named `module.improvements.<entity>.<action>` and carry
`improvements-events`, scope and entity id. They are published only after a
successful transaction. Existing `/api/events?view=improvements&scope=<id>`
pushes the complete current `{interface_version,scope,profile,jobs,cases}` read
model plus `signal_summary`; clients close the EventSource when leaving the module.

Errors use `{interface_version,error:{code,message,guard?}}`; unknown scope is
404, stale revision/conflicting job is 409, validation or transition refusal is
422, and malformed analyzer output fails its job without mutating cases.
