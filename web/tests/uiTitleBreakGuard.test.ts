import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { test } from 'vitest'

import { scanUiTree } from '../scripts/check-ui-system.mjs'
import { collectVueSources } from '../scripts/ui-system/sources.mjs'
import { scanTitleBreaks, UNBROKEN_TITLES } from '../scripts/ui-system/title-breaks.mjs'

const drawn = (template: string) => [
  {
    file: 'future/Row.vue',
    source: `<script setup lang="ts"></script>\n<template>${template}</template>`,
  },
]

test('the tree as it stands writes no title as text but the ones it registers', () => {
  assert.deepEqual(scanTitleBreaks(collectVueSources()), [])
})

test('the gate runs the rule, and holds a tree that is not the product to an empty register', () => {
  const root = mkdtempSync(join(tmpdir(), 'valkama-ui-guard-'))
  try {
    mkdirSync(join(root, 'shared/ui'), { recursive: true })
    // A file the product registers, so only an empty register refuses it here.
    writeFileSync(
      join(root, 'shared/ui/SectionHeader.vue'),
      drawn('<h3>{{ title }}</h3>')[0].source,
    )
    const violations = scanUiTree(root).filter((violation) => violation.includes('v-slash-breaks'))
    assert.equal(violations.length, 1)
    assert.ok(violations[0].startsWith('shared/ui/SectionHeader.vue: writes {{ title }}'))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a new surface that writes a title as text is refused, however it names it', () => {
  for (const template of [
    '<strong class="combo-title">{{ option.title }}</strong>',
    '<span>{{ title }}</span>',
    '<span>{{item.title}}</span>',
    '<span>{{ candidate.reference }} · {{ candidate.title }}</span>',
    '<span>{{ node?.title ?? fallback }}</span>',
    '<span>{{\n  member.title\n}}</span>',
  ]) {
    const violations = scanTitleBreaks(drawn(template), new Map())
    assert.match(violations.join('\n'), /draw it with v-slash-breaks/u, template)
  }
})

test('a title drawn through the directive, and words that only mention one, are not refused', () => {
  for (const template of [
    '<strong v-slash-breaks="option.title" class="combo-title" />',
    '<span :title="item.title">{{ item.reference }}</span>',
    "<span>{{ t('app.title') }}</span>",
    '<span>{{ moduleTitle(module) }}</span>',
    '<span>{{ subtitle }}</span>',
    '<!-- {{ item.title }} --><span />',
  ]) {
    assert.deepEqual(scanTitleBreaks(drawn(template), new Map()), [], template)
  }
  const script = 'export const label = (item: { title: string }) => `{{ ${item.title} }}`'
  assert.deepEqual(scanTitleBreaks([{ file: 'future/label.ts', source: script }], new Map()), [])
})

test('the register lets through only what it names, and names only what the tree holds', () => {
  const register = new Map([['future/Row.vue {{ title }}', "a heading's words"]])
  assert.deepEqual(scanTitleBreaks(drawn('<h3>{{ title }}</h3>'), register), [])
  assert.equal(scanTitleBreaks(drawn('<h3>{{ item.title }}</h3>'), register).length, 2)
  assert.match(scanTitleBreaks(drawn('<h3 />'), register).join('\n'), /no longer writes; drop it/u)
  for (const reason of UNBROKEN_TITLES.values()) assert.ok(reason.length > 0)
})
