/**
 * The Analytics page in the space the context strip chose, against a stand-in for its read. The
 * oracle is the requirement: every read of the page's usage carries the space, so every figure is
 * the space's work, and the quota, which is an account's, is asked without it; another space is a
 * new view, read again with the last answer drawn dimmed until the new one lands.
 */
import type { VueWrapper } from '@vue/test-utils'
import { flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { LOADING_DELAY_MS } from '@/shared/ui/loadingPresence.ts'

import { serveUsage, task, value } from '../fixtures/analytics.ts'
import type { TimedStretch } from '../fixtures/analytics.ts'
import { mountAnalytics, stubAnalyticsReads } from '../support/analyticsReads.ts'

/** Wednesday afternoon, the moment the page's reads are asked at. */
const NOW = new Date(2026, 10, 11, 14, 30)
const HOUR = 3600

/** What each space's board holds this Monday: an hour in MAIN, three in BETA. */
const SPACES: Record<string, TimedStretch[]> = {
  MAIN: [
    {
      at: new Date(2026, 10, 9, 10),
      group: { work_item: task(1, 'Main work'), project: value('alpha'), model: value('m-1') },
      spend: { seconds: HOUR },
    },
  ],
  BETA: [
    {
      at: new Date(2026, 10, 9, 11),
      group: { work_item: task(2, 'Beta work'), project: value('beta'), model: value('m-2') },
      spend: { seconds: 3 * HOUR },
    },
  ],
}

/** A read with no space reads both; a space reads its own work alone. */
const worldOf = (query: URLSearchParams) => {
  const space = query.get('space')
  return space === null ? Object.values(SPACES).flat() : (SPACES[space] ?? [])
}

const time = (page: VueWrapper) =>
  page.get('.overview-panel .tile-figure[data-measure="time"]').text().replaceAll(/\s/gu, ' ')

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: NOW })
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

describe('the Analytics page in a space', () => {
  it('sends the space with every read of its usage, and none with the quota', async () => {
    const reads = stubAnalyticsReads(
      (query) => serveUsage(worldOf(query), query),
      () => ({ status: 500 }),
    )
    const page = await mountAnalytics({ space: 'MAIN' })
    // The values each filter offers are read too once the fields are open.
    await page.get('.analytics-filter-add').trigger('click')
    await flushPromises()
    // The page's own read, its period before and its accounts, the rail's tiles, the overview's
    // cards and the filters' values: each of them asked.
    expect(reads.grouped('work_item').length).toBeGreaterThan(0)
    expect(reads.grouped('seat').length).toBeGreaterThan(0)
    expect(reads.grouped('model').length).toBeGreaterThan(0)
    expect(reads.grouped('environment').length).toBeGreaterThan(0)
    expect(reads.asked.filter((query) => query.get('space') !== 'MAIN')).toEqual([])
    expect(time(page)).toBe('1 h')
    expect(reads.quotaAsked.length).toBeGreaterThan(0)
    expect(reads.quotaAsked.filter((query) => query.has('space'))).toEqual([])
  })

  it('narrows to the space and to the project chosen in it, and to neither at the top', async () => {
    const reads = stubAnalyticsReads((query) => serveUsage(worldOf(query), query))
    const page = await mountAnalytics({ space: 'BETA', projectId: 'beta' })
    expect(reads.asked.length).toBeGreaterThan(0)
    expect(
      reads.asked.filter(
        (query) => query.get('space') !== 'BETA' || query.get('project') !== 'beta',
      ),
    ).toEqual([])
    expect(time(page)).toBe('3 h')

    const top = stubAnalyticsReads((query) => serveUsage(worldOf(query), query))
    const whole = await mountAnalytics()
    expect(top.asked.length).toBeGreaterThan(0)
    expect(top.asked.filter((query) => query.has('space'))).toEqual([])
    expect(time(whole)).toBe('4 h')
  })

  it('reads another space again, its last figures dimmed until the answer lands', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'], now: NOW })
    let holding = false
    const reads = stubAnalyticsReads((query) =>
      holding ? 'hold' : serveUsage(worldOf(query), query),
    )
    const page = await mountAnalytics({ space: 'MAIN' })
    const dimmed = () => page.get('.overview-panel').classes('read-pending')
    const wait = async (ms: number) => {
      vi.advanceTimersByTime(ms)
      await flushPromises()
    }
    expect(time(page)).toBe('1 h')
    expect(dimmed()).toBe(false)

    holding = true
    const before = reads.asked.length
    await page.setProps({ space: 'BETA' })
    await flushPromises()
    const asked = reads.asked.slice(before)
    expect(asked.length).toBeGreaterThan(0)
    expect(asked.filter((query) => query.get('space') !== 'BETA')).toEqual([])
    // MAIN's figures stay drawn, dimmed once the wait is long enough to be seen.
    expect(time(page)).toBe('1 h')
    expect(dimmed()).toBe(false)
    await wait(LOADING_DELAY_MS)
    expect(dimmed()).toBe(true)
    expect(time(page)).toBe('1 h')

    holding = false
    for (const held of reads.held.splice(0))
      held.release(serveUsage(worldOf(held.query), held.query))
    await flushPromises()
    await wait(400)
    expect(time(page)).toBe('3 h')
    expect(dimmed()).toBe(false)
  })
})
