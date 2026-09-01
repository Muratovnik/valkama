import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { test } from 'vitest'

import { scanUiTree } from '../scripts/check-ui-system.mjs'
import { scanBorderBudget, scanControlSizes, scanHiddenRules } from '../scripts/ui-system/lines.mjs'

/** One file with one style block, which is what most of these fixtures are. */
const styled = (name, css) => ({ file: `future/${name}.vue`, source: `<style>${css}</style>` })

/** The wrapper nine fixtures spelled out around the one rule under test. */
const scoped = (css) => `<style scoped>${css}</style>`

/** One file in the control band, carrying exactly the declaration under test. */
const control = (declaration) => [
  { file: 'future/Control.vue', source: `<style>.a { ${declaration}; }</style>` },
]

function scanFixture(relativePath, source) {
  return scanFixtures({ [relativePath]: source })
}

/** A tree, for the rules that need more than one file to have a subject. */
function scanFixtures(files) {
  const root = mkdtempSync(join(tmpdir(), 'valkama-ui-guard-'))
  try {
    for (const [relativePath, source] of Object.entries(files)) {
      const target = join(root, relativePath)
      mkdirSync(dirname(target), { recursive: true })
      writeFileSync(target, source, 'utf8')
    }
    return scanUiTree(root)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

test('the recurrence gate discovers a raw select in a new nested component', () => {
  const violations = scanFixture(
    'future/nested/NewChoice.vue',
    '<template><select><option>One</option></select></template>',
  )
  assert.equal(violations.length, 1)
  assert.match(violations[0], /shared custom control/)
})

test('the recurrence gate rejects direct Reka selection ownership outside ChoiceSelect', () => {
  const violations = scanFixture(
    'future/nested/NewRekaChoice.vue',
    `<script setup>import { SelectRoot, SelectTrigger } from 'reka-ui'</script><template><SelectRoot><SelectTrigger /></SelectRoot></template>`,
  )
  assert.equal(violations.length, 1)
  assert.match(violations[0], /selection primitives belong to ChoiceSelect/)
})

test('the recurrence gate rejects ad-hoc combobox and listbox semantics', () => {
  const violations = scanFixture(
    'future/nested/NewAriaChoice.vue',
    '<template><button role="combobox">Choose</button><div role="listbox"><button role="option">One</button></div></template>',
  )
  assert.equal(violations.length, 1)
  assert.match(violations[0], /selection semantics belong to ChoiceSelect/)
})

test('the recurrence gate discovers a raw svg in a new nested component', () => {
  const violations = scanFixture(
    'future/nested/NewIcon.vue',
    '<template><svg aria-hidden="true" /></template>',
  )
  assert.equal(violations.length, 1)
  assert.match(violations[0], /must use VIcon/)
})

test('the recurrence gate discovers direct overlay and dialog ownership drift', () => {
  const violations = scanFixture(
    'future/NewModal.vue',
    '<script setup>import OverlayHost from "../components/OverlayHost.vue"</script><template><OverlayHost role="dialog" /></template>',
  )
  assert.equal(violations.length, 2)
  assert.ok(violations.some((message) => message.includes('approved surface frames')))
  assert.ok(violations.some((message) => message.includes('dialog semantics')))
})

test('the recurrence gate rejects decorative gradients in new source files', () => {
  const violations = scanFixture(
    'future/NewSurface.css',
    '.surface { background: linear-gradient(red, blue); }',
  )
  assert.equal(violations.length, 1)
  assert.match(violations[0], /gradients are outside/)
})

test('the recurrence gate rejects obsolete visual identity aliases', () => {
  const violations = scanFixture('future/LegacySurface.css', ':root { --paper-blue: #abc; }')
  assert.equal(violations.length, 2, 'a revived alias is both an alias and a literal color')
  assert.ok(violations.some((message) => /obsolete visual identity aliases/.test(message)))
  assert.ok(violations.some((message) => /must be semantic tokens/.test(message)))
})

test('a literal color is rejected in stylesheets and modules, not only components', () => {
  for (const file of ['future/panel.css', 'future/palette.ts']) {
    const violations = scanFixture(file, 'export const brand = "#3355ff"')
    assert.equal(violations.length, 1, file)
    assert.match(violations[0], /must be semantic tokens/)
  }
})

test('a status color may mark an edge but may not tint a surface', () => {
  const tinted = scanFixture(
    'future/Alert.vue',
    scoped('.note { background: color-mix(in srgb, var(--color-danger) 8%, transparent); }'),
  )
  assert.equal(tinted.length, 1)
  assert.match(tinted[0], /tints a surface/)

  const marked = scanFixture(
    'future/Alert.vue',
    scoped('.note { border-inline-start: 3px solid var(--color-danger); }'),
  )
  // The status-tint rule lets the edge through. The one voice that still
  // speaks is the drawn-line ledger, which wants the new line recorded.
  assert.equal(marked.length, 1)
  assert.match(marked[0], /LINE_BUDGET/)
})

test('the drawn-line ledger is exact in both directions and names its tokens', () => {
  const divider = [styled('Panel', '.a { border-bottom: 1px solid var(--color-rule); }')]
  assert.deepEqual(scanBorderBudget(divider, new Map([['future/Panel.vue', 1]])), [])
  assert.match(scanBorderBudget(divider, new Map())[0], /draws 1 border line/)

  // A vanished line fails too, so an entry stays a record rather than a
  // ceiling: delete the line and the ledger in the same commit.
  assert.match(scanBorderBudget(divider, new Map([['future/Panel.vue', 2]]))[0], /says 2/)

  const literal = [styled('Panel', '.a { border: 1px solid #303030; }')]
  assert.ok(
    scanBorderBudget(literal, new Map([['future/Panel.vue', 1]])).some((violation) =>
      /names a rule token/.test(violation),
    ),
  )

  // A transparent border reserves layout space without drawing; it costs
  // nothing from the budget.
  const reserved = [styled('Panel', '.a { border: 1px solid transparent; }')]
  assert.deepEqual(scanBorderBudget(reserved, new Map()), [])
})

test('a hairline drawn as a ground is counted as the line it is', () => {
  const seams = [
    styled('Facts', '.grid { gap: var(--space-hair); background: var(--color-rule); }'),
  ]
  assert.match(scanHiddenRules(seams)[0], /hairline at every seam/)

  // Nesting is what nearly took this rule out. The scanner was one regex over
  // flat rules, so a container holding a nested rule stopped matching at all and
  // the guard reported a clean pass. The seam is found wherever it sits, on
  // whichever side of a nested rule its two halves are written.
  for (const shape of [
    '.grid { gap: var(--space-hair); background: var(--color-rule); .cell { padding: 0; } }',
    '.grid { & > .cell { padding: 0; } gap: var(--space-hair); background: var(--color-rule); }',
    '.grid { display: grid; .row { gap: var(--space-hair); background: var(--color-rule); } }',
  ]) {
    assert.match(scanHiddenRules([styled('Facts', shape)])[0], /hairline at every seam/, shape)
  }

  // Either half alone is not a line. A rule token is also the neutral fill of a
  // 7px status dot, and a hairline gap on its own shows whatever is behind it.
  assert.deepEqual(scanHiddenRules([styled('Dot', '.dot { background: var(--color-rule); }')]), [])
  assert.deepEqual(scanHiddenRules([styled('Row', '.row { gap: var(--space-hair); }')]), [])
  // Air between blocks is the way through.
  assert.deepEqual(scanHiddenRules([styled('Facts', '.grid { gap: var(--space-1); }')]), [])
})

test('a literal control height is rejected inside the band and ignored outside it', () => {
  // Inside the band a number is a control that opted out of the scale.
  assert.match(
    scanControlSizes(control('min-height: 44px'), new Map())[0],
    /writes 1 literal control height/,
  )
  assert.match(
    scanControlSizes(control('height: 36px'), new Map())[0],
    /--size-control-height-compact/,
  )
  assert.deepEqual(
    scanControlSizes(control('min-block-size: 40px'), new Map([['future/Control.vue', 1]])),
    [],
  )

  // Outside it are dots, badges and glyphs below, panels and charts above.
  assert.deepEqual(scanControlSizes(control('height: 18px'), new Map()), [])
  assert.deepEqual(scanControlSizes(control('min-height: 220px'), new Map()), [])
  assert.deepEqual(scanControlSizes(control('min-height: 60px'), new Map()), [])

  // The tokens are the way through, including the pointer target for a control
  // with no label to widen it.
  for (const token of [
    '--size-control-height',
    '--size-control-height-compact',
    '--size-control-target',
  ]) {
    assert.deepEqual(scanControlSizes(control(`min-height: var(${token})`), new Map()), [])
  }

  // A component-local alias does not turn an off-scale control measurement
  // into a system token. Control and filter sizes are owned by tokens.css.
  assert.match(
    scanControlSizes(control('--size-skills-filter-height: 52px'), new Map())[0],
    /writes 1 literal control height/,
  )
  assert.deepEqual(
    scanControlSizes(
      [{ file: 'app/styles/tokens.css', source: ':root { --size-control-height: 40px; }' }],
      new Map(),
    ),
    [],
  )

  // Exact in both directions, like the line ledger: an entry is a record of
  // what the file writes, never a ceiling to grow into.
  assert.match(
    scanControlSizes(control('min-height: 44px'), new Map([['future/Control.vue', 2]]))[0],
    /the ledger says 2/,
  )
})

test('the recurrence gate rejects self-justifying UI disclaimers and generic claims', () => {
  const violations = scanFixture(
    'i18n.ts',
    `export const messages = { en: { note: 'It does not run, install, or trust anything.', tail: 'Links records; AgentMemory itself is unchanged.' }, ru: { intro: 'Правдивый список сервисов.' } }`,
  )
  assert.equal(violations.length, 2)
  assert.ok(violations.some((message) => message.includes('state the useful behavior once')))
  assert.ok(violations.some((message) => message.includes('concrete product fact')))

  const russianTail = scanFixture(
    'i18n.ts',
    `export const messages = { note: 'Ссылка на блок плана; текст плана не копируем.' }`,
  )
  assert.equal(russianTail.length, 1)
  assert.match(russianTail[0], /state the useful behavior once/)
})

test('the recurrence gate rejects a locally rebuilt segmented control', () => {
  const violations = scanFixture(
    'future/ViewSwitch.vue',
    '<template><button :aria-pressed="active">Board</button></template>',
  )
  assert.equal(violations.length, 1)
  assert.match(violations[0], /belongs to SegmentedControl/)
})

test('the recurrence gate rejects a locally rebuilt text field but not a checkbox', () => {
  for (const source of [
    '<template><input v-model="q" type="text" /></template>',
    '<template><textarea v-model="note" rows="3" /></template>',
    '<template><input v-model="target" type="number" /></template>',
  ]) {
    const violations = scanFixture('future/NewForm.vue', source)
    assert.equal(violations.length, 1, source)
    assert.match(violations[0], /belongs to VTextInput/)
  }

  for (const source of [
    '<template><input v-model="on" type="checkbox" /></template>',
    '<template><input v-model="role" type="radio" value="executor" /></template>',
    '<template><input :value="q" type="search" /></template>',
  ]) {
    assert.deepEqual(scanFixture('future/NewForm.vue', source), [], source)
  }
})

test('uppercase and off-scale weights are rejected as hierarchy devices', () => {
  const upper = scanFixture('future/LaneHead.vue', scoped('.head { text-transform: uppercase; }'))
  assert.equal(upper.length, 1)
  assert.match(upper[0], /not from uppercase/)

  const weight = scanFixture(
    'future/LaneHead.vue',
    scoped(
      '.head { font-weight: 650; } .sub { font: 620 var(--font-size-dense)/var(--line-height-flat) var(--font-family-interface); }',
    ),
  )
  assert.equal(weight.length, 2)
  assert.ok(weight.every((message) => /off the 400\/500\/600\/700 scale/.test(message)))

  // A variable-font registration is a range, not a stop on the scale.
  assert.deepEqual(
    scanFixture(
      'future/fonts.css',
      '@font-face { font-family: "Onest Workbench"; font-weight: 100 900; }',
    ),
    [],
  )
})

test('a component names the semantic tier, never a palette primitive', () => {
  // The palette is two tiers, and it is only two while nothing outside it names
  // the lower one. A component pinned to `--color-gray-900` is pinned to a step
  // rather than to a meaning, and the next palette move goes around it.
  // Every token the fixture declares is also consumed, so the only finding left
  // for the tier rule to make is the one the test is about.
  const palette = [
    ':root {',
    '  --color-gray-900: #181818;',
    '  --font-size-dense: 13px;',
    '  --color-canvas: var(--color-gray-900);',
    '}',
  ].join('\n')

  const reached = scanFixtures({
    'app/styles/tokens.css': palette,
    'future/Panel.vue': scoped(
      '.a { background: var(--color-gray-900); color: var(--color-canvas); font-size: var(--font-size-dense); }',
    ),
  })
  assert.equal(reached.length, 1)
  assert.match(reached[0], /--color-gray-900 is a palette primitive/)

  // The size scales are primitives too, and are named directly on purpose:
  // the rule reads the declared value, not the name.
  assert.deepEqual(
    scanFixtures({
      'app/styles/tokens.css': palette,
      'future/Panel.vue': scoped(
        '.a { background: var(--color-canvas); font-size: var(--font-size-dense); }',
      ),
    }),
    [],
  )
})

test('layout asks its container, not the window', () => {
  const asked = scanFixture(
    'future/Panel.vue',
    scoped('@media (width <= 620px) { .a { display: grid; } }'),
  )
  assert.equal(asked.length, 1)
  assert.match(asked[0], /not the window/)

  assert.deepEqual(
    scanFixture(
      'future/Panel.vue',
      scoped('@container workspace (width <= 556px) { .a { display: grid; } }'),
    ),
    [],
  )
  // Motion preference is not a width, and the two elements that size themselves
  // cannot ask a container without asking themselves.
  assert.deepEqual(
    scanFixture('future/Panel.vue', scoped('@media (prefers-reduced-motion: reduce) {}')),
    [],
  )
  assert.deepEqual(
    scanFixture(
      'widgets/app-nav/components/AppNav.vue',
      scoped('@media (width <= 760px) { .app-nav-shell { width: 64px; } }'),
    ),
    [],
  )
  // And `shell.css` is no longer one of them: the rail asks about its own width in
  // its own file, and the shell's last width question was a 4px nudge of a
  // focus-revealed skip link.
  assert.deepEqual(
    scanFixture(
      'app/styles/shell.css',
      '@media (width <= 760px) { .app-nav-shell { width: 64px; } }',
    ),
    ['app/styles/shell.css: ask the container how much room there is, not the window'],
  )
})

test('the narrow primitive owners remain explicit exceptions', () => {
  const sources = [
    ['shared/ui/VIcon.vue', '<template><svg /></template>'],
    ['shared/ui/SegmentedControl.vue', '<template><button :aria-pressed="on" /></template>'],
    ['shared/ui/VTextInput.vue', '<template><input type="text" /><textarea /></template>'],
    [
      'shared/ui/DialogFrame.vue',
      '<script setup>import OverlayHost from "./OverlayHost.vue"</script><template><OverlayHost /></template>',
    ],
    [
      'shared/ui/InspectorDrawer.vue',
      '<script setup>import OverlayHost from "./OverlayHost.vue"</script><template><OverlayHost /></template>',
    ],
    ['shared/ui/OverlayHost.vue', '<template><section role="dialog" /></template>'],
    [
      'shared/ui/ChoiceSelect.vue',
      `<script setup>import { SelectRoot } from 'reka-ui'</script><template><button role="combobox" /><div role="listbox" /></template>`,
    ],
  ]
  for (const [file, source] of sources) assert.deepEqual(scanFixture(file, source), [])
})

test('utility classes are rejected wherever they reappear', () => {
  const rejected = [
    '<template><div class="mt-4 flex items-center gap-2" /></template>',
    '<template><p class="text-sm text-[var(--color-text-muted)]" /></template>',
    '<template><span class="rounded-[var(--radius-control)] bg-[var(--color-surface)]" /></template>',
    '<template><section class="grid min-w-0 grid-cols-2" /></template>',
  ]
  for (const source of rejected) {
    const found = scanFixture('modules/planning/Sample.vue', source)
    assert.equal(found.length, 1, source)
    assert.match(found[0], /utility classes are not the styling system/)
  }
})

test('semantic class names that merely contain a utility word stay allowed', () => {
  const allowed = [
    '<template><div class="content-grid" /></template>',
    '<template><div class="flow-strip readiness-panel" /></template>',
    '<template><div class="analysis-command-bar" /></template>',
  ]
  for (const source of allowed) {
    assert.deepEqual(scanFixture('modules/planning/Sample.vue', source), [], source)
  }
})

test('the second rule to assemble a type style by hand is the one that fails', () => {
  const shorthand = scoped(
    '.a { font: 600 var(--font-size-dense)/var(--line-height-flat) var(--font-family-interface); }',
  )
  const longhands = scoped(
    '.b { font-size: var(--font-size-dense); font-weight: 600; line-height: var(--line-height-flat); }',
  )
  // Spelled two ways, so the rule is comparing the style rather than the text.
  const violations = scanFixtures({ 'future/A.vue': shorthand, 'future/B.vue': longhands })
  assert.equal(violations.length, 1)
  assert.match(violations[0], /future\/B\.vue/)
  assert.match(violations[0], /600 dense\/flat sans/)
  assert.match(violations[0], /--font-\* role/)
  // One rule may assemble whatever no other rule assembles.
  assert.deepEqual(scanFixtures({ 'future/A.vue': shorthand }), [])
  // And naming the role is the fix, however many rules name it.
  assert.deepEqual(
    scanFixtures({
      'future/A.vue': scoped('.a { font: var(--font-label); }'),
      'future/B.vue': scoped('.b { font: var(--font-label); }'),
    }),
    [],
  )
})

test('a rule that leaves the leading to inheritance has not assembled a style', () => {
  // Two of three slots is a different decision from three, and it is one no role
  // token can carry: the `font` shorthand always sets a leading. `.fact-count`
  // names a size and a weight on `CountBadge`'s own root and leaves the leading
  // to the badge, which sets it solid so a number is the height of its digits.
  const partial = scoped('.a { font-size: var(--font-size-emphasis); font-weight: 600; }')
  assert.deepEqual(
    scanFixtures({ 'future/A.vue': partial, 'future/B.vue': partial.replace('.a', '.b') }),
    [],
  )
})
