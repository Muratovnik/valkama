import assert from 'node:assert/strict'

import { test } from 'vitest'

import { collectVueSources } from '../scripts/ui-system/sources.mjs'
import { scanTreeRoles, TREE_ROLES_OWNER } from '../scripts/ui-system/tree-roles.mjs'

const scan = (file: string, source: string) => scanTreeRoles([{ file, source }])

/** What the rule says of the word it found, wherever it is. */
const said = (file: string, line: number, word: string) =>
  `${file}:${line}: ${word} is a tree's role or a tree row's place; take them from ${TREE_ROLES_OWNER} with v-bind="treeGridAttrs(…)" or v-bind="treeRowAttrs(row)"`

test('a tree role or a row placement written in a template is refused', () => {
  for (const [markup, word] of [
    ['<table role="treegrid">', 'treegrid'],
    ['<tr :aria-level="row.depth + 1">', 'aria-level'],
    ['<tr aria-setsize="4">', 'aria-setsize'],
    ['<tr :aria-posinset="at">', 'aria-posinset'],
    ['<tr v-bind="{ \'aria-level\': 2 }">', 'aria-level'],
  ]) {
    const file = 'widgets/future/FutureTree.vue'
    assert.deepEqual(
      scan(file, `<template>\n  ${markup}\n</template>`),
      [said(file, 2, word)],
      markup,
    )
  }
})

test('the same written from a script is refused, through the DOM properties too', () => {
  const file = 'shared/lib/futureTree.ts'
  assert.deepEqual(
    scan(
      file,
      [
        "element.setAttribute('role', 'treegrid')",
        'row.ariaLevel = String(depth + 1)',
        "row.setAttribute('aria-posinset', '1')",
        'row.ariaSetSize = String(count)',
      ].join('\n'),
    ),
    [
      said(file, 1, 'treegrid'),
      said(file, 2, 'ariaLevel'),
      said(file, 3, 'aria-posinset'),
      said(file, 4, 'ariaSetSize'),
    ],
  )
})

test('the owner writes them, a binding of its attributes and a comment pass', () => {
  assert.deepEqual(
    scan(TREE_ROLES_OWNER, "export const role = 'treegrid'\nconst level = { 'aria-level': 1 }"),
    [],
  )
  assert.deepEqual(
    scan(
      'widgets/future/FutureTree.vue',
      [
        '<template>',
        '  <!-- The table is a treegrid; aria-level comes from the model. -->',
        '  <table v-bind="treeGridAttrs({ windowed, rowCount })">',
        '    <tr v-bind="treeRowAttrs(row)" :aria-expanded="open" :aria-rowindex="at" />',
        '  </table>',
        '</template>',
        '<script setup lang="ts">',
        '// aria-setsize and aria-posinset are counted by treeRowAttrs.',
        "import { treeGridAttrs, treeRowAttrs } from '@/shared/lib/treeRows.ts'",
        '</script>',
      ].join('\n'),
    ),
    [],
  )
  // A word that only begins like one is not one.
  assert.deepEqual(
    scan('shared/lib/future.ts', "const levels = 'aria-levels'; const x = 'treegrids'"),
    [],
  )
})

// Read as the file loads, not in a test (`collectVueSources`).
const productFindings = scanTreeRoles(collectVueSources())

test('the tree writes the tree roles in their owner alone', () => {
  assert.deepEqual(productFindings, [])
})
