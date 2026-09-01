// The preset stays JavaScript on purpose. stylelint transpiles this file into a
// temporary `.mjs` beside itself and then lets Node resolve what it imports, so
// an imported `.ts` fails with ERR_UNKNOWN_FILE_EXTENSION before any rule runs.
import propertyGroups from './stylelint-order-preset.js'
import selectorList from './stylelint-selector-list.js'

/**
 * The values a declaration is allowed to carry.
 *
 * This file used to be `.stylelintrc.json`, which could hold rules but not the
 * reason for one. Every machine rule in this repository carries the defect it
 * answers — `scripts/check-ui-system.mjs` is written that way throughout — and
 * the regexes below are unreadable without it.
 *
 * The division of labour with that guard: stylelint owns what a single
 * declaration may say, the guard owns composition, primitive ownership and
 * invariants that span files. Neither repeats the other, so a violation has one
 * owner and one message.
 */

/**
 * A size is named from the ramp in `tokens.css`, never spelled out.
 *
 * The ramp lived in DESIGN.md as prose while 238 declarations wrote the number,
 * which is how one overlay title came to exist at 19, 20, 20 and 21px in four
 * files and how 0.8rem — a 12.8px step the ramp does not contain — survived in
 * the palette itself. A size that happens to land on the ramp is still a
 * literal and still rejected: the remedy is the token, not a luckier number.
 *
 * The prefix is the whole check, which is only sound because it names one
 * dimension. While the ramp was spelled `--text-*` it shared that prefix with
 * the foreground colours, so `font-size: var(--text-muted)` satisfied this rule.
 */
const RAMP_SIZE = /^var\(--font-size-[a-z-]+\)$/

/** Leading is a step too, chosen by what the text is rather than by its size. */
const RAMP_LEADING = /^var\(--line-height-[a-z-]+\)$/

/**
 * The `font` shorthand, which is how this app's typography is written.
 *
 * A rule on `font-size` alone would have covered a third of it: `font: 600
 * var(--font-size-dense)/var(--line-height-flat) var(--font-family-interface)` sets a size
 * without ever naming the property.
 *
 * Two forms pass. A type role — `font: var(--font-label)` — is the one to write:
 * `tokens.css` holds the 22 styles more than one rule spends, and naming one is
 * how a rule stops assembling a size, a leading and a weight by hand. Assembling
 * one is still allowed, because a style written once is not duplication, and the
 * UI-system guard is what tells the two apart: it fails when a second rule
 * assembles a style that already exists.
 *
 * In the assembled form the optional prefix is the style and weight slots; the
 * leading is optional because a control that sets none inherits one; the family
 * is required because the shorthand resets it to the initial value when it is
 * left out, which is a silent way to lose the interface font. The weight slot
 * stays loose here on purpose — `check:ui-system` owns the four-stop weight
 * scale in both the shorthand and the longhand, including the variable-font
 * range in `@font-face` that is a registration rather than a stop. One
 * invariant, one owner.
 */
const TYPE_ROLE = /^var\(--font-(?!size-|family-)[a-z-]+\)$/

const RAMP_FONT =
  /^(?:(?:normal|italic|oblique|small-caps|\d{3})\s+)*var\(--font-size-[a-z-]+\)(?:\s*\/\s*var\(--line-height-[a-z-]+\))?\s+var\(--font-family-[a-z-]+\)$/

/**
 * A space is a step on the ladder, not a number someone liked.
 *
 * 509 literals were written against a grid that existed only as a sentence in
 * DESIGN.md, and 299 of them were off it: six sizes of "about eight pixels",
 * three of "about a dozen". They snapped to the ladder in one pass; this is
 * what stops the next one arriving.
 *
 * Four things that are not ladder steps stay legal. `0` and `auto` name no
 * distance at all. The gutter is what a module keeps from the panel edge, which
 * is a property of the panel rather than of the rhythm. And a computed value
 * carries its own arithmetic — `calc(-1 * var(--space-3))` is how a negative
 * margin is spelled here, so that the pair it belongs to moves when the step
 * does.
 */
const LADDER_STEP = String.raw`var\(--space-[a-z\d-]+\)`

/**
 * The two structural distances that are not steps in the rhythm.
 *
 * The page gutter is what a module keeps from the panel edge, and the column
 * gutter is how far apart two columns of one record stand. Both are properties
 * of a layout rather than of the vertical rhythm, and both had drifted into
 * several values before they were named — four clamps for the gutter, 24px and
 * 12px for the columns of two tables that show the same kind of thing.
 */
const GUTTER = String.raw`var\(--size-(?:page|column)-gutter\)`
const COMPUTED = String.raw`(?:calc|clamp|min|max)\((?:[^()]|\([^()]*\))*\)`
const spacing = (extra = '') =>
  new RegExp(
    `^(?:${LADDER_STEP}|${GUTTER}|${COMPUTED}|0|auto${extra})(?:\\s+(?:${LADDER_STEP}|${GUTTER}|${COMPUTED}|0|auto${extra}))*$`,
  )
const SPACING = spacing()

/** Prose sets its own rhythm from its own size, so the markdown owner adds `em`. */
const PROSE_SPACING = spacing(String.raw`|[\d.]+em`)

/**
 * A transition names its duration and its curve from the scale.
 *
 * Eleven of them had been written by hand at 0.12s, 0.14s, 0.18s and 120ms,
 * with three different easings, which is four speeds for what is one idea: a
 * control answering a click. The shorthand is what this app writes, so the
 * pattern reads the whole value rather than the longhand it rarely uses.
 *
 * `animation` is deliberately not here. A looping indicator's period is a
 * rhythm rather than a transition duration, and forcing the two together made
 * a spinner turn three times as fast the first time it was tried.
 */
/**
 * `0.01ms` is not a duration someone chose; it is how a stylesheet turns motion
 * off for a reader who asked for that, while still letting a transition fire so
 * `transitionend` arrives and nothing waits forever on an event that never came.
 */
const MOTION = /^(?:var\(--duration-[a-z-]+\)|0\.01ms)$/
const TRANSITION =
  /^(?:none|(?:[\w-]+\s+var\(--duration-[a-z-]+\)\s+var\(--ease-[a-z-]+\))(?:\s*,\s*[\w-]+\s+var\(--duration-[a-z-]+\)\s+var\(--ease-[a-z-]+\))*)$/

/**
 * A bounded surface carries a corner; only the side glued to an edge is square.
 *
 * `999px` is a pill — round because the thing is short, not because someone
 * measured half its height — and a computed radius is how a corner drawn inside
 * another corner states its own derivation instead of landing on a number.
 */
const RADIUS_PART = String.raw`(?:var\(--radius-[a-z-]+\)|${COMPUTED}|0|50%|999px)`
const RADIUS = new RegExp(`^${RADIUS_PART}(?:\\s+${RADIUS_PART})*$`)

/**
 * The files the type-selector cleanup has not yet reached, named rather than
 * counted so a rename or a removal can be checked against the tree instead of
 * taken on faith. Exported so `styleRules.test.ts` can resolve every one of
 * these against the real files stylelint lints, the same way
 * `scopeEscapeOwners` in `scripts/ui-system/boundaries.mjs` is checked against
 * the tree rather than only against itself — a list of exceptions decays
 * exactly the same way whether the exception is a scope escape or a bare type
 * selector.
 */
export const typeSelectorDebt = [
  'src/app/styles/shell.css',
  'src/pages/sessions/SessionTable.vue',
  'src/widgets/activity-bell/ActivityBell.vue',
  'src/widgets/analytics-dashboard/components/AnalyticsCardTable.vue',
  'src/widgets/analytics-dashboard/components/AnalyticsFilterBar.vue',
  'src/widgets/analytics-dashboard/components/AnalyticsTableInspector.vue',
  'src/widgets/analytics-dashboard/components/DataTableTrigger.vue',
  'src/widgets/improvement-case/components/ImprovementCaseDetail.vue',
  'src/widgets/improvement-case/components/ImprovementCaseList.vue',
  'src/widgets/improvement-case/components/ImprovementEvidence.vue',
]

export default {
  extends: ['stylelint-config-standard'],
  plugins: ['stylelint-order', 'stylelint-use-nesting', selectorList],
  overrides: [
    {
      files: ['**/*.vue'],
      customSyntax: 'postcss-html',
    },
    {
      // Element defaults, which is what a type selector is for. `base.css` is
      // where the document's own tags are given a starting appearance; naming a
      // class there would mean every `<p>` in the product had to opt in.
      files: ['src/app/styles/base.css'],
      rules: { 'selector-max-type': null },
    },
    {
      // A primitive telling its own two element forms apart. `VTextInput`
      // renders either an `<input class="control">` or a `<textarea class=
      // "control">`, and the tag is the real difference between them — a
      // textarea resizes and an input does not — so a class would only rename
      // a distinction the element already makes.
      files: ['src/shared/ui/VTextInput.vue'],
      rules: { 'selector-max-type': null },
    },
    {
      // A dependency's own SVG. Vue Flow draws the field's dot grid as a
      // `<pattern>` of `<circle>`s inside its background layer, and there is no
      // class to hand an element this product does not render. Every other
      // selector in that file names a class.
      files: ['src/widgets/work-item-graph/components/GraphView.vue'],
      rules: { 'selector-max-type': null },
    },
    {
      // The remainder of the type-selector cleanup, named so the debt is
      // visible and so no new file can join the list. 73 selectors across
      // these files; the shared primitives are done, which is where a type
      // selector cost the most because a primitive is reused everywhere.
      // Card #322 empties this list.
      files: typeSelectorDebt,
      rules: { 'selector-max-type': null },
    },
    {
      // The one file that renders prose it did not write. `markdown-it`'s output
      // is headings, lists, code blocks and tables with no class on any of
      // them, so a type selector is the only handle there is — every selector
      // this file writes for its own markup names a class. And a heading's
      // margin in prose follows the heading's own size rather than the
      // interface grid, which is what `em` is for and what the ladder cannot
      // express.
      files: ['src/pages/skills/components/SkillPreview.vue'],
      rules: {
        'selector-max-type': null,
        'declaration-property-value-allowed-list': {
          'font-size': [RAMP_SIZE, 'inherit'],
          'line-height': [RAMP_LEADING],
          'font': [TYPE_ROLE, RAMP_FONT, 'inherit'],
          '/^(?:padding|margin)/': [PROSE_SPACING],
          '/^(?:row-|column-)?gap$/': [PROSE_SPACING],
          '/^border(?:-[a-z]+)*-radius$/': [RADIUS],
          'border-radius': [RADIUS],
        },
      },
    },
  ],
  ignoreFiles: ['dist/**', 'node_modules/**', 'test-results/**', 'playwright-report/**'],
  rules: {
    /*
     * A relationship between two rules is written as nesting, not repeated in a
     * selector. `.grant-actions .revoke[data-armed]` names its parent a second
     * time and puts the reader's eye on the wrong end of the selector; nested,
     * everything that styles one element is in one place.
     *
     * The rule is `stylelint-use-nesting` from csstools, and it is here rather
     * than as a local rule because it finds four shapes a hand-written check
     * would have missed: a compound refinement (`.note.padded`), a state
     * (`.link:focus`), an ancestor-qualified variant (`.bar.live &`), and a
     * selector list that shares one parent. It also fixes them, which is how 84
     * of them were converted in one pass.
     *
     * Nesting is safe for these stylesheets on two counts that were checked
     * before any of it was written. Vue's scoped transform stamps the innermost
     * compound selector either way, so the scope id lands where it did; and the
     * build sets `cssTarget: 'chrome150'`, so esbuild ships the nesting instead
     * of flattening it back.
     */
    'csstools/use-nesting': 'always',
    /*
     * The same idea one level down: a selector *list* must not repeat a compound
     * either. `.tone-info .state-dot, .tone-success .state-dot, …` said
     * `.state-dot` four times to make one statement about it, so the reader had
     * to diff four lines to find the one word that differed.
     *
     * This one is local because nothing published answers it. `use-nesting`
     * above compares two rules and never looks inside a list;
     * `stylelint-no-restricted-syntax` queries the AST by attribute and cannot
     * compare one comma member with another; stylelint ships no core rule about
     * the shape of a list. `stylelint-selector-list.js` carries the reasoning,
     * including why it stays silent when the members differ in specificity.
     */
    'valkama/selector-list-no-repeated-compound': true,
    'no-descending-specificity': null,
    'value-keyword-case': ['lower', { ignoreFunctions: ['v-bind'] }],
    'selector-pseudo-class-no-unknown': [
      true,
      { ignorePseudoClasses: ['deep', 'slotted', 'global'] },
    ],
    'selector-class-pattern': '^[a-z][a-z0-9]*([-_]{1,2}[a-z0-9]+)*$',
    'custom-property-pattern': '^[a-z][a-z0-9]*(-[a-z0-9]+)*$',
    'at-rule-no-unknown': [true, { ignoreAtRules: ['import', 'apply', 'theme'] }],
    'declaration-property-value-allowed-list': {
      // `inherit` is the one keyword that names no size at all: it takes
      // whatever the ramp already chose one level up.
      'font-size': [RAMP_SIZE, 'inherit'],
      'line-height': [RAMP_LEADING],
      'font': [TYPE_ROLE, RAMP_FONT, 'inherit'],
      // Every padding, margin and gap longhand, however it is spelled. The
      // positional family — top, left, inset — is deliberately absent: a sticky
      // offset is the height of the header above it and a badge nudge is half a
      // glyph, so putting either on a rhythm ladder would be a lie in a token.
      '/^(?:padding|margin)/': [SPACING],
      '/^(?:row-|column-)?gap$/': [SPACING],
      '/^border(?:-[a-z]+)*-radius$/': [RADIUS],
      'border-radius': [RADIUS],
      'transition': [TRANSITION],
      'transition-duration': [MOTION],
      'transition-timing-function': [/^var\(--ease-[a-z-]+\)$/],
    },
    // A custom property declared twice in one block is a value someone edited
    // and a value someone forgot, and the tokens file is where that costs most.
    'declaration-block-no-duplicate-custom-properties': true,
    // One spelling for a URL, so a search for an asset finds every reference.
    'function-url-quotes': 'always',
    'shorthand-property-no-redundant-values': true,
    'block-no-empty': true,
    // Two decimals is past the point a browser rounds a pixel, so a third one
    // is the residue of a calculation someone pasted. `em` is exempt because
    // tracking is genuinely written at that scale: -0.015em is a typographic
    // value, not the tail of a division.
    'number-max-precision': [2, { ignoreUnits: ['em'] }],
    // Zero is zero in every unit, except in a custom property, where the unit is
    // what tells `calc()` the token is a length rather than a bare number.
    'length-zero-no-unit': [true, { ignore: ['custom-properties'] }],
    // `!important` is a declaration announcing that the cascade below it was
    // built wrong. Left on as an error so the fix is either the cascade or a
    // disable comment saying which third-party rule made it unavoidable.
    'declaration-no-important': true,
    // A value the property cannot take, reported as a warning because the check
    // does not know every function a browser has. `v-bind()` is Vue's compiler
    // handing the block a runtime value and is unknowable to any CSS parser —
    // the pattern anchors on the call so a typo like `v-binds(x)` is still read.
    'declaration-property-value-no-unknown': [
      true,
      { severity: 'warning', ignoreProperties: { '/.+/': '/^v-bind\\(/' } },
    ],

    // One order inside a block, so the answer to "where does this box sit and
    // how big is it" is always in the same place. `stylelint-order-preset.js`
    // carries the reasoning; custom properties lead because a block that
    // defines a token is defining it for everything under it.
    'order/order': ['custom-properties', 'declarations'],
    'order/properties-order': propertyGroups,

    // An element is styled for what it is, not for what tag it happens to be.
    // `.detail-head h2` breaks the day the heading becomes an h3 for the
    // outline, and it silently claims every future h2 someone puts in that box.
    // The exceptions below are listed in `overrides`, each with what it owes.
    'selector-max-type': 0,
  },
}
