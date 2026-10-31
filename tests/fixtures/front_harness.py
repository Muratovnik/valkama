"""Run the stdio front over this process's real stdio, following a pin file.

A stand-in for `mcp_front.main` in `tests/test_mcp_front.py`: the pin comes
from a JSON file the test rewrites rather than from a launcher manifest, and
the watcher looks every tenth of a second. The rest is the front as a session
runs it, which is the point: the main thread blocks reading a real stdin pipe
while the watcher switches releases.
"""

from __future__ import annotations

import json
import sys
import threading
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from server import mcp_front

PIN_FILE = Path(sys.argv[1])


def read_pin() -> mcp_front.Pin | None:
    try:
        pin = json.loads(PIN_FILE.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    return mcp_front.Pin(pin["python"], pin["script"], pin["revision"])


if __name__ == "__main__":
    first = read_pin()
    if first is None:
        raise SystemExit("no pin to start from")
    front = mcp_front.Front(
        sys.stdout.buffer, read_pin=read_pin, start_timeout=20.0, stop_timeout=0.5
    )
    front.start(first)
    stop = threading.Event()
    threading.Thread(target=front.watch, args=(stop, 0.1), daemon=True).start()
    status = front.serve(sys.stdin.buffer)
    stop.set()
    raise SystemExit(status)
