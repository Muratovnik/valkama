import assert from 'node:assert/strict'

import { test } from 'vitest'

import { compactCss } from './support/source.ts'

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
