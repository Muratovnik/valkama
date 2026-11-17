import assert from 'node:assert/strict'

import { test } from 'vitest'

import { compactCss, declarationsOf } from './support/source.ts'

test('compactCss flattens a component’s style block, not a `<style>` written in its script', () => {
  const source = [
    '<script setup>',
    'const label = "<style>"',
    '</script>',
    '<template><p /></template>',
    '<style scoped>',
    '.a { color: red; &:hover { color: blue; } }',
    '</style>',
  ].join('\n')
  // Whitespace goes everywhere, as compactCss always removes it; only the block is flattened.
  assert.equal(
    compactCss(source),
    '<scriptsetup>constlabel="<style>"</script><template><p/></template><stylescoped>.a{color:red}.a:hover{color:blue}</style>',
  )
})

test('declarationsOf reads the rule of exactly one selector, its declarations in any order', () => {
  const css = [
    '<template><p>{{ a }}</p></template>',
    '<style scoped>',
    '.x.segmented { color: red; }',
    '.segmented { margin: 0; }',
    '.segmented-option { color: blue; }',
    '.segmented { gap: 0; .row & { display: grid; } }',
    '.list, .segmented { padding: 1px; }',
    '</style>',
  ].join('\n')
  assert.deepEqual(declarationsOf(css, '.segmented').toSorted(), [
    'gap:0',
    'margin:0',
    'padding:1px',
  ])
  assert.deepEqual(declarationsOf(css, '.nothing'), [])
})
