/**
 * The tree every product-tree guard scans is the product.
 *
 * Seven guards (reveal, native title, tooltip side, focus ring, tooltip import,
 * trimmed word, viewport query) assert that `collectVueSources()` yields no
 * finding and keep no register of their own, so a walk that read nothing, or
 * the wrong folder, would pass every one of them. This file is their shared
 * domain guard: the walk must reach the files those rules name as owners and
 * every kind of source the rules read.
 */
import assert from 'node:assert/strict'

import { test } from 'vitest'

import { ONE_LINE_OWNER } from '../scripts/ui-system/one-line.mjs'
import { REVEAL_OWNER } from '../scripts/ui-system/reveal.mjs'
import { collectVueSources } from '../scripts/ui-system/sources.mjs'

// Owners from two layers, and one file of each kind the walk keeps (.css, .vue, .ts).
const KNOWN = [
  REVEAL_OWNER,
  // The finger query's owner, which the viewport-query guard names.
  'shared/ui/reach.css',
  ONE_LINE_OWNER,
  'app/App.vue',
  'shared/lib/uiSystem.ts',
]

test('the product-tree walk reads the product', () => {
  const files = new Map(collectVueSources().map(({ file, source }) => [file, source]))
  for (const file of KNOWN) assert.ok(files.get(file)?.trim(), `${file} is read and not empty`)
})
