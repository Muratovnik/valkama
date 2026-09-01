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

from server.cli import main

if __name__ == "__main__":
    main()
