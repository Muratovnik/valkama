/**
 * The Analytics page's view is its address. The oracle is the requirement: a reload or a pasted
 * link gives the same view, every part of it, and the read is asked for the period the view
 * names in the browser's own time.
 */
import { describe, expect, it } from 'vitest'

import { periodBounds } from '@/pages/analytics/utils/analyticsPeriod.ts'

import { DEFAULT_VIEW, readAddress, writeAddress } from '@/shared/api/analyticsAddress.ts'
import type { AnalyticsView } from '@/shared/api/analyticsAddress.ts'
import { usageParameters } from '@/shared/api/analyticsApi.ts'
import { OFFLINE_MODULE_FALLBACK } from '@/shared/api/platformModules.ts'
import {
  isPlatformRouteUnavailable,
  resolvePlatformRoute,
  serializePlatformRoute,
  validateManifestRouteState,
} from '@/shared/api/platformRoute.ts'
import type { PlatformRoute } from '@/shared/api/platformRoute.ts'

const ITEM = '00000000-0000-4000-8000-000000000012'

/** A view that differs from the default in every part the address holds. */
const EVERY_PART: AnalyticsView = {
  period: 'custom',
  from: '2026-10-05',
  to: '2026-10-18',
  by: 'model',
  measure: 'cost',
  filters: {
    project: ['valkama'],
    work_item: [ITEM, null],
    role: ['advisor'],
    environment: [null],
  },
}

const analytics = OFFLINE_MODULE_FALLBACK.find((module) => module.module_id === 'analytics')

/** Through the whole address: the module's state, the URL the shell writes, and back. */
function throughTheAddress(view: AnalyticsView): AnalyticsView {
  const route: PlatformRoute = {
    module_id: 'analytics',
    scope: { kind: 'global' },
    state: writeAddress(view),
  }
  const back = resolvePlatformRoute(new URL(serializePlatformRoute(route), 'http://127.0.0.1'))
  if (isPlatformRouteUnavailable(back)) throw new Error('the address did not resolve')
  if (!analytics) throw new Error('no analytics manifest')
  return readAddress(validateManifestRouteState(analytics, back.state ?? {}))
}

/** The default view with a filter of models chosen in the order given. */
const chosen = (model: (string | null)[]): AnalyticsView => ({
  ...DEFAULT_VIEW,
  filters: { model },
})

describe('the Analytics address', () => {
  it('gives back every part of a view through the URL the shell writes', () => {
    expect(throughTheAddress(EVERY_PART)).toEqual(EVERY_PART)
  })

  it.each([
    ['this week', { period: 'week' }],
    [
      'the past four weeks by executor in tokens',
      { period: 'weeks4', by: 'executor', measure: 'tokens' },
    ],
    ['a filter on work with no task alone', { filters: { work_item: [null] } }],
  ] as const)('gives back %s', (_name, part) => {
    const view = { ...DEFAULT_VIEW, ...part } as AnalyticsView
    expect(throughTheAddress(view)).toEqual(view)
  })

  it('writes nothing for the default view, so the plain page has the plain address', () => {
    expect(writeAddress(DEFAULT_VIEW)).toEqual({})
    expect(readAddress(undefined)).toEqual(DEFAULT_VIEW)
  })

  it('holds one view in one address, whatever order its filters were set in', () => {
    const one = writeAddress({ ...DEFAULT_VIEW, filters: { role: ['main'], account: ['a'] } })
    const other = writeAddress({ ...DEFAULT_VIEW, filters: { account: ['a'], role: ['main'] } })
    expect(one).toEqual(other)
  })

  it('writes the values of one filter in one order, and reads them back in it', () => {
    const [a, b, c] = ['00000000-0000-4000-8000-00000000000a', 'model-b', 'model-c']
    // Chosen in two orders, each with «none» among them: ids by their characters, «none» last.
    const one = writeAddress(chosen([c, null, a, b]))
    const other = writeAddress(chosen([b, a, null, c]))
    expect(one).toEqual(other)
    expect(one.filters).toBe(`{"model":["${a}","${b}","${c}",null]}`)
    expect(readAddress(one)).toEqual(chosen([a, b, c, null]))
    expect(throughTheAddress(chosen([c, null, a, b]))).toEqual(chosen([a, b, c, null]))
    // A link written in another order reads as the same view, and writes back as that one.
    const pasted = readAddress({ filters: JSON.stringify({ model: [null, c, b, a] }) })
    expect(pasted).toEqual(chosen([a, b, c, null]))
    expect(writeAddress(pasted)).toEqual(one)
  })

  it('drops what this build cannot read and keeps the rest of the link', () => {
    expect(
      readAddress({
        period: 'fortnight',
        by: 'colour',
        measure: 'joy',
        from: '2026-10-05',
        filters: JSON.stringify({ shade: ['x'], model: ['m-1', 3, ''], effort: 'high' }),
      }),
    ).toEqual({ ...DEFAULT_VIEW, filters: { model: ['m-1'] } })
    expect(readAddress({ filters: '{not json' })).toEqual(DEFAULT_VIEW)
  })
})

describe('the period a view names', () => {
  // A Wednesday afternoon in the browser's own time, whatever zone the run is in.
  const now = new Date(2026, 10, 11, 14, 30)
  const offset = -now.getTimezoneOffset()

  it('is this week from Monday at midnight to now', () => {
    expect(periodBounds(DEFAULT_VIEW, now)).toEqual({
      from: '2026-11-09',
      to: now.toISOString(),
      utcOffset: offset,
    })
  })

  it('starts this week on Monday from a Sunday too', () => {
    const sunday = new Date(2026, 10, 15, 9)
    expect(periodBounds(DEFAULT_VIEW, sunday)?.from).toBe('2026-11-09')
  })

  it('is the past four weeks as 28 days with today the last', () => {
    expect(periodBounds({ ...DEFAULT_VIEW, period: 'weeks4' }, now)?.from).toBe('2026-10-15')
  })

  it('takes a custom period whole, its last day included', () => {
    const view = {
      ...DEFAULT_VIEW,
      period: 'custom',
      from: '2026-10-30',
      to: '2026-10-31',
    } as const
    expect(periodBounds(view, now)).toEqual({
      from: '2026-10-30',
      to: '2026-11-01',
      utcOffset: offset,
    })
  })

  it('asks nothing for a custom period without a day or with its end first', () => {
    const custom = { ...DEFAULT_VIEW, period: 'custom' } as const
    expect(periodBounds({ ...custom, from: '2026-10-30', to: '' }, now)).toBeNull()
    expect(periodBounds({ ...custom, from: '2026-10-30', to: '2026-10-29' }, now)).toBeNull()
  })
})

describe('the read a view asks', () => {
  it('names each filter by its dimension and admits work with no value through none', () => {
    const parameters = usageParameters({
      from: '2026-11-09',
      to: '2026-11-11T11:30:00.000Z',
      utcOffset: 180,
      groupBy: ['work_item'],
      filters: EVERY_PART.filters,
      compare: true,
    })
    expect(Object.fromEntries(parameters)).toEqual({
      from: '2026-11-09',
      to: '2026-11-11T11:30:00.000Z',
      step: 'day',
      utc_offset: '180',
      group_by: 'work_item',
      project: 'valkama',
      work_item: ITEM,
      role: 'advisor',
      none: 'work_item,environment',
      compare: 'true',
    })
  })
})
