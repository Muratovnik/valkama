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
`web/dist` as it was. The `server-` specs, run with `VALKAMA_BROWSER_STORE`, are
the exception: the Python server serves `web/dist` alone, so they build there.
Each command below runs in `web/`:

- One spec: `npx playwright test <file> --workers=4`. A name is a prefix, so give
  the whole file name when it begins another.
- A probe spec kept outside the suite, such as in a worktree's ignored
  `tmp/<name>/`: `VALKAMA_BROWSER_PROBES=<its directory> npx playwright test
  --config tests/browser/probe.config.ts`. Name the file `ui-…` or
  `production-…` for the project it runs in; it imports `@playwright/test`, `@/`
  and the suite's own `test` from `web/tests/browser/test.ts` as a spec does, so
  it needs no configuration of its own.
- The whole suite, or a batch of it: `npm run test:browser:allowed`, never
  Playwright handed a list of names. Playwright given no spec runs every spec
  its configuration selects, and the list of the whole suite does not fit a
  Windows command line; the
  runner writes the list to a file Playwright reads, refuses an empty list or a
  missing list file before Playwright starts, and ends with each project's count
  and the total, to compare with what the run was meant to select. `--list`
  shows the selection without running it; `--specs=<file>` runs the specs a file
  names, one a line.

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
A report cites its `DIR/record.json`, which `python tests/run_record.py check`
refuses for another tree or state. Use it instead of a wrapper of your own, and
`serve --out DIR` with `stop --out DIR` for a live check; a test compares its
steps with `AGENTS.md`.
It does not move `TEMP`, which is what keeps the suite's renames from failing
with `PermissionError`.

Heavy runs wanting more CPUs than there are fail tests that pass alone, so each
goes through one gate, `tests/machine_lock.py`, at a file in the system's
temporary directory no TEMP or profile moves, declaring its CPUs: the whole
unittest suite 2, from its package's `load_tests` until its process ends;
`npm run test:unit` up to 8 workers, all given `--maxWorkers`;
`npm run test:browser:allowed` but `--list` all. In arrival order, a run goes in
alone at once, beside others if it fits their CPUs and the load;
`VALKAMA_HEAVY_TEST_CPUS=1` lets one in at a time.
Targeted runs take none — a unittest module, subpackage, `-p` or `-k`, Vitest
given files or `-t`, `npx playwright test <file>` — nor do the light gate steps,
and `npm test` with no Python says so and runs unlocked. What a holder starts goes
in at once: `gates` holds a place for `unittest`, whose wait opens its log, and
`npm test`'s is in `logs/web-test.log`. Its locks are the OS's: they go with a
run that dies. A waiter waits without limit, saying why at once and every
minute, then how long it waited:

```text
waiting for the heavy-test lock <file>: <who holds its CPUs, how many are free, or who is ahead>
took the heavy-test lock after 41 s: 2 of 32 CPUs, the machine 31% busy, alone
```

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
its own lockfile.

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
`server` and `tests` importable. Every test lives under `tests/`.
