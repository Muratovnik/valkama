import assert from 'node:assert/strict'

import { test } from 'vitest'

import { DETAIL_TOOLTIPS, scanTooltipKinds } from '../scripts/ui-system/native-titles.mjs'
import { collectVueSources } from '../scripts/ui-system/sources.mjs'

/** A fixture tree registers nothing: the product's register would all be gone in it. */
const NONE = new Map<string, string>()

const component = (template: string) => ({
  file: 'future/Row.vue',
  source: `<script setup lang="ts">\n</script>\n<template>\n${template}\n</template>\n`,
})

test('a hint that states no kind, or two, is refused wherever it stands', () => {
  for (const template of [
    '<button v-tooltip="label"><svg /></button>',
    '<a v-tooltip:right="name">{{ name }}</a>',
    '<ul><li v-for="row in rows" :key="row" v-tooltip="row">{{ row }}</li></ul>',
    '<p v-if="a">a</p><p v-else v-tooltip.top="b">b</p>',
    '<span v-tooltip.name.detail="b">b</span>',
  ]) {
    const found = scanTooltipKinds([component(template)], NONE)
    assert.equal(found.length, 1, template)
    assert.match(
      found[0] ?? '',
      /^future\/Row\.vue:\d+: <\w+> v-tooltip.* states (?:no kind|more than one kind)/,
    )
  }
  // A render function gives the kind as the directive's modifiers.
  const drawn = [
    { file: 'future/draw.ts', source: 'withDirectives(node, [[vTooltip, words]])\n' },
    { file: 'future/side.ts', source: "withDirectives(node, [[vTooltip, words, 'right']])\n" },
  ]
  assert.deepEqual(
    scanTooltipKinds(drawn, NONE).map((found) => found.split(': ')[0]),
    ['future/draw.ts:1', 'future/side.ts:1'],
  )
})

test('a name and a clipped hint pass; a detail passes only from the register', () => {
  for (const template of [
    '<button v-tooltip.name="label"><svg /></button>',
    '<a v-tooltip:right.clipped="name">{{ name }}</a>',
  ])
    assert.deepEqual(scanTooltipKinds([component(template)], NONE), [], template)
  assert.deepEqual(
    scanTooltipKinds(
      [
        {
          file: 'future/draw.ts',
          source: 'h(x, [[vTooltip, words, undefined, { name: true }]])\n',
        },
      ],
      NONE,
    ),
    [],
  )
  const detail = component('<time v-tooltip.detail="full">{{ short }}</time>')
  const [refused = ''] = scanTooltipKinds([detail], NONE)
  assert.match(refused, /a detail nobody registered/)
  const register = new Map([['future/Row.vue <time> v-tooltip.detail="full"', 'the whole date']])
  assert.deepEqual(scanTooltipKinds([detail], register), [])
  assert.deepEqual(scanTooltipKinds([component('<time>x</time>')], register), [
    'future/Row.vue <time> v-tooltip.detail="full": registered as a detail, and gone',
  ])
  const script = {
    file: 'future/draw.ts',
    source: 'h(x, [[vTooltip, why, undefined, { detail: true }]])\n',
  }
  assert.match(scanTooltipKinds([script], NONE)[0] ?? '', /a detail nobody registered/)
  assert.deepEqual(
    scanTooltipKinds(
      [script],
      new Map([['future/draw.ts script [vTooltip, why, undefined, { detail: true }]', 'why']]),
    ),
    [],
  )
})

test('every detail of the product tree says why its words are not on the screen', () => {
  assert.deepEqual(scanTooltipKinds(collectVueSources()), [])
  for (const [what, why] of DETAIL_TOOLTIPS) assert.ok(why.trim().length > 10, what)
})
