# Web tests: what a check selects, and what lets it fail

Routed from `AGENTS.md`. Read this before writing or changing a test under
`web/tests`; how to run one is in `quality-gates.md`.

A test checks the screen or a module against a rule the owner set — `DESIGN.md`,
a component's docstring, an API contract. Code that passes today is not the
oracle: a test that only describes today's code breaks when the code changes
legitimately, and keeps passing when it changes wrongly.

What a check is about:

- A set a check speaks for — every name in a legend, no part overlapping, twelve
  rows — is chosen by a contract hook: a `data-*` attribute the component
  documents, a role, an accessible name. It is never chosen by a styling class or
  by nesting (`children`, `classList[0]`, `firstElementChild`, `parentElement`, or
  `closest` on a styling wrapper). A styling class says how a thing looks, so a
  new kind of thing that looks the same takes it too, and the set grows without
  the rule changing. Where the set has no hook, the change adds one and documents
  it in the component's docstring.
- A component's own spec may select its parts by class where its props fix the
  set. A browser spec never chooses a population that way.
- A box a check measures is the element the rule is about, reached by its hook,
  not the nearest styled ancestor.

A check that can fail:

- Before an assertion over every member of a set read from the screen, over none
  of it, or over its least or greatest, assert the set's size against the
  fixture: exact where the fixture fixes it, at least one otherwise. `[].every`
  is true, `Math.min()` is `Infinity`, and a filter of nothing equals `[]`.
- An assertion that something is absent has a present control: the same selector
  shown present where the thing does appear, in the same spec or in one it names.
- A selector on a class nothing writes matches nothing, so its absence cannot
  fail and its presence cannot pass. `web/tests/specSelectors.test.ts` refuses
  one in `web/tests/browser`, `web/tests/components` and `web/tests/support`. It
  allows only a class a library writes at runtime, listed with what writes it; a
  dead use is fixed by selecting by a hook, never by a list entry.
- An expected value comes from the fixture or the rule, written in the test, never
  from a production helper that computes the same thing.
- A guard over source files fails on a known-invalid control, fails both ways on
  its register, and refuses an empty domain.
- A check of source text asserts a rule over it — something forbidden absent, a
  register matched both ways — not the implementation's own wording.
- A check waits on a condition or on the clock it controls (`page.clock`, fake
  timers), never on a fixed pause.
- A check that bounds time measures it on the clock other work on the machine
  moves least: a delay of the product's on the page's clock (`page.clock`, fake
  timers), which only the test moves, and a cost on the processor time of the
  thread that pays it (DevTools' `ThreadTime` for the page's main thread), which
  leaves out the time the thread waits for a processor. The wall clock counts
  whatever else the machine runs. A guard over source files reads and scans them
  as its file loads, not in a test's body, where the test's timeout counts the
  wall.

When many tests fail at once, sort every failure before changing anything:

- the rule broke: fix the code;
- the rule changed: update the test and cite the rule;
- the test was tied to markup the rule does not name: fix the selection as above,
  and leave the markup to the rule.

The commit says which kind each changed test was. A batch made green by renaming
selectors leaves the third kind in place for the next change to find.
