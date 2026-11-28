"""Make, link and remove a worktree that shares the main checkout's npm modules.

    python tests/worktree.py add [-b BRANCH | --detach] PATH [COMMIT]
    python tests/worktree.py link PATH
    python tests/worktree.py remove PATH

A development tool and not part of the product: `valkama` has no such command,
and nothing under `server/` imports this file. Run it from any checkout of the
repository; the main checkout is the one Git names as the repository's own.

A fresh worktree has no `node_modules` in `web/` or `desktop/`, and `npm ci` in
each copies tens of thousands of files there. That copy is not needed when the
worktree's `package-lock.json` is the main checkout's byte for byte: the main
checkout's modules then hold what it pins, as far as anyone's do. So `add` and `link` give
such a package a link to the main checkout's `node_modules`, a junction on
Windows, which takes no privilege, and a symbolic link elsewhere. A package with
another lockfile gets no link, and the tool says that `npm ci` is needed there.
A `node_modules` already in place, a directory or a link, is left as it is.
Whether the shared modules still match their lockfile is the gates' question:
`tests/isolated.py gates` refuses an npm step on modules that differ from it,
through a link as well.

`npm ci` empties the `node_modules` it installs into, through a link as well, so
it runs only in a package that has no link: an install through one strips the
modules from the main checkout and from every worktree sharing them.

`remove` takes the links out, then runs `git worktree remove`. Git removes the
worktree's registration and files but leaves a junction, and the directory that
holds it, where a later recursive delete that follows the junction would empty
the main checkout's modules. Before it touches a link, `remove` refuses a
worktree that Git would refuse to remove: one that is locked or has changes. It
never passes `--force`.

`defects` says how a worktree breaks the rules of parallel work: a copy of
modules where a link was due, and a worker's commit that carries `web/dist`.
`tests/run_record.py run` and `check` and `tests/isolated.py gates` refuse such a
worktree before anything runs, naming each defect and its fix.

Nothing here imports the `tests` package: its import moves the environment, and
Git run from this tool must see the caller's.
"""

from __future__ import annotations

import argparse
import os
import sys
from collections.abc import Sequence
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from server import git_worktrees
from windows import release


class RefusalError(Exception):
    """What this tool will not do, and why; nothing was changed by the refused step."""


def link_directory(link: Path, target: Path) -> None:
    """A junction on Windows, which takes no privilege, and a symbolic link elsewhere."""

    if sys.platform == "win32":
        import _winapi

        _winapi.CreateJunction(str(target), str(link))
    else:
        link.symlink_to(target, target_is_directory=True)


def unlink_directory(link: Path) -> None:
    """Remove the link itself. Removing a directory that holds anything fails instead."""

    if sys.platform == "win32":
        os.rmdir(link)
    else:
        os.unlink(link)


def main_checkout(root: Path) -> Path:
    """The working tree of the repository `root` belongs to, which is not a linked worktree."""

    found = git_worktrees.git_text(
        str(root), "rev-parse", "--path-format=absolute", "--git-common-dir"
    )
    if found.returncode:
        raise RefusalError(f"{root} is not in a Git repository: {found.stderr.strip()}")
    return Path(found.stdout.strip()).parent


def _registration(main: Path, worktree: Path) -> dict[str, str]:
    """Git's record of the linked worktree at `worktree`."""

    if git_worktrees.canonical(worktree) == git_worktrees.canonical(main):
        raise RefusalError(f"{worktree} is the main checkout, not a linked worktree")
    try:
        registered = git_worktrees.registered_worktrees(str(main))
    except git_worktrees.WorktreeListError as error:
        raise RefusalError(f"Git could not list the worktrees of {main}: {error}") from error
    record = registered.get(git_worktrees.canonical(worktree))
    if record is None:
        raise RefusalError(f"{worktree} is not a worktree of {main}")
    return record


def link_modules(main: Path, worktree: Path) -> list[str]:
    """Link each package's missing modules to the main checkout's; one line per package."""

    _registration(main, worktree)
    said = []
    for name in release.NPM_PACKAGES:
        package = worktree / name
        modules = package / "node_modules"
        shared = main / name / "node_modules"
        if os.path.lexists(modules):
            target = release.linked_modules(package)
            kept = "its own node_modules" if target is None else f"a link to {target}"
            said.append(f"{name}: left as it is, {kept}")
        elif not (package / "package-lock.json").is_file():
            said.append(f"{name}: no package-lock.json, so nothing to link")
        elif not shared.is_dir():
            said.append(f"{name}: npm ci is needed in {package}: the main checkout has no modules")
        elif not _same_bytes(package / "package-lock.json", main / name / "package-lock.json"):
            said.append(
                f"{name}: npm ci is needed in {package}:"
                " its package-lock.json is not the main checkout's"
            )
        else:
            link_directory(modules, shared.resolve())
            said.append(f"{name}: linked to {shared.resolve()}")
    return said


def _same_bytes(one: Path, other: Path) -> bool:
    try:
        return one.read_bytes() == other.read_bytes()
    except OSError:
        return False


#: The subject start of the one commit that may carry `web/dist` on a branch: the
#: integrator's rebuild on the integrated head. A worker's commits leave it alone.
BUNDLE_COMMIT = "build(web)"


def defects(root: Path) -> list[str]:
    """How the linked worktree `root` breaks the two rules of parallel work, one line each with its fix.

    Empty for the main checkout, for a directory Git does not know, and for a worktree
    that keeps both rules. The first rule: a package whose `package-lock.json` is the
    main checkout's byte for byte links its `node_modules` there, and a directory of
    its own in its place is a defect. The second: a commit of the branch since it left
    `main`, merges aside, carries `web/dist` only under a subject starting with
    `BUNDLE_COMMIT`. Without a `main` to measure from, the second rule is not judged.
    The runners call this before their first step and refuse a tree it names.
    """

    found = git_worktrees.git_text(
        str(root),
        "rev-parse",
        "--path-format=absolute",
        "--show-toplevel",
        "--git-dir",
        "--git-common-dir",
    )
    lines = found.stdout.splitlines()
    if found.returncode or len(lines) != 3:
        return []
    top, own, common = (Path(line) for line in lines)
    if git_worktrees.canonical(own) == git_worktrees.canonical(common):
        return []
    main = common.parent
    said = []
    for name in release.NPM_PACKAGES:
        modules = top / name / "node_modules"
        if (
            modules.is_dir()
            and not git_worktrees.is_reparse_point(str(modules))
            and _same_bytes(top / name / "package-lock.json", main / name / "package-lock.json")
        ):
            said.append(
                f"{modules} is a copy of its own, though its package-lock.json is the main"
                f" checkout's: remove that copy, then run"
                f" python -B {main / 'tests' / 'worktree.py'} link {top}"
            )
    base = git_worktrees.git_text(str(top), "merge-base", "main", "HEAD")
    if base.returncode == 0 and base.stdout.strip():
        carried = git_worktrees.git_text(
            str(top),
            "log",
            "--no-merges",
            "--format=%h %s",
            f"{base.stdout.strip()}..HEAD",
            "--",
            "web/dist",
        )
        for line in carried.stdout.splitlines():
            commit, _, subject = line.partition(" ")
            if not subject.startswith(BUNDLE_COMMIT):
                said.append(
                    f"commit {commit} ({subject}) carries web/dist: take web/dist out of it;"
                    f" only the integrator rebuilds it, in a commit whose subject starts"
                    f" {BUNDLE_COMMIT}"
                )
    return said


def add(
    main: Path, worktree: Path, *, branch: str | None, detach: bool, commit: str | None
) -> list[str]:
    """`git worktree add`, then the links `link_modules` makes."""

    # Quiet, because Git writes its checkout progress even to a pipe.
    arguments = ["worktree", "add", "--quiet"]
    try:
        if branch is not None:
            arguments += ["-b", git_worktrees.safe_ref(branch)]
        if detach:
            arguments.append("--detach")
        arguments.append(str(worktree))
        if commit is not None:
            arguments.append(git_worktrees.safe_ref(commit))
    except git_worktrees.PathSafetyError as error:
        raise RefusalError(str(error)) from error
    added = git_worktrees.git_text(str(main), *arguments)
    if added.returncode:
        raise RefusalError(f"git worktree add refused: {added.stderr.strip()}")
    return [f"added {worktree}", *link_modules(main, worktree)]


def remove(main: Path, worktree: Path) -> list[str]:
    """Take the module links out of `worktree`, then `git worktree remove` it."""

    record = _registration(main, worktree)
    if "locked" in record:
        reason = record["locked"] or "no reason given"
        raise RefusalError(
            f"{worktree} is locked ({reason}): unlock it with git worktree unlock first"
        )
    status = git_worktrees.git_text(str(worktree), "status", "--porcelain")
    if status.returncode:
        raise RefusalError(f"git status failed in {worktree}: {status.stderr.strip()}")
    if status.stdout.strip():
        raise RefusalError(
            f"{worktree} has changes, so Git would not remove it:\n{status.stdout.rstrip()}"
        )
    said = []
    for name in release.NPM_PACKAGES:
        modules = worktree / name / "node_modules"
        if git_worktrees.is_reparse_point(str(modules)):
            unlink_directory(modules)
            said.append(f"{name}: link removed")
    removed = git_worktrees.git_text(str(main), "worktree", "remove", str(worktree))
    if removed.returncode:
        raise RefusalError(
            f"git worktree remove refused: {removed.stderr.strip()}"
            + (
                f"; the module links are already out, `link {worktree}` puts them back"
                if said
                else ""
            )
        )
    if os.path.lexists(worktree):
        left = sorted(entry.name for entry in os.scandir(worktree))
        said.append(f"left in {worktree}, which Git did not remove: {', '.join(left) or 'nothing'}")
    else:
        said.append(f"removed {worktree}")
    return said


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="tests/worktree.py", description=__doc__.split("\n\n")[0])
    commands = parser.add_subparsers(dest="command", required=True)
    adding = commands.add_parser("add", help="make a worktree and link its modules")
    adding.add_argument("path", type=Path)
    starts = adding.add_mutually_exclusive_group()
    starts.add_argument("-b", "--branch", help="the new branch the worktree checks out")
    starts.add_argument("--detach", action="store_true", help="check the commit out detached")
    adding.add_argument(
        "commit", nargs="?", help="what the worktree starts from (Git's default: HEAD)"
    )
    linking = commands.add_parser("link", help="link the missing modules of an existing worktree")
    linking.add_argument("path", type=Path)
    removing = commands.add_parser("remove", help="take the links out, then remove the worktree")
    removing.add_argument("path", type=Path)
    return parser


def main(argv: Sequence[str] | None = None, *, root: Path = ROOT) -> int:
    options = _parser().parse_args(argv)
    worktree = options.path.absolute()
    try:
        checkout = main_checkout(root)
        if options.command == "add":
            said = add(
                checkout,
                worktree,
                branch=options.branch,
                detach=options.detach,
                commit=options.commit,
            )
        elif options.command == "link":
            said = link_modules(checkout, worktree)
        else:
            said = remove(checkout, worktree)
    except RefusalError as refusal:
        sys.stderr.write(f"worktree: {refusal}\n")
        return 1
    sys.stdout.writelines(f"{line}\n" for line in said if line)
    return 0


if __name__ == "__main__":
    sys.exit(main())
