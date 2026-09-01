import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { test } from 'vitest'

const OWNED_COMPONENTS = [
  'src/pages/sessions/SessionsView.vue',
  'src/pages/sessions/SessionTable.vue',
  'src/widgets/session-detail/SessionDetailDrawer.vue',
  'src/widgets/session-detail/SessionFeed.vue',
  'src/widgets/session-detail/SessionActions.vue',
]

test('session components never present Error.message directly', () => {
  for (const path of OWNED_COMPONENTS) {
    const source = readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
    assert.doesNotMatch(source, /(?:error|failure)\s+as\s+Error\)\.message|error\.message/u, path)
  }
})
