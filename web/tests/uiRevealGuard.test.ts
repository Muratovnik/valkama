import assert from 'node:assert/strict'

import { test } from 'vitest'

import { REVEAL_OWNER, scanRevealCopies } from '../scripts/ui-system/reveal.mjs'
import { collectVueSources } from '../scripts/ui-system/sources.mjs'

const ASKED =
  'whether a pointer can hover is asked once, in reveal.css; reveal an action with its classes'
const COPIED =
  'brings something into sight under the pointer; an action kept out of sight until then takes reveal-row and reveal from reveal.css'
const HIDES = 'hides an action where nothing can hover; hide it only under (hover: hover)'
const ONE_QUERY = 'asks only (hover: hover), once'

const OWNER = `@media (hover: hover) {
  .reveal { opacity: 0; transition: opacity 1s; }
  .reveal-row:is(:hover, :has(:focus-visible)) .reveal { opacity: 1; }
}`

const scan = (file: string, css: string) =>
  scanRevealCopies([{ file, source: file.endsWith('.vue') ? `<style scoped>${css}</style>` : css }])

test('the owner hides an action only where a pointer can hover', () => {
  assert.deepEqual(scan(REVEAL_OWNER, OWNER), [])
  // Spaces and capitals aside, it is the same one query.
  assert.deepEqual(scan(REVEAL_OWNER, OWNER.replace('(hover: hover)', '(Hover:hover)')), [])
  for (const css of ['.reveal { opacity: 0; }', '.reveal { visibility: hidden; }'])
    assert.deepEqual(
      scan(REVEAL_OWNER, css),
      [`${REVEAL_OWNER}: ${ONE_QUERY}`, `${REVEAL_OWNER}: ${HIDES}`],
      css,
    )
  assert.deepEqual(scan(REVEAL_OWNER, `${OWNER}\n.reveal-row .reveal { opacity: 0.0; }`), [
    `${REVEAL_OWNER}: ${HIDES}`,
  ])
})

test('the owner asks no other question about hover, nor the same one twice', () => {
  // Under any other list the hide is no longer only where a pointer can hover.
  for (const query of ['(hover: none)', '(any-hover: hover)', '(hover: hover), (pointer: fine)'])
    assert.deepEqual(
      scan(REVEAL_OWNER, OWNER.replace('(hover: hover)', query)),
      [`${REVEAL_OWNER}: ${ONE_QUERY}`, `${REVEAL_OWNER}: ${HIDES}`],
      query,
    )
  assert.deepEqual(
    scan(REVEAL_OWNER, `${OWNER}\n@media (hover: hover) { .reveal { inset: 0; } }`),
    [`${REVEAL_OWNER}: ${ONE_QUERY}`],
  )
})

test('a hover question anywhere else is a copy, in a component or a stylesheet', () => {
  for (const [file, query] of [
    ['future/Row.vue', '(hover: none)'],
    ['future/Row.vue', '(hover: hover)'],
    ['future/Row.vue', '(any-hover: none)'],
    ['future/Row.vue', '(prefers-reduced-motion: reduce), (hover: none)'],
    ['future/row.css', '(HOVER:NONE)'],
  ]) {
    const css = `.action { visibility: hidden; } @media ${query} { .action { visibility: visible; } }`
    assert.deepEqual(scan(file, css), [`${file}: ${ASKED}`], `${file} ${query}`)
  }
})

test('a rule that brings something into sight under the pointer is a copy, nested or flat', () => {
  for (const css of [
    // The lane heading's copy: the state in the enclosing selector.
    '.actions { opacity: 0; .head:is(:hover, :has(:focus-visible)) & { opacity: 1; } }',
    // The rail pin's copy: a sight token the row sets.
    '.row { --pin-sight: hidden; &:is(:hover, :focus-within) { --pin-sight: visible; } }',
    '.row:hover .action { visibility: visible; }',
    '.row:hover { .action { opacity: 1 } }',
  ])
    assert.deepEqual(scan('future/Row.vue', css), [`future/Row.vue: ${COPIED}`], css)
})

test('what hover changes besides sight, and sight that focus alone keeps, are not copies', () => {
  for (const css of [
    '.row:hover { background: var(--color-surface-hover); }',
    '.row:hover .action { opacity: 0.8; }',
    '.row:has(:focus-visible) .action { opacity: 1; visibility: visible; }',
    '.action { opacity: 1; } .action:focus-visible { outline: 2px solid; }',
    '@media (prefers-reduced-motion: reduce) { .action { transition: none; } }',
  ])
    assert.deepEqual(scan('future/Row.vue', css), [], css)
})

test('the tree reveals every action through reveal.css', () => {
  assert.deepEqual(scanRevealCopies(collectVueSources()), [])
})
