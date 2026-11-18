import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { test } from 'vitest'

import { scanUiTree } from '../scripts/check-ui-system.mjs'
import { collectVueSources } from '../scripts/ui-system/sources.mjs'
import { OTHER_TITLES, scanTitleBreaks } from '../scripts/ui-system/title-breaks.mjs'

const drawn = (template: string) => [
  {
    file: 'future/Row.vue',
    source: `<script setup lang="ts"></script>\n<template>${template}</template>`,
  },
]

/** A title written as text is refused naming the work item's primitive, then the other title's. */
const WRITTEN_REFUSAL =
  /as text; a work item's title is drawn through v-work-item-title .*v-slash-breaks/u

/** A title drawn through `v-slash-breaks` is refused naming the work item's primitive. */
const SLASHED_REFUSAL =
  /: draws v-slash-breaks=.*a work item's title is drawn through v-work-item-title/u

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
    assert.match(violations.join('\n'), WRITTEN_REFUSAL, template)
  }
})

test('a title drawn through its primitive, and words that only mention one, are not refused', () => {
  for (const template of [
    '<strong v-work-item-title="option.title" class="combo-title" />',
    '<span v-text-runs="option.runs" class="combo-title" />',
    // Text that is no title breaks after a `/` through the directive, as before.
    '<strong v-slash-breaks="option.label" class="combo-title" />',
    '<span v-slash-breaks="subtitle" />',
    `<span v-slash-breaks="t('app.title')" />`,
    '<span :title="item.title" v-slash-breaks="item.path" />',
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

test('a title drawn through v-slash-breaks is refused, naming the work item title primitive', () => {
  for (const template of [
    '<strong v-slash-breaks="option.title" class="combo-title" />',
    "<span v-slash-breaks='item.title'></span>",
    '<component :is="tag" v-slash-breaks="node?.title ?? fallback" class="name" />',
    '<li v-slash-breaks="`${row.title} ·`">x</li>',
    '<span\n  v-slash-breaks="\n    member.title\n  "\n/>',
  ]) {
    const violations = scanTitleBreaks(drawn(template), new Map())
    assert.equal(violations.length, 1, template)
    assert.match(violations[0], SLASHED_REFUSAL, template)
  }
  // Its place is named by the element it stands on, which a register entry lets through.
  const named = scanTitleBreaks(
    drawn('<h2 class="head"><strong v-slash-breaks="title" /></h2>'),
    new Map(),
  )
  assert.equal(named.length, 1)
  assert.ok(
    named[0].startsWith('future/Row.vue: draws v-slash-breaks="title" in h2.head > strong,'),
    named[0],
  )
  const register = new Map([
    ['future/Row.vue v-slash-breaks="title" in h2.head > strong', "the interface's words"],
  ])
  assert.deepEqual(
    scanTitleBreaks(drawn('<h2 class="head"><strong v-slash-breaks="title" /></h2>'), register),
    [],
  )
  assert.match(
    scanTitleBreaks(drawn('<h2 class="head"><strong /></h2>'), register).join('\n'),
    /registers future\/Row.vue v-slash-breaks="title" in h2.head > strong, which the tree no longer writes/u,
  )
})

test('the register lets through only what it names, and names only what the tree holds', () => {
  const register = new Map([['future/Row.vue {{ title }} in h3', "a heading's words"]])
  assert.deepEqual(scanTitleBreaks(drawn('<h3>{{ title }}</h3>'), register), [])
  assert.equal(scanTitleBreaks(drawn('<h3>{{ item.title }}</h3>'), register).length, 2)
  assert.match(scanTitleBreaks(drawn('<h3 />'), register).join('\n'), /no longer writes; drop it/u)
  for (const reason of OTHER_TITLES.values()) assert.ok(reason.length > 0)
})

test('a title inside a template literal is a title written as text', () => {
  for (const template of [
    '<span>{{ `${item.title} · ${count}` }}</span>',
    '<span>{{ `${`#${node.title}`}` }}</span>',
    "<span>{{ `${t('a')}: ${row?.title ?? ''}` }}</span>",
  ]) {
    const violations = scanTitleBreaks(drawn(template), new Map())
    assert.match(violations.join('\n'), WRITTEN_REFUSAL, template)
  }
  for (const template of [
    '<span>{{ `title: ${count}` }}</span>',
    "<span>{{ `${t('item.title')} ${count}` }}</span>",
    "<span>{{ '`' + subtitle }}</span>",
  ])
    assert.deepEqual(scanTitleBreaks(drawn(template), new Map()), [], template)
})

test('an entry lets through one place, named by the element it stands in', () => {
  const twice = drawn(
    '<p class="pinned">{{ title }}</p><h2 class="name"><slot>{{ title }}</slot></h2>',
  )
  const first = new Map([['future/Row.vue {{ title }} in p.pinned', 'the pinned words']])
  const refused = scanTitleBreaks(twice, first)
  assert.equal(refused.length, 1)
  assert.ok(
    refused[0].startsWith('future/Row.vue: writes {{ title }} in h2.name > slot as text'),
    refused[0],
  )
  const both = new Map([...first, ['future/Row.vue {{ title }} in h2.name > slot', 'the heading']])
  assert.deepEqual(scanTitleBreaks(twice, both), [])
  assert.match(
    scanTitleBreaks(drawn('<p class="pinned">{{ title }}</p>'), both).join('\n'),
    /registers future\/Row.vue \{\{ title \}\} in h2.name > slot, which the tree no longer writes/u,
  )
})

test('two places that swap keep their own reasons, and two in one kind of element are counted', () => {
  const register = new Map([
    ['future/Row.vue {{ title }} in p.pinned', 'the pinned words, held to one line'],
    ['future/Row.vue {{ title }} in h2', 'the heading the interface writes'],
  ])
  const placed = drawn('<p class="pinned">{{ title }}</p><h2>{{ title }}</h2>')
  const swapped = drawn('<h2>{{ title }}</h2><p class="pinned">{{ title }}</p>')
  assert.deepEqual(scanTitleBreaks(placed, register), [])
  assert.deepEqual(scanTitleBreaks(swapped, register), [])
  // A place the register did not name is refused wherever it stands in the file.
  const moved = drawn('<h2>{{ title }}</h2><p class="row">{{ title }}</p>')
  assert.deepEqual(
    scanTitleBreaks(moved, register).map((line) => line.split(' as text')[0]),
    [
      'future/Row.vue: writes {{ title }} in p.row',
      'title-breaks.mjs: registers future/Row.vue {{ title }} in p.pinned, which the tree no longer writes; drop it',
    ],
  )
  // Only places alike in expression and element are told apart by their order.
  const alike = drawn('<li>{{ title }}</li><li>{{ title }}</li>')
  assert.deepEqual(
    scanTitleBreaks(alike, new Map()).map((line) => line.split(' as text')[0]),
    ['future/Row.vue: writes {{ title }} in li', 'future/Row.vue: writes {{ title }} in li #2'],
  )
})

test('the element a title stands in is read past attributes, void and closed elements', () => {
  const template =
    '<div class="row" :title="a > b"><img src="x"><input /><span class="x">a</span>' +
    '<VBadge class="tag one" v-if="ok">{{ item.title }}</VBadge>{{ title }}</div>'
  assert.deepEqual(
    scanTitleBreaks(drawn(template), new Map()).map((line) => line.split(' as text')[0]),
    [
      'future/Row.vue: writes {{ item.title }} in VBadge.tag.one',
      'future/Row.vue: writes {{ title }} in div.row',
    ],
  )
})
