# Installation and setup

The README's [Install](../../README.md#install) and
[Quick start](../../README.md#quick-start) get Valkama running for your agent
clients. This guide explains what those steps set up, and covers the rest of an
installation: checking it, setting it up again, and the desktop app. Launcher
ownership, releases and relocation are specified in
[`SERVICE.md`](../../SERVICE.md).

## What the launcher pins

`python valkama.py launcher install` installs the stable command that agent
clients register, at the path `launcher status` reports in its `command` field.
The user-facing command contains no source-checkout path. It runs a pinned
release: the checkout's current commit, copied out with `git archive` and never
edited, so uncommitted work in the checkout never reaches a client session or
the store it opens. Run `launcher install` again to publish newer commits, or
with `--revision <commit>` to go back to an earlier release (a release from
before `valkama hook` is answered by the shim with silence and exit 0 when a
client hook calls it; see `SERVICE.md`). A managed Python
shim beside the command is the durable process identity; its manifest records
the release's `valkama.py`, the pinned commit, the interpreter and managed
hashes. Agent clients, the tray and the desktop all use that verified pair.
After moving the checkout, run `launcher install` once from the new location;
client configuration and listener ownership remain unchanged. See
[`SERVICE.md`](../../SERVICE.md) for releases, ownership, safe listener
reconciliation, drift handling, uninstall and relocation details.

A release's `valkama-<version>-source.zip` installs without Git. Unpack it whole
into an empty directory and, in that directory, run:

```bash
python valkama.py launcher install
```

The archive's `valkama-source.json` records the commit it was built from and the
SHA-256 of every file it holds. The install checks each file against it and pins
that commit, as a clone of the commit would. A file changed or missing since is
refused by name: unpack the archive again. A file the record does not list is not
copied, and `--revision` accepts only the archive's commit.

## Client registration

The Codex registration names the absolute path `launcher status` returned. This
absolute path belongs to the installed service launcher, not to the source
checkout.

`VALKAMA_AUTHOR` is the name Planning claims and comments are signed with when an
MCP tool call names no `author` of its own. Give each client a different one in
its registration. Without the variable, the `author` in `config.json` applies; with
neither, the name is `agent`.

`python valkama.py skill install` writes the Valkama skill for each client this
user has, where that client finds its user's skills (`~/.claude/skills/valkama`,
`~/.agents/skills/valkama`), from the release the launcher pins, and
`launcher install` keeps it in step. It edits no client configuration; see
[`SERVICE.md`](../../SERVICE.md#install-the-skill).

## Checking an installation

For local diagnostics without opening or migrating the database:

```bash
python valkama.py status
```

To set it up again, or check that it is right:

```
python valkama.py setup
```

It reports what this installation has — Python, Git, a verified stable launcher,
and whether each agent client runs that launcher with its required author and
UTF-8 environment — and prints the exact command sequence for anything missing
or stale. It changes nothing until you add `--apply`.

It never edits `~/.claude.json` or `~/.codex/config.toml`. Both clients own
their registration through their own CLI, so this reads through `claude mcp get`
and `codex mcp list --json` and writes through `claude mcp add` and
`codex mcp add`, which know their own file's format and scopes.

The check worth having is not "is a server registered" but "does it use the
verified service launcher": a registration left pointing at a checkout that
moved keeps working until it does not, and says nothing in between. A stale
registration is removed before its launcher-backed replacement is added.

`python valkama.py doctor` checks the whole installation in four levels —
Installation, Projects, Capabilities, Connections — and says what to do about
each problem; the [command reference](commands.md) lists its options. Among
the Installation checks, its Desktop app line says whether the installed desktop
app was built from the release the launcher pins; see
[The desktop app (Windows)](#the-desktop-app-windows).

## The desktop app (Windows)

The release's `Valkama-Setup-<version>.exe` installs the desktop window. It
requires the source service, Python 3.11+, and the managed launcher from step 2
of [Install](../../README.md#install); the installer does not bundle a Python
backend. For a fresh installation, run the installer after installing the
launcher. If an older Agent Kanban or Agent Hub desktop app is installed, use the
migration script below from the source directory to remove those registered
copies before installing the new one.

To build the desktop installer from source:

```powershell
cd desktop
npm ci
npm run dist                            # builds release/Valkama Setup <version>.exe
cd ..
.\windows\install-desktop.ps1 -WhatIf   # show what would change
.\windows\install-desktop.ps1 -Build    # rebuild, remove older copies, install
```

The migration script is needed across past renames because each changed the NSIS
`appId`, so a new installer lands *beside* the old copy instead of over it.
`install-desktop.ps1` reads what is actually registered under `HKCU`, stops
anything running from those directories, runs each old copy's own uninstaller,
and installs the current one. It only ever touches something registered under
one of this product's names *and* installed under `%LOCALAPPDATA%\Programs`;
anything else is reported and left alone.

The desktop app is a separate artifact: `launcher install` publishes the server
and the web build and leaves the installed app as it was, and the app's version
in `desktop/package.json` stays the same while its sources change. So
`launcher status` reports, in its `desktop_app` field, whether the installed app
packs the `desktop/` sources of the release the launcher pins, and `doctor` shows
the same answer as its Desktop app line. Neither installs, starts or changes
anything. The check compares the bytes of each file the release's build
configuration packs with the file in the app's `resources\app.asar`, and
`package.json` without the keys the build drops:

| `desktop_app.state` | `doctor` | Meaning |
| --- | --- | --- |
| `current` | ok | the app packs the release's desktop sources |
| `differs` | warn | the files in `differs` are not the release's; `fix` names the reinstall |
| `unreadable` | warn | the app's archive or the release's desktop sources cannot be read; `detail` says which |
| `no-release` | unknown | the launcher pins no release to compare with |
| `absent` | ok | no desktop app is installed |
| `unsupported` | no line | not Windows |

For `differs`, install the app from the commit the launcher pins:
`.\windows\install-desktop.ps1 -Build` in a source checkout at that commit, or
that release's `Valkama-Setup-<version>.exe`. When the app is the newer of the
two, `launcher install` from the app's commit pins the matching release instead.

What the window and the tray do once installed is in
[The desktop app and the tray](desktop-and-tray.md).
