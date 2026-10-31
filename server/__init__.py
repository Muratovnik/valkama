"""Valkama: HTTP and MCP surfaces over one SQLite store.

Layout, grouped by owner. Everything above the line is domain — it answers
questions about the store and knows nothing about who asked:

    store.py        the schema, its migrations, backups and the connection
    store_identity/ which store this is, and the exact refs of what it holds
    planning/       spaces, workflows, work items, links and their events, and
                    the routing that answers a read for one exact project scope
    app_shell.py    what the web shell reads first: modules, context, last route
    ui_state.py     the envelope those reads answer in, and its refusal
    executions/     one attempt at a work item: its lifecycle and the drivers
                    that know how each agent client is invoked
    runner.py       process shape for a launched client, and stopping it
    sessions.py     essential lifecycle ingestion and exact work association
    hooks/          `valkama hook`: client hook events into the store or the
                    spool, and the Claude identity transform
    housekeeping.py start-up maintenance a long-lived process runs: the spool drain
    transcripts.py  the local copy of each ended session's transcript, and its retention
    federation.py   spaces and search across attached databases
    refs.py         resolving a work item ref into what it points at
    documents.py    repository documents, for search and for evidence
    telemetry/      execution usage from bounded read-only client journals
    git_worktrees.py  the worktree preflight a launch has to pass
    processes.py    decoded subprocess text and stopping a process tree
    http_security.py  the loopback write guard: host, origin, token, body size
    static_assets.py  the built web UI, the checkout paths and runtime identity
    launcher.py     the managed stable command agent clients register
    watchers.py     change fan-out, shared by every surface
    platform/       the kernel: the module list and its manifest, the store
                    bring-up, and the external adapter contract and transports
    projects/       project and scope registries

And below it the surfaces, which own no domain rule of their own:

    mcp_surface.py  the tool catalogue, dispatch and the stdio message loop
    mcp_front.py    the stdio front a launcher session runs: it holds the
                    client's pipe and runs the pinned release's server behind it
    http_surface.py the JSON API, event streams and the built web UI
    cli.py          the subcommands

Imports run one way: a surface may import domain, domain may not import a
surface, and no surface imports another. `cli.py` is the single exception by
construction — it is what chooses between the MCP and HTTP surfaces. The front
imports neither of those: it runs the server as a child process, and
`valkama.py` decides whether a process is the front.

`valkama.py` next to this package remains the source entry point. Agent clients
register the service-owned launcher created by `valkama.py launcher install`;
only that managed shim records the checkout path. The desktop installer keeps
its own service-owned install record. Tests mirror this layout under `tests/`.

The server imports nothing outside the standard library. The desktop app and
managed launcher use the selected system Python with no virtualenv, so a
third-party import here would break them.
"""
