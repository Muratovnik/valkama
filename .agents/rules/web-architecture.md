# The web app: layers, slices, one style system, and components as black boxes

Routed from `AGENTS.md`. Read this before changing anything under `web/src`.

The web app in `web/src` is laid out in Feature-Sliced Design layers, from
the top down:

    app/       what exists once: entry point, root component, router, the
               shell's own composables, and the global stylesheet
    pages/     one slice per platform module, each holding that module's screen
    widgets/   composite blocks a page arranges: nav, drawers, the board, the
               graph, the analytics dashboard
    features/  one thing the operator does: compose a card, write a summary,
               launch a session, edit the analyzer profile
    entities/  what the product is about: board and its cards, sessions,
               improvements, skills, analytics
    shared/    segments with no business context: api, ui, lib, i18n, types,
               stores

Two rules, and `npm run check:ui-system` fails either. A file imports only from
a layer strictly below its own, so any layer can be lifted off the top without
touching what is under it. A slice never imports a sibling slice of its own
layer, because two slices that import each other are one slice filed under two
names. Cross-file imports use the `@/` alias, never relative chains.

The same guard rejects a runtime import cycle. Downward-only imports make a
cycle across layers impossible, so what is left is a cycle inside one layer, and
`shared/` is where it happens. Type-only edges do not count: `import type` is
erased, so the contract modules in `shared/api` may name each other's types, and
two of them do.

Inside a slice the segments are `components/`, `composables/` and `utils/`. A
slice whose content is all one kind keeps its files directly: a segment folder
holding the slice's only files repeats the slice name and says nothing else.

Styling is one system — semantic tokens plus named classes, with `tokens.css`,
`base.css` and `shell.css` behind `app/styles/index.css`; there is no utility
framework, and the guard rejects one reappearing.

A component is a black box, and two checks make that a fact rather than a habit.
`eslint-plugin-vue-scoped-css` refuses a scoped selector no template in the same
file can produce, so a class in a style block has to be a class that file writes;
`scanScopeEscapes` in the UI-system guard holds `:deep()` and `:global()` to a
list of files with a reason each. What a host needs is almost always the channel
Vue already has: a class written on a child component tag lands on that child's
root together with the host's scope id, so `<VIcon class="note-icon" />` styles
the same element `svg` used to reach and survives the icon becoming something
other than an `svg`. Deeper than a root there are two more — the child placing
its own slot with `:slotted()`, and a custom property the host declares and the
child reads with a fallback, which is what `--color-count-badge-ring` and
`--size-text-area-min-height` are.

The failure this prevents is silent. `.registry-row > .semantic-state` named two
other components' classes to move one element: rename either and the rule matches
nothing, reports nothing, and the layout quietly loses a rule, because scoped CSS
has no idea which file a class came from. `.button` and a bare `svg` were the same
bet on `VButton`'s root tag and Lucide's element. `:slotted()` needs no permission
and is not an escape — it is a component placing content handed to its own slot,
and `tests/components/registryRow.spec.ts` asserts the stamp arrives, because a
`:slotted` rule whose attribute never lands also fails without saying so.
