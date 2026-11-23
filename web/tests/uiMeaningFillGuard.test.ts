/**
 * The product tree fills with a meaning colour only where `FILL_BUDGET` says. The rule's
 * fixtures, a fill it refuses and a ledger entry it holds both ways, are in
 * `uiSystemGuard.test.ts`; the whole guard runs over the tree as its own gate step.
 */
import assert from 'node:assert/strict'

import { test } from 'vitest'

import { collectVueSources } from '../scripts/ui-system/sources.mjs'
import { FILL_BUDGET, scanMeaningFills } from '../scripts/ui-system/styles.mjs'

// Read as the file loads, not in a test (`collectVueSources`).
const productFills = scanMeaningFills(collectVueSources(), FILL_BUDGET)

test('the product tree fills with a meaning colour only where the ledger says', () => {
  // The product tree against the real ledger; the switch is not on it, so a
  // switch painted a hue again fails here.
  assert.equal(FILL_BUDGET.has('shared/ui/ToggleSwitch.vue'), false)
  assert.deepEqual(productFills, [])
})
