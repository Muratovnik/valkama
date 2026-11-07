import assert from 'node:assert/strict'

import { test } from 'vitest'

import { collectVueSources } from '../scripts/ui-system/sources.mjs'
import { scanUiSources } from '../scripts/ui-system/styles.mjs'

const WINDOW = 'ask the container how much room there is, not the window'
const REACH = 'shared/ui/reach.css'
const FINGER = '@media (pointer: coarse), (width <= 620px) { .reach::before { inset: 0; } }'

const asked = (file: string, css: string) =>
  scanUiSources([{ file, source: file.endsWith('.vue') ? `<style scoped>${css}</style>` : css }])

test('a width anywhere in a query list asks the window', () => {
  for (const query of [
    '(pointer: coarse), (width <= 620px)',
    '(hover: none), (forced-colors: active), (max-width: 40rem)',
    'screen and (min-width: 40rem)',
    'not all and (400px < width)',
    '(prefers-reduced-motion: reduce),\n  (width > 900px)',
  ]) {
    const css = `@media ${query} { .a { display: grid; } }`
    assert.deepEqual(asked('future/Panel.vue', css), [`future/Panel.vue: ${WINDOW}`], query)
  }
})

test('a list that asks no width, and a width that is no query, are not refused', () => {
  for (const css of [
    '@media (pointer: coarse), (hover: none) { .a { display: grid; } }',
    '@media (prefers-reduced-motion: reduce), (forced-colors: active) { .a { color: inherit; } }',
    '@container overlay (width <= 30rem) { .a { display: grid; } }',
    '.a { max-width: 20rem; min-width: 0; inline-size: 100%; }',
    '@media (min-resolution: 2dppx) { .a { display: grid; } }',
  ])
    assert.deepEqual(asked('future/Panel.vue', css), [], css)
})

test('reach.css holds the one finger query, and only that one', () => {
  assert.deepEqual(asked(REACH, FINGER), [])
  assert.deepEqual(
    asked(REACH, `${FINGER}\n@media (width <= 900px) { .reach { color: inherit; } }`),
    [`${REACH}: ${WINDOW}`, `${REACH}: ${WINDOW}`],
  )
  assert.deepEqual(asked(REACH, '@media (width <= 620px) { .reach { color: inherit; } }'), [
    `${REACH}: ${WINDOW}`,
  ])
  // Spelled with other spaces or capitals it is still the one query.
  assert.deepEqual(
    asked(REACH, '@media (Pointer:coarse) ,\n  (width<=620px) { .reach { inset: 0; } }'),
    [],
  )
  // The same query anywhere else is a window question like any other.
  assert.deepEqual(asked('shared/ui/EntryHead.vue', FINGER), [`shared/ui/EntryHead.vue: ${WINDOW}`])
})

test('reach.css may ask the finger query only as written, not a list that merely holds a coarse pointer', () => {
  for (const query of [
    '(pointer: coarse), (width <= 4000px)',
    '(pointer: coarse), (width <= 620px), (min-width: 1px)',
    '(width <= 620px), (pointer: coarse)',
    '(pointer: coarse), (max-width: 620px)',
    '(pointer: coarse), (hover: none), (width <= 620px)',
  ]) {
    const css = `@media ${query} { .reach::before { inset: 0; } }`
    assert.deepEqual(asked(REACH, css), [`${REACH}: ${WINDOW}`], query)
  }
})

test('the tree asks the window only where it may', () => {
  const findings = scanUiSources(collectVueSources()).filter((line) => line.endsWith(WINDOW))
  assert.deepEqual(findings, [])
})
