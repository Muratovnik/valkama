"""A stand-in for the machine's heavy-process gate, for the tests of `tests/heavy_gate.py`.

    python tests/heavy_gate_double.py --state DIR run --kind KIND [--want W] ... -- COMMAND ...
    python tests/heavy_gate_double.py --state DIR hold --kind KIND --pid P ...
    python tests/heavy_gate_double.py --state DIR status --json

It speaks the part of the gate's contract that Valkama's runners use, and nothing of
its measuring: `run` admits at once, gives K the want, writes a lease file under
DIR with a profile of `CORES` cores, says the gate's admission line on stderr, runs
COMMAND with `{k}` replaced and `HEAVY_GATE_LEASE` and `HEAVY_GATE_K` set, and
passes on its exit code; `hold` answers its JSON line and stays until P exits;
`status --json` lists the leases. A file `refuse` in DIR makes `run` and `hold`
answer no room, with exit code 75. A file `stall` makes a `hold` that waits wait
for good, as an entry in `DIR/queue`, until P exits. Every call appends its arguments to
`DIR/calls.jsonl` and its working directory to `DIR/cwds.jsonl`, for a test to
read. `write_entry_point` writes the
`heavy-gate.json` that points at it, as the installer writes the real one.
"""

from __future__ import annotations

import argparse
import ctypes
import json
import os
import subprocess
import sys
import time
from collections.abc import Sequence
from pathlib import Path

HERE = Path(__file__).resolve()
#: The cores of the profile every lease of the double is admitted by.
CORES = 5.2
#: What a refusal says, for a test to find in what the runner said.
REFUSAL = "12.0 cores are busy beside a stand-in lease"


def write_entry_point(directory: Path) -> Path:
    """The `heavy-gate.json` of a double whose state is `directory`; returns its path."""

    directory.mkdir(parents=True, exist_ok=True)
    entry = directory / "heavy-gate.json"
    argv = [sys.executable, str(HERE), "--state", str(directory)]
    entry.write_text(
        json.dumps({"protocol": 1, "argv": argv, "state": str(directory)}), encoding="utf-8"
    )
    return entry


def calls(directory: Path) -> list[list[str]]:
    """The arguments of every call the double at `directory` was given, in order."""

    path = directory / "calls.jsonl"
    if not path.is_file():
        return []
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines()]


def started_in(directory: Path) -> list[str]:
    """The working directory of every call the double at `directory` was given, in order.

    The real gate reads its rules from the repository of that directory.
    """

    path = directory / "cwds.jsonl"
    if not path.is_file():
        return []
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines()]


def _wait_for(pid: int) -> None:
    if sys.platform == "win32":
        synchronize, infinite = 0x00100000, 0xFFFFFFFF
        kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        handle = kernel32.OpenProcess(synchronize, False, pid)
        if handle:
            kernel32.WaitForSingleObject(handle, infinite)
            kernel32.CloseHandle(handle)
        return
    while True:
        try:
            os.kill(pid, 0)
        except OSError:
            return
        time.sleep(0.05)


def _lease(state: Path, kind: str, k: int | None) -> tuple[str, Path]:
    lease = f"double-{os.getpid()}"
    leases = state / "leases"
    leases.mkdir(parents=True, exist_ok=True)
    path = leases / f"{lease}.json"
    record = {
        "protocol": 1,
        "id": lease,
        "name": f"valkama:{kind}",
        "holder_pid": os.getpid(),
        "since": time.time(),
        "k": k,
        "profile": {"cores_total": CORES, "whole_machine": False},
    }
    path.write_text(json.dumps(record), encoding="utf-8")
    return lease, path


def _refusal() -> dict[str, object]:
    return {"protocol": 1, "admitted": False, "reason": "cpu", "detail": REFUSAL, "eta_s": 60}


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--state", type=Path, required=True)
    verbs = parser.add_subparsers(dest="verb", required=True)
    for name in ("run", "hold"):
        verb = verbs.add_parser(name)
        verb.add_argument("--kind", required=True)
        verb.add_argument("--size", type=int)
        verb.add_argument("--want", type=int)
        verb.add_argument("--pid", type=int)
        verb.add_argument("--wait", action="store_true", default=None)
        verb.add_argument("--no-wait", dest="wait", action="store_false")
        if name == "run":
            verb.add_argument("command", nargs=argparse.REMAINDER)
    verbs.add_parser("status").add_argument("--json", action="store_true")
    arguments = list(sys.argv[1:] if argv is None else argv)
    options = parser.parse_args(arguments)
    state: Path = options.state
    state.mkdir(parents=True, exist_ok=True)
    with (state / "calls.jsonl").open("a", encoding="utf-8") as log:
        log.write(json.dumps(arguments[2:]) + "\n")
    with (state / "cwds.jsonl").open("a", encoding="utf-8") as log:
        log.write(json.dumps(os.getcwd()) + "\n")
    if options.verb == "status":
        leases = [
            json.loads(path.read_text(encoding="utf-8"))
            for path in sorted((state / "leases").glob("*.json"))
        ]
        sys.stdout.write(json.dumps({"protocol": 1, "leases": leases, "queue": []}) + "\n")
        return 0
    if options.verb == "hold" and options.wait and (state / "stall").exists():
        # A waiter that never gets room, in the queue until the process it holds for
        # exits, as the gate's waiter watches that process and no other.
        queue = state / "queue"
        queue.mkdir(exist_ok=True)
        waiter = queue / f"{os.getpid()}.json"
        waiter.write_text(json.dumps({"pid": os.getpid(), "for": options.pid}), encoding="utf-8")
        try:
            _wait_for(options.pid)
        finally:
            waiter.unlink(missing_ok=True)
        return 75
    if (state / "refuse").exists():
        answer = json.dumps(_refusal())
        if options.verb == "hold":
            sys.stdout.write(answer + "\n")
            sys.stdout.flush()
        else:
            sys.stderr.write(
                f"{answer}\nheavy-gate: no room for valkama:{options.kind}: {REFUSAL}\n"
            )
        return 75
    k = options.want
    lease, path = _lease(state, options.kind, k)
    line = (
        f"heavy-gate: admitted valkama:{options.kind} after 0 s: "
        f"{f'K={k}, ' if k else ''}profile {CORES} cores 1.0 GB, machine 1.0 of 32 busy, alone\n"
    )
    try:
        if options.verb == "hold":
            sys.stdout.write(
                json.dumps({"protocol": 1, "admitted": True, "lease": lease, "k": k}) + "\n"
            )
            sys.stdout.flush()
            sys.stderr.write(line)
            _wait_for(options.pid)
            return 0
        sys.stderr.write(line)
        sys.stderr.flush()
        command = options.command[1:] if options.command[:1] == ["--"] else options.command
        command = [word.replace("{k}", str(k)) if k else word for word in command]
        environment = {**os.environ, "HEAVY_GATE_LEASE": lease}
        if k:
            environment["HEAVY_GATE_K"] = str(k)
        return subprocess.call(command, env=environment)
    finally:
        path.unlink(missing_ok=True)


if __name__ == "__main__":
    sys.exit(main())
