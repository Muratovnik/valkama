# Changelog

Notable changes to Valkama. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

The MCP server reports itself as `1.0.0+<build>`, where the build is a digest
over the modules the running process started with. Two servers from different
checkouts are therefore distinguishable even at the same version.

## [Unreleased]

The first public release. There is no earlier public version to compare
against, so this entry describes what the repository contains rather than what
changed in it.

### Added

- **A local modular control surface for agent work.** Planning, Sessions,
  Analytics, Improvements, Skills, and Settings share one Kernel vocabulary,
  persisted module registry, and normalized integration records.
- **A Planning module agents use over MCP.** Its Kanban view has six fixed
  columns, atomic `claim_card`, epics as parent cards, and transition guards
  that refuse a move the Planning workflow could not honestly report.
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
  `serve`, `mcp`, `summary`, `runtime`, `dump`, `graph`, `merge-boards`, `attach`,
  `detach`, `scopes`, `purge-stream`, `import-routa`.
- **Backups that are tested, not assumed.** A schema upgrade snapshots the
  database before any `ALTER`; `merge-boards` writes a clean snapshot first, and
  a test performs the documented rollback end to end.

### Notes on the history

The repository carries its full development history from 2026-07-26, and it
records two renames — Kanban, then Agent Hub, then Valkama. Store migrations
carry data across both, and four literals are still deliberately spelled the old
way because they name what earlier versions wrote to real disks.

Four commits are marked breaking. They predate any public release, so nothing
outside this repository depended on what they changed:

- `feat!: speak MCP 2026-07-28 only, and drop the handshake it removed` — since
  reverted; the handshake is served again, and why is in the connection
  contract.
- `refactor(server)!: name the module platform and publish the contract as
  valkama`
- `refactor(web)!: rebuild on the renamed contract and give the style system one
  grammar`
- `refactor(web)!: give every element one component that decides how it looks`
