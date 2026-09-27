# Valkama service contract

Valkama owns the command that clients, the tray and the desktop use to start it.
None of them points directly into the source checkout.

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
The manifest records the current `valkama.py`, the exact Python interpreter and
the hashes that let every local surface verify the command and shim before use.

Moving the repository requires one reinstall from the new checkout:

```text
python /new/path/valkama.py launcher install
```

The stable command and shim paths do not change, so client configuration and
listener ownership remain valid. A listener started before the move still names
that same shim in its process command line; after reinstall, the tray or desktop
can safely replace it if its runtime is stale. A missing former source is
reported as unavailable but does not erase managed ownership, so reinstalling
from the new checkout needs no relocation exception or old-path scan.

An edited or partially missing managed file is reported as `drifted` and is not
overwritten or removed without `--force`.

Remove only the managed launcher files with:

```text
python valkama.py launcher uninstall
```

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
launcher manifest and the exact managed shim path as that process's script
argument. Comparison is Win32-style ordinal case-insensitive; Unicode folding
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

## Machine-readable discovery

```text
python valkama.py capabilities
python valkama.py status
```

`capabilities` reports the supported MCP revisions, tool count and public
surfaces without reading user data.

`status` reports source identity, database path and existence, runtime identity
and launcher state. It does not open, create or migrate the SQLite database.
