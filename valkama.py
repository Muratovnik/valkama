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

    from server.cli import main

    main()
