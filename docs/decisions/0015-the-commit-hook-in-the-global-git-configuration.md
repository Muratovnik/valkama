---
status: draft
---

# ADR 0015: Valkama keeps its commit hook in the global Git configuration

## Context

Valkama attaches each commit an agent's shell makes to the task that agent's
session holds. For that it has to see the commit when it is made, in every
repository the agent works in, without a step the agent or a person has to
remember.

Git has two places a hook can come from. The hook directory (`.git/hooks`, or
the one `core.hooksPath` names) holds one script per event, and on a machine
where another tool already set `core.hooksPath` that directory and its
scripts are that tool's. A recent Git also runs hooks named in its
configuration: `hook.<name>.command` runs on each `hook.<name>.event`, in
addition to the hook directory's script and before it (Git 2.56.1), and it
needs no script in the directory to delegate to it.

The global configuration is a file Valkama shares with everything else on the
machine: the user's identity, credential helpers, other tools' settings and
hooks.

## Decision

1. **Three hooks of Valkama's own, in the global configuration.**
   `hook.valkama-commit` runs on `post-commit`, `hook.valkama-rewrite` on
   `post-rewrite` and `hook.valkama-merge` on `post-merge`. Three names rather
   than one with three events, because Git does not tell a command which event
   ran it. The global scope reaches every repository the user commits in, the
   ones cloned later included.
2. **Valkama writes these three and nothing else in that file.**
   `valkama git-hook install` writes each name's command and event with
   `git config --global --replace-all`; the names are Valkama's, so a command
   or an extra event found under one of them is replaced. `valkama git-hook
   uninstall` removes the three sections whole with `--remove-section`, which
   leaves the file with the bytes it had before the install when nothing else
   changed it in between. `core.hooksPath`, the hook directory and every other
   entry are never read for a decision and never written.
3. **The command follows the launcher.** It is a guard in `sh` that ends at once
   when the environment names no client session, then the launcher's shim run
   on the interpreter the launcher's manifest records, with `-I -S`; a
   virtualenv's interpreter is replaced with the base one its `pyvenv.cfg`
   names, which saves the second process a virtualenv starts on Windows. The
   paths are absolute and the command reads no variable but the guard's, so it
   runs the same from every shell. Install refuses while no launcher is
   installed. `valkama launcher install` rewrites the command of each hook that
   is there and adds none; a failure there is named in `git_hook_error` and
   leaves the launcher installed, as a failed skill refresh does.
4. **Valkama says what state the hooks are in.** `valkama git-hook status`
   reads each as `installed`, `missing`, `stale` (a command or event other than
   the current launcher's), `disabled` (`hook.<name>.enabled` false in the
   global file) or `unsupported` (Git does not list it in
   `git hook list --show-scope`), with the commit records waiting and the
   directories they wait in. `valkama doctor` reports the same as its
   `commit-hook` check, and the records waiting for over an hour or set aside
   in `commits/rejected/` as `commit-records`. `valkama setup` offers the hook
   as a finding of its own, and `--apply` installs it after the launcher.
5. **No test writes a real global file.** Importing the tests package points
   `GIT_CONFIG_GLOBAL` at a file of the suite's own, which carries only the
   caller's identity and safe directories, and `tests/isolated.py` gives every
   gate a file in its throwaway profile. A test commit made inside an agent's
   shell then also runs no hook a machine has installed.

## Consequences

- Nothing is required of the hook directory or of whoever set it, and a
  machine without Valkama's hooks loses nothing else.
- A repository can switch one hook off for itself with
  `git config hook.valkama-commit.enabled false`. `--no-verify` does not skip
  `post-*` hooks.
- A Git that does not run hooks from its configuration reads as
  `unsupported`, and Valkama then learns of commits only from the check when a
  task closes and from manual attachment.
- `valkama launcher uninstall` leaves the hooks in place, and they then run a
  shim that is gone: `doctor` reports them `stale`. Run `git-hook uninstall`
  before removing the launcher.
- Additions only: a new command, a new `doctor` group with two checks, a new
  `setup` finding, and the `git_hook` and `git_hook_error` fields of
  `launcher install`. No existing answer changes meaning.
- Rejected: a script in the hook directory (it belongs to whoever set
  `core.hooksPath`, and Valkama would have to install into another tool's
  directory or ask it to delegate); hooks in each repository's local
  configuration (every registered repository, and again for each new clone);
  writing the file directly (`git config` knows its format, quoting and
  includes); and adding missing hooks on `launcher install` (removing one is a
  choice that pinning a release must not undo).
