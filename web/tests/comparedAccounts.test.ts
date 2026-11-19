/**
 * An account's change from the period before (`comparedLines`) where its organization placed work
 * on no account then. The oracle is DESIGN's rule for the section's table: an account that spent
 * now, whose organization's work no reading placed on an account came to more before than its own,
 * has no percent but «not known before»; the rule reads that work in the same line as the account
 * — beside the same second value of a pair — so a pair of the account and a model is held to its
 * organization's unplaced work on that model alone. Each expectation is worked out by hand.
 */
import assert from 'node:assert/strict'

import { describe, test } from 'vitest'

import { comparedLines } from '@/pages/analytics/utils/usageFigures.ts'

import type { UsageDimension } from '@/shared/api/analyticsApi.ts'

import { seatValue, usageAnswer, value } from './fixtures/analytics.ts'
import type { Stretch } from './fixtures/analytics.ts'

const ORG = '0a0a0a0a-1111-4222-8333-444444444444'
const P = seatValue(`${ORG}/1b1b1b1b-1111-4222-8333-444444444444`)
const LOOSE = seatValue(`${ORG}/`)
const MODEL_A = value('model-a')
const MODEL_B = value('model-b')
const HOUR = 3600

/**
 * Now P worked an hour on each model. Before, P worked half an hour on model-a and two hours on
 * model-b, and its organization placed two hours of model-a and one of model-b on no account.
 */
const NOW: Stretch[] = [
  { day: 0, group: { seat: P, model: MODEL_A }, spend: { seconds: HOUR } },
  { day: 0, group: { seat: P, model: MODEL_B }, spend: { seconds: HOUR } },
]
const BEFORE: Stretch[] = [
  { day: 0, group: { seat: P, model: MODEL_A }, spend: { seconds: HOUR / 2 } },
  { day: 0, group: { seat: P, model: MODEL_B }, spend: { seconds: 2 * HOUR } },
  { day: 0, group: { seat: LOOSE, model: MODEL_A }, spend: { seconds: 2 * HOUR } },
  { day: 0, group: { seat: LOOSE, model: MODEL_B }, spend: { seconds: HOUR } },
]

/** P's lines by `by`, split by `across`, each by the model it holds and its change. */
function changesOf(by: UsageDimension, across: UsageDimension) {
  const read = usageAnswer({
    first: new Date(2026, 10, 9),
    days: 1,
    groupBy: [by, across],
    stretches: NOW,
    before: BEFORE,
  }).usage
  const lines = comparedLines({
    rows: read.rows,
    before: read.comparison?.rows ?? null,
    dimension: by,
    across,
    measure: 'time',
    name: (one) => one.id ?? '',
  })
  return Object.fromEntries(
    lines
      .filter((line) => [line.second?.value.id, line.value.id].includes(P.id))
      .map((line) => {
        const model = by === 'model' ? line.value.id : line.second?.value.id
        return [model, line.change?.direction]
      }),
  )
}

describe('an account’s change beside its organization’s unplaced work', () => {
  test('is held to the unplaced work of the same pair, the account split by model', () => {
    // model-a: two unplaced hours against half an hour; model-b: one against two.
    assert.deepEqual(changesOf('seat', 'model'), { 'model-a': 'unplaced', 'model-b': 'down' })
  })

  test('reads the account where it is the second of a pair, by model and by account', () => {
    assert.deepEqual(changesOf('model', 'seat'), { 'model-a': 'unplaced', 'model-b': 'down' })
  })
})
