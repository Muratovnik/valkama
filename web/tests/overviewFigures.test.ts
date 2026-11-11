/**
 * The figures the overview adds to the Analytics page. Each expectation is worked out by hand from
 * the data in the test: which rise is said from its base, and which tasks moved most and by how
 * much.
 */
import assert from 'node:assert/strict'

import { describe, test } from 'vitest'

import { mostMoved, risenFromLittle } from '@/pages/analytics/utils/overviewFigures.ts'
import type { ComparedLine, Spent } from '@/pages/analytics/utils/usageFigures.ts'

import { task } from './fixtures/analytics.ts'

const spent = (seconds: number, tokens: number | null = null): Spent => ({
  seconds,
  tokens,
  cost: null,
  unpriced: 0,
})

describe('a rise from a little base', () => {
  test('is ten times the base or more, and needs something before', () => {
    assert.equal(risenFromLittle('time', spent(1200), spent(120)), true)
    assert.equal(risenFromLittle('time', spent(1199), spent(120)), false)
    assert.equal(risenFromLittle('time', spent(1200), spent(0)), false)
    assert.equal(risenFromLittle('time', spent(0), spent(0)), false)
  })

  test('is read in the measure chosen, and a measure with no figure is no rise', () => {
    assert.equal(risenFromLittle('tokens', spent(10, 5000), spent(10, 400)), true)
    assert.equal(risenFromLittle('tokens', spent(10, 5000), spent(10, null)), false)
  })
})

/** A task's line beside the period before, moving the way the seconds say. */
function line(number: number, now: number, before: number | null): ComparedLine {
  const value = task(number, `Task ${number}`)
  let change: ComparedLine['change'] = null
  if (before !== null)
    change =
      now === before
        ? { direction: 'same', ratio: 0 }
        : { direction: now > before ? 'up' : 'down', ratio: (now - before) / (before || 1) }
  return {
    key: `task-${number}`,
    kind: 'category',
    value,
    now: spent(now),
    before: before === null ? null : spent(before),
    change,
  }
}

describe('what moved most', () => {
  test('ranks by the amount in hours and not the share, three each way, the largest first', () => {
    const { up, down } = mostMoved(
      [
        line(1, 7200, 3600), // +1 h, doubled
        line(2, 41_400, 36_000), // +1 h 30 min, 15% more: the larger amount outranks the share
        line(3, 900, 0), // +15 min from nothing
        line(4, 100, 50), // +50 s, the fourth rise: left out
        line(5, 0, 7200), // −2 h, to nothing
        line(6, 5400, 7200), // −30 min
        line(7, 500, 500), // the same
      ],
      'time',
    )
    assert.deepEqual(
      up.map((one) => [one.line.key, one.by]),
      [
        ['task-2', 1.5],
        ['task-1', 1],
        ['task-3', 0.25],
      ],
    )
    assert.deepEqual(
      down.map((one) => [one.line.key, one.by]),
      [
        ['task-5', -2],
        ['task-6', -0.5],
      ],
    )
  })

  test('an equal amount keeps the order of the keys, so the list does not shuffle', () => {
    const { up } = mostMoved([line(9, 200, 100), line(8, 200, 100)], 'time')
    assert.deepEqual(
      up.map((one) => one.line.key),
      ['task-8', 'task-9'],
    )
  })

  test('nothing moves when the period before was not read', () => {
    assert.deepEqual(mostMoved([line(1, 7200, null), line(2, 0, null)], 'time'), {
      up: [],
      down: [],
    })
  })
})
