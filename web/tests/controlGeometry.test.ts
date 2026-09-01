import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { test } from 'vitest'

import { messages } from '@/shared/i18n/index.ts'

import { compactCss } from './support/source.ts'

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
 * That is what this file states.
 */
const source = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')

const button = source('../src/shared/ui/VButton.vue')
const segmented = source('../src/shared/ui/SegmentedControl.vue')
const choice = source('../src/shared/ui/ChoiceSelect.vue')
const bell = source('../src/widgets/activity-bell/ActivityBell.vue')
const badge = source('../src/shared/ui/CountBadge.vue')
const nav = source('../src/widgets/app-nav/components/AppNav.vue')
const navList = source('../src/widgets/app-nav/components/NavModuleList.vue')
const navConnection = source('../src/widgets/app-nav/components/NavConnectionButton.vue')
const contextBar = source('../src/app/components/AppContextBar.vue')
const lane = source('../src/widgets/work-item-views/components/WorkItemColumn.vue')
const stack = source('../src/widgets/work-item-views/components/WorkItemColumn.vue')
const card = source('../src/widgets/work-item-views/components/WorkItemTile.vue')
const evaluationRequest = source(
  '../src/widgets/improvement-case/components/EvaluationRequestForm.vue',
)

test('a track owns the row and derives its segments, so it matches the button beside it', () => {
  const css = compactCss(segmented)
  // The height is on the outermost box. Set on the segment instead, the track
  // added its 2px inset on top and no toolbar could line up.
  assert.match(css, /\.segmented\{[^}]*min-height:var\(--size-control-height\)/)
  assert.match(
    css,
    /\.segmented-option\{[^}]*min-height:calc\(var\(--size-control-height\)-2\*var\(--space-half\)\)/,
  )
  assert.match(
    css,
    /\.segmented\.size-compact\.segmented-option\{[^}]*min-height:calc\(var\(--size-control-height-compact\)-2\*var\(--space-half\)\)/,
  )
  // The track's inset and the gap between segments are the same sub-grid step,
  // which is what makes a pressed segment sit inside the track evenly.
  assert.match(css, /\.segmented\{[^}]*gap:var\(--space-half\)/)
  assert.match(css, /\.segmented\{[^}]*padding:var\(--space-half\)/)
  // A segment's label and a button's label are the same type, so they name the
  // same role. Spelled out, they were the same three declarations in two files
  // with no way to know about each other.
  assert.match(css, /\.segmented-option\{[^}]*font:var\(--font-control\)/)
})

test('every labelled control in the family names the row, never the pointer target', () => {
  assert.match(compactCss(button), /\.button\{[^}]*min-height:var\(--size-control-height\)/)
  assert.match(compactCss(button), /\.button\{[^}]*font:var\(--font-control\)/)
  assert.match(compactCss(choice), /\.choice-trigger\{[^}]*min-height:var\(--size-control-height\)/)
  // The bar states the family for both triggers at once, so the two names sit in
  // one `:is()` rather than in two members that spelled `.context-bar` twice.
  assert.match(
    compactCss(contextBar),
    /:is\(\.choice-trigger,\.bell-trigger\)\)\{[^}]*min-height:var\(--size-control-height\)/,
  )
  // Both rail controls are asserted where they are now written: the entry in the
  // list that renders it, the connection button in its own file. They used to be
  // in `shell.css`, describing two controls from outside the components that own
  // them.
  assert.match(compactCss(navList), /\.nav-item\{[^}]*min-height:var\(--size-control-height\)/)
  assert.match(
    compactCss(navConnection),
    /\.nav-refresh\{[^}]*min-height:var\(--size-control-height\)/,
  )
})

test('an icon button is as tall as its neighbours and still answers a 44px click', () => {
  const css = compactCss(bell)
  assert.match(css, /\.bell-trigger\{[^}]*min-width:var\(--size-control-height\)/)
  assert.match(
    css,
    /\.bell-trigger::after\{[^}]*inset:calc\(\(var\(--size-control-height\)-var\(--size-control-target\)\)\/2\)/,
  )
})

test('the unread count sits on the bell, cut out of the ground the bar names', () => {
  // It stood beside the glyph as a bare number, which widened the control past
  // everything else in the bar and read as a second label.
  assert.doesNotMatch(bell, /placement="inline"/)
  // `.bell-count`, not `.count-badge`: the badge's own class belongs to the
  // badge, and a host that spells it is one rename away from styling nothing.
  assert.match(
    compactCss(bell),
    /\.bell-trigger\.bell-count\{inset-block-start:var\(--space-half\);inset-inline-end:var\(--space-half\)/,
  )
  // Capped at one digit: a badge standing on a 20px glyph inside a 40px button
  // has room for "9+" and not for "99+", which covered the bell it counts.
  assert.match(bell, /:limit="9"/)
  // The ring is the ground under the badge, and only the container knows which
  // ground that is; a two-value prop could not name a third one.
  assert.match(badge, /var\(--color-count-badge-ring, var\(--color-navigation\)\)/)
  assert.doesNotMatch(badge, /surface\?:/)
  assert.match(compactCss(contextBar), /--color-count-badge-ring:var\(--color-navigation-raised\)/)
})

test('a count stands beside what it counts, not at the far edge of the row', () => {
  // The rail put its badge in a track pushed to the end, and the column header
  // used space-between, so both numbers left the words they belong to.
  // The rail's list hands the badge `.nav-item-count`, so the rule names an
  // element that file renders rather than one `CountBadge` does.
  assert.match(compactCss(navList), /\.nav-item-count\{justify-self:start\}/)
  assert.match(compactCss(lane), /\.column-head\{[^}]*gap:var\(--space-2\)/)
  assert.doesNotMatch(compactCss(lane), /\.column-head\{[^}]*justify-content:space-between/)
})

test('a control states its own subject, so nothing captions it twice', () => {
  // The word survives as the accessible name, which is where a control with a
  // visible value needs it.
  assert.doesNotMatch(contextBar, /class="scope-label"/)
  assert.match(contextBar, /:label="t\('platform\.scope\.label'\)"/)
  // The connection strip is the refresh control; the word under the state was
  // the button's own name printed inside it, and it cost the dot its alignment.
  assert.doesNotMatch(navConnection, /refresh\.label/)
  assert.match(navConnection, /:title="t\('refresh\.title'\)"/)
  assert.match(
    navConnection,
    /<span class="connection-copy">\{\{ t\(`status\.\$\{connection\}`\) \}\}<\/span>/,
  )
})

test('settings is a destination in the navigation, not a footer beside the connection', () => {
  const navigation = /<nav[\s\S]*?<\/nav>/.exec(nav)?.[0] ?? ''
  assert.match(navigation, /systemModules/)
  const utility = /<div class="nav-utility">[\s\S]*?<\/div>/.exec(nav)?.[0] ?? ''
  assert.doesNotMatch(utility, /systemModules/)
  assert.match(utility, /<NavConnectionButton/)
})

test('the space between two tiles belongs to the stack, so a column insets evenly', () => {
  assert.match(compactCss(stack), /\.column-stack\{[^}]*gap:var\(--space-2\)/)
  assert.doesNotMatch(compactCss(card), /\.work-item-tile\{[^}]*margin-bottom/)
  // One rhythm down the tile, declared once, instead of three regions setting
  // their own margins in two different sizes.
  assert.match(compactCss(card), /\.work-item-tile\{[^}]*gap:var\(--space-1\)/)
  assert.doesNotMatch(compactCss(card), /\.tile-line\{[^}]*margin-bottom/)
  assert.doesNotMatch(compactCss(card), /\.tile-facts\{[^}]*margin-top/)
  // A grid track is min-content wide unless told otherwise, and the min-content
  // of a row of labels is those labels at full length — so the tile laid itself
  // out wider than its own box and clipped the result inside its padding.
  assert.match(compactCss(card), /\.work-item-tile\{[^}]*grid-template-columns:minmax\(0,1fr\)/)
})

test('a row carrying anything but text aligns by centre', () => {
  // A flex box hands its baseline to its first item, so a label chip — a padded
  // box rather than a line of text — dragged the plain text beside it off the
  // row they were meant to share. Both the facts row and the reference row now
  // carry shared semantic primitives, so neither may align by text baseline.
  assert.match(compactCss(card), /\.tile-facts\{[^}]*align-items:center/)
  assert.match(compactCss(card), /\.tile-line\{[^}]*align-items:center/)
})

test('a bounded action form wraps controls instead of widening its module', () => {
  const css = compactCss(evaluationRequest)
  assert.match(css, /\.eval-form\{[^}]*min-width:0/)
  assert.match(css, /\.eval-actions\{[^}]*flex-wrap:wrap/)
})

test('skill inventory issues name their source before their project context', () => {
  const view = source('../src/pages/skills/components/SkillsView.vue')
  assert.match(view, /title: t\(`skills\.sources\.\$\{root\.source\}`\)/)
  assert.match(view, /context: root\.project_title/)
  assert.match(view, /class="notice-context"/)
})

test('a caption places its count instead of welding one into the copy', () => {
  // "Skills · 37" over "Projects · 3" reads as a pair of tabs, which is what the
  // designer asked about first: is this navigation or a sentence? A separator
  // glyph inside a translation is also the reason no layout could answer —
  // there was nothing for it to place.
  for (const key of ['count', 'projectCount', 'clientCount'] as const) {
    for (const catalog of [messages.en.skills, messages.ru.skills] as Record<string, string>[]) {
      assert.doesNotMatch(catalog[key], /·|\{count\}/, `skills.${key} still carries its own count`)
    }
  }
  const view = readFileSync(
    new URL('../src/pages/skills/components/SkillsView.vue', import.meta.url),
    'utf8',
  )
  const catalogue = readFileSync(
    new URL('../src/pages/skills/components/SkillCatalogue.vue', import.meta.url),
    'utf8',
  )
  const toolbar = readFileSync(
    new URL('../src/pages/skills/components/SkillsToolbar.vue', import.meta.url),
    'utf8',
  )
  assert.match(toolbar, /\{\{ t\('skills\.count'\) \}\}\s*<CountBadge/)
  // And the band that stood between the filters and the table is gone: it said
  // how many rows the table below it had, and which scope the context bar had
  // already named.
  assert.doesNotMatch(view + toolbar + catalogue, /list-summary|visibleCount|selectedScopeLabel/)
})

test('two columns of one record stand one gutter apart, whichever table they are in', () => {
  const skills = compactCss(
    readFileSync(
      new URL('../src/pages/skills/components/SkillCatalogue.vue', import.meta.url),
      'utf8',
    ),
  )
  const sessions = compactCss(
    readFileSync(new URL('../src/pages/sessions/SessionTable.vue', import.meta.url), 'utf8'),
  )
  // A grid spends the whole gutter as its gap; a real table spends half of it
  // inside each cell. They had drifted to 12px and 24px for the same idea.
  assert.match(skills, /\.skill-row\{[^}]*gap:var\(--size-column-gutter\)/)
  assert.match(
    sessions,
    /\.sessiontd\{[^}]*padding:var\(--space-2\)calc\(var\(--size-column-gutter\)\/2\)/,
  )
})
