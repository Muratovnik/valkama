/**
 * What the Analytics page ranks its colours over. The oracle is the requirement: a value is the
 * colour of its place in the period's ranking without the page's filters, so a filter that takes
 * values away repaints none of the rest; that ranking costs no read while no filter is set, nor
 * when one is set after answers without it were read, and one read per key and round otherwise.
 */
import assert from 'node:assert/strict'

import { describe, test } from 'vitest'

import { createColourPlaces } from '@/pages/analytics/composables/useColourPlaces.ts'
import { stackLines } from '@/pages/analytics/utils/dayFigures.ts'

import type { Usage, UsageDimension, UsageFilters, UsageQuery } from '@/shared/api/analyticsApi.ts'

import { usageAnswer, value } from './fixtures/analytics.ts'
import type { Stretch } from './fixtures/analytics.ts'

const HOUR = 3600

/** Four models, a to d, the first the largest; each at high effort, b at medium too. */
const STRETCHES: Stretch[] = [
  { day: 0, group: { model: value('a'), effort: value('high') }, spend: { seconds: 6 * HOUR } },
  { day: 0, group: { model: value('b'), effort: value('high') }, spend: { seconds: 2 * HOUR } },
  { day: 1, group: { model: value('b'), effort: value('medium') }, spend: { seconds: 3 * HOUR } },
  { day: 1, group: { model: value('c'), effort: value('medium') }, spend: { seconds: 2 * HOUR } },
  { day: 1, group: { model: value('d'), effort: value('medium') }, spend: { seconds: HOUR } },
]

const answer = (stretches: readonly Stretch[], groupBy: UsageDimension[] = ['model']) =>
  usageAnswer({ first: new Date(2026, 10, 9), days: 2, groupBy, stretches }).usage

/** The period's answer by model, and the same with only the work at medium effort. */
const ALL = answer(STRETCHES)
const MEDIUM = answer(STRETCHES.filter((one) => one.group.effort?.id === 'medium'))

/** A read the test answers by hand, and every query it was asked. */
function reader() {
  const asked: UsageQuery[] = []
  const pending: { reject: (error: Error) => void; resolve: (usage: Usage) => void }[] = []
  const read = (query: UsageQuery) => {
    asked.push(query)
    return new Promise<Usage>((resolve, reject) => {
      pending.push({ resolve, reject })
    })
  }
  return { asked, pending, read }
}

/** Lets every answer in flight reach its reader. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

function places(options: { scope?: UsageFilters } = {}) {
  const server = reader()
  let key = 'week'
  const colours = createColourPlaces({
    read: server.read,
    placesKey: () => key,
    scope: () => ({ ...options.scope }),
  })
  return {
    ...server,
    colours,
    move: (next: string) => {
      key = next
    },
  }
}

describe('the rows the page ranks its colours over', () => {
  test('take an answer read without filters as the key, and ask nothing', () => {
    const { asked, colours } = places()
    assert.equal(colours.rows('model'), null)
    colours.take(['model'], ALL, {})
    assert.equal(colours.rows('model'), ALL.rows)
    assert.equal(asked.length, 0)
  })

  test('keep the key read before a filter under the filter, and ask nothing', () => {
    const { asked, colours } = places()
    colours.take(['model'], ALL, {})
    colours.take(['model'], MEDIUM, { effort: ['medium'] })
    assert.equal(colours.rows('model'), ALL.rows)
    assert.equal(asked.length, 0)
  })

  test('ask once, without the page filters, for a key no answer without them gave', async () => {
    const { asked, colours, pending } = places({ scope: { project: ['p-1'] } })
    const crossed = answer(
      STRETCHES.filter((one) => one.group.effort?.id === 'medium'),
      ['model', 'effort'],
    )
    const filters = { effort: ['medium'], project: ['p-1'] }
    colours.take(['model', 'effort'], crossed, filters)
    colours.take(['model', 'effort'], crossed, filters)
    assert.equal(asked.length, 1)
    // The answer's own period and steps, the scope's project and nothing else.
    assert.deepEqual(asked[0], {
      from: crossed.period.from,
      to: crossed.period.to,
      utcOffset: crossed.period.utc_offset,
      step: crossed.period.step,
      groupBy: ['model', 'effort'],
      filters: { project: ['p-1'] },
      compare: false,
    })
    assert.equal(colours.rows('model', 'effort'), null)
    const whole = answer(STRETCHES, ['model', 'effort'])
    pending[0]?.resolve(whole)
    await settle()
    assert.equal(colours.rows('model', 'effort'), whole.rows)
    // The scope's project alone is no filter of the page: its answer is the key.
    colours.take(['model'], ALL, { project: ['p-1'] })
    assert.equal(colours.rows('model'), ALL.rows)
    assert.equal(asked.length, 1)
  })

  test('after a refresh under a filter, ask again and keep the key meanwhile', async () => {
    const { asked, colours, pending } = places()
    colours.take(['model'], ALL, {})
    colours.renew()
    colours.take(['model'], MEDIUM, { effort: ['medium'] })
    assert.equal(asked.length, 1)
    assert.equal(colours.rows('model'), ALL.rows)
    const fresh = answer([...STRETCHES, { day: 1, group: { model: value('e') }, spend: {} }])
    pending[0]?.resolve(fresh)
    await settle()
    assert.equal(colours.rows('model'), fresh.rows)
  })

  test('keep the key when its read fails, and ask again with the next answer', async () => {
    const { asked, colours, pending } = places()
    colours.take(['model'], ALL, {})
    colours.renew()
    colours.take(['model'], MEDIUM, { effort: ['medium'] })
    pending[0]?.reject(new Error('down'))
    await settle()
    assert.equal(colours.rows('model'), ALL.rows)
    colours.take(['model'], MEDIUM, { effort: ['medium'] })
    assert.equal(asked.length, 2)
  })

  test('forget every key for another period', () => {
    const { colours, move } = places()
    colours.take(['model'], ALL, {})
    move('weeks4')
    assert.equal(colours.rows('model'), null)
  })
})

describe('a stack under a filter', () => {
  test('give each value that stays the hue it had, and fold one the period gives no hue', () => {
    const many: Stretch[] = [
      ...STRETCHES,
      // Two more models at high effort, so the period's key has six categories and f gets none.
      { day: 0, group: { model: value('e'), effort: value('high') }, spend: { seconds: HOUR / 2 } },
      { day: 0, group: { model: value('f'), effort: value('medium') }, spend: { seconds: 60 } },
    ]
    const whole = answer(many)
    const medium = answer(many.filter((one) => one.group.effort?.id === 'medium'))
    const unfiltered = stackLines({ usage: whole, by: 'model', measure: 'time' })
    const filtered = stackLines({
      usage: medium,
      by: 'model',
      measure: 'time',
      places: whole.rows,
    })
    const slots = (lines: ReturnType<typeof stackLines>) =>
      Object.fromEntries(lines.map((line) => [line.key, line.slot]))
    // a 6 h, b 5 h, c 2 h, d 1 h, e half an hour: five hues in that order; f folds into «other».
    assert.deepEqual(slots(unfiltered), {
      'v:a': 1,
      'v:b': 2,
      'v:c': 3,
      'v:d': 4,
      'v:e': 5,
      'other': 'other',
    })
    // At medium effort a and e are gone: b, c and d keep their hues, f still folds.
    assert.deepEqual(slots(filtered), { 'v:b': 2, 'v:c': 3, 'v:d': 4, 'other': 'other' })
    // Ranked over the filtered answer alone, the survivors would move up a hue each.
    const own = stackLines({ usage: medium, by: 'model', measure: 'time' })
    assert.equal(slots(own)['v:b'], 1)
  })
})
