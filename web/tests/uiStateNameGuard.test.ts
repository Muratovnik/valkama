import assert from 'node:assert/strict'

import { test } from 'vitest'

import { collectVueSources } from '../scripts/ui-system/sources.mjs'
import { scanStateNames, STATE_NAME_READS } from '../scripts/ui-system/state-names.mjs'

const HINT = "prints a workflow state's name as the space wrote it; name it through useStateName"

const component = (template: string, script = '') => ({
  file: 'future/Row.vue',
  source: `<script setup lang="ts">\n${script}\n</script>\n<template>\n${template}\n</template>\n`,
})

test('a template or a script that prints a state’s name itself is refused', () => {
  for (const [template, script] of [
    ['<span>{{ item.state.name }}</span>', ''],
    ['<SemanticState :label="props.state.name" />', ''],
    ['<span>{{ row.state_name }}</span>', ''],
    ['<span>{{ word }}</span>', 'const word = computed(() => props.item.state?.name)'],
    [
      '<span>{{ word }}</span>',
      'const word = props.workflow.states.find((state) => state.key === key)?.name ?? key',
    ],
  ]) {
    const found = scanStateNames([component(template, script)], new Map())
    assert.equal(found.length, 1, `${template} ${script}`)
    assert.match(found[0] ?? '', new RegExp(`^future/Row\\.vue:\\d+: .*${HINT}`))
  }
  const plain = {
    file: 'future/columns.ts',
    source: 'export const word = (item) => item.state.name\n',
  }
  assert.equal(scanStateNames([plain], new Map()).length, 1)
})

test('a name through the function, a key, a category or a comment passes', () => {
  const script = [
    'const stateName = useStateName()',
    'const word = computed(() => stateName(props.item.state))',
    '// item.state.name is the space’s word, not the reader’s',
    'const key = props.item.state.key',
  ].join('\n')
  const template = [
    '<!-- {{ item.state.name }} -->',
    '<span :data-state="item.state.key" :data-category="item.state.category">{{ word }}</span>',
  ].join('\n')
  assert.deepEqual(scanStateNames([component(template, script)], new Map()), [])
})

test('a registered read passes, and a registered one that is gone is refused', () => {
  const register = new Map([['future/Row.vue first.state.name', 'compares, names nothing']])
  const compares = component('<span />', 'const same = first.state.name === second.state.key')
  assert.deepEqual(scanStateNames([compares], register), [])
  assert.deepEqual(scanStateNames([component('<span />')], register), [
    'future/Row.vue first.state.name: registered as a state name read, and gone',
  ])
})

test('the product tree prints no state name but through the function, and its register is exact', () => {
  assert.deepEqual(scanStateNames(collectVueSources()), [])
  for (const reason of STATE_NAME_READS.values()) assert.ok(reason.length > 20)
})
