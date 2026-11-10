/**
 * The way from an item's Agents tab to the Analytics page filtered to that item: a real link, in
 * the route form every page is opened by, whose state names the item by the usage read's own
 * parameter, and which the Analytics module's manifest accepts as its state.
 */
import { afterEach, describe, expect, it } from 'vitest'

import { OFFLINE_MODULE_FALLBACK } from '@/shared/api/platformModules.ts'
import {
  parsePlatformRoute,
  resolveManifestRouteAuthority,
  validateManifestRouteState,
} from '@/shared/api/platformRoute.ts'

import { whoUsage } from '../fixtures/usage.ts'
import { mountSummary } from './usageSummaryHost.ts'

describe('the way to Analytics', () => {
  afterEach(() => document.body.replaceChildren())

  it('opens the Analytics page filtered to this item, by the read’s own parameter', () => {
    const usage = whoUsage()
    const link = mountSummary(usage).get('a.work-usage-analytics')
    expect(link.text()).toBe('Open in Analytics')
    const href = link.attributes('href') ?? ''
    expect(href.startsWith('/modules/analytics/global?state=')).toBe(true)
    const route = parsePlatformRoute(new URL(href, 'http://localhost'))
    expect(route).toEqual({
      module_id: 'analytics',
      scope: { kind: 'global' },
      state: { work_item: usage.work_item_id },
    })
    const analytics = OFFLINE_MODULE_FALLBACK.find((module) => module.module_id === 'analytics')
    if (!analytics) throw new Error('the analytics module is missing')
    expect(validateManifestRouteState(analytics, route.state)).toEqual({
      work_item: usage.work_item_id,
    })
    expect(resolveManifestRouteAuthority(analytics, route)).toEqual({ status: 'ready' })
  })

  it('follows the item the tab reads', () => {
    const other = '7d3e9a10-0000-4000-8000-0000000000ff'
    const href = mountSummary(whoUsage({ work_item_id: other }))
      .get('a.work-usage-analytics')
      .attributes('href')
    expect(parsePlatformRoute(new URL(href ?? '', 'http://localhost')).state).toEqual({
      work_item: other,
    })
  })
})
