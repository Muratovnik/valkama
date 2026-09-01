import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import stylelint from 'stylelint'
import { test } from 'vitest'

import { typeSelectorDebt } from '../stylelint.config.ts'

const configFile = fileURLToPath(new URL('../stylelint.config.ts', import.meta.url))
const repoPath = (file: string) => fileURLToPath(new URL(`../${file}`, import.meta.url))

/** How many type-selector warnings one file earns under the real config. */
const typeSelectors = async (codeFilename, code) => {
  const { results } = await stylelint.lint({ code, codeFilename, configFile })
  return results[0].warnings.filter((warning) => warning.rule === 'selector-max-type').length
}

/**
 * Lint one declaration per rule and report which of them the value rule refused.
 *
 * A configured rule that never runs is worse than no rule, because the gate
 * then reports the invariant as held. This asks the real linter with the real
 * config rather than re-implementing the regexes here, which would only prove
 * that a copy of them agrees with itself.
 */
async function rejectedIndexes(declarations) {
  const code = declarations
    .map((declaration, index) => `.probe-${index} { ${declaration} }`)
    .join('\n')
  const { results } = await stylelint.lint({ code, codeFilename: 'src/probe.css', configFile })
  const rejected = new Set()
  for (const warning of results[0].warnings) {
    if (warning.rule === 'declaration-property-value-allowed-list') rejected.add(warning.line - 1)
  }
  return [...rejected].sort((left, right) => left - right)
}

/** Every index, which is what a list of refused declarations must come back as. */
const all = (declarations) => declarations.map((_, index) => index)

/**
 * The type ramp, enforced.
 *
 * This invariant used to live in `check:ui-system` as a regex over the file
 * text. It moved here when stylelint gained the value rules, because a value
 * rule is what that linter is for: it reads the declared property instead of
 * guessing at one from a pattern. The rule moved; the test moved with it.
 *
 * A size that happens to land on the ramp is still a literal and still refused —
 * the remedy is the token, not a luckier number.
 */
test('a size and a leading are named from the ramp, never spelled out', async () => {
  const spelled = [
    'font-size: 18px;',
    'font-size: 1.3rem;',
    'line-height: 1.4;',
    // Solid leading is on the ramp as `--line-height-flat`; the number is not.
    'line-height: 1;',
  ]
  assert.deepEqual(await rejectedIndexes(spelled), all(spelled))

  const named = [
    'font-size: var(--font-size-dense);',
    'font-size: var(--font-size-page) !important;',
    // Nothing at all: `inherit` takes whatever the ramp chose one level up.
    'font-size: inherit;',
    'line-height: var(--line-height-flat);',
  ]
  assert.deepEqual(await rejectedIndexes(named), [])
})

/**
 * The `font` shorthand, which is how most of this app's typography is written.
 *
 * A rule on `font-size` alone would have covered a third of it, and that gap is
 * the reason this test exists separately: the shorthand sets a size without
 * ever naming the property.
 */
test('the font shorthand carries the ramp in both its size and its leading', async () => {
  const spelled = [
    'font: 600 21px/1.2 var(--font-family-interface);',
    // Half-named is not named: the leading is still a number.
    'font: 600 var(--font-size-dense)/1.2 var(--font-family-interface);',
    'font: 13px var(--font-family-mono);',
    // Leaving the family out resets it to the initial value, which is a silent
    // way to lose the interface font.
    'font: var(--font-size-dense)/var(--line-height-snug);',
  ]
  assert.deepEqual(await rejectedIndexes(spelled), all(spelled))

  const named = [
    'font: 400 var(--font-size-dense)/var(--line-height-snug) var(--font-family-interface);',
    'font: normal var(--font-size-dense)/var(--line-height-snug) var(--font-family-interface);',
    // The weight and the leading slots are both optional in the shorthand.
    'font: var(--font-size-section)/var(--line-height-normal) var(--font-family-interface);',
    'font: var(--font-size-dense) var(--font-family-mono);',
    'font: inherit;',
  ]
  assert.deepEqual(await rejectedIndexes(named), [])
})

/**
 * The spacing ladder, enforced.
 *
 * 509 literals had been written against a grid that lived only as a sentence in
 * DESIGN.md, and 299 of them were off it. They snapped in one pass; this is
 * what stops the next one arriving.
 */
test('a space is a step on the ladder, not a number someone liked', async () => {
  const spelled = [
    'padding: 10px;',
    'gap: 7px;',
    'margin-block: 13px;',
    // On the grid but still spelled: the remedy is the token, not the number.
    'margin: 16px;',
    'padding-inline-start: 8px;',
  ]
  assert.deepEqual(await rejectedIndexes(spelled), all(spelled))

  const named = [
    'padding: var(--space-3);',
    'gap: var(--space-2) var(--space-4);',
    // Neither of these names a distance at all.
    'margin: 0 auto;',
    // The gutter belongs to the panel edge rather than to the rhythm.
    'padding: var(--space-6) var(--size-page-gutter) var(--space-12);',
    // How a negative margin is spelled, so the pair it belongs to moves with it.
    'margin-block: calc(-1 * var(--space-3));',
    'padding: var(--space-6) clamp(12px, 3vw, 32px) var(--space-16);',
  ]
  assert.deepEqual(await rejectedIndexes(named), [])
})

test('a bounded surface carries a corner from the scale', async () => {
  const spelled = ['border-radius: 5px;', 'border-radius: 11px;', 'border-top-left-radius: 12px;']
  assert.deepEqual(await rejectedIndexes(spelled), all(spelled))

  const named = [
    'border-radius: var(--radius-card);',
    'border-top-left-radius: var(--radius-shell);',
    // A pill is round because the thing is short, not because someone measured
    // half its height; and a corner inside a corner states its own derivation.
    'border-radius: 999px;',
    'border-radius: 50%;',
    'border-radius: calc(var(--radius-control) - var(--space-half));',
  ]
  assert.deepEqual(await rejectedIndexes(named), [])
})

/**
 * An element is styled for what it is, not for what tag it happens to be.
 *
 * `.detail-head h2` breaks the day the heading becomes an h3 for the outline,
 * and it silently claims every future h2 someone puts in that box. The rule is
 * on everywhere; the files that still owe the cleanup are named in `overrides`,
 * which is what stops the list growing while it shrinks.
 */
test('a new file may not style an element by its tag', async () => {
  assert.equal(
    await typeSelectors(
      'src/shared/ui/NewThing.vue',
      '<template><div /></template><style scoped>.panel h2 { color: red; }</style>',
    ),
    1,
  )
  assert.equal(await typeSelectors('src/app/styles/other.css', '.panel h2 { color: red; }'), 1)
  assert.equal(
    await typeSelectors(
      'src/shared/ui/NewThing.vue',
      '<template><div /></template><style scoped>.panel-title { color: red; }</style>',
    ),
    0,
  )
  // `base.css` gives the document's own tags a starting appearance, which is
  // what a type selector is for; a class there would make every `<p>` opt in.
  assert.equal(await typeSelectors('src/app/styles/base.css', 'h2 { margin: 0; }'), 0)
})

/**
 * The type-selector debt ledger, checked against the tree rather than trusted.
 *
 * A list of exceptions decays in the two directions `componentBoundaries.test.ts`
 * names for `scopeEscapeOwners`: an entry can survive a rename or a removal, and
 * an entry can outlive the debt it was written to excuse. Neither failure is
 * loud — the file this override names simply stops earning a warning, and the
 * override goes on exempting it from nothing. Reading the ledger's own count is
 * how the Kanban rename left three renamed successors and two removed files in
 * this list with a stated selector count that had stopped matching the tree.
 */
test('the type-selector debt ledger names files that exist and still owe one', async () => {
  for (const file of typeSelectorDebt) {
    const path = repoPath(file)
    assert.ok(existsSync(path), `${file}: in the type-selector debt ledger but no longer exists`)
    const { results } = await stylelint.lint({
      files: path,
      config: { rules: { 'selector-max-type': 0 } },
      customSyntax: file.endsWith('.vue') ? 'postcss-html' : undefined,
    })
    const stillOwes = results[0].warnings.some((warning) => warning.rule === 'selector-max-type')
    assert.ok(
      stillOwes,
      `${file}: in the type-selector debt ledger but has no bare type selector left`,
    )
  }
})

/** Which lines the repeated-compound rule refused, under the real config. */
const repeatedCompounds = async (code: string) => {
  const { results } = await stylelint.lint({ code, codeFilename: 'src/probe.css', configFile })
  return results[0].warnings
    .filter((warning) => warning.rule === 'valkama/selector-list-no-repeated-compound')
    .map((warning) => warning.line)
}

/**
 * A selector list that says the same compound in every member.
 *
 * The rule is local, which means nothing but this test stands between it and
 * going quiet: it reports by comparing comma members to each other, and a
 * comparison that stops matching reports a clean tree rather than an error. It
 * has already been silent once, on a list written across two lines — the parser
 * hands back the newline after the comma as part of the next member's first node,
 * so `.a` and a newline plus `.a` looked like two different compounds.
 *
 * The negatives matter as much: a rule that fired on a list it cannot safely fold
 * would be telling the reader to change what the cascade does.
 */
test('a selector list may not repeat a compound in every member', async () => {
  const reported = [
    '.tone-info .dot,\n.tone-ok .dot { background: red }',
    '.panel > section,\n.panel > footer { padding: 0 }',
    '.a:hover .grip,\n.a:focus-visible .grip { width: 2px }',
    '.md { & h1,\n  & h2 { margin: 0 } }',
  ]
  for (const code of reported) {
    assert.deepEqual(await repeatedCompounds(code), [1], code)
  }

  const allowed = [
    // Nothing is shared.
    '.left .a, .right .b { color: red }',
    // One compound per member, so there is no fragment to share.
    '.a, .b { color: red }',
    // Reached two different ways: folding would give the child reach to the
    // descendant, or the other way round.
    '.recovery > button, .choices button { color: red }',
    // Unequal specificity: `:is()` takes the largest and would move the second.
    '.a > header button, .b button { color: red }',
    // Already said once.
    ':is(.tone-info, .tone-ok) .dot { background: red }',
  ]
  for (const code of allowed) {
    assert.deepEqual(await repeatedCompounds(code), [], code)
  }
})
