import assert from 'node:assert/strict'

import { test } from 'vitest'

import { compactCss, declarationsOf, sourceCode } from './support/source.ts'

/**
 * What a control's size and a row's alignment are, once neither is a number a
 * file chose for itself.
 *
 * The designer's pass over the shell found twelve separate defects, and all of
 * them resolved to two habits. A control sized its own inner element, so a
 * wrapper was always taller than what it wrapped and a tab track stood 48px
 * beside a 44px button. And a row aligned by `space-between` or by `baseline`
 * without asking what was in it, so a count ended up at the far edge of the
 * thing it counted and an icon dragged its own text off the line.
 *
 * `check:ui-system` owns the first as a ledger over literal heights; what it
 * cannot see is which element the height was set on, or why a row is centred.
 * That is what this file states, as declarations of the rule a selector names
 * whole, in any order and however the file is laid out.
 */
const button = sourceCode('shared/ui/VButton.vue')
const segmented = sourceCode('shared/ui/SegmentedControl.vue')
const choice = sourceCode('shared/ui/ChoiceSelect.vue')
const badge = sourceCode('shared/ui/CountBadge.vue')
const nav = sourceCode('widgets/app-nav/components/AppNav.vue')
const navList = sourceCode('widgets/app-nav/components/NavModuleList.vue')
const navConnection = sourceCode('widgets/app-nav/components/NavConnectionButton.vue')
const contextBar = sourceCode('app/components/AppContextBar.vue')
const lane = sourceCode('widgets/work-item-views/components/WorkItemColumn.vue')
const stack = sourceCode('widgets/work-item-views/components/WorkItemStack.vue')
const card = sourceCode('widgets/work-item-views/components/WorkItemTile.vue')

/** Whether the rule `selector` names declares `declaration`, as compactCss writes it. */
function declares(css: string, selector: string, declaration: string) {
  const declarations = declarationsOf(css, selector)
  assert.ok(declarations.includes(declaration), `${selector}: ${declarations.join(';')}`)
}

/** A height of the row less the track's inset on both sides, either way the product is written. */
const insetHeight = (height: string) =>
  new RegExp(
    `^min-height:calc\\(var\\(${height}\\)-(?:2\\*var\\(--space-half\\)|var\\(--space-half\\)\\*2)\\)$`,
  )

test('a track owns the row and derives its segments, so it matches the button beside it', () => {
  // The height is on the outermost box. Set on the segment instead, the track
  // added its 2px inset on top and no toolbar could line up.
  declares(segmented, '.segmented', 'min-height:var(--size-control-height)')
  for (const [selector, height] of [
    ['.segmented-option', '--size-control-height'],
    ['.segmented.size-compact .segmented-option', '--size-control-height-compact'],
  ]) {
    const declarations = declarationsOf(segmented, selector)
    assert.ok(
      declarations.some((each) => insetHeight(height).test(each)),
      `${selector}: ${declarations.join(';')}`,
    )
  }
  // The track's inset and the gap between segments are the same sub-grid step,
  // which is what makes a pressed segment sit inside the track evenly.
  declares(segmented, '.segmented', 'gap:var(--space-half)')
  declares(segmented, '.segmented', 'padding:var(--space-half)')
  // A segment's label and a button's label are the same type, so they name the
  // same role. Spelled out, they were the same three declarations in two files
  // with no way to know about each other.
  declares(segmented, '.segmented-option', 'font:var(--font-control)')
})

test('every labelled control in the family names the row, never the pointer target', () => {
  declares(button, '.button', 'min-height:var(--size-control-height)')
  declares(button, '.button', 'font:var(--font-control)')
  declares(choice, '.choice-trigger', 'min-height:var(--size-control-height)')
  // The bar gives its choice control the same height inside its own scope.
  assert.match(
    compactCss(contextBar),
    /:deep\(\.choice-trigger\)\{[^}]*min-height:var\(--size-control-height\)/,
  )
  // Both rail controls are asserted where they are now written: the entry in the
  // list that renders it, the connection button in its own file. They used to be
  // in `shell.css`, describing two controls from outside the components that own
  // them.
  declares(navList, '.nav-item', 'min-height:var(--size-control-height)')
  declares(navConnection, '.nav-refresh', 'min-height:var(--size-control-height)')
})

test('a count badge uses its surrounding color for the cutout ring', () => {
  assert.match(compactCss(badge), /var\(--color-count-badge-ring,var\(--color-navigation\)\)/)
  assert.doesNotMatch(badge, /surface\?:/)
})

test('a count stands beside what it counts, not at the far edge of the row', () => {
  // The rail put its badge in a track pushed to the end, and the column header
  // used space-between, so both numbers left the words they belong to.
  // The rail's list hands the badge `.nav-item-count`, so the rule names an
  // element that file renders rather than one `CountBadge` does.
  declares(navList, '.nav-item-count', 'justify-self:start')
  declares(lane, '.work-item-column .column-head', 'gap:var(--space-2)')
  // Nothing in the lane's stylesheet pushes a row's ends apart.
  assert.doesNotMatch(compactCss(lane), /justify-content:space-between/)
})

test('a control states its own subject, so nothing captions it twice', () => {
  // The word survives as the accessible name, which is where a control with a
  // visible value needs it.
  assert.doesNotMatch(contextBar, /class="scope-label"/)
  assert.match(contextBar, /\s:label="\s*t\(\s*'platform\.scope\.label'\s*\)\s*"/)
  // The connection strip is the refresh control; the word under the state was
  // the button's own name printed inside it, and it cost the dot its alignment.
  assert.doesNotMatch(navConnection, /refresh\.label/)
  // Its hint names the refresh, after the lost connection it is there for, and its word
  // first while the rail cuts it: the state's word, printed on one line.
  assert.match(navConnection, /v-tooltip\.detail="\{[^"]*\bwords:/)
  assert.match(navConnection, /t\(\s*'refresh\.title'\s*\)/)
  assert.match(navConnection, /t\(\s*`status\.\$\{/)
  assert.match(navConnection, /<span\b[^>]*\sclass="connection-copy one-line"/)
})

test('settings stands in the foot beside the connection, inside the navigation', () => {
  // Settings at the rail's floor, in the foot and only there, is
  // browser/production-nav-foot.spec.ts; the connection stands in the same foot.
  const navigation = /<nav[\s\S]*?<\/nav>/.exec(nav)?.[0] ?? ''
  const utility = /<div\s+class="nav-utility"[\s\S]*?<\/div>/.exec(navigation)?.[0] ?? ''
  assert.match(utility, /<NavConnectionButton(?=[\s/>])/)
})

test('the space between two tiles belongs to the stack, so a column insets evenly', () => {
  declares(stack, '.work-item-stack', 'gap:var(--space-2)')
  // One rhythm down the tile, declared once, instead of three regions setting
  // their own margins in two different sizes.
  declares(card, '.work-item-tile', 'gap:var(--space-1)')
  for (const [selector, margin] of [
    ['.work-item-tile', 'margin-bottom'],
    ['.tile-line', 'margin-bottom'],
    ['.tile-facts', 'margin-top'],
  ])
    assert.ok(
      !declarationsOf(card, selector).some((each) => each.startsWith(`${margin}:`)),
      `${selector} sets its own ${margin}`,
    )
  // A grid track is min-content wide unless told otherwise, and the min-content
  // of a row of labels is those labels at full length — so the tile laid itself
  // out wider than its own box and clipped the result inside its padding.
  declares(card, '.work-item-tile', 'grid-template-columns:minmax(0,1fr)')
})

test('a row carrying anything but text aligns by centre', () => {
  // A flex box hands its baseline to its first item, so a label chip — a padded
  // box rather than a line of text — dragged the plain text beside it off the
  // row they were meant to share. Both the facts row and the reference row now
  // carry shared semantic primitives, so neither may align by text baseline.
  declares(card, '.tile-facts', 'align-items:center')
  declares(card, '.tile-line', 'align-items:center')
})
