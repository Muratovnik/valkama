# Quality gates: composition, ratchets, and the traps that earned their sentences

Routed from `AGENTS.md`. Read this before touching the toolchain, the test
suite, or any number a gate compares against. The gate command list itself
stays in `AGENTS.md`; this file is why each gate exists and how it bites.

`npm test` runs oxlint, ESLint, Prettier, Stylelint, vue-tsc, the UI-system
guard, knip and jscpd before the suites; `npm run format` applies the two
formatters. `npm run test:browser` adds the axe pass over the harness surfaces,
and `desktop`'s own `npm test` asserts the renderer options and the packaged
fuse set as text, because configuration is what silently reverts.

The browser suite serves the harness on 4174 and the built app on 4175 and never
reuses a server, so a second checkout running it at the same time sets
`VALKAMA_BROWSER_PORT` to another harness port; the app takes the next one. It
builds the app into the ignored `web/test-results/<port>/app` and keeps the run's
traces in `web/test-results/<port>/results`, so a run leaves the committed
`web/dist` as it was. Playwright empties `results` when the next run starts and
writes an attachment given as a body nowhere, so the suite's `test` copies what
each test wrote into its output directory and every body attachment into
`web/test-results/<port>/shots/<run>/`, named `<spec>__<name>`; the ten newest
runs of a port keep theirs, and a run's end says where its files are. A shot taken
only when `VALKAMA_SHOT_DIR` names a folder goes there by `requestedShot`, under
the same `<spec>__` prefix. The `server-` specs, run with `VALKAMA_BROWSER_STORE`, are
the exception: the Python server serves `web/dist` alone, so they build there.
Each command below runs in `web/`:

- One spec, under a lease at the heavy-process gate (below):
  `python ../tests/heavy_gate.py run --kind browser-targeted --want 4 -- npx playwright test <file> '--workers={k}'`.
  A name is a prefix, so give the whole file name when it begins another. Every test of the suite that bounds
  a time (`web/tests/browser/timedChecks.ts`) runs after it, alone: Playwright runs
  that project whole, and only the runner's list narrows it.
- A probe spec kept outside the suite, such as in a worktree's ignored
  `tmp/<name>/`: `VALKAMA_BROWSER_PROBES=<its directory> python ../tests/heavy_gate.py run --kind browser-targeted --want 4 --
  npx playwright test --config tests/browser/probe.config.ts '--workers={k}'`. Name the file
  `ui-<name>.spec.mts` or `production-<name>.spec.mts` for the project it runs
  in. Both run in `en-US`: a probe that reads the Russian interface sets
  `test.use({ locale: 'ru-RU' })`. It imports `expect` and the types from
  `@playwright/test` and the app through `@/` as a spec does, and the suite's
  own `test` and helpers by a path relative to itself, such as
  `../../web/tests/browser/test.ts` from `tmp/<name>/`, so it needs no
  configuration and no `package.json` of its own.
  The `.mts` is what makes it an ES module, as every module of the suite is: a
  `.spec.ts` there is a CommonJS script, and its first import of a suite module
  the run has already loaded, through the configuration or the global setup,
  fails. `web/tests/probeConfig.test.ts` lists such a probe through the
  configuration.
- The whole suite, or a batch of it: `npm run test:browser:allowed`, never
  Playwright handed a list of names. Playwright given no spec runs every spec
  its configuration selects, and the list of the whole suite does not fit a
  Windows command line; the
  runner writes the list to a file Playwright reads, refuses an empty list or a
  missing list file before Playwright starts, and ends with each project's count
  and the total, to compare with what the run was meant to select. `--list`
  shows the selection without running it; `--specs=<file>` runs the specs a file
  names, one a line, each bare and relative to `web/tests/browser`
  (`production-list.spec.ts`, not `tests/browser/production-list.spec.ts`). A
  Playwright option takes its value after `=`, as in `--grep=freshness`: the
  runner refuses a separate value.

The specs that write the system clipboard or are granted it are named in
`web/tests/browser/clipboardSpecs.ts`, and they run only when asked for: with
`VALKAMA_BROWSER_CLIPBOARD=1` or through the runner's `--with-clipboard=<spec name>`.
`web/playwright.config.ts` reads that list and selects none of them without the
variable — not in a bare run, not when one is named, not under `--list` — and
the runner sets it when `--with-clipboard` names one and removes it otherwise.
A bare `npx playwright test` or `npm run test:browser` is therefore safe for the
clipboard, but it is still not how the suite runs: it refuses nothing and ends
with no count to compare, so the whole suite goes through the runner.
`tests/clipboardSpecs.test.ts` fails on a spec that grants or writes the
clipboard and is not on that list, so a spec that starts to goes onto it in the
same change, and on a configuration that selects a listed spec without the
variable.

The Analytics sweep (`web/tests/sweep/analyticsSweep.ts`) is not a gate but a
measurement of a running Valkama: every rail section, period, chart view and the
value panel opened from a mark of each section, at each width, for three
classes. Hover reach points the real pointer at each sampled mark's centre and
3px off it on each axis and expects what `DESIGN.md` and `hintReach.ts` say:
the mark's own hint, the nearest of several, either of two within a pixel.
Overflow reports a sideways scroll that is none of the design's: the page's,
one widened by content out of flow, one whose content is neither a table nor a
row of like items, and one shorter than the least target (`--period-reach`).
`--forbid <text>`, repeatable, counts every visible place a text stands, in the
page and in a hint, as the product's own words: a place inside a name of the
data shown, such as a task's title that quotes the text, is the data's, judged
by the titles and names the page's API answers gave (`occurrences`). Run it on a store copy, from `web/`, with its output in the
ignored `tmp/` (it refuses any other place, since it records what the store
shows):

```powershell
python tests/isolated.py serve --out tmp/<name>/stand --store-copy
node tests/sweep/analyticsSweep.ts --url <the stand's address> --out ../tmp/<name>/sweep --forbid "меньше минуты"
python tests/isolated.py stop --out tmp/<name>/stand
```

`--widths`, `--sections` and `--periods` narrow it; `--marks` sets how many
marks of each sort it samples. It walks the measure the page opens on unless
`--measures time,tokens,cost` names the ones to open each view with: a column
a measure adds and the words it gives a figure change what a table holds, so a
table that fits under the time may scroll a few pixels under the cost, and a
sweep of the default measure never sees it. Its summary counts each group by
measure too. It writes `sweep.json`, every miss with its
state, selector path, owner, offset and what was found instead, prints a
summary by class and owner, and exits 1 when anything missed. A hover or
overflow remark is closed by its group's number falling on a store copy, not
by a test on the spot the remark named: such a test passes while the same
defect stands at the next mark, period or width.

semgrep is the only dataflow analysis here: ruff matches patterns, semgrep
follows a tainted value through a function. It reads the Python server alone,
because it does not parse `.vue`; the web side is covered by
eslint-plugin-security through vue-eslint-parser. Registry rules are fetched
once and cached, so the first run on a fresh machine needs the network. It
scans only files Git knows about: a new module that is not yet staged is
skipped without a word, so stage new files (`git add -N` is enough) before
reading its result as covering them.

Run the Python gates from the ignored `.venv`, built on Python 3.15 — the
interpreter the installed launcher runs, so the suite meets the SQLite the
service does — from `requirements-dev.txt` (`uv venv .venv --python 3.15`, then
`uv pip install --python .venv/Scripts/python.exe -r requirements-dev.txt`),
with `.venv/Scripts` first on `PATH`. The minimum the code supports stays
Python 3.11 (`target-version` and `python_version` in `pyproject.toml`). A
shared interpreter drifts: an unpinned semgrep and mcp 2.x there broke the gate,
because semgrep imports `mcp.server.fastmcp` at start and mcp 2 removed it.

A tool whose own dependencies do not install on the Python `.venv` is built on
gets an environment of its own beside it, with its own requirements file, and
the gates run it and check its pin there; `OwnEnvironment` in
`windows/release.py` declares each one, its directory, its requirements and the
Python to build it on. semgrep is the one today: every release since 1.137.0
pins `pywin32==311`, which has no wheel for Python 3.15. Build the ignored
`.venv-semgrep` from `requirements-semgrep.txt` on the newest Python it installs
on (`uv venv .venv-semgrep --python 3.14`, then
`uv pip install --python .venv-semgrep/Scripts/python.exe -r requirements-semgrep.txt`),
and run `semgrep` with `.venv-semgrep/Scripts` first on `PATH`: the launcher
finds `pysemgrep` through it, so an older `.venv` that still holds one would
otherwise run that copy. Both runners put the directory of each step's own
program first on `PATH` for that step (`release.program_environment`). When
semgrep installs on the Python of `.venv` again, its pin can move back into
`requirements-dev.txt` and its declaration go.

`python tests/isolated.py gates --out DIR` runs the `AGENTS.md` list from that
venv in one call: only the child sees the redirected `HOME`, `USERPROFILE`,
`LOCALAPPDATA`, `APPDATA` and `VALKAMA_DB`, and every step's exit code counts.
`--only python` is the Python half; `--owner` is the audit with the owner policy.
A report cites its `DIR/record.json`, which `python tests/run_record.py check`
refuses for another tree or state, and, given `--require NAME`, for having no
step of that name; a step that `run` records takes the name of its command's
words, so `run --out DIR -- typos` is the step `typos` the integrator requires
of a worker's record. `run` replaces the record in DIR once the tree has
changed, so each commit's checks go into a directory of their own. Use `gates`
instead of a wrapper of your own, and
`serve --out DIR` with `stop --out DIR` for a live check; a test compares its
steps with `AGENTS.md`.
It does not move `TEMP`, which is what keeps the suite's renames from failing
with `PermissionError`.

Given several records, `check` takes them as a chain, which
`tests/record_chain.py` states in full. One record is made at the tree as it is
now; the others at commits HEAD descends from, in any worktree of the
repository, since what a step ran on is its commit and the uncommitted paths
its record names. A step of an earlier record counts only when no path that
differs between its state and the tree touches what it reads: `typos`, the
subjects and the release audit count only from the newest; a unittest run reads,
module by module, what `tests/affected.py` reaches, so a whole suite is carried
by a rerun of the modules a change reaches; a command in `web/` reads `web/` but
`web/dist` and every file a source there names, as `DESIGN.md` is by the token
check `npm test` runs; the browser suite reads `web/` but `web/dist`, `server/`
and `valkama.py`; a path outside `web/`, `server/`, `tests/`, `docs/`, `.agents/`,
`valkama.py` and the Markdown files at the top touches every step. A touched step
counts from a record where it is untouched, and is refused, naming it and the
path, when none is. A passed `npm test` in `web/` counts for the web steps its `test`
script runs, including those the scripts it runs reach, so a touched one of them
needs no run of its own. The same step is the same words in the same directory, and
for the browser runner the specs its list file named, which `run` keeps. A
document no check names therefore needs `typos` and the subjects alone. After a
merge the branch's records count on the merged head the same way, so only the
steps the other side's changes touch run again. The chain's Python reach is this
checkout's import graph, so a worktree's chain is checked with that worktree's
own `tests/run_record.py`.

Heavy runs beside one another fail tests that pass alone, so each goes through
the machine's heavy-process gate, `heavy-gate`, which Host Runtime installs with
its `heavy-gate.json` in `%USERPROFILE%/.agent-host-runtime/bin`.
`.heavy-gate.toml` declares Valkama's kinds of run, and `tests/heavy_gate.py`
takes the lease for each: `unittest-parallel`, `tests/parallel.py`, sized by
its modules, which runs K processes at once of the 8 it wants by default (half
the CPUs on a smaller machine); `unittest-suite`, the whole unittest suite in one
process, from its package's `load_tests` until its process ends; `vitest-suite`,
`npm run test:unit`, whose `--maxWorkers` becomes K, the share the gate gives of
the 8 workers it wants or the count the caller gave; `browser-suite`,
`npm run test:browser:allowed` but `--list`, sized by its number of specs; and
`browser-targeted`, one spec or a probe. The gate admits a run by what earlier
runs of its kind and size used, beside others while the machine has room.
In an agent's session a run that finds no room exits 75 at once and says why;
`HEAVY_GATE_WAIT=1` makes it wait instead, saying why every minute. Its leases
are the OS's: they go with a run that dies. `heavy-gate mode serial` lets one
heavy run in at a time across the machine, and `heavy-gate mode measured` goes
back. Where no gate is installed, the run goes direct and says so. The gate's
hook refuses a heavy command started outside it, naming the command to run.
Targeted runs take no lease — a unittest module, subpackage, `-p` or `-k`,
Vitest given files or `-t` — nor do the light gate steps, and `npm test` with no
Python says so and runs without one. What a holder starts runs under its lease:
`gates` runs `unittest` under one, whose wait opens its log, and `npm test`'s is
in `logs/web-test.log`. The gate says on stderr what it admitted:

```text
heavy-gate: admitted valkama:browser-suite after 41 s: K=16, profile 13.3 cores 3.1 GB, machine 4 of 32 busy, alone
```

Branches from before the gate still share the machine through the earlier lock,
a file in the logon temporary directory no TEMP or profile moves. Until they are
gone, `tests/legacy_lock.py` keeps them and a gated run apart: a run takes its
lease first and then that lock's byte shared, with an entry in `<lock>.runs/`
counting the cores of its profile, or the whole machine where the gate counts
it so, so an earlier run sees it and waits. An earlier run that holds the whole machine keeps
a gated run out: it refuses with 75 in an agent's session, or waits under its
lease and says so:

```text
took the earlier branches' heavy-test lock <file> after 2 s: shared, counting 14 CPUs
```

A command of its own goes through the gate as `python tests/heavy_gate.py run
--kind <kind> [--size N] [--want N] -- <command>`, `{k}` in the command standing
for K. It finds the command's
program on `PATH` before it asks for a lease, so a name it cannot find fails at once, and
`npx` starts as the `npx.cmd` it is; Windows finds only an `.exe` by a bare
name, and looks in its own directory before `PATH`. The Windows `timeout` is
refused there, since it runs no command: a `timeout` found first on `PATH`, as
Git's, is the one used.

`tests/commit_subjects.py` reads the subject of every commit `HEAD` reaches,
merges included. Twice an integration branch reached the merge into `main`
carrying `merge: …` and Git's default merge subject, the release audit passed
both times, and the history had to be rewritten. A directory with no history of
its own, such as a source snapshot, is skipped with its reason and exit code 3,
and `gates` refuses the step there, so neither reads as a pass.

An npm gate on modules its lockfile does not pin fails in a way that reads as a
defect in the code, so neither runner lets that happen, each in its own way.
`windows/release.py check` runs `npm ci` for `web` and `desktop` ahead of every
stage, because a release must verify what the lockfile pins, whatever the
checkout's `node_modules` holds. `tests/isolated.py gates` installs
nothing: before each npm step it compares `node_modules/.package-lock.json` with
`package-lock.json` and refuses that step, saying where `npm ci` is needed, on a
missing tree, a difference or a comparison it could not make. A refused step does
not start and the run does not pass. Two entries match when `version`, `resolved`
and `integrity` agree; the rest of an entry and the top of the file are npm's
bookkeeping. The hidden file has no root entry and leaves out optional packages
this platform skips, so only an entry marked `optional` may be missing from it.

`npm ci` empties the `node_modules` it installs into, through a link as well,
and then replaces the link with a directory. Worktrees link their modules to the
main checkout's, so an install in either strips them from every checkout sharing
them; a release check run in the main checkout once did, and then failed on a
file a running process held. So `check` installs nowhere in the checkout: it
copies the sources Git tracks or would add, never a `node_modules`, into a
temporary directory, runs `npm ci` and every npm stage there, puts the web build
back in `web/dist`, and removes the copy without entering a link in it. A gate's
refusal says to remove a link before running `npm ci` in a worktree. `gates`
still reads through a link, so a worktree may share modules as long as they match
its own lockfile. `tests/worktree.py` makes those links where a worktree's
lockfile is the main checkout's byte for byte, and takes them out before
`git worktree remove`, which deletes the rest of the worktree but leaves a
junction behind, and the directory that holds it.

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

A test that leaves an SQLite connection (on Python 3.13 and later), a child
process, a file or a temporary directory open fails. `tests/resource_leaks.py`,
installed by `tests/__init__.py` for every way the suite runs, makes four warnings
errors and no other: sqlite3's `unclosed database`, `subprocess`'s `subprocess N
is still running`, `io`'s `unclosed file` and `tempfile`'s `Implicitly cleaning
up`. It fails the test during which the resource
was collected, which is not always the one that opened it: run that module again
with `-X tracemalloc=20 -W always::ResourceWarning`, where the guard stands aside
and the warning prints the line that opened each one. `with conn:` ends a
transaction and leaves the connection open; close it with `contextlib.closing`,
`try`/`finally`, or open a store file for reading through `store.read_only`. A
`Popen` warns whenever nothing read its exit status, even after its child has
ended: `wait()` for it, in a `finally` or a cleanup when the test may fail first.

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
`server` and `tests` importable. Every test lives under `tests/`.
