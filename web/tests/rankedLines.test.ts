/**
 * The lines of a section's ranked chart (`rankedLines`). Worked out by hand from the stretches in
 * each test: work on no task is a line like any value, standing where its figure puts it, whether
 * that is first, second or nowhere; only the folded tail of the values past the kept ones is last.
 */
import assert from 'node:assert/strict'

import { describe, test } from 'vitest'

import { rankedLines } from '@/pages/analytics/utils/usageFigures.ts'

import { noTask, task, usageAnswer } from './fixtures/analytics.ts'
import type { Stretch } from './fixtures/analytics.ts'

const HOUR = 3600

/** Three tasks of three, two and one hours, and work on no task of `none` hours, if any. */
function linesWith(none: number | null, shown = Number.POSITIVE_INFINITY) {
  const stretches: Stretch[] = [
    ...[3, 2, 1].map((hours, index) => ({
      day: 0,
      group: { work_item: task(index + 1, `Task ${index + 1}`) },
      spend: { seconds: hours * HOUR },
    })),
    ...(none === null
      ? []
      : [{ day: 1, group: { work_item: noTask }, spend: { seconds: none * HOUR } }]),
  ]
  const { usage } = usageAnswer({
    first: new Date(2026, 10, 9),
    days: 2,
    groupBy: ['work_item'],
    stretches,
  })
  return rankedLines(usage.rows, 'work_item', 'time', shown).map((line) => [
    line.kind,
    line.spent.seconds / HOUR,
  ])
}

describe('the lines of a ranked chart', () => {
  test('put work on no task first when it is the largest', () => {
    assert.deepEqual(linesWith(5), [
      ['none', 5],
      ['category', 3],
      ['category', 2],
      ['category', 1],
    ])
  })

  test('put work on no task second when one value is larger', () => {
    assert.deepEqual(linesWith(2.5), [
      ['category', 3],
      ['none', 2.5],
      ['category', 2],
      ['category', 1],
    ])
  })

  test('list the values alone when no work is on no task', () => {
    assert.deepEqual(linesWith(null), [
      ['category', 3],
      ['category', 2],
      ['category', 1],
    ])
  })

  test('fold what is past the kept lines into the tail, last, work on no task among them', () => {
    assert.deepEqual(linesWith(0.5, 2), [
      ['category', 3],
      ['category', 2],
      ['other', 1.5],
    ])
  })
})
