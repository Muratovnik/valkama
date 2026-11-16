import assert from 'node:assert/strict'

import { test } from 'vitest'

import { collectVueSources } from '../scripts/ui-system/sources.mjs'
import { scanTooltipImports } from '../scripts/ui-system/tooltip-imports.mjs'

const IMPORT = "import { vTooltip } from '@/shared/ui/tooltipAnchors.ts'"

const component = (script: string, template: string) => ({
  file: 'future/Row.vue',
  source: `<script setup lang="ts">\n${script}\n</script>\n\n<template>\n${template}\n</template>\n`,
})

test('a template that writes v-tooltip without importing it is refused, at its line', () => {
  for (const template of [
    '<b v-tooltip.detail="hint">b</b>',
    '<b\n  v-tooltip:right.name="label"\n>b</b>',
    '<b v-tooltip="label">b</b>',
  ]) {
    const found = scanTooltipImports([component('', template)])
    assert.equal(found.length, 1, template)
    const line = 6 + template.split('\n').findIndex((part) => part.includes('v-tooltip'))
    assert.match(found[0] ?? '', new RegExp(`^future/Row\\.vue:${line}: `, 'u'), template)
  }
})

test('the import, a comment or another directive passes', () => {
  assert.deepEqual(scanTooltipImports([component(IMPORT, '<b v-tooltip.detail="hint">b</b>')]), [])
  const options = {
    file: 'future/Old.vue',
    source: `<script lang="ts">\n${IMPORT}\n</script>\n<template><b v-tooltip.name="x">b</b></template>\n`,
  }
  assert.deepEqual(scanTooltipImports([options]), [])
  for (const template of [
    '<!-- v-tooltip draws its hint here --><b>b</b>',
    '<b v-tooltipish="x">b</b>',
    '<b>v-tooltip</b>',
  ])
    assert.deepEqual(scanTooltipImports([component('', template)]), [], template)
})

test('every template of the product tree that writes v-tooltip imports it', () => {
  assert.deepEqual(scanTooltipImports(collectVueSources()), [])
})
