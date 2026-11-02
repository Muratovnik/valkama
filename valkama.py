"""Entry point for the Valkama server.

The implementation lives in the `server` package next to this file.
This module stays because the desktop app launches it directly, and the managed
launcher records it as the source entry point for agent clients. Moving or
renaming it would break those service-owned install records.
"""

from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

if __name__ == "__main__":
    # A client hook runs on every session event and, for Claude, on every
    # Valkama tool call. It is dispatched before the command line is imported,
    # so it never loads the MCP or HTTP surface.
    if sys.argv[1:2] == ["hook"]:
        from server.hooks.entry import main as hook_main

        sys.exit(hook_main(sys.argv[2:]))

    # The launcher's `mcp` is dispatched early too. When this is the release the
    # launcher names, the process becomes the session's stdio front, which runs
    # the server as a child; loading every surface into the front would only
    # make each session slower to open. Otherwise it serves in-process below.
    if sys.argv[1:] == ["mcp"]:
        from server.mcp_front import main as front_main

        status = front_main()
        if status is not None:
            sys.exit(status)

    # `serve --on-demand` holds the port at login until someone connects. Whatever
    # is imported before that is what it costs all day, so this comes before the
    # command line, which loads every surface.
    if sys.argv[1:2] == ["serve"] and "--on-demand" in sys.argv[2:]:
        from server.on_demand import main as on_demand_main

        status = on_demand_main(sys.argv[2:])
        if status is not None:
            sys.exit(status)

    # The tray and the desktop app ask the launcher three read-only questions
    # on the way to a window: `runtime`, `launcher status` and `launcher
    # listener status`. They are answered before the command line is imported,
    # which loads every surface; anything else, or an error, falls through.
    if sys.argv[1:2] in (["runtime"], ["launcher"]):
        from server.launcher_queries import main as query_main

        answered = query_main(sys.argv[1:])
        if answered is not None:
            sys.exit(answered)

    from server.cli import main

    main()
