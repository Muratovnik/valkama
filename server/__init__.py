"""Valkama: HTTP and MCP surfaces over one SQLite store.

Layout, grouped by owner. Everything above the line is domain — it answers
questions about the store and knows nothing about who asked:

    store.py        the schema, its migrations, backups and the connection
    planning/       spaces, workflows, work items, links and their events
    executions/     one attempt at a work item: its lifecycle and the drivers
                    that know how each agent client is invoked
    runner.py       process shape for a launched client, and stopping it
    sessions.py     agent session ingest, the monitor read model, retention
    federation.py   spaces and search across attached databases
    refs.py         resolving a work item ref into what it points at
    documents.py    repository documents, for search and for evidence
    analytics/      flow, agent usage and work-item-age read models
    git_worktrees.py  the worktree preflight a launch has to pass
    processes.py    decoded subprocess text and stopping a process tree
    http_security.py  the loopback write guard: host, origin, token, body size
    static_assets.py  the built web UI, the checkout paths and runtime identity
    launcher.py     the managed stable command agent clients register
    watchers.py     change fan-out, shared by every surface
    platform/       the kernel: contracts, registry, relations, scope,
                    providers and the module manifest
    improvements/   the improvements store, its integration with Planning,
                    job supervision, evaluation and the evaluation worker
    projects/       project and scope registries
    skills/         skills inventory and activation

And below it the three surfaces, which own no domain rule of their own:

    mcp_surface.py  the tool catalogue, dispatch and the stdio message loop
    http_surface.py the JSON API, event streams and the built web UI
    cli.py          the subcommands

Imports run one way: a surface may import domain, domain may not import a
surface, and no surface imports another. `cli.py` is the single exception by
construction — it is what chooses between the other two.

`valkama.py` next to this package remains the source entry point. Agent clients
register the service-owned launcher created by `valkama.py launcher install`;
only that managed shim records the checkout path. The desktop installer keeps
its own service-owned install record. Tests mirror this layout under `tests/`.

The server imports nothing outside the standard library. The desktop app and
managed launcher use the selected system Python with no virtualenv, so a
third-party import here would break them.
"""
