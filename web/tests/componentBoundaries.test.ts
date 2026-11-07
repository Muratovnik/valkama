/**
 * What keeps the component boundary rule from going quiet.
 *
 * Two tools hold the boundary and they fail in opposite ways. The ESLint plugin
 * refuses a selector no template in the file can produce, and an oversight there
 * is loud: the rule reports a real file. `scanScopeEscapes` is a list of files
 * allowed past it, and an oversight there is silent — a pattern that stops
 * matching reports nothing at all and reads as a clean tree. That already
 * happened once in this repository, to a rule about status colours, and a
 * fixture is what noticed.
 *
 * So this file states what the rule finds and what it deliberately does not,
 * against sources written here rather than against the tree.
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { test } from 'vitest'

import {
  hasScopeEscape,
  scanScopeEscapes,
  scopeEscapeOwners,
} from '../scripts/ui-system/boundaries.mjs'

const srcPath = (file: string) => fileURLToPath(new URL(`../src/${file}`, import.meta.url))

const host = (css: string) => [{ file: 'future/Host.vue', source: `<style scoped>${css}</style>` }]

const component = (script: string, css: string) => [
  {
    file: 'future/Host.vue',
    source: `<script setup lang="ts">\n${script}\n</script>\n<template><p /></template>\n<style scoped>\n${css}\n</style>`,
  },
]

test('an escape hatch is a reach unless the file is on the list', () => {
  const reaches = [
    '.registry-grant-actions :deep(.registry-revoke) { color: red; }',
    '.a ::v-deep(.b) { color: red; }',
    ':global(.launch-dialog) { width: 640px; }',
    '.a ::v-global(.b) { color: red; }',
  ]
  for (const css of reaches) {
    const found = scanScopeEscapes(host(css))
    assert.match(found[0] ?? '', /styles an element this component does not render/, css)
  }
})

test('a component placing its own slot is not a reach', () => {
  // `:slotted()` is the row that owns a grid deciding where the grid's cells go.
  // It carries the component's own scope id, so it cannot leave the component.
  assert.deepEqual(scanScopeEscapes(host('.row > :slotted(*) { grid-column: 2; }')), [])
})

test('prose quoting a selector does not authorise one', () => {
  // Every comment in these blocks says what a rule replaced, so a rule reading
  // the raw source would fire on its own explanation — and, worse, a file could
  // buy itself a reach by describing one.
  assert.deepEqual(scanScopeEscapes(host('/* was :deep(.count-badge) */ .a { color: red; }')), [])
  const bought = scanScopeEscapes(host('/* :deep() is fine here */ .a :deep(.b) { color: red; }'))
  assert.equal(bought.length, 1)
})

test('each part of a component is read in its own language, as the other rules read it', () => {
  // A `//` comment in the script is a comment, so the selector it quotes reaches nothing.
  assert.deepEqual(
    scanScopeEscapes(component('// a :deep( selector would be wrong here\nconst a = 1', '.a {}')),
    [],
  )
  // A `/*` inside a quoted glob opens no comment, so it cannot hide the reach after it.
  const hidden = component(
    "const pages = import.meta.glob('./pages/*.vue')",
    '.a :deep(.b) { color: red; }\n/* note */',
  )
  assert.equal(scanScopeEscapes(hidden).length, 1)
  // The kind the message names is read the same way: only the reach that is code.
  const named = scanScopeEscapes(
    component('// :global(.x) was here', '.a :deep(.b) { color: red; }'),
  )
  assert.match(named[0] ?? '', /^future\/Host\.vue: :deep\(\) styles/)
})

test('the declared owners are files that still exist and still reach', () => {
  // A list of exceptions decays in two directions: an entry can outlive the
  // reach it excused, and a file can be renamed out from under it. Either way
  // the entry then excuses nothing and the list stops describing the tree.
  //
  // `scanScopeEscapes` skips every file the owners list names, so it cannot be
  // the thing that checks this: asking it whether an owner still reaches would
  // always come back clean, owner or not. `hasScopeEscape` is the same test
  // `scanScopeEscapes` runs on everyone else, run here against the owner's own
  // source instead of being skipped for it.
  for (const file of scopeEscapeOwners) {
    assert.match(file, /\.vue$/, file)
    let source: string
    try {
      source = readFileSync(srcPath(file), 'utf8')
    } catch {
      assert.fail(`${file}: declared in scopeEscapeOwners but no longer exists under src/`)
      continue
    }
    assert.ok(
      hasScopeEscape(file, source),
      `${file}: declared in scopeEscapeOwners but its source no longer contains a scope escape`,
    )
  }
  assert.ok(scopeEscapeOwners.has('widgets/work-item-graph/components/GraphField.vue'))
})

test('a stylesheet outside a component is not the subject', () => {
  // `:deep()` in a plain `.css` file is meaningless rather than dangerous: there
  // is no scope for it to escape. The rule reads `.vue` and leaves the global
  // stylesheets to the rules that own them; only a sheet a component scopes is read.
  assert.deepEqual(scanScopeEscapes([{ file: 'app/styles/shell.css', source: ':deep(.a) {}' }]), [])
})

test('a stylesheet a component scopes to itself is held to the same list', () => {
  // `<style scoped src>` makes the file the component's own block, so the hatch is the same reach.
  const sheet = { file: 'future/parts/host.css', source: '.a :deep(.b) { color: red; }' }
  const scoped = {
    file: 'future/Host.vue',
    source: '<style scoped src="./parts/host.css"></style>',
  }
  const found = scanScopeEscapes([scoped, sheet])
  assert.equal(found.length, 1)
  assert.match(found[0] ?? '', /^future\/parts\/host\.css: :deep\(\) styles/)
  const global = { file: 'future/Host.vue', source: '<style src="./parts/host.css"></style>' }
  assert.deepEqual(scanScopeEscapes([global, sheet]), [])
})
