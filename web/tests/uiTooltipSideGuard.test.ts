import assert from 'node:assert/strict'

import { test } from 'vitest'

import { scanTooltipSides, SIDED_TOOLTIPS } from '../scripts/ui-system/native-titles.mjs'
import { collectVueSources } from '../scripts/ui-system/sources.mjs'

/** A fixture tree registers nothing: the product's register would all be gone in it. */
const NONE = new Map<string, string>()

const component = (template: string) => ({
  file: 'future/Row.vue',
  source: `<script setup lang="ts">\n</script>\n<template>\n${template}\n</template>\n`,
})

test('a hint that states where it stands is refused, however it says it', () => {
  for (const [template, side] of [
    ['<a v-tooltip:right.clipped="name">{{ name }}</a>', 'right'],
    ['<b v-tooltip:right-start.detail="hint">b</b>', 'right-start'],
    ['<b v-tooltip:[where].name="label">b</b>', '[where]'],
    ['<b v-tooltip.detail="{ text: hint, side: \'left\' }">b</b>', 'side'],
    ['<b v-tooltip.detail="{ text: hint, placement }">b</b>', 'placement'],
    ['<b v-tooltip.detail="{ text: side, note: align }">b</b>', null],
    ['<b v-tooltip.detail="{ text: hint, align: \'start\' }">b</b>', 'align'],
  ] as const) {
    const found = scanTooltipSides([component(template)], NONE)
    if (side === null) {
      // A value that happens to be named so says nothing of where the hint stands.
      assert.deepEqual(found, [], template)
      continue
    }
    assert.equal(found.length, 1, template)
    assert.match(found[0] ?? '', /^future\/Row\.vue:\d+: <[ab]> /u)
    assert.ok((found[0] ?? '').includes(`states where it stands (${side})`), template)
  }
  // A render function states its side as the directive's third element.
  const drawn = [
    {
      file: 'future/side.ts',
      source: "withDirectives(node, [[vTooltip, words, 'right', { name: true }]])\n",
    },
    { file: 'future/bound.ts', source: 'h(x, [[vTooltip, t(a, b), side, { detail: true }]])\n' },
    { file: 'future/none.ts', source: 'h(x, [[vTooltip, words, undefined, { name: true }]])\n' },
    { file: 'future/short.ts', source: 'h(x, [[vTooltip, words]])\n' },
  ]
  assert.deepEqual(
    scanTooltipSides(drawn, NONE).map((found) => found.split(': ')[0]),
    ['future/side.ts:1', 'future/bound.ts:1'],
  )
})

test('a hint without a side passes, and an exception passes only from the register', () => {
  for (const template of [
    '<button v-tooltip.name="label"><svg /></button>',
    '<span v-tooltip.detail="{ text: hint, words: label }">x</span>',
  ])
    assert.deepEqual(scanTooltipSides([component(template)], NONE), [], template)
  const sided = component('<time v-tooltip:left.detail="full">{{ short }}</time>')
  const register = new Map([['future/Row.vue <time> v-tooltip:left.detail="full"', 'why it must']])
  assert.deepEqual(scanTooltipSides([sided], register), [])
  assert.deepEqual(scanTooltipSides([component('<time>x</time>')], register), [
    'future/Row.vue <time> v-tooltip:left.detail="full": registered as a sided hint, and gone',
  ])
})

test('no hint of the product tree states a side, and every exception says why', () => {
  assert.deepEqual(scanTooltipSides(collectVueSources()), [])
  for (const [what, why] of SIDED_TOOLTIPS) assert.ok(why.trim().length > 10, what)
})
