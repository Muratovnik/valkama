/**
 * The small charts of a dimension, day by day. Worked out by hand from the stretches in each
 * test: the eight largest values in the measure each a chart, unknown work and work with no value
 * among them by their figures, the rest one chart of «other» that adds them up day by day; a day
 * a value did not work is zero, and a day it worked without a figure in the measure is null, never
 * zero.
 */
import assert from 'node:assert/strict'

import { describe, test } from 'vitest'

import { dayMultiples } from '@/pages/analytics/utils/dayMultiples.ts'

import { usageAnswer, value } from './fixtures/analytics.ts'
import type { Stretch } from './fixtures/analytics.ts'

const HOUR = 3600
const model = (number: number) => `model-${String(number).padStart(2, '0')}`

describe('the small charts of a dimension', () => {
  test('chart eight values, fold the rest into «other» day by day, unknown work among them', () => {
    // Ten models on the first day, model-n working 11 - n hours; model-01 an hour more on the
    // second, beside half an hour nobody can place, the smallest, folded with the rest.
    const stretches: Stretch[] = [
      ...Array.from({ length: 10 }, (_, index) => ({
        day: 0,
        group: { model: value(model(index + 1)) },
        spend: { seconds: (10 - index) * HOUR },
      })),
      { day: 1, group: { model: value(model(1)) }, spend: { seconds: HOUR } },
      { day: 1, group: {}, spend: { seconds: HOUR / 2 } },
    ]
    const { usage } = usageAnswer({
      first: new Date(2026, 10, 9),
      days: 2,
      groupBy: ['model'],
      stretches,
    })
    const charts = dayMultiples({ usage, by: 'model', measure: 'time' })
    assert.deepEqual(
      charts.map(({ line, values }) => [line.key === 'other' ? 'other' : line.kind, values]),
      [
        ...Array.from({ length: 8 }, (_, index) => [
          'category',
          index === 0 ? [10, 1] : [10 - index, 0],
        ]),
        // model-09 and model-10: two hours and one on the first day; unknown work half an hour
        // on the second.
        ['other', [3, 0.5]],
      ],
    )
    assert.equal(charts[0]?.line.value?.id, model(1))
  })

  test('give unknown work a chart of its own where its figure ranks it among the eight', () => {
    // Three models of an hour each, and four hours nobody can place: the largest, charted first.
    const stretches: Stretch[] = [
      ...Array.from({ length: 3 }, (_, index) => ({
        day: 0,
        group: { model: value(model(index + 1)) },
        spend: { seconds: HOUR },
      })),
      { day: 1, group: {}, spend: { seconds: 4 * HOUR } },
    ]
    const { usage } = usageAnswer({
      first: new Date(2026, 10, 9),
      days: 2,
      groupBy: ['model'],
      stretches,
    })
    const charts = dayMultiples({ usage, by: 'model', measure: 'time' })
    assert.deepEqual(
      charts.map(({ line, values }) => [line.kind, values]),
      [
        ['unknown', [0, 4]],
        ['category', [1, 0]],
        ['category', [1, 0]],
        ['category', [1, 0]],
      ],
    )
  })

  test('leave a day without a figure in the measure empty, not zero', () => {
    const stretches: Stretch[] = [
      { day: 0, group: { model: value('model-a') }, spend: { seconds: HOUR, tokens: 100 } },
      { day: 1, group: { model: value('model-a') }, spend: { seconds: HOUR } },
    ]
    const { usage } = usageAnswer({
      first: new Date(2026, 10, 9),
      days: 3,
      groupBy: ['model'],
      stretches,
    })
    const charts = dayMultiples({ usage, by: 'model', measure: 'tokens' })
    assert.deepEqual(
      charts.map((one) => one.values),
      [[100, null, 0]],
    )
  })
})
