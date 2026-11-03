# Valkama service contract

Valkama owns the command that clients, the tray and the desktop use to start it.
None of them points directly into the source checkout: the command runs a pinned
release, one commit of the checkout copied out and never edited.

## Install the launcher

From the current checkout:

```text
python valkama.py launcher install
python valkama.py launcher status
```

The result is JSON containing `command` and `args`. The default command is:

- Windows: `%LOCALAPPDATA%\Valkama\bin\valkama.cmd`
- macOS/Linux: `$XDG_BIN_HOME/valkama` or `~/.local/bin/valkama`

The launcher directory contains three managed files: the user-facing command, a
Python shim and a hash manifest. The command itself contains no checkout path.
The manifest records the release's `valkama.py`, the commit it was pinned from
(`revision`), the checkout it came from (`checkout`), the exact Python
interpreter and the hashes that let every local surface verify the command and
shim before use.

## Pinned releases

`launcher install` writes the commit it is given (`--revision`, default `HEAD`)
with `git archive` into the releases directory (`--releases` overrides it):

- Windows: `%LOCALAPPDATA%\Valkama\releases\<commit>`
- macOS/Linux: `$XDG_DATA_HOME/valkama/releases/<commit>` or
  `~/.local/share/valkama/releases/<commit>`

Only committed files reach a release, so an unfinished edit in the checkout
cannot break or migrate anything a client session opens. Each new client session
spawns its own server, and that server opens the live store; with a pinned
release, code reaches the store only when someone runs `launcher install`. That
is the one step that publishes the checkout's newer commits to clients, and the
step at which a raised store schema migrates the store.

A release is staged and renamed into place whole, with a record of every file's
hash. Installing a commit that already has a release reuses it after checking
those hashes; a release that has been edited is refused, not repaired, because a
running server may be using it. Releases are kept after a newer install, so the
previous one is the rollback:

```text
python valkama.py launcher install --revision <previous commit>
```

Run `launcher autostart disable` first when the previous release has no
`serve --on-demand`: it would exit at login with nothing on the port.

A release from before `valkama hook` does not know that command, and its
argument parser exits 2, which Claude Code reads from a prompt or tool hook as
blocking the prompt or the call. The shim therefore answers `valkama hook`
itself, with exit status 0 and nothing on stdout, whenever the pinned release
has no `server/hooks/entry.py`; every other command still reaches the release.
The shim is written by the launcher code that runs `launcher install`, so roll
back with a build that has this guard -- the stable command of the current
release, or a checkout at least that new -- not with the older release's own
`launcher install`.

A running session follows the pin. The stable command's `mcp` starts a stdio
front that holds the client's pipe and runs the pinned release's server as a
child process. Within a few seconds of `launcher install` the front stops that
server between two requests, starts the newly pinned release, and tells a client
that can hear it that the tool list changed. So `launcher install` reaches
running sessions at once, and an install that raises the store schema migrates
the store through the first session that switches, or, with none running, when
the next session opens it.

A release that does not start leaves the session on the release it had, and
the next tool result carries one warning naming it and why. The store schema
still governs the opposite case: a release older than the store refuses to open
it, so pinning back past a schema raise leaves running sessions where they are
and makes new ones fail to start. A session opened with a release from before
the front warns until its client restarts it, as it always did. What the front
keeps and what each client does with the notification are in
[the connection contract](docs/connection-contract.md#a-release-switch-under-a-running-session).

The stable command can install too. Run from a release, `launcher install` pins
from the checkout that release was copied from; `--checkout` names another one.

## Move the checkout

Moving the repository requires one install from the new checkout:

```text
python /new/path/valkama.py launcher install
```

The stable command and shim paths do not change, so client configuration and
listener ownership remain valid. A listener started before the move still names
that same shim in its process command line; after the install, the tray or
desktop can safely replace it if its runtime is stale. A missing release is
reported as unavailable but does not erase managed ownership, so installing
again needs no relocation exception or old-path scan.

An edited or partially missing managed file is reported as `drifted` and is not
overwritten or removed without `--force`.

Remove only the managed launcher files with:

```text
python valkama.py launcher uninstall
```

Uninstalling leaves the releases directory alone. Delete a release yourself once
no Valkama process runs from it.

## Managed listener lifecycle

The tray and desktop calculate runtime identity and start `serve` with the
verified Python/shim pair from launcher status. They do not use a checkout entry
point, desktop install record, `VALKAMA_SCRIPT` or interpreter override.

The backend identity covers `valkama.py`, Python modules under `server/`, and
`VERSION`; the UI identity covers the built files under `web/dist/`. Development
dependencies, tests and local recovery copies do not change a running service's
identity. A changed release version does, and an existing MCP process keeps the
release label and build identity it captured at startup.

On Windows, the launcher can report or stop the listener on the configured
port:

```powershell
$launcher = (python .\valkama.py launcher status | ConvertFrom-Json).command
& $launcher launcher listener status --port 8642
& $launcher launcher listener stop --port 8642
```

Listener ownership requires both the exact normalized interpreter path from the
launcher manifest, or the `pythonw.exe` beside it, and the exact managed shim path
as that process's script argument. Comparison is Win32-style ordinal case-insensitive; Unicode folding
cannot turn a different path into the managed path. A Valkama-shaped HTTP
response or runtime JSON is never stop authority.

Every inspection also carries the process creation timestamp. Before stop, the
launcher holds a Windows process handle, repeats the port/PID/executable/shim/
creation check, and terminates only through that handle. A disappeared,
substituted or malformed identity is left untouched. A stale managed listener
can therefore be replaced after a checkout move, while a truly foreign listener
is reported with its PID and accompanied by the choice to stop it yourself or
use another port. Listener process inspection is currently Windows-only,
matching the tray and desktop platforms.

### Holding the port from login

A work item's address works only while something listens on the port. On Windows
the launcher can keep something there from login without the cost of a server
nobody is using yet:

```powershell
& $launcher launcher autostart enable --port 8642
& $launcher launcher autostart status
& $launcher launcher autostart disable
```

`enable` writes one value, `Valkama`, under
`HKCU\Software\Microsoft\Windows\CurrentVersion\Run`. It runs
`serve --on-demand` through the managed shim with the `pythonw.exe` beside the
recorded interpreter, so no console window opens, and it starts that listener now
when the port is free. Autostart is off until you enable it. A value under this name
that runs another command is reported as `foreign` and left alone unless you pass
`--force`. `doctor` shows the state in one line. `disable` removes the value and
leaves a running listener until logout or `listener stop`.

`serve --on-demand` binds the port with no part of the server loaded. On the first
connection the server has to answer, it loads the server into the same process and
serves the same socket, so that connection is answered rather than redirected or
dropped. One read is answered without it: a process about to show a Windows
notification asks `GET /api/alerts/presence` whether a page already shows the item,
and no page can be open before the server is loaded, so the answer is
`{"visible":false}` and the listener stays small. To the desktop app,
the tray and `listener status` or `stop` it is an ordinary managed listener;
`listener status` adds `"on_demand": true`.

- **The port is taken.** It touches nothing and tries the bind again every 30
  seconds, so it takes the port within 30 seconds of the desktop app closing the
  server it started.
- **The server cannot be loaded.** The connection gets a 503 page, the traceback goes
  to `on-demand.log` beside the launcher's files (`%LOCALAPPDATA%\Valkama` on Windows,
  `~/.local/share/valkama` elsewhere), and a later connection tries again, no sooner
  than 5 seconds after the failure. The log stays out of `~/.valkama`, because an
  existing directory there would read as a store already adopted.
- **`launcher install`.** A listener held on demand would load the old release on
  the next connection, so `install` stops it through the check above and starts it
  from the new release. It rewrites the autostart value when autostart is on, and
  starts a listener only if one was running or autostart is on. A plain `serve` and
  a foreign listener are left alone. A waiting listener that `install` could not
  reach hands over to the pinned release at its next bind attempt or connection.
- **`launcher uninstall`.** It removes a value naming this shim and stops a listener
  held on demand. Another program's value stays.

The log records how long each load took, as `serving after N s`. The desktop app
gives a managed listener about 2.5 seconds to answer. If the first load takes longer
it reports the server as out of date and offers a restart. That restart looks again
first and keeps the listener if the load has finished by then. If it has to stop the
listener, the app runs a server of its own, and links stop working once the app
closes, until the next login or `autostart enable`.

## Register clients

Claude Code, PowerShell example:

```powershell
$launcher = (python .\valkama.py launcher status | ConvertFrom-Json).command
claude mcp add valkama --scope user --env VALKAMA_AUTHOR=claude --env PYTHONUTF8=1 --env PYTHONIOENCODING=utf-8 -- $launcher mcp
```

Codex configuration, using the `command` returned by launcher status:

```toml
[mcp_servers.valkama]
command = "C:/Users/<user>/AppData/Local/Valkama/bin/valkama.cmd"
args = ["mcp"]
env = { VALKAMA_AUTHOR = "codex", PYTHONUTF8 = "1", PYTHONIOENCODING = "utf-8" }
```

The absolute value is an installed service path, not a source-checkout path.
`python valkama.py setup` verifies the managed launcher and both registrations;
with `--apply`, it removes a stale registration before adding the replacement.

## Install the skill

Valkama ships a skill, `server/skill/valkama`, that tells an agent how to work
the planning tools: finding and claiming an item, keeping its checklist,
batching writes, merging duplicates and closing it. Install it for the clients
this user has:

```text
valkama skill install
valkama skill status
```

`valkama` is the stable command `launcher status` names; from a checkout,
`python valkama.py skill install` does the same. Each client gets a copy where it finds its user's skills by itself, so neither
client's configuration is touched:

| Client | Copy |
| --- | --- |
| Claude Code | `~/.claude/skills/valkama`, or `$CLAUDE_CONFIG_DIR/skills/valkama` when that is set |
| Codex | `~/.agents/skills/valkama` |

Without `--client`, `install` writes for each client whose own directory
exists (`~/.claude` or `$CLAUDE_CONFIG_DIR`, `~/.codex` or `$CODEX_HOME`);
`--client claude` or `--client codex`, repeatable, names them. The files come
from the release the launcher pins, so the skill describes the tools clients
run; with no launcher installed they come from the code that runs the command.
Both clients notice a new or changed skill in a running session. A Claude Code
session started before `~/.claude/skills` existed needs `/reload-skills` or a
restart, and Codex needs a restart when a change does not appear.

A copy is Valkama's while a manifest beside its files, `.valkama-skill.json`,
records their digests. `status` reads each copy as `missing`, `installed`,
`outdated` (from another release), `drifted` (a file edited, removed or added)
or `unmanaged` (a `valkama` skill Valkama did not write). `install` leaves an
installed copy as it is, refuses a drifted or unmanaged one without `--force`,
and with it writes the skill's files and names any other file it left.
`launcher install` refreshes every installed or outdated copy to the release it
pins and reports them under `skills`; it installs none for a client that has
none. `valkama skill uninstall` removes the files a manifest names and the
directory once it is empty, refuses a drifted copy without `--force`, and never
removes an unmanaged one. `valkama doctor` reports each copy under the
installation level. A refused `install` or `uninstall` exits with status 1.

## Machine-readable discovery

```text
python valkama.py capabilities
python valkama.py status
```

`capabilities` reports the supported MCP revisions, tool count and public
surfaces without reading user data.

`status` reports source identity, database path and existence, runtime identity
and launcher state. It does not open, create or migrate the SQLite database.
