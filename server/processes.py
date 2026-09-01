"""Run a child process, then decode what it wrote — in that order.

`subprocess.run(..., text=True)` cannot honour clause 3 of the workspace
Unicode contract on Windows, which requires a decode failure to propagate. The
read happens in a reader thread, so a `UnicodeDecodeError` kills that thread
instead of reaching the caller: `communicate()` hands back the stream as `None`
and the exit code arrives intact, so nothing raises and nothing is noticed.
Decoding here, in the caller's own thread, is what makes the failure travel.

The codec is named rather than inherited for the same reason. `text=True`
follows the locale unless `PYTHONUTF8` is set, so one line of code decodes two
different ways depending on how the process was started — strict UTF-8 under
the gate, CP1251 under a plain shell on a Russian Windows.

`errors` is a parameter and not a constant because clause 4 allows a legacy or
lossy boundary when its owner declares it. Strict is the default; a caller that
relaxes it says which peer and why at the call site.
"""

from __future__ import annotations

import contextlib
import os
import signal
import subprocess
import sys
from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class TextResult:
    """A finished child process whose streams were decoded, not guessed.

    The three field names match `subprocess.CompletedProcess` so a call site
    reads the same after moving here.
    """

    returncode: int
    stdout: str
    stderr: str


def run_text(
    argv: list[str],
    *,
    encoding: str = "utf-8",
    errors: str = "strict",
) -> TextResult:
    """Capture both streams as bytes and decode them with a named codec."""
    completed = subprocess.run(argv, capture_output=True, shell=False, check=False)
    return TextResult(
        returncode=completed.returncode,
        stdout=completed.stdout.decode(encoding, errors),
        stderr=completed.stderr.decode(encoding, errors),
    )


def stop_process_tree(process: Any, *, wait_timeout: float = 2.0) -> bool:
    """Stop a child and everything it started; report whether the tree went.

    An agent client spawns its own children, so `terminate()` leaves them
    running with the pipe still open. Windows needs `taskkill /T`, POSIX needs
    the process group, and both fall back to terminating the child alone.

    This lived in three places — the launch runner, the evaluation sandbox and
    the job supervisor — and the copies had already drifted apart: only two of
    them killed the POSIX process group, and only two bounded `taskkill` with a
    timeout. That is the cost of a copy, on the path that stops a runaway agent.

    `taskkill` output is captured as bytes and never decoded: it writes its
    diagnostics in the console OEM code page, which is not UTF-8 on a localized
    Windows, and only the exit code is read here.
    """
    pid = getattr(process, "pid", None)
    if sys.platform == "win32" and pid:
        with contextlib.suppress(OSError, subprocess.SubprocessError):
            killed = subprocess.run(
                ["taskkill", "/PID", str(pid), "/T", "/F"],
                capture_output=True,
                shell=False,
                timeout=5,
                check=False,
            )
            if killed.returncode == 0:
                with contextlib.suppress(OSError, subprocess.TimeoutExpired):
                    process.wait(timeout=wait_timeout)
                return True
    elif sys.platform != "win32" and pid:
        # Named rather than implied by the branch above: the process-group API
        # does not exist on Windows, and the platform check is what tells a
        # type checker this line is unreachable there.
        with contextlib.suppress(OSError, subprocess.SubprocessError):
            os.killpg(os.getpgid(pid), signal.SIGKILL)
            process.wait(timeout=wait_timeout)
            return True
    try:
        process.terminate()
        process.wait(timeout=wait_timeout)
    except Exception:
        with contextlib.suppress(Exception):
            process.kill()
        with contextlib.suppress(Exception):
            process.wait(timeout=wait_timeout)
    return False


__all__ = ["TextResult", "run_text", "stop_process_tree"]
