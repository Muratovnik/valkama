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

test('compactCss keeps a descendant apart from a compound, however either is written', () => {
  // `.a .b` styles a `.b` inside an `.a`; `.a.b` styles one element that has both.
  // Read as the same selector, a rule moved to the other element still passes.
  const css = [
    '.a .b { color: red; }',
    '.a.b { color: blue; }',
    '.c {',
    '  .d { color: green; }',
    '  &.d { color: black; }',
    '}',
    '.e\n    >   .f,',
    '.g\n  .h { color: gray; }',
  ].join('\n')
  assert.equal(
    compactCss(css),
    '.a .b{color:red}.a.b{color:blue}.c .d{color:green}.c.d{color:black}.e>.f,.g .h{color:gray}',
  )
  assert.deepEqual(declarationsOf(css, '.a .b'), ['color:red'])
  assert.deepEqual(declarationsOf(css, '.a.b'), ['color:blue'])
  assert.deepEqual(declarationsOf(css, '.c .d'), ['color:green'])
  assert.deepEqual(declarationsOf(css, '.c.d'), ['color:black'])
  // The selector a test names is laid out the same way, so its spacing is not a rule either.
  assert.deepEqual(declarationsOf(css, '.g   .h'), ['color:gray'])
  assert.deepEqual(declarationsOf(css, '.e > .f'), ['color:gray'])
  assert.deepEqual(declarationsOf(css, '.g.h'), [])
})

test('compactCss puts the parent wherever a nested rule writes `&`, not only at its start', () => {
  // A selector that names `&` anywhere is not prefixed with the parent: each `&`
  // is the parent, so `.row &` inside `.b` is a `.b` inside a `.row`.
  const css = '.b { .row & { color: red; } .x & + & { color: blue; } & > .c { color: gray; } }'
  assert.equal(compactCss(css), '.row .b{color:red}.x .b+.b{color:blue}.b>.c{color:gray}')
  assert.deepEqual(declarationsOf(css, '.row .b'), ['color:red'])
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
