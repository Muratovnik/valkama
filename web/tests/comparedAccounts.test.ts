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

import { mostMoved } from '@/pages/analytics/utils/overviewFigures.ts'
import { comparedLines } from '@/pages/analytics/utils/usageFigures.ts'

import type { UsageDimension } from '@/shared/api/analyticsApi.ts'

import { seatValue, task, usageAnswer, value } from './fixtures/analytics.ts'
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

/**
 * Narrowed to P, by task: now P worked five hours on T-1 and two on T-2. Before, P worked ten
 * minutes on T-1 and an hour on T-2, and the read left out three hours of its organization's work
 * on no account on T-1 and half an hour on T-2.
 */
const T1 = task(1, 'One')
const T2 = task(2, 'Two')
const NARROWED_NOW: Stretch[] = [
  { day: 0, group: { seat: P, work_item: T1 }, spend: { seconds: 5 * HOUR } },
  { day: 0, group: { seat: P, work_item: T2 }, spend: { seconds: 2 * HOUR } },
]
const NARROWED_BEFORE: Stretch[] = [
  { day: 0, group: { seat: P, work_item: T1 }, spend: { seconds: HOUR / 6 } },
  { day: 0, group: { seat: P, work_item: T2 }, spend: { seconds: HOUR } },
]
const LEFT_OUT: Stretch[] = [
  { day: 0, group: { seat: LOOSE, work_item: T1 }, spend: { seconds: 3 * HOUR } },
  { day: 0, group: { seat: LOOSE, work_item: T2 }, spend: { seconds: HOUR / 2 } },
]

/** The tasks that rose most, narrowed to P, beside the work left out when `left` is given. */
function risenMost(left: readonly Stretch[] | null) {
  const read = usageAnswer({
    first: new Date(2026, 10, 9),
    days: 1,
    groupBy: ['work_item'],
    stretches: NARROWED_NOW,
    before: NARROWED_BEFORE,
    unplaced: left ? { now: [], before: left } : null,
  }).usage
  const lines = comparedLines({
    rows: read.rows,
    before: read.comparison?.rows ?? null,
    unplaced: read.comparison?.unplaced?.rows ?? null,
    dimension: 'work_item',
    measure: 'time',
    name: (one) => one.id ?? '',
  })
  return {
    changes: Object.fromEntries(lines.map((line) => [line.value.title, line.change?.direction])),
    up: mostMoved(lines, 'time').up.map((one) => one.line.value.title),
  }
}

describe('a task’s change, narrowed to an account', () => {
  test('is not known, and not the most changed, where the work left out on it outweighed its own', () => {
    // T-1: three hours left out against ten minutes; T-2: half an hour against an hour.
    assert.deepEqual(risenMost(LEFT_OUT), { changes: { One: 'unplaced', Two: 'up' }, up: ['Two'] })
  })

  test('is a rise where the read left nothing out, the largest first', () => {
    assert.deepEqual(risenMost(null), { changes: { One: 'up', Two: 'up' }, up: ['One', 'Two'] })
  })
})
