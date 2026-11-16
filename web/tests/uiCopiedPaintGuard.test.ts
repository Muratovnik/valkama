/**
 * The one register of the semantic-state guard: a component whose bound style copies paint the
 * page already shows, read back from it, is not held to the rule against authoring paint, and a
 * registered component that is gone is refused.
 */
import assert from 'node:assert/strict'

import { test } from 'vitest'

import { scanSemanticStateOwnership } from '../scripts/ui-system/semantic-states.mjs'

const component = (source: string) => [{ file: 'future/StatusView.vue', source }]

test('a registered component may bind paint it reads back from the page, and one gone is refused', () => {
  const copying = `
    <script setup>
    const ink = getComputedStyle(document.body).color
    </script>
    <template><div class="copy" :style="{ color: ink }">Words</div></template>
  `
  const register = new Map([['future/StatusView.vue', 'copies the ink the page shows']])
  // Unregistered, a bound colour is an authored paint value.
  assert.equal(scanSemanticStateOwnership(component(copying), new Map()).length, 1)
  assert.deepEqual(scanSemanticStateOwnership(component(copying), register), [])
  const gone = new Map([['future/Gone.vue', 'copied paint once']])
  assert.deepEqual(
    scanSemanticStateOwnership(component(copying), new Map([...register, ...gone])),
    ['future/Gone.vue: registered as copying paint, and gone'],
  )
})
