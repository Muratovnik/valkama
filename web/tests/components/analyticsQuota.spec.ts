/**
 * The subscription quota on the Analytics page, against stand-ins for its usage and quota reads.
 * The oracle is the requirement: two tiles, «Five hours» and «Week», stand after the token kinds
 * and before the dimensions; each names the tightest account's window — the most spent of those
 * still standing, never simply the first — with its share and its state in words. Choosing one
 * opens its panel as a new place in the address. The panel has a row per account, by its name or
 * else the start of its id, and for each window its bar, its share, its reset, its forecast — a
 * point for the five hours, a range for a week — and how old its reading is and who read it. No
 * source, a silent window and a fresh 0 % each read in words of their own, on the tile and in the
 * panel, and nothing adds two shares or puts money beside one.
 *
 * The figures come from `quotaAt`: the tightest five hours is the fourth account's 74 %, the
 * tightest week the second account's 88 %, and the first account is neither.
 */
import { flushPromises } from '@vue/test-utils'
import type { DOMWrapper, VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { QuotaShareWindow } from '@/shared/api/analyticsApi.ts'

import { serveUsage, task, value } from '../fixtures/analytics.ts'
import type { TimedStretch } from '../fixtures/analytics.ts'
import { NIGHT, quotaAnswer, quotaAt, UNREAD } from '../fixtures/quota.ts'
import { mountAnalytics, stubAnalyticsReads } from '../support/analyticsReads.ts'

/** Wednesday afternoon, the moment the page's reads are asked at. */
const NOW = new Date(2026, 10, 11, 14, 30)
const HOUR = 3_600_000

const WORLD: TimedStretch[] = [
  {
    at: new Date(2026, 10, 10, 10),
    group: { work_item: task(1, 'One'), model: value('model-a') },
    spend: { seconds: 3600, tokens: 1000, cost: 1 },
  },
]

const usage = (query: URLSearchParams) => serveUsage(WORLD, query)
const quotaOf = (accounts: number[]) => () => {
  const quota = quotaAt(NOW)
  return quotaAnswer({
    ...quota,
    accounts: quota.accounts.filter((_, index) => accounts.includes(index)),
  })
}

const tile = (page: VueWrapper, section: string) => page.get(`[data-section="${section}"]`)
/** What a tile says: its lead, its share and the state beside its name. */
const textIn = (page: VueWrapper, section: string, part: string) =>
  tile(page, section)
    .findAll(part)
    .map((one) => one.text())
    .join('')
const says = (page: VueWrapper, section: string) => ({
  lead: textIn(page, section, '.rail-tile-lead'),
  aside: textIn(page, section, '.rail-tile-aside'),
  count: textIn(page, section, '.analytics-rail-count'),
})
const accounts = (page: VueWrapper) => page.findAll('.quota-account')
const accountNamed = (page: VueWrapper, name: string) => {
  const found = accounts(page).find((one) => one.get('.quota-account-name').text() === name)
  if (!found) throw new Error(`no account ${name}`)
  return found
}
/** Words as a reader reads them: the app keeps a figure and its unit together with a no-break space. */
const plain = (text: string) => text.replaceAll(' ', ' ')
/** What a window of the panel says: its state, its bar's words and its facts. */
function windowOf(account: DOMWrapper<Element>, kind: string) {
  const window = account.get(`.quota-window[data-window="${kind}"]`)
  const fact = (key: string) => plain(window.get(`[data-fact="${key}"]`).text())
  return {
    state: window.attributes('data-state'),
    value: window.get('.window-value').text(),
    note: window.get('.window-note').text(),
    filled: window.find('.window-fill').exists(),
    hatched: window.find('.window-held').exists(),
    reset: fact('reset'),
    forecast: fact('forecast'),
    latest: fact('latest'),
  }
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: NOW })
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

describe('the quota tiles', () => {
  it('stand after the token kinds and before the dimensions, and read the quota at the reader’s offset', async () => {
    const reads = stubAnalyticsReads(usage, quotaOf([0, 1, 2, 3]))
    const page = await mountAnalytics()
    const sections = page
      .findAll('.analytics-rail-entry')
      .map((one) => one.attributes('data-section'))
    expect(sections.slice(0, 5)).toEqual([
      'overview',
      'token_kind',
      'quota_five_hour',
      'quota_week',
      'account',
    ])
    expect(reads.quotaAsked).toHaveLength(1)
    expect(reads.quotaAsked[0]?.get('utc_offset')).toBe(String(-NOW.getTimezoneOffset()))
  })

  it('name the tightest account’s window with its share and its state in words, never the first account', async () => {
    stubAnalyticsReads(usage, quotaOf([0, 1, 2, 3]))
    const page = await mountAnalytics()
    expect(says(page, 'quota_five_hour')).toEqual({
      lead: 'a1b2c3d4',
      aside: '74%',
      count: 'fresh',
    })
    expect(says(page, 'quota_week')).toEqual({ lead: '7e6d5c4b', aside: '88%', count: 'silent' })
    // The week's bar is hatched, being silent; the five hours' is not.
    expect(tile(page, 'quota_week').find('.window-held').exists()).toBe(true)
    expect(tile(page, 'quota_five_hour').find('.window-held').exists()).toBe(false)
    expect(tile(page, 'quota_five_hour').get('.window-track').attributes('aria-label')).toBe(
      'Five hours: 74% used, steady use 70%, fresh',
    )
  })

  it('say no source, a fresh 0 % and a window reset since it was read each in words of their own', async () => {
    stubAnalyticsReads(usage, quotaOf([2]))
    const unread = await mountAnalytics()
    expect(says(unread, 'quota_five_hour')).toEqual({ lead: 'No source', aside: '', count: '' })
    expect(says(unread, 'quota_week')).toEqual({ lead: 'No source', aside: '', count: '' })
    expect(unread.find('[data-section="quota_week"] .window-track').exists()).toBe(false)
    unread.unmount()

    stubAnalyticsReads(usage, () => {
      const quota = quotaAt(NOW)
      const night = quota.accounts
        .slice(1, 2)
        .map((account) => ({ ...account, windows: account.windows.slice(0, 1) }))
      return quotaAnswer({ ...quota, accounts: night })
    })
    const zero = await mountAnalytics()
    expect(says(zero, 'quota_five_hour')).toEqual({ lead: '7e6d5c4b', aside: '0%', count: 'fresh' })
    expect(zero.find('[data-section="quota_five_hour"] .window-fill').exists()).toBe(false)
    expect(says(zero, 'quota_week').lead).toBe('No reading')
    zero.unmount()

    // Read five hours ago: every five hours has reset since, every week still stands.
    stubAnalyticsReads(usage, () => quotaAnswer(quotaAt(NOW.getTime() - 5 * HOUR)))
    const reset = await mountAnalytics()
    expect(says(reset, 'quota_five_hour').lead).toBe('Reset since read')
    expect(says(reset, 'quota_week').lead).toBe('7e6d5c4b')
  })

  it('say that the quota could not be read, while the other tiles show their figures', async () => {
    stubAnalyticsReads(usage, () => ({ status: 503 }))
    const page = await mountAnalytics()
    expect(says(page, 'quota_week').lead).toBe('Could not be read')
    expect(tile(page, 'overview').get('.rail-tile-lead').text()).not.toBe('Could not be read')
  })

  it('open their panel as a new place in the address, which the address gives back', async () => {
    stubAnalyticsReads(usage, quotaOf([0, 1, 2, 3]))
    const page = await mountAnalytics()
    await tile(page, 'quota_week').trigger('click')
    expect(page.emitted('state')?.at(-1)).toEqual([{ by: 'quota_week' }, 'push'])
    page.unmount()

    const opened = await mountAnalytics({ routeState: { by: 'quota_week' } })
    expect(opened.get('[aria-current="page"]').attributes('data-section')).toBe('quota_week')
    expect(opened.get('.quota-panel h2').text()).toBe('Week')
  })
})

describe('the quota panel', () => {
  it('has a row per account by its name or the start of its id, with its windows of the section', async () => {
    stubAnalyticsReads(usage, quotaOf([0, 1, 2, 3]))
    const page = await mountAnalytics({ routeState: { by: 'quota_week' } })
    expect(accounts(page).map((one) => one.get('.quota-account-name').text())).toEqual([
      'Work',
      '7e6d5c4b',
      '9f8e7d6c',
      'a1b2c3d4',
    ])
    const work = accountNamed(page, 'Work')
    expect(work.findAll('.quota-window').map((one) => one.get('h4').text())).toEqual([
      'Week',
      'Week, model-a',
    ])
    expect(work.text()).toContain('Plan: Max')
    // The whole ids are the name's hint.
    expect(work.get('.quota-account-name span').attributes('data-tooltip')).toContain(
      `Account ${'0b7d4e19-1c2d-4e3f-8a4b-5c6d7e8f9a0b'} of organization`,
    )
    expect(accountNamed(page, 'a1b2c3d4').text()).toContain('Known by its seat for this week only')
    // The usage credits are a line of their state, never a figure.
    expect(plain(work.get('.quota-account-others').text())).toBe(
      'Usage credits: silent, read 2 d ago from the poll',
    )
  })

  it('says a silent window, a fresh one and a fresh 0 % apart, with each reading’s age and source', async () => {
    stubAnalyticsReads(usage, quotaOf([0, 1, 2, 3]))
    const week = await mountAnalytics({ routeState: { by: 'quota_week' } })
    const fresh = windowOf(accountNamed(week, 'Work'), 'week')
    expect(fresh).toMatchObject({
      state: 'fresh',
      value: '41% used',
      note: 'fresh',
      hatched: false,
    })
    expect(fresh.latest).toBe('Read 2 min ago from the poll')
    const silent = windowOf(accountNamed(week, 'Work'), 'week_model')
    expect(silent).toMatchObject({
      state: 'silent',
      value: '13% used',
      note: 'silent',
      hatched: true,
    })
    expect(silent.latest).toMatch(/^No change since \d{2}:\d{2}, 5 h ago, from the poll$/u)
    // A week forecasts a range, said as one.
    expect(fresh.forecast).toBe('By the reset: 57% to 61%')
    expect(fresh.reset).toMatch(/^Resets .+, in 3 d$/u)
    week.unmount()

    stubAnalyticsReads(usage, quotaOf([0, 1, 2, 3]))
    const five = await mountAnalytics({ routeState: { by: 'quota_five_hour' } })
    const zero = windowOf(accountNamed(five, '7e6d5c4b'), 'five_hour')
    expect(zero).toMatchObject({ value: '0% used', note: 'fresh', filled: false, hatched: false })
    expect(zero.latest).toBe('Read 3 min ago from the status line')
    // The five hours forecast a point: it lasts, or runs out at a time.
    expect(zero.forecast).toBe('Lasts to the reset')
    expect(windowOf(accountNamed(five, 'Work'), 'five_hour').forecast).toMatch(
      /^Runs out at \d{2}:\d{2}$/u,
    )
    expect(windowOf(accountNamed(five, 'Work'), 'five_hour').reset).toMatch(
      /^Resets \d{2}:\d{2}, in 2 h/u,
    )
    // An organization no source read says so, and a week alone says it has no five hours.
    expect(accountNamed(five, '9f8e7d6c').get('[data-state="no-source"]').text()).toBe(
      'No quota source has read this account’s work in the past seven days.',
    )
    // No money stands beside a share, and no share is a total: what used a window is a block of
    // its own under the readings (`analyticsQuotaSpent.spec.ts`).
    const shares = five.findAll(
      '.quota-account-head, .window-bar, .quota-window-facts, .step-line, .quota-account-others',
    )
    expect(shares.length).toBeGreaterThan(0)
    for (const part of shares) expect(part.text()).not.toMatch(/\$|total/iu)
  })

  it('draws each window’s readings as steps, and as a table of when, how much and who read it', async () => {
    stubAnalyticsReads(usage, quotaOf([0]))
    const page = await mountAnalytics({ routeState: { by: 'quota_five_hour' } })
    const work = accountNamed(page, 'Work')
    expect(work.get('.step-line').attributes('aria-label')).toMatch(
      /^Five hours of Work from .+ to .+: 10% at .+, 35% at .+, 62% at .+$/u,
    )
    // The running window opens on its start to now and a third of that past it, said on the
    // reader's clock: 11:30 to 14:30, and an hour of forecast to 15:30.
    expect(work.findAll('.step-axis span').map((one) => one.text())).toEqual(['11:30', '15:30'])
    // The whole window runs to its reset, two hours after 14:30.
    await work.findAll('.step-views [role="radio"]')[1]?.trigger('click')
    expect(work.findAll('.step-axis span').map((one) => one.text())).toEqual(['11:30', '16:30'])
    // The panel's own switch, not a line's span, turns the readings into a table.
    const table = page
      .findAll('.quota-panel [role="radio"]:not([aria-checked="true"])')
      .find((one) => one.element.closest('.step-views') === null)
    await table?.trigger('click')
    await flushPromises()
    const readings = accountNamed(page, 'Work')
    expect(readings.find('.step-line').exists()).toBe(false)
    expect(
      readings.findAll('.quota-window-readings tbody tr').map((row) => row.text()),
    ).toHaveLength(3)
    expect(readings.get('.quota-window-readings tbody tr').text()).toContain('the poll')
  })

  it('says the quota could not be read, and that an organization with no source has nothing more', async () => {
    stubAnalyticsReads(usage, () => ({ status: 503 }))
    const page = await mountAnalytics({ routeState: { by: 'quota_five_hour' } })
    expect(page.text()).toContain('The quota could not be read.')
    page.unmount()

    stubAnalyticsReads(usage, quotaOf([2]))
    const unread = await mountAnalytics({ routeState: { by: 'quota_week' } })
    const only = accountNamed(unread, UNREAD.organization.slice(0, 8))
    expect(only.find('.quota-window').exists()).toBe(false)
    expect(only.find('[data-state="no-source"]').exists()).toBe(true)
    expect(NIGHT.account_uuid.startsWith('7e6d5c4b')).toBe(true)
  })
})

/**
 * The panel's times are said at the answer's own offset and dated against the answer's day. The
 * read gives its `now` in UTC and its offset beside it (`utc_offset`), so these answers go through
 * the page's own read, and each moment the read writes is at +03:00. The process's own zone takes
 * no part: every clock below is the answer's.
 */
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
    // (100 − 70) / (120 − 70) = 0.6 of the way: three hours on, 00:46 of 15 November at +03:00.
    const week: QuotaShareWindow = {
      kind: 'week',
      model: null,
      state: 'fresh',
      resets_at: '2026-11-15T02:46:00+03:00',
      latest,
      started_at: '2026-11-08T02:46:00+03:00',
      even_percent: 97.02,
      readings: [latest],
      forecast: { low_percent: 120, high_percent: 140 },
    }
    stubAnalyticsReads(usage, workWith(at, [week]))
    const page = await mountAnalytics({ routeState: { by: 'quota_week' } })
    const said = windowOf(accountNamed(page, 'Work'), 'week')
    expect(said.forecast).toBe('Runs out before the reset, by about Nov 15, 00:46')
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
      forecast: { outcome: 'runs_out', runs_out_at: '2026-11-15T01:50:00+03:00', basis: 'blend' },
    }
    stubAnalyticsReads(usage, workWith(at, [five]))
    const page = await mountAnalytics({ routeState: { by: 'quota_five_hour' } })
    const work = accountNamed(page, 'Work')
    const said = windowOf(work, 'five_hour')
    expect(said.reset).toBe('Resets 02:30, in 1 h 50 min')
    expect(said.forecast).toBe('Runs out at 01:50')
    expect(said.latest).toMatch(/^No change since Nov 14, 23:10, /u)
    // The line opens on the window's start, the day before, to now and a third of that past it:
    // 21:30 to 00:40 is 3 h 10 min, so it runs on to 01:43.
    expect(work.findAll('.step-axis span').map((one) => plain(one.text()))).toEqual([
      'Nov 14, 21:30',
      '01:43',
    ])
  })
})
