import assert from 'node:assert/strict'

import { test } from 'vitest'

import { scanUiSources } from '../scripts/ui-system/styles.mjs'

const FILE = 'widgets/future/Panel.vue'

/**
 * What each rule of the file scan is shown, as the code that trips it, in the part of a
 * component it stands in: the template, the script or the style block.
 */
const TRIGGERS: { code: string; part: 'script' | 'style' | 'template' }[] = [
  { part: 'style', code: '.card { background: var(--color-kind-epic); }' },
  { part: 'template', code: '<select></select>' },
  { part: 'script', code: "import { SelectRoot } from 'reka-ui'" },
  { part: 'template', code: '<div role="listbox"></div>' },
  { part: 'template', code: '<button aria-pressed="true"></button>' },
  { part: 'template', code: '<div role="tablist"></div>' },
  { part: 'template', code: '<textarea></textarea>' },
  { part: 'template', code: '<svg></svg>' },
  { part: 'script', code: "import OverlayHost from '@/shared/ui/OverlayHost.vue'" },
  { part: 'template', code: '<dialog></dialog>' },
  { part: 'template', code: '<details></details>' },
  { part: 'style', code: '.band { background: linear-gradient(red, blue); }' },
  { part: 'template', code: '<div class="flex items-center"></div>' },
  { part: 'style', code: '.kicker { text-transform: uppercase; }' },
  { part: 'style', code: '.glass { backdrop-filter: blur(4px); }' },
  { part: 'style', code: '.old { color: var(--ink-navy); }' },
  { part: 'template', code: '<p>Saved; it does not restart the service.</p>' },
  { part: 'template', code: '<p>A seamless view.</p>' },
  { part: 'style', code: '.heavy { font-weight: 800; }' },
  { part: 'style', code: '@media (width <= 600px) { .panel { color: inherit; } }' },
  { part: 'style', code: '.panel { color: #fff; }' },
  {
    part: 'style',
    code: '.panel { background: color-mix(in srgb, var(--color-danger) 10%, transparent); }',
  },
]

/** A component with `code` in its part, and a comment of each kind beside it. */
function component(part: string, code: string, comment = '') {
  const template = part === 'template' ? code : '<p>Text</p>'
  const script = part === 'script' ? code : ''
  const style = part === 'style' ? code : ''
  return `<script setup lang="ts">\n${script}\n</script>\n<template>${template}${comment}</template>\n<style scoped>\n${style}\n</style>\n`
}

const findings = (source: string) => scanUiSources([{ file: FILE, source }])

test('every rule of the file scan reads its trigger as code', () => {
  for (const { part, code } of TRIGGERS)
    assert.notDeepEqual(findings(component(part, code)), [], `${part}: ${code}`)
})

test('the same triggers in a comment of any kind trip no rule', () => {
  for (const { code } of TRIGGERS) {
    const wrapped = [
      component('style', '', `<!-- ${code} -->`),
      component('style', `/* ${code} */`),
      component('script', `/* ${code} */`),
      component('script', `// ${code}`),
      component('script', `const ready = true // ${code}`),
    ]
    for (const source of wrapped) assert.deepEqual(findings(source), [], source)
  }
})

test('a comment beside a trigger hides it from no rule', () => {
  for (const { part, code } of TRIGGERS) {
    const commented = component(part, `/* beside */ ${code}`).replace(
      `<template>/* beside */ `,
      '<template><!-- beside -->',
    )
    assert.notDeepEqual(findings(commented), [], commented)
  }
})
