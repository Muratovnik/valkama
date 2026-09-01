# Contributing to Valkama

Thanks for looking. This is a tool one person built for their own development
loop and published because it might be useful to yours. Issues and pull requests
are welcome; replies are best-effort, not same-day.

## Before you write code

**Open an issue first for anything structural** — a new module, a schema change,
a new dependency, a change to how the MCP surface behaves. The architecture here
has a few hard rules (below) and it is cheaper to hear about them before you
write than in review.

**Small fixes need no ceremony.** A wrong string, a crash, a broken link — send
the pull request.

## Setting up

```bash
git clone <your fork>
cd valkama
pip install -r requirements-dev.txt     # the gate toolchain; the server needs none of it
python valkama.py serve                 # http://127.0.0.1:8642/
```

Python 3.11 or newer. If you touch the UI or the desktop shell you also need
Node 20.19+ or 22.12+:

```bash
cd web     && npm ci
cd desktop && npm ci
```

## The gates

Every change runs all of these, from the repository root. GitHub CI runs the
same pinned Python, web, and desktop gates on Windows; run them locally before
you open a pull request so a remote runner is not the first place the change is
exercised.

```powershell
python -m ruff check .
python -m ruff format --check .
typos
vulture server tests valkama.py vulture_whitelist.py --min-confidence 60
mypy
lint-imports --cache-dir .cache/import-linter
semgrep scan --config p/python --config p/security-audit --metrics off --error server valkama.py
python -m coverage run -m unittest discover -s . -p "test_*.py"
python -m coverage report
cd web
npm test
npm run typecheck
npm run build
cd ../desktop
npm test
```

The toolchain is pinned in `requirements-dev.txt` and configured in
`pyproject.toml`. Do not loosen a pin to make a gate pass.

## Rules that will send a pull request back

These are not style preferences. Each one is here because breaking it cost
something once.

1. **The server imports nothing outside the Python standard library.** Your
   agent client launches it with whatever `python` it finds and no virtualenv,
   so a new runtime dependency is a control surface that silently fails to
   appear.
   Development tools are fine; runtime imports are not.

2. **Imports run one way.** A surface (`cli`, `http_surface`, `mcp_surface`) may
   import a domain module. A domain module may never import a surface, and no
   surface imports another. `cli` is the one exception by construction, since
   choosing between the other two is what it is for. `lint-imports` enforces
   this.

3. **Rebuild and commit `web/dist` whenever you change `web/src`.** The built UI
   is committed on purpose, so a fresh clone serves the UI with no build step.
   A source change without its rebuild ships an interface that does not match
   the code.

4. **Ratchets only tighten.** The mypy overrides list only empties, the coverage
   floor only rises. A module absent from a list is checked, not skipped.

5. **`store.STORE_SCHEMA_VERSION` goes up in the same commit that changes what
   an existing row means.** Migrations are forward-only and idempotent, so an
   added column does not need it — a changed meaning does. This is what makes an
   older build refuse a newer store instead of misreading it.

6. **Supported external MCP handshake and tool schemas stay compatible.**
   Existing local data instead crosses a model change through a verified
   backup, one forward-only migration, and a tested restore path. The runtime
   keeps one schema; it does not keep parallel readers or writers. Somebody's
   Planning history is in that SQLite file.

7. **No utility CSS framework.** The web app is semantic tokens plus named
   classes, laid out in Feature-Sliced Design layers. `npm run check:ui-system`
   rejects a layering breach and a utility framework reappearing.
   [`DESIGN.md`](DESIGN.md) is the authority for anything visual.

8. **Never test a schema or data change against a live Planning store.** Use a
   throwaway store or a copy. This code can destroy work somebody is using.

## Commits

Conventional Commits, Angular type set, and the set is closed:

```
build  chore  ci  docs  feat  fix  perf  refactor  revert  style  test
```

An optional lowercase scope, and `!` for a breaking change:

```
fix(web): stop the drawer from swallowing the escape key
refactor(server)!: name the module platform and publish the contract as valkama
```

Write the subject as what the commit does, not what you did. The body is where
the reasoning goes, and reasoning is welcome — the history here is meant to be
readable years later.

## Where things go

| You are adding | It goes in |
| --- | --- |
| server logic | `server/`, as a domain module or on a surface |
| a test | `tests/`, mirroring the module it exercises |
| UI | `web/src/`, in the right Feature-Sliced layer |
| the desktop window | `desktop/` |
| anything that exists only because the host is Windows | `windows/` |
| a product contract | `docs/`, with `status:` and `card:` frontmatter |

A new file at the top level needs an argument for why it belongs to none of
those. `tests/test_docs_lifecycle.py` refuses a document under `docs/` without
its frontmatter.

## Reporting a bug

Include what you ran, what happened, and what you expected. For anything
involving the MCP surface, say which client and which of its versions —
handshake behaviour differs between them, and that is usually the answer. See
[`docs/connection-contract.md`](docs/connection-contract.md).

For a security issue, please open a private security advisory on the repository
rather than a public issue.

## License

By contributing you agree that your contribution is licensed under the
[MIT License](LICENSE), the same as the rest of the project.
