/**
 * The quota panel's times on the Analytics page, against stand-ins for its usage and quota reads.
 * The panel's times are said at the answer's own offset and dated against the answer's day. The
 * read gives its `now` in UTC and its offset beside it (`utc_offset`), so these answers go through
 * the page's own read, and each moment the read writes is at +03:00. The process's own zone takes
 * no part: every clock below is the answer's.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { QuotaShareWindow } from '@/shared/api/analyticsApi.ts'

import { serveUsage, task, value } from '../fixtures/analytics.ts'
import type { TimedStretch } from '../fixtures/analytics.ts'
import { quotaAnswer, quotaAt } from '../fixtures/quota.ts'
import { mountAnalytics, stubAnalyticsReads } from '../support/analyticsReads.ts'
import { accountNamed, plain, showTable, windowOf } from '../support/quotaPanel.ts'

/** Wednesday afternoon, the moment the page's reads are asked at before each test sets its own. */
const NOW = new Date(2026, 10, 11, 14, 30)

const WORLD: TimedStretch[] = [
  {
    at: new Date(2026, 10, 10, 10),
    group: { work_item: task(1, 'One'), model: value('model-a') },
    spend: { seconds: 3600, tokens: 1000, cost: 1 },
  },
]

const usage = (query: URLSearchParams) => serveUsage(WORLD, query)

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: NOW })
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

describe('the quota panel’s times', () => {
  const OFFSET = 180

  /** «Work» of the four accounts as of `at`, with these windows alone. */
  const workWith = (at: Date, windows: QuotaShareWindow[]) => () => {
    const quota = quotaAt(at, OFFSET)
    const [work] = quota.accounts
    if (!work) throw new Error('the four accounts start with «Work»')
    return quotaAnswer({ ...quota, accounts: [{ ...work, windows }] })
  }

  it('say a week’s run-out at the answer’s clock and with its date past the answer’s midnight', async () => {
    // 21:46 on 14 November at +03:00, 18:46 in UTC.
    const at = new Date('2026-11-14T18:46:00Z')
    vi.setSystemTime(at)
    const latest = { at: '2026-11-14T21:44:00+03:00', used_percent: 70, source: 'poll' } as const
    // The slower pace runs from 70 % now to 120 % at the reset five hours on, so it reaches 100 %
    // (100 − 70) / (120 − 70) = 0.6 of the way: three hours on, 00:46 of 15 November at +03:00,
    // which a week says by its day and the part of the day, the night before the 15th.
    const week: QuotaShareWindow = {
      kind: 'week',
      model: null,
      state: 'fresh',
      resets_at: '2026-11-15T02:46:00+03:00',
      latest,
      started_at: '2026-11-08T02:46:00+03:00',
      even_percent: 97.02,
      readings: [latest],
      restarts: [],
      forecast: { low_percent: 120, high_percent: 140 },
    }
    stubAnalyticsReads(usage, workWith(at, [week]))
    const page = await mountAnalytics({ routeState: { by: 'quota_week' } })
    const said = windowOf(accountNamed(page, 'Work'), 'week')
    expect(said.forecast).toBe(
      'Forecast · Limit runs out before the reset, by the night before Nov 15',
    )
    // The reset falls after the answer's midnight, so it carries its date.
    expect(said.reset).toBe('Resets Nov 15, 02:46, in 5 h')
  })

  it('say a time of the answer’s day with no date and the day before with it, past its midnight', async () => {
    // 00:40 on 15 November at +03:00, still 14 November in UTC.
    const at = new Date('2026-11-14T21:40:00Z')
    vi.setSystemTime(at)
    const latest = { at: '2026-11-14T23:10:00+03:00', used_percent: 40, source: 'poll' } as const
    const five: QuotaShareWindow = {
      kind: 'five_hour',
      model: null,
      state: 'silent',
      resets_at: '2026-11-15T02:30:00+03:00',
      latest,
      started_at: '2026-11-14T21:30:00+03:00',
      even_percent: 63.33,
      readings: [{ at: '2026-11-14T21:40:00+03:00', used_percent: 10, source: 'poll' }, latest],
      restarts: [],
      forecast: {
        outcome: 'runs_out',
        runs_out_at: '2026-11-15T01:50:00+03:00',
        at_reset_percent: null,
        basis: 'blend',
      },
    }
    stubAnalyticsReads(usage, workWith(at, [five]))
    const page = await mountAnalytics({ routeState: { by: 'quota_five_hour' } })
    const work = accountNamed(page, 'Work')
    const said = windowOf(work, 'five_hour')
    expect(said.reset).toBe('Resets 02:30, in 1 h 50 min')
    expect(said.forecast).toBe('Forecast · Limit runs out at 01:50')
    expect(said.latest).toMatch(/^No change since Nov 14, 23:10, /u)
    // The line opens on the window's start, the day before, to now and a third of that past it:
    // 21:30 to 00:40 is 3 h 10 min, so it runs on to 01:43.
    expect(work.findAll('.step-axis span').map((one) => plain(one.text()))).toEqual([
      'Nov 14, 21:30',
      '01:43',
    ])
  })

  it('say a window with no reset yet has no pace, in its bar’s hint and in a table’s words', async () => {
    const at = new Date('2026-11-14T18:46:00Z')
    vi.setSystemTime(at)
    const latest = { at: '2026-11-14T21:44:00+03:00', used_percent: 30, source: 'poll' } as const
    const week: QuotaShareWindow = {
      kind: 'week',
      model: null,
      state: 'fresh',
      resets_at: null,
      latest,
      started_at: null,
      even_percent: null,
      readings: [latest],
      restarts: [],
      forecast: null,
    }
    stubAnalyticsReads(usage, workWith(at, [week]))
    const page = await mountAnalytics({ routeState: { by: 'quota_week' } })
    const said = windowOf(accountNamed(page, 'Work'), 'week')
    expect(said).toMatchObject({
      lead: '30% used · up to date',
      even: 'No pace: reset time unknown',
      latest: 'Read 2 min ago from the poll',
      facts: ['forecast', 'reset'],
      reset: 'Reset time unknown',
    })
    expect(said.label).toBe(
      'Week: 30% used, up to date. Too few readings for a forecast. Read 2 min ago from the poll',
    )

    // As a table no hint shows, so the window says its pace and its latest reading in words; its
    // forecast is a column of its account's table.
    await showTable(page)
    const window = accountNamed(page, 'Work').get('.quota-window[data-window="week"]')
    expect(window.find('.quota-window-lead').exists()).toBe(false)
    expect(
      window.findAll('[data-fact]').map((one) => [one.attributes('data-fact'), plain(one.text())]),
    ).toEqual([
      ['reset', 'Reset time unknown'],
      ['even', 'No pace: reset time unknown'],
      ['latest', 'Read 2 min ago from the poll'],
    ])
    expect(plain(accountNamed(page, 'Work').get('[data-cell="forecast"]').text())).toBe(
      'Too few readings for a forecast',
    )
  })
})
