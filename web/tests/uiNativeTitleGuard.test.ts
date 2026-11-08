import assert from 'node:assert/strict'

import { test } from 'vitest'

import { scanNativeTitles } from '../scripts/ui-system/native-titles.mjs'
import { collectVueSources } from '../scripts/ui-system/sources.mjs'

const HINT = "gives the browser's own tooltip; write v-tooltip"

const component = (template: string, script = '') => ({
  file: 'future/Row.vue',
  source: `<script setup lang="ts">\n${script}\n</script>\n<template>\n${template}\n</template>\n`,
})

const HEADED = {
  file: 'shared/ui/Headed.vue',
  source:
    '<script setup lang="ts">\ndefineProps<{ title: string }>()\n</script>\n<template><h2>{{ title }}</h2></template>\n',
}
const PLAIN = {
  file: 'shared/ui/Plain.vue',
  source:
    '<script setup lang="ts">\ndefineProps<{ label: string }>()\n</script>\n<template><button>{{ label }}</button></template>\n',
}

test('an element given a title, written or bound, anywhere in a template, is refused', () => {
  for (const template of [
    '<button title="Refresh">r</button>',
    '<span :title="name">{{ name }}</span>',
    '<span v-bind:title="name">{{ name }}</span>',
    '<ul><li v-for="row in rows" :key="row" :title="row">{{ row }}</li></ul>',
    '<p v-if="a">a</p><p v-else :title="b">b</p>',
    '<svg viewBox="0 0 1 1"><path d="M0 0" title="drawn" /></svg>',
  ]) {
    const found = scanNativeTitles([component(template)])
    assert.equal(found.length, 1, template)
    assert.match(found[0] ?? '', new RegExp(`^future/Row\\.vue:\\d+: <\\w+> .*${HINT}`))
  }
})

test('a component with no title prop passes the attribute to its root, and is refused', () => {
  const imports = [
    "import Plain from '@/shared/ui/Plain.vue'",
    "import Headed from '@/shared/ui/Headed.vue'",
  ].join('\n')
  const refused = [
    '<Plain label="x" :title="hint" />',
    // A component the tree does not hold, or one chosen as the page runs.
    '<SelectItem value="a" :title="hint" />',
    '<component :is="tag" :title="hint" />',
  ]
  for (const template of refused)
    assert.equal(
      scanNativeTitles([component(template, imports), HEADED, PLAIN]).length,
      1,
      template,
    )
  // Its own title prop is its heading; a slot's is the slot's; a hint is the tooltip.
  for (const template of [
    '<Headed :title="heading" />',
    '<Headed title="Settings" />',
    '<slot name="row" :title="item.title" />',
    '<button v-tooltip="hint"><svg><title>Mark</title></svg></button>',
  ])
    assert.deepEqual(scanNativeTitles([component(template, imports), HEADED, PLAIN]), [], template)
})

test('a script that sets an element’s title is refused, and data called title is not', () => {
  const sources = [
    { file: 'future/mark.ts', source: "el.setAttribute('title', words)\n" },
    { file: 'future/draw.ts', source: "h('span', { 'class': 'mark', 'title': words })\n" },
  ]
  assert.deepEqual(
    scanNativeTitles(sources).map((found) => found.split(': ')[0]),
    ['future/mark.ts:1', 'future/draw.ts:1'],
  )
  assert.deepEqual(
    scanNativeTitles([{ file: 'future/data.ts', source: "const row = { title: 'A card' }\n" }]),
    [],
  )
})

test('a registered exception passes with its reason, and one that is gone is refused', () => {
  const source = component('<span :title="name">{{ name }}</span>')
  const register = new Map([['future/Row.vue <span> :title="name"', 'why the browser draws it']])
  assert.deepEqual(scanNativeTitles([source], register), [])
  assert.deepEqual(scanNativeTitles([component('<span>x</span>')], register), [
    'future/Row.vue <span> :title="name": registered as a native title, and gone',
  ])
})

test('the product tree gives no element a native title', () => {
  assert.deepEqual(scanNativeTitles(collectVueSources()), [])
})
