# Changelog

Notable changes to Valkama. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

The MCP server reports itself as `<release>+<build>`, where the build is a digest
over the modules the running process started with. Two servers from different
checkouts are therefore distinguishable even at the same version.

## [Unreleased]

### Added

- `create_work_item` and `POST /api/planning/work-items` take `claim` and
  `links` (`{other, kind}`), applied to the new item in the same transaction:
  created, then claimed, then linked. A refused claim or link creates nothing
  and names the step, as `apply_work_item_changes` does, and the answer adds
  `applied`. Filing discovered work linked `discovered-from` and claimed takes
  one call instead of three.
- The chain root carries its own mark on the graph: a «root» tag on its node,
  and «chain root» in the node's accessible name. It stands one step above the
  closed work around it even when it is closed itself.
- The card's chain section draws a branch map. Each lane is one origin of the
  work — the root's own children, each other epic, the work filed under no
  epic — and every member is one segment of the same width along it: finished
  work by closing time, then review and work in progress, then blocked, queued
  and backlog work, so a lane's length is its volume and its grey tail is what
  remains. A lane branches off the lane it was discovered from, at the task it
  was discovered from. Pointing at a segment names the task, its state and its
  holder, and a click opens it. A lane's label narrows the member list below to
  that lane, with a chip that widens it back and a button that opens the lane's
  epic. Each lane is one keyboard stop: Left and Right move between its tasks,
  Page Up and Page Down between stretches of one state, Home and End to its
  ends, Enter opens the task, and a live region says which task it is. On a
  long chain, narrow segments of one state merge into one stretch, and work
  under way is raised so that it still shows.

### Changed

- A chain on the graph draws its open part by default: the root, the open
  members, and every member that is the parent of one drawn, so the epics the
  open work is filed under stay on the field. A «Closed · N» switch beside the
  chip draws the closed members as well, and N is the number of nodes it adds.
  The chip still counts the whole chain, and the legend names only the groups
  drawn. On a chain of 600 members, 480 of them closed, the default draws 122
  nodes instead of 601. Whether closed work is drawn is held apart for the
  chain and the whole space, so leaving a chain gives the space back its own
  filter, and each chain opens on its open part.
- Chain views colour members by progress: finished green, in progress blue,
  review amber, queued and backlog grey, blocked red. That holds in the card's
  branch map, its member groups and its scope chart, and on the graph scoped to
  a chain.
- The branch map replaces the card's line of origins: each lane's label names
  its epic, or says it has none, and its counts stand at the lane's end.
- The card's scope chart is shorter and stands under the branch map.
- The chain answer names a root with children once, as `has_children`; the
  `container` field that always carried the same value is gone from
  `GET /api/planning/work-item/chain` and `get_work_item_chain`.
- In the card's chain section, a member row names its state only when its
  group mixes states. A group in one state names it once, in its heading, and
  the finished group is headed the same way.
- The card's workable figure says what it counts: unheld, unblocked work in
  any state work can start from, the backlog included.
- A work item of an attached store shows the chain section with a note that
  the chain is read for work items of the primary store only.
- The desktop app is built on Electron 45 (Chromium 156), up from Electron 43.

### Fixed

- The chain a graph is scoped to is now part of the address. The Planning
  module's route state admits two more keys, `chain` (the root's reference)
  and `chain_scope` (`chain` or `epic`), so a reload, a shared link, Back and
  Forward come back to the same chain. Leaving it by the chip or by switching
  to Kanban or List removes both keys. A link that names no valid reference,
  a reference the server does not know, or a chain from another planning space
  shows the whole space with a notice saying why, and the keys are dropped.
- The navigation rail names each entry by what it shows. A screen reader now
  hears a module's attention count, which the entry's label used to hide; the
  brand button is called Valkama, with where it goes in its tooltip; and the
  finder's name includes the shortcut printed beside it. The «Needs my answer»
  button is named the same way, so it says how many questions wait.
- A route a module cannot open in the current scope says so in one sentence
  that names the module, instead of a sentence followed by `.: planning`.
- A chain link whose root is not among the space's work items says just that,
  instead of always blaming another planning space; a root deleted while its
  graph was open is one such case.
- The release check runs every Python tool from the interpreter that runs it:
  `python -m <tool>`, or the console script in that interpreter's own scripts
  directory, which is also put first on `PATH` for each stage. A shared Python
  first on `PATH` could otherwise supply typos, mypy or a semgrep whose
  dependencies had drifted from its pin. Before the first stage it checks every
  `requirements-dev.txt` pin against that interpreter and, when one is missing
  or at another version, stops with one message naming the interpreter, each
  package and what to run. `CONTRIBUTING.md` says how to run a release.

## [2.1.0](https://github.com/Muratovnik/valkama/compare/v2.0.0...v2.1.0) - 2026-10-31

### Added

- A chain of work: what one item's work grew into, and whether it converges.
  For a root item, scope `epic` is its children; scope `chain`, the default,
  adds every item discovered from the root or a member and every child of a
  member, until nothing new is found. `relates-to`, `duplicates` and `blocks`
  never widen it, and the walk never goes upstream. The answer counts the
  members (total, closed, open, ready, per category), groups them by parent,
  gives a per-day series of created and closed members with running totals,
  and says whether the last seven UTC days were growing, converging or steady.
  `GET /api/planning/work-item/chain` carries every member and the `blocks` and
  `discovered-from` links among them. The MCP tool `get_work_item_chain` carries
  the same figures, the newest 30 days of the series, and the open members as
  compact rows, active first, paged with `truncated` and `next_offset`.
- `list_work_items` and `GET /api/planning/work-items` take `parent`, and then
  list only that item's children.
- The work item card shows the item's chain when it has one. It has a switch
  between the epic and the whole chain, the totals with the open members split
  by workflow category, and a chart of total scope against closed members by
  day, with the open gap shaded. A sentence says whether the last seven days
  grew or converged. Members are grouped by the parent they came from, and the
  open ones are listed by category, with the holder and a mark on those ready
  to start. «Show on graph» scopes the graph to the chain: it draws the members
  and the root, recesses the done ones, and has a legend and a chip to leave.
- The whole-space graph leaves out items that no drawn link touches, with a
  switch that shows them again.

## [2.0.0](https://github.com/Muratovnik/valkama/compare/v1.0.2...v2.0.0) - 2026-10-31

### Added

- The MCP tool `apply_work_item_changes` applies several writes to one work
  item in one call: a claim, checklist ticks, refs, links, a comment, the
  summary and a transition, in that order, so a closing transition sees the
  ticks and the summary sent with it. Each step is the write its single tool
  makes, with the same guards, events and revision bumps. The call is all or
  nothing: a refused step writes nothing, and the error keeps the refusal's
  code and names the step (`step: {group, index}`). The batch is recorded as one
  call with its identity. It answers with the usual acknowledgement plus
  `applied`, what each group changed; `verbose: true` returns the full item.
  The HTTP write `POST /api/planning/work-item/apply` takes the same body. The
  single tools are unchanged.
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
    drain cannot revive an ended session. A spool file that fails validation,
    including a list or an object where a string belongs, is set aside as
    `*.rejected`; no file content stops a drain, and a failure in start-up
    maintenance is reported on stderr without stopping the server.
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
    the spool drain and the lease expiry, in a background thread, so the first
    request never waits for a copy. The drain and the lease expiry before it
    share a budget of about three seconds and give up quickly on a store
    another writer holds.
  - Retention: copies are kept while a non-terminal work item refers to the
    session (by a session ref, a write call, its current claim, an execution
    linked to the session, or as the item the session was launched for), and
    for at least 90 days after the later of the session's last activity and
    the newest terminal transition of a referring item. A purge
    appends `transcript_purged` before it deletes the file, and the next sweep
    removes a file a crash left behind. A sweep deletes nothing else but an
    abandoned `*.partial`: a copy no row names, as after restoring the store
    from a snapshot, is kept and reported by `doctor`.
  - `valkama transcripts purge` deletes copies on request, whatever retention
    says: `--session <id>` (repeatable), `--before <date>` (sessions whose last
    activity is earlier) and `--dry-run`. Each copy gets a `transcript_purged`
    row with `reason` `on-request` before its file is deleted, a copy still
    owed for those sessions is never made, and the command prints counts only,
    including how many open work items refer to the sessions.
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
    so a session whose hooks are silent stays live while it writes. One that
    arrives after the session ended makes it `active` again, because a client
    can resume an ended session without a new session start; its claims then
    stay live. A drained or replayed hook event never does.
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

- `valkama export --space KEY` (repeatable) exports only those Planning spaces
  and names them in the file as `space_filter`; an unknown space exits non-zero.
  `valkama export --output PATH` writes the export through a temporary file in
  the same directory and replaces the target in one rename, then prints one
  line with the path, the spaces and the item count. Without `--output` the
  export still goes to stdout.
- `list_work_items` and `search_work_items` take an optional `offset`, and so do
  `GET /api/planning/work-items` and `GET /api/planning/search`. Their answers
  carry `next_offset`, the offset of the next page, or `null` on the last one.
  The `tools/list` change is additive only: one new optional `offset` property
  on each of the two tools, and longer descriptions that explain paging. The
  HTTP answers gain `truncated` and `next_offset`, and so does a `verbose`
  tool answer, which is the HTTP answer; no existing field changes.

### Changed

- The MCP tool `get_work_item` answers by default with the item's current
  fields and only the newest part of its history: the 5 most recent comments
  and 10 most recent events, with `comments_total`, `events_total` and
  `history_truncated`. The new boolean argument `full: true` returns the
  complete history, as the tool did before. The HTTP read
  `GET /api/planning/work-item` is unchanged and takes the same cut as opt-in
  `comments`, `events` and `sessions` parameters.
- `get_work_item` also carries `sessions`: each agent session whose confirmed
  calls wrote to the item, with its `client`, `identity_source`, `first_at`,
  `last_at` and number of `writes`. Valkama records this itself, so the MCP
  server's instructions and the `attach_work_item_ref` description no longer
  ask an agent to attach its session id as a ref, and they point to
  `apply_work_item_changes` for several writes to one item.
- Moving an item to Review no longer warns about missing evidence when a
  confirmed session has written to it: such a write names its session as a
  session ref does. Before, an agent that stopped attaching session refs got
  the warning on every move to Review without a commit ref.
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

- An MCP server whose launcher had moved on to another build appended the
  stale-build warning to every tool result, so a long session carried dozens of
  copies and paid for each on every later request. The first result after the
  drift carries it; a reminder follows only after at least 30 minutes, three in
  all per process.
- The desktop app refused to start or reuse the server on Windows builds that
  report a listening socket's TCP state as `Closed` or as no state at all:
  `launcher listener status` looked only for `Listen` sockets, found none and
  called a port that the managed server held `free`. A listener is now any
  socket on the port with no remote end, whatever state Windows reports.
- Any local process could obtain the browser session token, because
  `GET /api/security/bootstrap` without an `Origin` returned it, and could
  then write as the owner (`browser`, signed `user`) with a forged `Origin`.
  The bootstrap and every write with the browser credential now also require
  `Sec-Fetch-Site: same-origin`, the fetch metadata a browser sets on its own
  requests; a request without it is refused with `403`
  `fetch_metadata_refused`. The web client and the desktop app send it
  already. The adapter endpoint is unchanged.
- An MCP tool call refused for its arguments -- an unknown argument, a `limit`
  that is not an integer -- answered only with the text
  `PlanningHttpError: ...`. It now answers like every other refusal, with
  `structuredContent.error.code` (`invalid_request`) and the message.
- `valkama export` wrote at most 1000 work items per Planning space and said
  nothing about the rest; the items lost were those in the last workflow
  states. It now reads every item page by page and checks the count against
  the space's own. A count that does not add up stops the export, and nothing
  is printed or written.
- `list_work_items` cut its answer at 1000 items and `search_work_items` at
  200 without saying so; at a `limit` of 1000 or more (200 for a search) the
  compact answer reported `truncated: false` while it was cut. A page still
  holds at most 1000 (200) items, but `truncated` is now correct at every
  limit and `next_offset` says where the rest starts. The list order now ends
  on the work item id, so paging cannot repeat or skip an item that ties with
  one from another space.
- Rolling the launcher back with `launcher install --revision` to a release
  from before `valkama hook`, while the client hooks were still registered,
  would have blocked every prompt and tool call in Claude Code: that release's
  argument parser exits 2 on the unknown command. The shim now answers
  `valkama hook` with exit 0 and no output when the pinned release has no hook
  entry point.
- A half-written migration snapshot, left by a process killed while writing it,
  was found as reusable at every later open and stopped each one. A reusable
  snapshot that cannot be read is now renamed to `*.unverified`, kept, and a
  fresh snapshot is taken.
- Search across attached scopes (`/api/search?scope=all`) failed as a whole when
  one attached store was written by an earlier build: reading a claim there
  needed a column that store does not have. Such a claim now reads
  `unconfirmed`, and a scope that cannot be opened or searched for any reason
  costs only its own hits and is named, with the reason, in the new `skipped`
  list of the answer.
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
