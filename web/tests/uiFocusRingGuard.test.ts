import assert from 'node:assert/strict'

import { test } from 'vitest'

import { scanFocusRingWidths } from '../scripts/ui-system/focus-rings.mjs'
import { collectVueSources } from '../scripts/ui-system/sources.mjs'

const RING = "a focus ring's width is var(--size-focus-ring)"

const styled = (css: string) => [
  {
    file: 'future/Row.vue',
    source: `<template><p /></template>\n<style scoped>\n${css}\n</style>`,
  },
]

test('a focus ring that writes its own width is refused, however it writes it', () => {
  for (const css of [
    '.a:focus-visible { outline: 2px solid var(--color-focus-ring); }',
    '.a:focus { OUTLINE: 2PX solid; }',
    '.a:focus-visible { outline: solid var(--color-focus-ring); outline-width: 2px; }',
    '.a:focus-visible { outline-width: var(--ring, 2px); }',
    '.a:focus-visible {\n  outline:\n    2px dashed var(--color-focus-ring);\n}',
    // In rem, in a sum, in a keyword: still a width written out.
    '.a:focus-visible { outline: 0.125rem solid var(--color-focus-ring); }',
    '.a:focus-within { outline: calc(1px + 1px) solid; }',
    '.a:focus-visible { outline: thin solid; }',
    // Through a property the same file sets to one, here or on a host the rule sits under.
    '.a { --ring: 2px; &:focus-visible { outline: var(--ring) solid; } }',
    '.host { --ring: 2px; } .host .a:focus-visible { outline-width: var(--ring); }',
    // A focus state named by a rule it is nested in, or beside another state.
    '.a:focus-visible { .icon { outline: 2px solid; } }',
    '.a { & :focus-visible { outline: 2px solid } }',
    '.a:hover, .a:focus-visible { outline: 2px solid; }',
  ])
    assert.deepEqual(
      scanFocusRingWidths(styled(css)),
      [`future/Row.vue: writes the width of 1 focus ring(s) itself; ${RING}`],
      css,
    )
  const sheet = [
    {
      file: 'future/ring.css',
      source: '.a:focus-visible { outline: 2px solid; } .b:focus { outline: 2px solid; }',
    },
  ]
  assert.deepEqual(scanFocusRingWidths(sheet), [
    `future/ring.css: writes the width of 2 focus ring(s) itself; ${RING}`,
  ])
})

test('the token, an outline for no focus state, an offset and a comment are not refused', () => {
  for (const css of [
    '.a:focus-visible { outline: var(--size-focus-ring) solid var(--color-focus-ring); }',
    '.a:focus-visible { outline-width: var(--ring, var(--size-focus-ring)); }',
    '.a { --ring: var(--size-focus-ring); &:focus-visible { outline: var(--ring) solid; } }',
    '.a:focus-visible { outline: none; } .b:focus-visible { outline: 0; }',
    '.a:focus-visible { outline: var(--size-focus-ring) solid; outline-offset: 2px; }',
    // Outlines that are no focus ring keep their own widths.
    '.a.is-drop-target { outline: 2px dashed var(--color-accent); }',
    '.a { outline: 1px solid CanvasText; outline-offset: 2px; }',
    '.a[data-highlighted] { outline: 1px solid var(--color-focus-ring); }',
    '.a:not(:focus-visible) { outline: 1px solid; }',
    '.a { content: "; outline: 2px"; }',
    '/* .a:focus-visible { outline: 2px solid } */ .a { color: red; }',
  ])
    assert.deepEqual(scanFocusRingWidths(styled(css)), [], css)
  // A script names no focus state: what it writes into an inline style is not read here.
  const scripts = [
    { file: 'future/ring.ts', source: "el.style.outline = '2px solid'" },
    {
      file: 'future/Row.vue',
      source:
        '<script setup>const css = "a:focus { outline: 2px }"</script>\n<template><p style="outline: 2px solid" /></template>',
    },
  ]
  assert.deepEqual(scanFocusRingWidths(scripts), [])
})

test('every focus ring in the tree takes its width from the token', () => {
  assert.deepEqual(scanFocusRingWidths(collectVueSources()), [])
})
