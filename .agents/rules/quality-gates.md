# Quality gates: composition, ratchets, and the traps that earned their sentences

Routed from `AGENTS.md`. Read this before touching the toolchain, the test
suite, or any number a gate compares against. The gate command list itself
stays in `AGENTS.md`; this file is why each gate exists and how it bites.

`npm test` runs oxlint, ESLint, Prettier, Stylelint, the UI-system guard, knip
and jscpd before the suites; `npm run format` applies the two formatters.
`npm run test:browser` adds the axe pass over the harness surfaces, and
`desktop`'s own `npm test` asserts the renderer options and the packaged fuse
set as text, because configuration is what silently reverts and no test of
behavior can see it.

semgrep is the only dataflow analysis here: ruff matches patterns, semgrep
follows a tainted value through a function. It reads the Python server alone,
because it does not parse `.vue`; the web side is covered by
eslint-plugin-security through vue-eslint-parser. Registry rules are fetched
once and cached, so the first run on a fresh machine needs the network.

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
what every `platform_contracts` validator does with any accepted payload;
`test_board_properties.py` drives arbitrary sequences of board operations
against a throwaway store and asserts what every sequence leaves true. They are
the reason the suite now needs a third-party package at all: the server still
imports nothing outside the standard library, but the tests no longer run on a
machine where `install-tools` has never been run.

Discovery starts at the repository root because that is the import root: it is
not itself a package, so unittest puts it on `sys.path`, which is what makes
`server` and `tests` importable. It used to start one level down, inside a
directory that held the whole product while the repository around it held only
that product's configuration. Flattening removed the level; discovery still
starts here, and every test lives under `tests/`.
