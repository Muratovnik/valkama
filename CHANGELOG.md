# Changelog

Notable changes to Valkama. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

The MCP server reports itself as `<release>+<build>`, where the build is a digest
over the modules the running process started with. Two servers from different
checkouts are therefore distinguishable even at the same version.

## [Unreleased]

### Added

- `valkama hook <client> <event>`, the command Claude Code and Codex hooks run.
  It records a session lifecycle event from stdin straight into the store, with
  no `serve` or MCP session running. It covers session start and end, subagent
  start and stop, turn end, prompt submission, compaction and, for Claude Code,
  notifications. The event becomes one `execution_events` row, confirmed with
  source `hook`, and updates the session rows that every session reader uses.
  A subagent gets its own row, `<session>:<agent>`, under its parent.
  - The write is a light open of a store that already exists at the current
    schema. A busy, missing or other-version store, or a failed insert, sends
    the event to `spool/` beside the store instead. A hook never creates the
    store's own directory, because its existence is what stops the first open
    from adopting a store written under an earlier product name. Spool files are delivered
    later by the next successful hook write, or by `housekeeping.drain_spool`.
    Delivery is idempotent on the event's uid. An event older than what the
    store already knows is kept as history and changes no session, so a late
    drain cannot revive an ended session.
  - The command always exits 0 and prints nothing, whatever its input. It keeps
    an allowlist of fields and never the prompt, tool arguments, assistant text
    or Codex turn metadata.
  - `valkama hook claude pre-tool-use` prints the `PreToolUse` output that adds
    `_identity` (session, tool use, and agent inside a subagent) to a Valkama
    tool call. It does not open the store, and it makes no permission decision.
  - `doctor` reports spool files still waiting, with the oldest event time;
    rejected spool files; events delivered through the spool in the last 14
    days; Planning writes in the last 14 days by identity state and source; and
    the last hook event per client.

  The contract is in `docs/hook-contract.md`, which replaces the superseded
  session event contract. `POST /api/ingest` is unchanged.
- A local transcript archive. When a session ends, `valkama hook` copies its
  transcript, and a subagent's own transcript when the client reports one, into
  `transcripts/` beside the store. The copy survives the client deleting the
  original.
  - Each copy is written through a `*.partial` file and renamed to a name made
    from the session, the agent and the content's sha256. A
    `transcript_archived` row in `execution_events` records the source path,
    the archive path and the sha256. The content never enters the store.
  - In the hook, a copy is made only for a source of at most 8 MiB that copies
    within 1.2 seconds, which keeps the hook inside Codex's three-second
    `SessionEnd` budget. Anything else stays owed. `transcripts.sweep` makes
    owed copies, records a source that no longer exists, and purges copies by
    the retention rule. The start-up of an MCP server or `serve` runs it after
    the spool drain and the lease expiry, starting no new step after two
    seconds.
  - Retention: copies are kept while a non-terminal work item refers to the
    session, and for at least 90 days after the later of the session's last
    activity and the newest terminal transition of a referring item. A purge
    appends `transcript_purged` before it deletes the file, and the next sweep
    removes a file a crash left behind.
  - The export lists "transcript archive" among what it excludes and never
    reads it. `doctor` reports copies kept and their size, copies owed, files
    no row names and recorded copies missing from disk.
- The store gains what session identity and claim leases need, still at schema
  9. A new append-only table `execution_events` records the execution tree:
  client lifecycle events and every Planning write call with the identity it
  carried. Its triggers refuse UPDATE and DELETE.
  - `work_item_events`, `work_item_comments` and `work_item_refs` gain a
    `call_id` link to the call that wrote them.
  - `work_items` gains `claim_call_id`, the call that took the current claim.
  - `sessions` gains `parent_session_id`, `agent_id`, `transcript_path` and
    `client_version`.

  The first open of an existing store by this build takes a verified snapshot
  labelled `preidentity` and adds these columns once. Every existing row keeps
  its values, and its new link is empty, which reads as "not confirmed".
  The step itself writes nothing into them, and the MCP tools are unchanged.
  An earlier schema-9 build still opens the store and writes to it. A
  `claim_ref` write that does not name its call, which is how such a build
  claims, clears the claim's link.
- Every Planning write call records who made it. Each MCP tool call and each
  browser write that changes Planning adds one `planning_write` row to
  `execution_events`, inside the call's own transaction, and every event,
  comment and ref the call writes points to it. A refused call leaves no row.
  The row is `confirmed` when the client proved the session: Codex through
  `_meta.sessionId`, Claude Code through an `_identity` argument whose
  `tool_use_id` matches `_meta["claudecode/toolUseId"]`, the browser through
  its session credential. Anything else is accepted and recorded as
  `unconfirmed`. The `author` text and the server's environment are never
  identity. See `docs/connection-contract.md#call-identity`.
  - Every tool accepts and removes an `_identity` argument before checking its
    schema, so a `PreToolUse` hook that adds one breaks no call. A malformed
    one is dropped, never refused. `tools/list` is unchanged.
  - History events in `get_work_item`, a `verbose` write and the HTTP item
    read carry `identity`: `state`, `source`, `session_id` and `agent_id`. An
    event recorded before this reads as `unconfirmed` with the rest `null`.
    The web reads records strictly, so a `web/dist` built before this change
    refuses every item; serve the one built with it.
  - A write made by the execution runner outside any call records no call row
    and reads as `unconfirmed`.
- A claim is a lease held by the session that took it. Its state, `live`,
  `stale` or `unconfirmed`, is computed at every read: `unconfirmed` when no
  confirmed session took it, `stale` when that session ended, failed, has no
  row or showed no sign of life for 14 days, otherwise `live`. See
  `docs/connection-contract.md#claims-are-leases`.
  - `get_work_item`, a `verbose` write and the HTTP item read carry `claim`:
    `holder`, `state`, `session_id`, `agent_id`, `source`, `acquired_at`,
    `last_seen` and `expires_at`, or `null`. Every item record, the compact
    list and search rows and the short write acknowledgements carry
    `claim_state`. `claim_ref` and `ready` keep their meaning, and `tools/list`
    is unchanged. The web reads records strictly, so a `web/dist` built before
    this change refuses every item; serve the one built with it.
  - A confirmed write call counts as a sign of life of its top-level session,
    so a session whose hooks are silent stays live while it writes.
  - A stale lease is released by the first write that meets it:
    `claim_work_item` on that item, `claim_ready_work_item` in its space, and
    the start-up of an MCP server or `serve`, which now also drains the hook
    spool. The release is a `released` event with the detail
    `lease-expired: <holder>`, written by `valkama` under its own call row
    (source `valkama`, tool `lease-expiry`). Taking a stale claim over needs no
    `force`.
  - The board marks a stale claim on its tile, and the inspector shows the
    lease and its expiry. The owner takes a stale claim over without being
    asked to confirm a takeover; the owner's own claim shows no lease.
  - `doctor`'s hook and identity findings have their texts in the web's
    Settings, in English and Russian.

### Changed

- Two sessions that sign with the same `author` no longer release or take
  over each other's claim. A confirmed session holds its claim whatever author
  it signs with, and any other caller needs `force` against a live lease. A
  claim without a confirmed session is still compared by author.
- The space's abandoned claims (`stale_claims`) follow the lease: a stale lease
  is listed at once and a live one never, whatever its quiet. The three-day
  quiet rule stays for unconfirmed claims, except the owner's own claim made
  in the browser; a claim a launch took for its runner is still listed.
  Each entry carries `claim_state`.
- Starting an item under an unconfirmed or stale claim answers with a warning.
  The claim still counts as the executor, and a claim taken in the browser
  gets no warning.

- **Breaking for every running client: store schema 9.** The first open by this
  build takes a verified snapshot labelled `preschema9` beside the store, then
  drops the extension registry's tables, `platform_modules` with
  `platform_registry_audit`, and `integration_settings`; every other row is kept
  as it was. A store older than schema 8 goes through the same historical
  migrations as before, under its `preproductmodel` snapshot, and ends at 9. A
  build at schema 8 refuses the upgraded store with `StoreTooNewError` and
  leaves the store file unchanged, so restart every agent client after pinning
  this release with `launcher install`. Going back to a schema-8 build is described in the README under
  "Migrating an older store".
  A fresh store is created at 9 without those tables, and a store stamped 9 that
  still holds one of them is refused.
- **Breaking for `export`:** an export carries only the `planning` section. The
  `relations` section (the registry's adapter links) and the `settings` section
  (the integration switches) went with their tables; `--section relations` and
  `--section settings` are refused as unknown.
- A store that is already current opens without the full `PRAGMA
  integrity_check`. The check still runs whenever an open migrates the store,
  and on every snapshot and restore.
- **Breaking for MCP clients:** the work-item write tools (`create_work_item`,
  `update_work_item`, `transition_work_item`, `claim_work_item`,
  `set_work_item_checklist`, `claim_work_item_checklist_item`,
  `tick_work_item_checklist_item`, `set_work_item_summary`) answer with a short
  acknowledgement (reference, revision, state, holder and what the call changed)
  instead of the whole item. Pass `verbose: true` for the full item. Every MCP
  tool result is now serialized on one line without indentation. The HTTP API
  and the read tools are unchanged.
- **Breaking for MCP clients:** `list_work_items` and `search_work_items` answer
  one compact row per item and, without a `limit`, at most 50 rows, with a
  `truncated` flag. Pass `verbose: true` for the full items as before. Planning
  tools now refuse an argument their schema does not have, and a missing required
  one, naming the tool and the arguments it takes. They also read the spellings
  agents tend to reach for when a schema is out of view (`reference` for `id`,
  `to` for `state`, `planning_space_id` for `space`, and the few others listed in
  the connection contract); the published schemas are unchanged apart from the
  optional `verbose`.
- Focus the workspace on projects, work items, claims, blockers, execution,
  results, and review. Navigation contains Work and Settings; board, list, and
  graph share the Planning read model. Memory refs and exact session context
  remain inside work-item context.
- Keep session lifecycle ingestion in Planning, accepting `session_start`,
  `session_end`, `attention`, and `turn_end`. `/api/session` resolves compact
  stored context rather than an event feed.
- **Breaking for adapter authors:** the external adapter manifest has exactly
  four fields (`contract_version`, `adapter_id`, `version`, `capabilities`), and
  any other field is refused by name, including a record installed with the
  earlier, longer manifest. Capabilities are an open set of dotted lowercase
  ids. Check and install such an adapter again.
- The module list (Planning, Memory, Settings) is declared in code.
  `GET /api/modules` and the MCP tool `list_platform_modules` keep their shape
  and answer from it without reading the store: every module is `enabled`, none
  is `mutable`, every `revision` is 1 and `updated_at` is when the list last
  changed. Settings no longer declares the registry's read models, and the
  entity kinds `service`, `connection` and `registry` left the reference
  vocabulary.
- `launcher install` pins a release: it copies one commit of the checkout
  (`--revision`, default `HEAD`) with `git archive` into the releases directory,
  and the stable command runs that copy instead of the working tree. Uncommitted
  edits no longer reach new client sessions or the store they open; newer
  commits reach clients at the next `launcher install`, and an earlier
  `--revision` is the rollback. The launcher manifest gains `revision` and
  `checkout`, keeping its schema version. A running MCP server warns once the
  launcher has been pinned to another release, and `doctor` reports how far the
  checkout has moved past the pinned commit. Run `launcher install` once after
  updating so the stable command stops running the checkout directly.
- The default workflow has a terminal **Cancelled** state for work closed as not
  needed, duplicated or superseded, so it is no longer counted as done. Moving
  an item there needs a closing summary but leaves its undone checklist steps
  open; Done still needs every step ticked. A workflow still shaped like the
  earlier six-state default gains Cancelled, with every move to and from it,
  the first time a store is opened; a workflow shaped differently is left
  alone. No existing row changes meaning, so this needs no store schema change.

### Fixed

- A claim, checklist claim or checklist tick made in the browser was signed
  `agent`, while a comment made there was signed `user`. A browser write that
  names no author, or an empty one, is now signed `user`.
- Load the global Work directory from project and space counts, keeping large
  work histories within the bounded UI response. The full directory API remains
  available without the optional `directory_only=true` query.
- Wrap work-queue filters and Settings controls in narrow windows.
- Keep every work item in a space's board, list, graph, and work queues, including
  spaces with more than 1000 items. Bounded item searches retain their limits.
- Decode Git reference context after byte capture while preserving its timeout.
- Check subprocess byte capture and explicit decoding policy, write ownership,
  and document lifecycle without pinning private expressions or release-note text.

### Removed

- Standalone Analytics dashboard and export/read model; Improvements signals,
  analysis, evaluation, monitoring, jobs, API, and MCP tools; Skills catalogue
  and activation UI/API; standalone Sessions fleet, inbox, and tool event feed.
- `/api/sessions`, `/api/session-seen`, and the Sessions SSE view. Installed
  skill files and existing client enablement settings are unchanged.
- Unused desktop inbox notification wiring, frontend remnants of the retired
  Analytics and Skills screens, and the unused usage client with its test fixtures.
- The extension registry: services, connections, assignments, grants, actions,
  packages, relations and capability resolution, with `/api/platform/registry`,
  `/api/platform/relations`, `/api/platform/actions`,
  `/api/platform/assignments` and `/api/platform/grants`, which now answer 404.
  Nothing seeds or reads the registry's rows, and store schema 9 drops their
  tables. The work-item read no longer carries a `relations` key.
- **Breaking for HTTP clients:** turning a module on or off. `POST
  /api/modules/state` answers 404, the Settings Workspace section that held the
  switches is gone, and a disabled module row in an existing store no longer
  hides or refuses anything. Store schema 9 drops the `platform_modules` and
  `platform_registry_audit` tables.

## [1.0.2] - 2026-09-27

The first public release. There is no earlier public version to compare
against, so this entry describes what the repository contains rather than what
changed in it.

### Added

- **A local modular control surface for agent work.** Planning, Sessions,
  Analytics, Improvements, Skills, Memory, and Settings share one Kernel vocabulary,
  persisted module registry, and normalized integration records.
- **A Planning module agents use over MCP.** Its Kanban view has six fixed
  columns, competing claims are refused by `claim_work_item`, epics are parent
  work items, and transition guards refuse a move the Planning workflow could
  not honestly report.
- **An activity trace on every Planning card** — creations, moves, claims,
  takeovers, releases, checklist completions and link changes, each with its
  author, beside typed refs for commits, sessions and memory entries.
- **Checklists with stable ids** that agents claim and complete individually, so
  two agents can split one card without either of them inventing a percentage.
- **A live Planning UI** in Vue 3, served from a committed build, updating over
  Server-Sent Events rather than polling, in English and Russian. Concurrent
  moves are resolved with a `409` naming who moved the card where, not silently
  undone.
- **Agent session launching from a Planning card**, with an explicit delivery
  contract and an enforced JSON result schema. A process exit code is not
  treated as delivery, and resume works only against the client's own stored
  session identity.
- **An analytics dashboard** over the same events — flow, throughput, cycle,
  reopen and blocked KPIs — that reports coverage as `confirmed`, `inferred`,
  `partial` or `unknown` and never fabricates a duration across missing history.
- **An improvements module** for working through recurring failures: a sidecar
  domain with its own database scope, a job supervisor, and evaluation runs
  bound to canonical pack snapshots.
- **A skills inventory** over registered projects, and normalized registry
  views for Modules, Adapters, Services, Connections, and Assignments.
- **Local project registration owned by Valkama.** The `projects` CLI adds
  existing roots, binds Planning spaces, checks and publishes a fixed schema-v3
  projection, and can restore the preceding inventory and projection bytes.
  An explicit import accepts an existing schema-1 TOML inventory.
- **An Electron desktop window and a Windows tray icon.** The tray appears while
  an agent holds a session and disappears when the last one ends; a click always
  produces a visible outcome, including a refusal when the listener cannot prove
  it is this checkout.
- **A dual-era MCP surface**: one process serves revision 2026-07-28 and the
  `initialize` handshake it replaced, choosing from how the client opens. See
  [`docs/connection-contract.md`](docs/connection-contract.md).
- **Two guards against version skew** — `static_assets.SourceWatch` for a
  process that went stale while it ran, `store.STORE_SCHEMA_VERSION` for a build
  that was already old when it started.
- **A CLI** covering the current Planning lifecycle and product diagnostics:
  `serve`, `mcp`, `summary`, `runtime`, `export`, `migrate`, `attach`, `detach`,
  `scopes`, `purge-stream`, `config`, `setup`, `doctor`, `adapter`, `capabilities`,
  `status`, `launcher`, and `projects`.
- **Migration recovery points.** Store migrations take clean SQLite snapshots
  before changing existing data. The Board-to-Planning conversion is explicit;
  `migrate planning-model --dry-run` converts a temporary copy first. Tests
  restore a pre-migration product-model snapshot into a separate store and
  replay the migration.

### Notes

This is the first public release. The source archive contains the Python service
and the built web UI. The Windows installer contains the desktop window; it uses
the Python service and managed launcher installed from the source archive.
