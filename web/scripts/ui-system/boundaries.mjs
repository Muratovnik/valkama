/**
 * The component boundary rule: which files may leave their own component.
 *
 * A scoped block styles the elements its own template writes. `eslint-plugin-
 * vue-scoped-css` holds that line for every ordinary selector — a class in the
 * block has to be a class in the template — and it deliberately does not look
 * inside `:deep()` or `:global()`, because those two say out loud that the
 * boundary is being crossed on purpose. This is what holds them to a purpose.
 *
 * The list is the marking. A comment above each of the seventy rules that use
 * one would say "vue-flow's DOM" sixty times and stop being read; a list of
 * six files with a reason each can be read in one sitting, and a seventh cannot
 * appear without someone writing down why.
 *
 * `:slotted()` is not on this list and needs no permission: it is a component
 * placing content handed to its own slot, which is the opposite of a reach —
 * the row that owns a grid deciding where the grid's cells go.
 */

/**
 * Files allowed to style something they do not render.
 *
 * `AppContextBar` places the selectors standing in the chrome, and the
 * selector's trigger is not that component's root, so no class handed down
 * reaches it. The fills are already the honest kind: the bar declares
 * `--color-choice-trigger-fill` and its hover, and the trigger's own state rules
 * read them, the way `--color-count-badge-ring` works. What still reaches by
 * name is geometry — the trigger's padding and the selector's width on a narrow
 * bar — and this entry is the record of it. `SkillCatalogue` reaches
 * the same selector for the same reason. The entry names the bar rather than the
 * shell because the bar is its own component: `App.vue` renders nothing it does
 * not own.
 *
 * `SkillPreview` renders a skill's Markdown through `v-html`, so the headings,
 * code blocks and tables it styles are `markdown-it`'s output and appear in no
 * template. `GraphField` styles Vue Flow's pane, background, nodes and edges,
 * which the library renders and names.
 *
 * `ImprovementProfileDialog` uses `:global()` rather than `:deep()`: the overlay
 * host mounts its panel at the end of `<body>`, outside the subtree the scope
 * attribute reaches, so a scoped rule cannot land on it at all.
 */
const scopeEscapeOwners = new Set([
  'app/components/AppContextBar.vue',
  'widgets/work-item-graph/components/GraphField.vue',
])

const SCOPE_ESCAPE = /(?:::v-deep|:deep)\s*\(|(?:::v-global|:global)\s*\(/

/** The escape hatch a file used, named the way the file spells it. */
function escapeKinds(source) {
  const kinds = new Set()
  if (/(?:::v-deep|:deep)\s*\(/.test(source)) kinds.add(':deep()')
  if (/(?:::v-global|:global)\s*\(/.test(source)) kinds.add(':global()')
  return [...kinds].join(' and ')
}

export function scanScopeEscapes(sources) {
  const violations = []
  for (const { file, source } of sources) {
    if (!file.endsWith('.vue') || scopeEscapeOwners.has(file)) continue
    if (!hasScopeEscape(source)) continue
    violations.push(
      `${file}: ${escapeKinds(source)} styles an element this component does not render; ` +
        'hand the child a class, let it place its own slot, or add this file to ' +
        'scopeEscapeOwners with the reason',
    )
  }
  return violations
}

/**
 * Whether a file's own source still reaches past its scope, read the same way
 * `scanScopeEscapes` reads every other file. Exported so the owners list can be
 * checked against the files it excuses instead of only against itself — the
 * excusing set is what `scanScopeEscapes` skips, so nothing else can ask it.
 */
export function hasScopeEscape(source) {
  return SCOPE_ESCAPE.test(withoutComments(source))
}

/**
 * A comment cannot be a reach, and it must not be able to authorise one either.
 *
 * The prose in these files quotes selectors constantly — the whole point of the
 * comments here is to say what a rule replaced — so a rule reading the raw
 * source would fire on its own explanation.
 */
function withoutComments(source) {
  return source.replaceAll(/\/\*[\S\s]*?\*\//g, ' ').replaceAll(/<!--[\S\s]*?-->/g, ' ')
}

export { scopeEscapeOwners }
