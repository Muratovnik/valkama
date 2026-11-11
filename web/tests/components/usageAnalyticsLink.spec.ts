/**
 * The way from an item's Agents tab to the Analytics page: a real link whose target, read the way
 * the page reads its own address, is the page filtered to every item the tab's figures cover — the
 * item, or an epic with its children — over the days that work spans in the browser's own
 * calendar, since the tab's figures cover all of it and the page's own period is this week. The
 * route holds a state string of at most 240 characters,
 * and the filter is one such string: `{"work_item":[…]}` is 15 characters and 39 more for each
 * item id, so five ids fit and six do not. Past that the link opens the epic's own work, and its
 * words say so.
 */
import { afterEach, describe, expect, it } from 'vitest'

import { DEFAULT_VIEW, readAddress } from '@/shared/api/analyticsAddress.ts'
import type { AnalyticsView } from '@/shared/api/analyticsAddress.ts'
import type { ItemUsage } from '@/shared/api/planningUsageApi.ts'
import { OFFLINE_MODULE_FALLBACK } from '@/shared/api/platformModules.ts'
import {
  parsePlatformRoute,
  resolveManifestRouteAuthority,
  validateManifestRouteState,
} from '@/shared/api/platformRoute.ts'

import { whoUsage } from '../fixtures/usage.ts'
import { mountSummary } from './usageSummaryHost.ts'

const child = (index: number) => `7d3e9a10-0000-4000-8000-${String(index).padStart(12, '0')}`

/** A moment of August 2026 in the browser's own time: day, hour, minute. */
const at = (day: number, hour: number, minute: number) =>
  new Date(2026, 7, day, hour, minute).toISOString()

/**
 * The fixture's work, standing from half an hour before the midnight that ends 13 August to half
 * an hour after the one that begins 16 August, in the browser's own time: a day read in UTC
 * names another day at one end or the other. The latest end is not the last stretch's.
 */
function tabUsage(overrides: Partial<ItemUsage> = {}): ItemUsage {
  const usage = whoUsage(overrides)
  const times = [
    [at(13, 23, 30), at(14, 2, 0)],
    [at(14, 9, 0), at(16, 0, 30)],
    [at(14, 12, 0), at(14, 13, 0)],
    [at(15, 8, 0), at(15, 9, 0)],
  ]
  return {
    ...usage,
    account_stretches: usage.account_stretches.map((stretch, index) => ({
      ...stretch,
      started_at: times[index][0],
      ended_at: times[index][1],
    })),
  }
}

/** An epic's read: its own line, then one for each child, as the read lists them. */
function epicUsage(children: number): ItemUsage {
  const usage = tabUsage({ scope: 'epic' })
  const [own] = usage.by_item
  return {
    ...usage,
    by_item: [
      own,
      ...Array.from({ length: children }, (_, index) => ({
        ...own,
        work_item_id: child(index + 1),
        reference: `MAIN-${100 + index}`,
      })),
    ],
  }
}

/** The link's words and the view the page reads from its target, as the app opens it. */
function follow(usage: ItemUsage): { view: AnalyticsView; words: string } {
  const link = mountSummary(usage).get('a.work-usage-analytics')
  const route = parsePlatformRoute(new URL(link.attributes('href') ?? '', 'http://localhost'))
  expect(route.module_id).toBe('analytics')
  const analytics = OFFLINE_MODULE_FALLBACK.find((module) => module.module_id === 'analytics')
  if (!analytics) throw new Error('the analytics module is missing')
  expect(resolveManifestRouteAuthority(analytics, route)).toEqual({ status: 'ready' })
  return {
    view: readAddress(validateManifestRouteState(analytics, route.state ?? {})),
    words: link.text(),
  }
}

const filteredTo = (items: string[]): AnalyticsView => ({
  ...DEFAULT_VIEW,
  period: 'custom',
  from: '2026-08-13',
  to: '2026-08-16',
  filters: { work_item: items },
})

describe('the way to Analytics', () => {
  afterEach(() => document.body.replaceChildren())

  it('opens the page filtered to an item without children, over the days its work spans', () => {
    const usage = tabUsage()
    expect(follow(usage)).toEqual({
      view: filteredTo([usage.work_item_id]),
      words: 'Open in Analytics',
    })
  })

  it('follows the item the tab reads', () => {
    const other = '7d3e9a10-0000-4000-8000-0000000000ff'
    const usage = tabUsage({ work_item_id: other })
    expect(
      follow({ ...usage, by_item: [{ ...usage.by_item[0], work_item_id: other }] }).view,
    ).toEqual(filteredTo([other]))
  })

  it('keeps the page’s own period for an item whose read holds no stretch of work', () => {
    const usage = whoUsage({ account_stretches: [] })
    expect(follow(usage).view).toEqual({
      ...DEFAULT_VIEW,
      filters: { work_item: [usage.work_item_id] },
    })
  })

  it('opens an epic with a few children filtered to the epic and every child', () => {
    const usage = epicUsage(2)
    expect(follow(usage)).toEqual({
      view: filteredTo([usage.work_item_id, child(1), child(2)]),
      words: 'Open in Analytics',
    })
  })

  it('carries every item while they fit in the address, five ids', () => {
    const usage = epicUsage(4)
    const items = [usage.work_item_id, child(1), child(2), child(3), child(4)]
    // The filter of five ids stands within the route's 240 characters, and a sixth passes them.
    expect(JSON.stringify(filteredTo(items).filters)).toHaveLength(15 + 39 * 5)
    expect(15 + 39 * 5).toBeLessThanOrEqual(240)
    expect(15 + 39 * 6).toBeGreaterThan(240)
    expect(follow(usage)).toEqual({ view: filteredTo(items), words: 'Open in Analytics' })
  })

  it('opens the epic’s own work, and says so, once they do not fit, six ids', () => {
    const usage = epicUsage(5)
    expect(follow(usage)).toEqual({
      view: filteredTo([usage.work_item_id]),
      words: 'Open the epic’s own work in Analytics',
    })
  })
})
