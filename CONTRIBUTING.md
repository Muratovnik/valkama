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
python -m venv .venv-semgrep            # semgrep's own environment, see below
.venv-semgrep/Scripts/python -m pip install -r requirements-semgrep.txt
python valkama.py serve                 # http://127.0.0.1:8642/
```

Python 3.11 or newer. If you touch the UI or the desktop shell you also need
Node 22.22.2+ or 24.15+:

```bash
cd web     && npm ci
cd desktop && npm ci
```

[Building and development](docs/guides/development.md) shows how to run the web UI
and the desktop app from source and rebuild them.

## The gates

Every change runs all of these, from the repository root. GitHub CI runs the
same pinned Python, web, and desktop gates on Windows; run them locally before
you open a pull request so a remote runner is not the first place the change is
exercised.

```powershell
python -m ruff check .
python -m ruff format --check .
python tests/commit_subjects.py
python .github/relkit.pyz audit --history
typos
vulture server tests valkama.py vulture_whitelist.py --min-confidence 60
mypy
lint-imports --cache-dir .cache/import-linter
semgrep scan --config p/python --config p/security-audit --metrics off --error server valkama.py
python tests/parallel.py --coverage
python -m coverage report
cd web
npm test
npm run build
cd ../desktop
npm test
```

The toolchain is pinned in `requirements-dev.txt` and configured in
`pyproject.toml`. Do not loosen a pin to make a gate pass. semgrep is pinned in
`requirements-semgrep.txt` instead and lives in `.venv-semgrep`, an environment of
its own: its releases pin `pywin32==311`, which has no wheel for Python 3.15, the
Python the project's `.venv` is built on. Build that environment on the newest
Python it installs on (3.14 today) and put its `Scripts` (or `bin`) directory
first on `PATH` when you run `semgrep`.

The history audit reads every commit and needs a clean tracked tree, so it runs
on the clean head before publication, not between commits. Before each commit,
`python .github/relkit.pyz audit --staged` checks what is about to be committed.

An owner checkout additionally runs `python .github/relkit.pyz protect install`
once and `python .github/relkit.pyz audit --history --owner` before publication.

`tests/isolated.py` runs that list in one call, in a throwaway profile, so a run
cannot write test projects or a store into your own. Run it with the virtual
environment built from `requirements-dev.txt`, and give it a result directory
outside the tracked tree; it has no default:

```powershell
# Every gate above; add --only python, or any step name, for part of the list.
.venv/Scripts/python tests/isolated.py gates --out tmp/gates

# A server of this checkout on a free port. It returns once the server listens,
# and prints the address, the port and the process id.
.venv/Scripts/python tests/isolated.py serve --out tmp/serve

# The same, serving a read-only copy of the store you run on, or of SOURCE.
.venv/Scripts/python tests/isolated.py serve --out tmp/serve --store-copy [SOURCE]

# Stops the server with everything it started and removes the profile.
.venv/Scripts/python tests/isolated.py stop --out tmp/serve
```

The gates write one log per step under `logs/` and `gates.txt` in the result
directory; the exit code is non-zero if any step failed or none ran. They install
nothing: an npm step on a `node_modules` that is missing or differs from its
`package-lock.json` is refused rather than run, the refusal says where `npm ci` is
needed, and the exit code is non-zero then too. The commit subject step is refused
the same way in a directory with no Git history of its own. The server
writes to `logs/serve.log`. `serve` warns before it starts when `web/dist` may be
older than `web/src`; rebuild before you look at the interface it serves. A store copy holds your real data, so it goes with
the profile when the server stops or dies. It stays on disk while the server is
running, however long that is: run `stop` when you are done. A copy of a store
Valkama 2.9 left is carried to this build's schema before the server starts, by the
commands of the migration itself run on the copy and your copied project registry:
`projects upgrade`, `projects map-items` and `migrate work-model`. Each writes its
log under `logs/`, and one that fails stops the start, naming its log.

Between commits, `tests/affected.py` picks the Python test modules a change
reaches and runs them:

```powershell
# After a commit: the modules HEAD's change reaches, run with unittest.
.venv/Scripts/python tests/affected.py HEAD~1..HEAD

# The same for the index or, with neither, the working tree; --why says
# why each module was picked, --list only names them.
.venv/Scripts/python tests/affected.py --staged --list --why
```

A test module is picked when it imports a changed module of `server/` or
`tests/`, directly or through other modules (the import graph `lint-imports`
checks), when it names a changed file outside that graph, such as a document,
a fixture or `valkama.py`, or when it is one of the modules that hold a whole
surface of the server, which run on every change under `server/`. A change to
a central module reaches most of the suite, because the tests that import the
MCP or HTTP surface import nearly all of the server through it; a selection of
more than a quarter of the test modules runs under the machine's heavy-test
lock, as the gates' `unittest` step does. For a change
under `web/` the script prints the `npx vitest related` command to run from
`web/` and runs no node itself. It picks no browser spec: those are chosen by
the route, fixture or page helper they rely on, not by import. It is the
targeted run between commits, not the gates: every change still runs the full
list above before a pull request.

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

5. **`store.STORE_SCHEMA_VERSION` goes up by one in the same commit that changes
   the store's declaration or what an existing row means.** A build opens a store
   only at its own number, so one number names one declaration: this is what
   makes a build refuse a store of another declaration instead of misreading it.
   `tests/test_store_schema_pin.py` fails a declaration change without the raise.

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

`python tests/commit_subjects.py` holds every commit reachable from `HEAD` to
this, a merge commit included, so Git's default `Merge branch …` subject fails it.

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
| a product contract | `docs/`, with `status:` frontmatter |
| a guide to using the product | `docs/guides/`, without frontmatter |

A new file at the top level needs an argument for why it belongs to none of
those. `tests/test_docs_lifecycle.py` refuses a document under `docs/`, outside
`docs/guides/`, without its frontmatter.

## Releasing

A release is cut with the Release Kit bundled at `.github/relkit.pyz`, whose
settings are `[release]` in `relkit.toml`. It runs `windows/release.py check`,
`build` and `smoke`, each with the interpreter that launched it, so launch it
with the project's virtual environment, not whatever `python` comes first on
`PATH`:

```powershell
uv venv .venv --python 3.15              # or: python -m venv .venv
uv pip install --python .venv/Scripts/python.exe -r requirements-dev.txt
uv venv .venv-semgrep --python 3.14
uv pip install --python .venv-semgrep/Scripts/python.exe -r requirements-semgrep.txt
.venv/Scripts/python .github/relkit.pyz release prepare <version>
```

Outside Windows the interpreter is `.venv/bin/python`. `check` runs every
Python tool from that interpreter's environment — as `python -m <tool>`, or as
the console script in its own `Scripts` (or `bin`) directory, which it also puts
first on `PATH` for each stage — and never a same-named tool found elsewhere on
`PATH`. Before the first stage it verifies that every package
`requirements-dev.txt` pins is installed there at that version, and that the
semgrep `requirements-semgrep.txt` pins is installed in `.venv-semgrep`, which is
where it runs semgrep from, with that environment's scripts first on `PATH`; it refuses at
once, naming the interpreter, each missing or mismatched package and what to
run, when one is not. It then runs `npm ci` for `web` and `desktop`, so it verifies
what the lockfiles pin and needs the network or an npm cache. It installs into a
temporary copy of the sources and runs every npm stage there, never in the checkout:
`npm ci` empties the tree it installs into, and other worktrees may link their
`node_modules` to the checkout's. The checkout's own `node_modules` is left as it is.
`build` needs npm and no Python tool, and `smoke` runs the
server, which needs only the standard library. The web build that `check` runs
in the copy replaces `web/dist` in the checkout; commit it only when `web/src`
changed.

### The changelog entry

The release publishes the entry `CHANGELOG.md` holds for its version, as it was
committed, and refuses a version that has none. The changelog keeps Release Kit's
`conventional-changelog` profile, which `[changelog]` in `relkit.toml` declares.
Write and commit the entry before `release prepare`. Release Kit composes it from
the history since the previous release:

```powershell
python .github/relkit.pyz notes v<next> --draft --from-tag v<prev> --write
```

`--write` inserts the entry into `CHANGELOG.md` above the previous release's and
refuses when `v<next>` already has one. `relkit.toml` sets
`units = "first-parent"`, so the entry has one line per commit on `main`'s
first-parent line: a merge stands for its whole branch and its subject is the
line, and a commit made straight on `main` is a line of its own. Lines come from
`feat`, `fix`, `perf` and `revert` subjects and from breaking changes, each linked
to its commit. That is why a change users see reaches `main` through a merge
whose subject is written for them, `feat(analytics): one scroll for the whole
page`, while a merge with nothing for users keeps `chore: merge <branch> into
main`.

The draft also prints, after `review:`, the releasable commits that reached
`main` only behind a merge with a `chore` subject, grouped by that merge, and the
breaking commits behind a merge the entry lists without marking it breaking. For
each, decide whether a user of `v<prev>` sees it, and if so, say it in the entry.
When every releasable commit is behind such merges, the draft fails and gives the
same list. A draft downloads Release Kit's pinned git-cliff when its cache lacks
it, so the first one on a machine needs the network. Then edit the entry for the
people who use the release:

- Keep only what a user of `v<prev>` sees changed. Drop a fix of something that
  first appeared in the same release, and merge the lines of one feature into one
  line that keeps their commit links.
- Write each line for that user rather than for the reviewer of the commit, and
  keep every removal, migration, breaking change, security or data-safety fix and
  changed default.
- Open the entry with a few lines under `### Highlights`. Put what breaks for a
  user under `### Breaking Changes` with what to do about it: a store schema that
  older builds refuse, its recovery point and the way back belong there or in the
  highlights.
- Set the heading's date to the release's own. An entry runs to tens of lines,
  not hundreds.

Then read the entry back as the release will:

```powershell
python .github/relkit.pyz notes v<next>
```

It prints the entry, or refuses it naming the line and the rule it breaks: the
heading compares `v<prev>` with `v<next>`, and every line under Features, Bug
Fixes and Performance Improvements carries a commit link on its first line, its
label the start of the hash. `release prepare` then refuses a link to a commit
outside the release.

Until its version is tagged, `tests/test_changelog_entry.py` holds the entry, and
`[Unreleased]`, to two more rules. A line written by hand is at most 90 characters;
a heading, a table row, a lone link and a line the draft wrote are exempt. Every
`feat`, `perf` and breaking commit on the first-parent line since `v<prev>` keeps
its link, unless a revert in the same range names it. A dropped `fix` needs none.

## Reporting a bug

Include what you ran, what happened, and what you expected. For anything
involving the MCP surface, say which client and which of its versions —
handshake behaviour differs between them, and that is usually the answer. See
[`docs/connection-contract.md`](docs/connection-contract.md).

For a security issue, please open a private security advisory on the repository
rather than a public issue.

## License

By contributing you agree that your contribution is licensed under the
[Apache License 2.0 with the Commons Clause License Condition v1.0](LICENSE), the
same as the rest of the project.
