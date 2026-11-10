import assert from 'node:assert/strict'

import { test } from 'vitest'

import {
  ONE_LINE_COPIES,
  ONE_LINE_OWNER,
  scanOneLineCopies,
} from '../scripts/ui-system/one-line.mjs'
import { collectVueSources } from '../scripts/ui-system/sources.mjs'

const OWNER = `.one-line {
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.trimmed-word {
  text-box: trim-both cap alphabetic;
  overflow: clip visible;
  text-overflow: ellipsis;
}`

const ELLIPSIS = 'ends text in an ellipsis of its own'
const CLIPPED = 'holds text to one line and clips it with no ellipsis'

const scan = (file: string, css: string, register?: ReadonlyMap<string, string>) =>
  scanOneLineCopies(
    [
      {
        file,
        source: file.endsWith('.vue')
          ? `<template><i /></template><style scoped>${css}</style>`
          : css,
      },
    ],
    register ?? new Map(),
  )

test('the tree as it stands ends a line in an ellipsis through the shared rule only', () => {
  assert.deepEqual(scanOneLineCopies(collectVueSources(), ONE_LINE_COPIES), [])
})

test('a rule of its own that ends text in an ellipsis is refused, however it is written', () => {
  for (const [css, place] of [
    ['.name { min-width: 0; overflow: hidden; text-overflow: ellipsis; }', '.name'],
    ['.name{text-overflow:ellipsis}', '.name'],
    ['.name { text-overflow: "…"; }', '.name'],
    ['.name { text-overflow: clip ellipsis; }', '.name'],
    ['.host { color: red; .name { text-overflow: ellipsis } }', '.host .name'],
    ['.host { &.cut { text-overflow: ellipsis; } }', '.host &.cut'],
    [
      '@container (width < 560px) { .detail { text-overflow: ellipsis; } }',
      '@container (width < 560px) .detail',
    ],
  ] as const) {
    assert.deepEqual(
      scan('future/Name.vue', css),
      [
        `future/Name.vue ${place}: ${ELLIPSIS}; write the shared one-line class (${ONE_LINE_OWNER}) on the element, or trimmed-word one-line on a trimmed word, with a clipped hint of its whole words, or register why it cannot`,
      ],
      css,
    )
  }
  assert.match(
    scan('future/marks.css', '.word { text-overflow: ellipsis; }').join('\n'),
    /^future\/marks\.css \.word: /u,
  )
})

test('one line clipped with its ellipsis forgotten is the same copy', () => {
  for (const css of [
    '.name { white-space: nowrap; overflow: hidden; }',
    '.name { white-space: pre; overflow-x: clip; }',
    '.name { text-wrap-mode: nowrap; overflow-inline: hidden; }',
    '.name { text-wrap: nowrap; overflow: clip visible; }',
  ])
    assert.match(
      scan('future/Name.vue', css).join('\n'),
      new RegExp(`\\.name: ${CLIPPED}`, 'u'),
      css,
    )
})

test('what cuts no words a reader sees, or no words at all, passes', () => {
  for (const css of [
    // The initial value, written to undo an ellipsis where words wrap.
    '.word { white-space: normal; overflow: visible; text-overflow: clip; }',
    // Hidden whole and kept for assistive technology.
    '.label { position: absolute; width: 1px; height: 1px; white-space: nowrap; overflow: hidden; clip-path: inset(50%); }',
    '.label { white-space: nowrap; overflow: hidden; clip: rect(0 0 0 0); }',
    // One line that runs on, and a box that clips what wraps.
    '.row { white-space: nowrap; }',
    '.box { overflow: hidden; }',
    // Clipped down only: a line is not cut across.
    '.row { white-space: nowrap; overflow: visible hidden; }',
    // Words about the properties.
    '/* text-overflow: ellipsis comes from .one-line */ .a { color: red; }',
  ])
    assert.deepEqual(scan('future/Fine.vue', css), [], css)
  const script =
    "<script setup>const rule = '.x { text-overflow: ellipsis }'</script><template><i /></template>"
  assert.deepEqual(
    scanOneLineCopies([{ file: 'future/Script.vue', source: script }], new Map()),
    [],
  )
})

test('a copy split over rules is still a copy', () => {
  // Two rules for one selector are one rule: its one line, and the clip written further down.
  assert.match(
    scan('future/Name.vue', '.name { white-space: nowrap; } .name { overflow: hidden; }').join(
      '\n',
    ),
    new RegExp(`\\.name: ${CLIPPED}`, 'u'),
  )
  // An ellipsis is refused wherever the one line comes from.
  assert.match(
    scan(
      'future/Name.vue',
      '.row { white-space: nowrap; } .row .name { text-overflow: ellipsis; }',
    ).join('\n'),
    new RegExp(`\\.row \\.name: ${ELLIPSIS}`, 'u'),
  )
  // Rules for different selectors, or under a condition, are not merged.
  assert.deepEqual(
    scan('future/Fine.vue', '.row { white-space: nowrap; } .box { overflow: hidden; }'),
    [],
  )
})

/** A component whose template is given, with a stylesheet of its own. */
const component = (template: string, css: string, register?: ReadonlyMap<string, string>) =>
  scanOneLineCopies(
    [
      {
        file: 'future/Row.vue',
        source: `<template>${template}</template><style scoped>${css}</style>`,
      },
    ],
    register ?? new Map(),
  )

/** What the guard says of a trimmed word its component holds to one line. */
const finding = (classes: string, holder: string) =>
  `future/Row.vue <span> class="${classes}": is a trimmed word, which ends in an ellipsis, held to one line by .${holder}; write the shared one-line class (${ONE_LINE_OWNER}) on the element, or trimmed-word one-line on a trimmed word, with a clipped hint of its whole words, or register why it cannot`

test('a trimmed word that its component holds to one line is a one-line label without its class', () => {
  // Held by what holds it, as the state's word was by the state.
  assert.deepEqual(
    component(
      '<p class="row"><b v-if="a"><span class="trimmed-word">{{ a }}</span></b></p>',
      '.row { display: flex; white-space: nowrap; }',
    ),
    [finding('trimmed-word', 'row')],
  )
  // Held itself, by a nested rule or one of a list.
  assert.deepEqual(
    component(
      '<span class="label trimmed-word">{{ a }}</span>',
      '.box { & .label, .other { white-space: nowrap; } }',
    ),
    [finding('label trimmed-word', 'label')],
  )
  // With the class it is the shared label; a rule that hides its element whole holds no line.
  for (const [template, css] of [
    [
      '<p class="row"><span class="trimmed-word one-line">{{ a }}</span></p>',
      '.row { white-space: nowrap; }',
    ],
    [
      '<p class="row"><span class="trimmed-word">{{ a }}</span></p>',
      '.row { white-space: nowrap; overflow: hidden; clip-path: inset(50%); }',
    ],
    [
      '<p class="row"><span class="trimmed-word">{{ a }}</span></p>',
      '.other { white-space: nowrap; }',
    ],
  ])
    assert.deepEqual(component(template, css), [], template)
  const register = new Map([['future/Row.vue <span> class="trimmed-word"', 'never cut']])
  assert.deepEqual(
    component(
      '<p class="row"><span class="trimmed-word">{{ a }}</span></p>',
      '.row { white-space: nowrap; }',
      register,
    ),
    [],
  )
})

test('the owner writes the two rules, and a third in it is a copy too', () => {
  assert.deepEqual(scan(ONE_LINE_OWNER, OWNER), [])
  const third = `${OWNER}\n.label { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }`
  assert.match(
    scan(ONE_LINE_OWNER, third).join('\n'),
    /app\/styles\/shell\.css \.label: ends text/u,
  )
  // The class's name inside another selector is not the class's own rule.
  assert.equal(
    scan(ONE_LINE_OWNER, `${OWNER}\n.nav .one-line { text-overflow: ellipsis; }`).length,
    1,
  )
})

test('a registered exception passes, and one the tree no longer holds is refused', () => {
  const register = new Map([['future/Edge.vue .edge-name', 'a label the reader sizes by dragging']])
  const css = '.edge-name { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }'
  assert.deepEqual(scan('future/Edge.vue', css, register), [])
  assert.deepEqual(scan('future/Edge.vue', '.edge-name { color: red; }', register), [
    'future/Edge.vue .edge-name: registered as a one-line exception, and gone',
  ])
})
