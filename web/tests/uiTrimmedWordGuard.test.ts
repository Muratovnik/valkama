import assert from 'node:assert/strict'

import { test } from 'vitest'

import { collectVueSources } from '../scripts/ui-system/sources.mjs'
import { scanTrimmedWords } from '../scripts/ui-system/trimmed-word.mjs'

const OWNER = 'app/styles/shell.css'
const OWN_RULE = `.trimmed-word {
  text-box: trim-both ex alphabetic;
  overflow: clip visible;
}`

test('the tree as it stands trims in one rule only', () => {
  assert.deepEqual(scanTrimmedWords(collectVueSources()), [])
})

test('a component that trims a word of its own is refused, however it spells the trim', () => {
  for (const css of [
    '.word { text-box: trim-both ex alphabetic; }',
    '.word { overflow: hidden; text-box-trim: trim-both; }',
    '.word { text-box-edge: ex alphabetic; }',
    '.host { .word { color: red; text-box: trim-both ex alphabetic } }',
  ]) {
    const source = `<template><i /></template><style scoped>${css}</style>`
    const violations = scanTrimmedWords([{ file: 'future/Word.vue', source }])
    assert.match(violations.join('\n'), /outside \.trimmed-word/u, css)
  }
  const inSheet = scanTrimmedWords([
    { file: 'future/marks.css', source: '.word { text-box: trim-both ex alphabetic; }' },
  ])
  assert.match(inSheet.join('\n'), /future\/marks\.css/u)
})

test('its owner may not trim in a second rule either', () => {
  const twice = `${OWN_RULE}\n.other { text-box: trim-both ex alphabetic; }`
  assert.deepEqual(scanTrimmedWords([{ file: OWNER, source: OWN_RULE }]), [])
  assert.equal(scanTrimmedWords([{ file: OWNER, source: twice }]).length, 1)
})

test('words about the property, and a script that names it, are not a declaration', () => {
  const comment =
    '<style>/* the box is trimmed with text-box: see shell.css */ .a { color: red }</style>'
  assert.deepEqual(scanTrimmedWords([{ file: 'future/Note.vue', source: comment }]), [])
  const script = "export const property = 'text-box: trim-both'"
  assert.deepEqual(scanTrimmedWords([{ file: 'future/name.ts', source: script }]), [])
})
