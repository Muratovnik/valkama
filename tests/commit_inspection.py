"""What an agent's shell sees on the way of a commit record: run inside a client's command.

Not a test of the suite: the live check of the commit hook (`commit_live_check.py`)
asks each client to run it as one shell command, and keeps what it prints. It
changes nothing it reads; the only file it creates is one probe file of a name no
other run uses in each place a record may go, which it removes before it exits.

    python -I -S tests/commit_inspection.py --repository R --interpreter P
        --registry REAL_PROJECTS_JSON --global-file REAL_GITCONFIG
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import uuid

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from server.hooks import commit_records, notify

#: The variables the live check sets for its own set, and the guard naming the store it
#: protects: the store's default path is read without them.
SET_VARIABLES = ("VALKAMA_DB", "LOCALAPPDATA", "GIT_CONFIG_GLOBAL", "VALKAMA_PROTECTED_STORE")


def _run(argv: list[str], environ: dict[str, str] | None = None, cwd: str | None = None) -> dict:
    try:
        done = subprocess.run(
            argv, capture_output=True, env=environ, cwd=cwd, timeout=20, check=False
        )
    except (OSError, subprocess.TimeoutExpired) as error:
        return {"error": f"{type(error).__name__}: {error}"}
    return {
        "returncode": done.returncode,
        "stdout": done.stdout.decode("utf-8", "replace"),
        "stderr": done.stderr.decode("utf-8", "replace"),
    }


def _readable(path: str) -> dict:
    try:
        with open(path, "rb") as handle:
            size = len(handle.read())
    except OSError as error:
        return {"path": path, "readable": False, "error": f"{type(error).__name__}: {error}"}
    return {"path": path, "readable": True, "bytes": size}


def _probe(directory: str, *, create: bool) -> dict:
    """Whether a file can be created in `directory`, which is created first when `create`
    asks and it is missing; what this created is removed again."""

    found: dict = {"directory": directory, "visible": os.path.isdir(directory)}
    made: list[str] = []
    name = os.path.join(directory, f"probe-{uuid.uuid4().hex}.tmp")
    try:
        if create and not os.path.isdir(directory):
            os.mkdir(directory)
            made.append(directory)
        with open(name, "wb") as handle:
            handle.write(b"probe")
        found["created"] = True
    except OSError as error:
        found["created"] = False
        found["error"] = f"{type(error).__name__}: {error}"
    finally:
        try:
            os.remove(name)
        except FileNotFoundError:
            pass
        except OSError as error:
            found["remove_error"] = f"{type(error).__name__}: {error}"
        for folder in reversed(made):
            try:
                os.rmdir(folder)
            except OSError as error:
                found["rmdir_error"] = f"{type(error).__name__}: {error}"
    found["left_behind"] = os.path.exists(name)
    return found


def inspect(options: argparse.Namespace) -> dict:
    without_set = {key: value for key, value in os.environ.items() if key not in SET_VARIABLES}
    without_global = {key: value for key, value in os.environ.items() if key != "GIT_CONFIG_GLOBAL"}
    listing = ["git", "config", "--global", "--show-origin", "--list"]
    default_store = notify.settings(without_set)[0]
    common = _run(
        ["git", "-C", options.repository, "rev-parse", "--path-format=absolute", "--git-common-dir"]
    )
    common_dir = str(common.get("stdout", "")).strip()
    return {
        "whoami": _run(["whoami"]),
        "environment": {
            name: os.environ.get(name)
            for name in (
                "HOME",
                "USERPROFILE",
                "LOCALAPPDATA",
                "GIT_CONFIG_GLOBAL",
                "VALKAMA_DB",
                "CLAUDE_CODE_SESSION_ID",
                "CODEX_SESSION_ID",
                "CODEX_THREAD_ID",
                "CODEX_TOOL_CALL_ID",
            )
        },
        "git_global_with_variable": _run(listing),
        "git_global_without_variable": _run(listing, without_global),
        "real_global_file": _readable(options.global_file),
        "real_registry": _readable(options.registry),
        "registry_by_default_path": _readable(commit_records.registry_path(without_set)),
        "default_store": default_store,
        "default_store_directory": (
            _probe(os.path.dirname(default_store), create=False) if default_store else None
        ),
        "git_common_dir": common_dir,
        "fallback_directory": (
            _probe(os.path.join(common_dir, "valkama"), create=True) if common_dir else None
        ),
        "interpreter": _run([options.interpreter, "-I", "-S", "-c", "print('started')"]),
        "this_interpreter": sys.executable,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repository", required=True)
    parser.add_argument("--interpreter", required=True)
    parser.add_argument("--registry", required=True, help="the registry the owner's tools read")
    parser.add_argument("--global-file", required=True, help="the owner's global Git file")
    parser.add_argument("--output", help="also write the result here")
    options = parser.parse_args(argv)
    result = inspect(options)
    text = json.dumps(result, indent=1, ensure_ascii=False)
    sys.stdout.write(text + "\n")
    if options.output:
        try:
            with open(options.output, "w", encoding="utf-8", newline="\n") as handle:
                handle.write(text)
        except OSError as error:
            sys.stderr.write(f"output not written: {error}\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
