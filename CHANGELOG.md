# Changelog

Notable changes to Valkama. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

The MCP server reports itself as `<release>+<build>`, where the build is a digest
over the modules the running process started with. Two servers from different
checkouts are therefore distinguishable even at the same version.

## [Unreleased]

### Changed

- Focus the workspace on projects, work items, claims, blockers, execution,
  results, and review. Navigation contains Work and Settings; board, list, and
  graph share the Planning read model. Memory refs and exact session context
  remain inside work-item context.
- Keep session lifecycle ingestion in Planning, accepting `session_start`,
  `session_end`, `attention`, and `turn_end`. `/api/session` resolves compact
  stored context rather than an event feed.

### Fixed

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
