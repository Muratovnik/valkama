/**
 * Whether a quota window is fresh or silent, judged by the panel's clock. The oracle is the
 * connection contract: a window is `fresh` while its latest sample is at most the answer's
 * `fresh_for_seconds` old and `silent` once it is older. The answer's own `state` was judged when
 * the server answered, so a panel left open past the threshold must not go on saying a reading is
 * fresh: the page's clock ticks, the answer stays, and the words, the window's `data-state` and
 * the tightest tile follow the clock alone.
 *
 * The answers here give a threshold of ten minutes, not the server's fifteen, so a page that held
 * a number of its own instead of the answer's would say these readings fresh too long.
 */
import { flushPromises } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Quota, QuotaShareWindow } from '@/shared/api/analyticsApi.ts'

import { momentAt, serveUsage } from '../fixtures/analytics.ts'
import { quotaAnswer, quotaAt } from '../fixtures/quota.ts'
import { mountAnalytics, stubAnalyticsReads } from '../support/analyticsReads.ts'
import { accountNamed, says, windowOf } from '../support/quotaPanel.ts'

const NOW = new Date(2026, 10, 11, 14, 30)
const SECOND = 1000
const MINUTE = 60 * SECOND
/** The answer's threshold: a reading at most ten minutes old is fresh. */
const FRESH_FOR_SECONDS = 600

const usage = (query: URLSearchParams) => serveUsage([], query)

/** «Work» and the unnamed account as of `NOW`, every window as the answer judged it then. */
function answered(change = (accounts: Quota['accounts']) => accounts) {
  const quota = quotaAt(NOW)
  return quotaAnswer({
    ...quota,
    fresh_for_seconds: FRESH_FOR_SECONDS,
    accounts: change(quota.accounts.slice(0, 2)),
  })
}

/** Moves the page's clock on by `ms` and lets what it ticked settle. */
async function wait(ms: number) {
  vi.advanceTimersByTime(ms)
  await flushPromises()
}

const workWeek = (page: VueWrapper) => windowOf(accountNamed(page, 'Work'), 'week')

beforeEach(() => {
  // The page's clock ticks on an interval (`useQuota`); its reads are left to run as they do.
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'], now: NOW })
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

describe('a quota window’s state by the panel’s clock', () => {
  it('turns a reading that was fresh silent once it is older than the answer’s threshold', async () => {
    const answer = answered()
    stubAnalyticsReads(usage, () => answer)
    const page = await mountAnalytics({ routeState: { by: 'quota_week' } })
    // «Work»'s week was read two minutes before the answer, which judged it fresh and stays so.
    const week = answer.quota.accounts[0]?.windows[1]
    expect(week).toMatchObject({ kind: 'week', state: 'fresh' })
    expect(workWeek(page)).toMatchObject({
      state: 'fresh',
      lead: '41% used · up to date',
      latest: 'Read 2 min ago from the poll',
    })

    // Ten minutes old is still fresh: the threshold is the last fresh moment.
    await wait(8 * MINUTE)
    expect(workWeek(page)).toMatchObject({ state: 'fresh', lead: '41% used · up to date' })

    // At the next tick of the clock it is older, and every word of the window says it is silent.
    await wait(5 * SECOND)
    const silent = workWeek(page)
    expect(silent).toMatchObject({ state: 'silent', lead: '41% used · no data for 10 min' })
    expect(silent.latest).toMatch(/^No change since \d{2}:\d{2}, 10 min ago, from the poll$/u)
    expect(silent.label).toMatch(
      /^Week: 41% used, steady use since the window started would be at \d+% now, no data for 10 min\. /u,
    )
  })

  it('names on the tile the fresh window of two at the same share, by the clock', async () => {
    // Both five hours at 62 % and lasting to their reset, so neither runs out first nor ends
    // higher: «Work»'s read two minutes before the answer, the other's one.
    const offset = -NOW.getTimezoneOffset()
    stubAnalyticsReads(usage, () =>
      answered(([work, night]) => {
        if (!work || !night) throw new Error('the four accounts start with «Work»')
        const [five, ...windows] = night.windows as [QuotaShareWindow, ...QuotaShareWindow[]]
        const [workFive, ...workWindows] = work.windows as [QuotaShareWindow, ...QuotaShareWindow[]]
        const at = momentAt(NOW.getTime() - MINUTE, offset)
        const latest = { ...five.latest, at, used_percent: 62 }
        const lasting = { ...workFive, forecast: five.forecast }
        return [
          { ...work, windows: [lasting, ...workWindows] },
          { ...night, windows: [{ ...five, latest, readings: [latest] }, ...windows] },
        ]
      }),
    )
    const page = await mountAnalytics()
    // Both fresh, the first in the answer's order.
    expect(says(page, 'quota_five_hour')).toEqual({
      lead: 'Work',
      aside: '62%',
      count: 'up to date',
    })

    // «Work»'s reading is past ten minutes and the other's is not: the fresh one is the tightest.
    await wait(8 * MINUTE + 5 * SECOND)
    expect(says(page, 'quota_five_hour')).toEqual({
      lead: '7e6d5c4b',
      aside: '62%',
      count: 'up to date',
    })

    // A minute on both are silent, and the first in the answer's order is again the tightest.
    await wait(MINUTE)
    expect(says(page, 'quota_five_hour')).toEqual({
      lead: 'Work',
      aside: '62%',
      count: 'no data for 11\u{A0}min',
    })
  })
})
