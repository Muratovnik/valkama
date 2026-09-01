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
      hasScopeEscape(source),
      `${file}: declared in scopeEscapeOwners but its source no longer contains a scope escape`,
    )
  }
  assert.ok(scopeEscapeOwners.has('widgets/work-item-graph/components/GraphView.vue'))
})

test('a stylesheet outside a component is not the subject', () => {
  // `:deep()` in a plain `.css` file is meaningless rather than dangerous: there
  // is no scope for it to escape. The rule reads `.vue` and leaves the global
  // stylesheets to the rules that own them.
  assert.deepEqual(scanScopeEscapes([{ file: 'app/styles/shell.css', source: ':deep(.a) {}' }]), [])
})
