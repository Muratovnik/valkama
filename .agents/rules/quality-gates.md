# Quality gates: composition, ratchets, and the traps that earned their sentences

Routed from `AGENTS.md`. Read this before touching the toolchain, the test
suite, or any number a gate compares against. The gate command list itself
stays in `AGENTS.md`; this file is why each gate exists and how it bites.

`npm test` runs oxlint, ESLint, Prettier, Stylelint, the UI-system guard, knip
and jscpd before the suites; `npm run format` applies the two formatters.
`npm run test:browser` adds the axe pass over the harness surfaces, and
`desktop`'s own `npm test` asserts the renderer options and the packaged fuse
set as text, because configuration is what silently reverts and no test of
behavior can see it. The browser suite serves the harness on 4174 and the built
app on 4175 and never reuses a server, so a second checkout running it at the
same time sets `VALKAMA_BROWSER_PORT` to another harness port; the app takes the
next one.

semgrep is the only dataflow analysis here: ruff matches patterns, semgrep
follows a tainted value through a function. It reads the Python server alone,
because it does not parse `.vue`; the web side is covered by
eslint-plugin-security through vue-eslint-parser. Registry rules are fetched
once and cached, so the first run on a fresh machine needs the network. It
scans only files Git knows about: a new module that is not yet staged is
skipped without a word, so stage new files (`git add -N` is enough) before
reading its result as covering them.

Run the Python gates from the ignored `.venv`, built from
`requirements-dev.txt` (`uv venv .venv --python 3.11`, then
`uv pip install --python .venv/Scripts/python.exe -r requirements-dev.txt`),
with `.venv/Scripts` first on `PATH`. A shared interpreter drifts: an
unpinned semgrep and mcp 2.x there broke the gate, because semgrep imports
`mcp.server.fastmcp` at start and mcp 2 removed it. `PATH` matters even with
the venv present, since the `semgrep` launcher finds `pysemgrep` through it
and otherwise runs the shared copy.

`python tests/isolated.py gates --out DIR` runs the `AGENTS.md` list from that
venv in one call: only the child sees the redirected `HOME`, `USERPROFILE`,
`LOCALAPPDATA`, `APPDATA` and `VALKAMA_DB`, and every step's exit code counts.
`--only python` is the Python half; `--owner` is the audit with the owner policy.
Use it instead of a wrapper of your own, and `serve --out DIR` with
`stop --out DIR` for a live check; a test compares its steps with `AGENTS.md`.
It does not move `TEMP`, which is what keeps the suite's renames from failing
with `PermissionError`. `tests/isolated.py` states the rest of its reasons.

An npm gate on modules its lockfile does not pin fails in a way that reads as a
defect in the code, so neither runner lets that happen, each in its own way.
`windows/release.py check` runs `npm ci` in `web` and `desktop` ahead of every
stage, because Release Kit runs it in the main checkout's working tree and a
release must verify what the lockfile pins. `tests/isolated.py gates` installs
nothing: before each npm step it compares `node_modules/.package-lock.json` with
`package-lock.json` and refuses that step, saying where `npm ci` is needed, on a
missing tree, a difference or a comparison it could not make. A refused step does
not start and the run does not pass. Two entries match when `version`, `resolved`
and `integrity` agree; the rest of an entry and the top of the file are npm's
bookkeeping. The hidden file has no root entry and leaves out optional packages
this platform skips, so only an entry marked `optional` may be missing from it.

`npm ci` through a linked `node_modules` empties the link's target and then
replaces the link with a directory, so a worktree linking the main checkout's
modules would strip them from every checkout sharing them. `check` refuses a link,
and a gate's refusal says to remove it first. `gates` still reads through a link,
so a worktree may share modules as long as they match its own lockfile. The other
side of sharing: a release's `npm ci` in the main checkout replaces what those
worktrees run on while it lasts.

`lint-imports` is the one-way import rule `AGENTS.md` states in prose, stated
as configuration so a tool refuses a breach instead of a reviewer noticing one.
mypy checks the modules that are already clean and names the rest in
`[[tool.mypy.overrides]]` with what each owes; that list is a ratchet to empty
module by module, never to grow, and a module absent from it — including every
new one — is checked. Both read the repository root as the import root, which
is what it is: `server` sits directly in it.

knip owns dead code on the web side: unused files, exports, types and
dependencies all fail `npm test`. A symbol used only inside its own file must
not be exported, because the `export` keyword is what hides it from
`noUnusedLocals`. `npm run lint:dead -- --fix --include exports` removes those
keywords mechanically; the compiler then reports whatever was dead all along.

The suite runs under coverage because a floor is the only thing that notices a
test being deleted. `fail_under` in `pyproject.toml` is a ratchet: raise it when
the measured figure rises, never lower it to make a run green. Deleting a test
and lowering the floor to match is the one move it exists to prevent.

One trap worth knowing: coverage records line numbers and resolves them against
the file as it is when the report runs. Reformat a measured file before
reporting and the figure is nonsense — the ratchet fired once on a two-line
shift that `ruff format` had introduced after the run.

Two test files state properties rather than examples, and `property_settings.py`
owns how Hypothesis is configured for both. `test_contract_properties.py` says
what every identity-ref validator and the adapter manifest validator do with
any accepted payload;
`test_board_properties.py` drives arbitrary sequences of board operations
against a throwaway store and asserts what every sequence leaves true. They are
the reason the suite now needs a third-party package at all: the server still
imports nothing outside the standard library, but the tests no longer run on a
machine where `requirements-dev.txt` was never installed.

Discovery starts at the repository root because that is the import root: it is
not itself a package, so unittest puts it on `sys.path`, which is what makes
`server` and `tests` importable. It used to start one level down, inside a
directory that held the whole product while the repository around it held only
that product's configuration. Flattening removed the level; discovery still
starts here, and every test lives under `tests/`.
