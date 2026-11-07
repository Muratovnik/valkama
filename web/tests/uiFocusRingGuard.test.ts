import assert from 'node:assert/strict'

import { test } from 'vitest'

import { scanFocusRingWidths } from '../scripts/ui-system/lines.mjs'
import { collectVueSources } from '../scripts/ui-system/sources.mjs'

const RING = "a focus ring's width is var(--size-focus-ring)"

const styled = (css: string) => [
  {
    file: 'future/Row.vue',
    source: `<template><p /></template>\n<style scoped>\n${css}\n</style>`,
  },
]

test('a ring that writes its width as 2px is refused, however it spells the outline', () => {
  for (const css of [
    '.a:focus-visible { outline: 2px solid var(--color-focus-ring); }',
    '.a { color: red; outline: 2px solid Highlight; }',
    '.a:focus-visible { outline: solid var(--color-focus-ring); outline-width: 2px; }',
    '.a:focus-visible { outline-width: var(--ring, 2px); }',
    '.a:focus-visible {\n  outline:\n    2px dashed var(--color-focus-ring);\n}',
  ])
    assert.deepEqual(
      scanFocusRingWidths(styled(css)),
      [`future/Row.vue: writes 1 outline(s) 2px wide; ${RING}`],
      css,
    )
  const sheet = [
    { file: 'future/ring.css', source: '.a { outline: 2px solid; } .b { outline: 2px solid; }' },
  ]
  assert.deepEqual(scanFocusRingWidths(sheet), [
    `future/ring.css: writes 2 outline(s) 2px wide; ${RING}`,
  ])
})

test('the token, a forced palette frame, an offset and a comment are not refused', () => {
  for (const css of [
    '.a:focus-visible { outline: var(--size-focus-ring) solid var(--color-focus-ring); }',
    '.a { outline: 1px solid CanvasText; outline-offset: 2px; }',
    '.a:focus-visible { outline-width: var(--ring, var(--size-focus-ring)); }',
    '/* was outline: 2px solid var(--color-focus-ring) */ .a { color: red; }',
    '.a { border: 2px solid var(--color-rule); outline: 12px solid; }',
  ])
    assert.deepEqual(scanFocusRingWidths(styled(css)), [], css)
  const script = [{ file: 'future/ring.ts', source: "export const ring = 'outline: 2px solid'" }]
  assert.deepEqual(scanFocusRingWidths(script), [])
})

test('every focus ring in the tree takes its width from the token', () => {
  assert.deepEqual(scanFocusRingWidths(collectVueSources()), [])
})
