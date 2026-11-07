import assert from 'node:assert/strict'

import { test } from 'vitest'

import { scanTypeStyles } from '../scripts/ui-system/styles.mjs'

test('a type style written in a script string is no rule body, so it assembles nothing', () => {
  const source = [
    '<script setup>',
    'const label = "<style>"',
    'const css = "a { font: 600 var(--font-size-dense)/var(--line-height-flat) var(--font-family-interface); }"',
    '</script>',
    '<template><p /></template>',
    '<style scoped>.b { font: 600 var(--font-size-dense)/var(--line-height-flat) var(--font-family-interface); }</style>',
  ].join('\n')
  assert.deepEqual(scanTypeStyles([{ file: 'future/A.vue', source }]), [])
})
