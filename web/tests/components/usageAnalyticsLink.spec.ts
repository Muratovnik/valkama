/**
 * The way from an item's Agents tab to the Analytics page: a real link whose target, read the way
 * the page reads its own address, is the page filtered to every item the tab's figures cover — the
 * item, or an epic with its children. The route holds a state string of at most 240 characters,
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

/** An epic's read: its own line, then one for each child, as the read lists them. */
function epicUsage(children: number): ItemUsage {
  const usage = whoUsage({ scope: 'epic' })
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
  filters: { work_item: items },
})

describe('the way to Analytics', () => {
  afterEach(() => document.body.replaceChildren())

  it('opens the page filtered to an item without children', () => {
    const usage = whoUsage()
    expect(follow(usage)).toEqual({
      view: filteredTo([usage.work_item_id]),
      words: 'Open in Analytics',
    })
  })

  it('follows the item the tab reads', () => {
    const other = '7d3e9a10-0000-4000-8000-0000000000ff'
    const usage = whoUsage({ work_item_id: other })
    expect(
      follow({ ...usage, by_item: [{ ...usage.by_item[0], work_item_id: other }] }).view,
    ).toEqual(filteredTo([other]))
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
