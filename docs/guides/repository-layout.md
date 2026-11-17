# How the repository is laid out

Where each part of Valkama lives, for a reader about to change one. Where a new
file goes is in [`CONTRIBUTING.md`](../../CONTRIBUTING.md#where-things-go).

| Path | Owns |
| --- | --- |
| `valkama.py` | the source entry point — it prepares `sys.path` and hands off to `server/cli.py`; a few commands are dispatched before the command line is imported: `hook` to `server/hooks/entry.py`, `statusline` to `server/hooks/statusline.py`, `mcp` to the stdio front in `server/mcp_front.py`, `serve --on-demand` to `server/on_demand.py`, and the read-only `runtime` and `launcher` queries of the tray and the desktop app to `server/launcher_queries.py` |
| `server/` | the Python server, managed launcher, domain modules, and CLI/HTTP/MCP surfaces; the skill clients install (`server/skill/`) and the Claude Code mod (`server/mod/`) |
| `.claude-plugin/` | the marketplace file that makes the repository a Claude Code marketplace listing the mod |
| `web/` | the Vue application, its build and its tests |
| `desktop/` | the Electron window — its own npm package, tests and release output |
| `windows/` | what exists only because the host is Windows: the tray script, the icon, its generator, the installer |
| `tests/` | the Python suite, mirroring `server/` |
| `docs/` | the product's written contracts, and these guides in `docs/guides/` |

`windows/` is separate from `desktop/` because they answer different questions.
`desktop/` is an application — JavaScript, npm, an asar. `windows/` is
PowerShell, an `.ico` and an NSIS installer, and the Electron app is one of its
consumers rather than its owner.
