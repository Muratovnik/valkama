/**
 * The subscription quota on the Analytics page, against stand-ins for its usage and quota reads.
 * The oracle is the requirement: two tiles, «Five hours» and «Week», stand after the token kinds
 * and before the dimensions; each names the tightest account's window — of those still standing,
 * the one whose forecast runs out first, else ends highest, never simply the first or the most
 * spent — with its share and, where it runs out before its reset, when, else its state in words.
 * Choosing one
 * opens its panel as a new place in the address. The panel has a row per account, by the name the
 * page gives an account, and for each window its bar, its share, its reset, its forecast — a
 * point for the five hours, a range for a week — and how old its reading is and who read it. No
 * source, a silent window and a fresh 0 % each read in words of their own, on the tile and in the
 * panel, and nothing adds two shares or puts money beside one. A silent window's share is drawn as
 * solid as a fresh one's and says how long it has been silent; the forecast is the bar's hatched
 * tail, which the words name «Forecast ·» on the tile and in the panel, and the readings' table
 * ends with it.
 *
 * The figures come from `quotaAt`: the tightest five hours is the fourth account's 74 %, which runs
 * out first, the tightest week the second account's 88 %, whose forecast ends highest, and the
 * first account is neither.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { messages } from '@/shared/i18n/index.ts'

import { serveUsage, task, value } from '../fixtures/analytics.ts'
import type { TimedStretch } from '../fixtures/analytics.ts'
import {
  NIGHT,
  NIGHT_NAME,
  quotaAnswer,
  quotaAt,
  SEATED_NAME,
  UNREAD,
  UNREAD_NAME,
} from '../fixtures/quota.ts'
import { mountAnalytics, stubAnalyticsReads } from '../support/analyticsReads.ts'
import {
  accountNamed,
  accounts,
  headings,
  plain,
  radioNamed,
  says,
  showTable,
  tile,
  windowOf,
} from '../support/quotaPanel.ts'

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
      'seat',
    ])
    expect(reads.quotaAsked).toHaveLength(1)
    expect(reads.quotaAsked[0]?.get('utc_offset')).toBe(String(-NOW.getTimezoneOffset()))
  })

  it('name the tightest account’s window with its share and its run-out or state in words, never the first account', async () => {
    stubAnalyticsReads(usage, quotaOf([0, 1, 2, 3]))
    const page = await mountAnalytics()
    // The five hours run out forty minutes on, so the tile says when in place of its state.
    expect(says(page, 'quota_five_hour')).toEqual({
      lead: SEATED_NAME,
      aside: '74%',
      count: 'runs out at 15:10',
    })
    expect(says(page, 'quota_week')).toEqual({
      lead: NIGHT_NAME,
      aside: '88%',
      count: 'no data for 3\u{A0}h',
    })
    // Silent or fresh, the share spent is solid; each forecast is one hatched tail past it, the
    // week's range to its high end, and the bar's words name the hatch.
    expect(tile(page, 'quota_week').get('.window-fill').classes()).toEqual(['window-fill'])
    expect(tile(page, 'quota_week').findAll('.window-ahead')).toHaveLength(1)
    expect(tile(page, 'quota_five_hour').findAll('.window-ahead')).toHaveLength(1)
    expect(tile(page, 'quota_five_hour').get('.window-track').attributes('aria-label')).toBe(
      'Five hours: 74% used, steady use since the window started would be at 70% now, up to date. Forecast · Limit runs out at 15:10',
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
    expect(says(zero, 'quota_five_hour')).toEqual({
      lead: NIGHT_NAME,
      aside: '0%',
      count: 'up to date',
    })
    expect(zero.find('[data-section="quota_five_hour"] .window-fill').exists()).toBe(false)
    expect(says(zero, 'quota_week').lead).toBe('No reading')
    zero.unmount()

    // Read five hours ago: every five hours has reset since, every week still stands.
    stubAnalyticsReads(usage, () => quotaAnswer(quotaAt(NOW.getTime() - 5 * HOUR)))
    const reset = await mountAnalytics()
    expect(says(reset, 'quota_five_hour').lead).toBe('Reset since read')
    expect(says(reset, 'quota_week').lead).toBe(NIGHT_NAME)
  })

  it('say that the quota could not be read, while the other tiles show their figures', async () => {
    stubAnalyticsReads(usage, () => ({ status: 503 }))
    const page = await mountAnalytics()
    expect(says(page, 'quota_week').lead).toBe('Could not be loaded')
    expect(tile(page, 'overview').get('.rail-tile-lead').text()).not.toBe('Could not be loaded')
  })

  it('open their panel as a new place in the address, which the address gives back', async () => {
    stubAnalyticsReads(usage, quotaOf([0, 1, 2, 3]))
    const page = await mountAnalytics()
    await tile(page, 'quota_week').trigger('click')
    expect(page.emitted('state')?.at(-1)).toEqual([{ by: 'quota_week' }, 'push'])
    page.unmount()

    const opened = await mountAnalytics({ routeState: { by: 'quota_week' } })
    expect(opened.get('[aria-current="page"]').attributes('data-section')).toBe('quota_week')
    // The panel's heading, the one of its level under the page's, names the section opened.
    expect(headings(opened, 2)).toEqual(['Week'])
  })
})

describe('the quota panel', () => {
  it('offers «Name» at an account with no name of its own, which opens the field that renames it', async () => {
    stubAnalyticsReads(usage, quotaOf([0, 1]))
    const page = await mountAnalytics({ routeState: { by: 'quota_week' } })
    const nameIt = (account: ReturnType<typeof accountNamed>) =>
      account.find('[data-account-head="name-it"]')
    // «Work» has a name of its own, so only the menu renames it.
    expect(nameIt(accountNamed(page, 'Work')).exists()).toBe(false)
    const night = accountNamed(page, NIGHT_NAME)
    expect(nameIt(night).text()).toBe('Name')
    expect(nameIt(night).attributes('aria-label')).toBe(`Name account ${NIGHT_NAME}`)
    expect(night.find('[data-account-head="field"]').exists()).toBe(false)
    await nameIt(night).trigger('click')
    const field = night.get('[data-account-head="field"] input')
    expect(field.attributes('aria-label')).toBe('Account name')
    expect((field.element as HTMLInputElement).value).toBe('')
    // While the field stands in the name's place, «Name» has nothing more to open.
    expect(nameIt(night).exists()).toBe(false)
  })

  it('has a row per account by its name or what tells it apart, with its windows of the section', async () => {
    stubAnalyticsReads(usage, quotaOf([0, 1, 2, 3]))
    const page = await mountAnalytics({ routeState: { by: 'quota_week' } })
    expect(accounts(page).map((one) => one.get('.quota-account-name').text())).toEqual([
      'Work',
      NIGHT_NAME,
      UNREAD_NAME,
      SEATED_NAME,
    ])
    const work = accountNamed(page, 'Work')
    expect(work.findAll('.quota-window').map((one) => one.get('h4').text())).toEqual([
      'Week',
      'Week, model-a',
    ])
    expect(work.text()).toContain('Plan: Max')
    // No hint says the whole id: the account's menu, named for it, copies it.
    expect(work.get('.quota-account-name').attributes('data-tooltip')).toBeUndefined()
    expect(work.html()).not.toContain('0b7d4e19-1c2d-4e3f-8a4b-5c6d7e8f9a0b')
    expect(work.get('[data-account-head="menu"] .menu-trigger').attributes('aria-label')).toBe(
      'Account actions: Work',
    )
    expect(accountNamed(page, SEATED_NAME).text()).toContain(
      'May be two accounts: their readings run under one weekly reset',
    )
    // The usage credits are a line of their name and state, never a figure, and how old their
    // reading is and who read it is the line's hint, as a window of a share keeps it in its bar's.
    const credits = work.get('.quota-account-others li span')
    expect(plain(credits.text())).toBe('Usage credits: no data')
    expect(plain(credits.attributes('data-tooltip') ?? '')).toMatch(
      /^No change since .+, 2 d ago, from the poll$/u,
    )
    page.unmount()

    // As a table, where no hint shows, the line says it all in words.
    stubAnalyticsReads(usage, quotaOf([0, 1, 2, 3]))
    const table = await mountAnalytics({ routeState: { by: 'quota_week' } })
    await showTable(table)
    expect(plain(accountNamed(table, 'Work').get('.quota-account-others').text())).toBe(
      'Usage credits: no data, read 2 d ago from the poll',
    )
  })

  it('says a silent window, a fresh one and a fresh 0 % apart, with each reading’s age and source', async () => {
    stubAnalyticsReads(usage, quotaOf([0, 1, 2, 3]))
    const week = await mountAnalytics({ routeState: { by: 'quota_week' } })
    const fresh = windowOf(accountNamed(week, 'Work'), 'week')
    expect(fresh).toMatchObject({
      state: 'fresh',
      lead: '41% used · up to date',
      tail: 1,
      // The forecast, then the reset: the pace and the reading's age are the bar's hint.
      facts: ['forecast', 'reset'],
      even: 'Pace tick · steady use since the window started would be at 57% now',
      more: [],
    })
    expect(fresh.latest).toBe('Read 2 min ago from the poll')
    expect(fresh.label).toBe(
      'Week: 41% used, steady use since the window started would be at 57% now, up to date. Forecast · By the reset: 57% to 61%. Read 2 min ago from the poll',
    )
    const silent = windowOf(accountNamed(week, 'Work'), 'week_model')
    expect(silent).toMatchObject({
      state: 'silent',
      lead: '13% used · no data for 5 h',
      filled: true,
      tail: 0,
    })
    expect(silent.latest).toMatch(/^No change since \d{2}:\d{2}, 5 h ago, from the poll$/u)
    // A week forecasts a range, said as one after «Forecast ·»; one too new for a
    // forecast says so, quieter, and draws no tail.
    expect(fresh.forecast).toBe('Forecast · By the reset: 57% to 61%')
    expect(fresh.reset).toMatch(/^Resets .+, in 3 d$/u)
    expect(silent.forecast).toBe('Too few readings for a forecast')
    const quiet = (window: string, key: string) =>
      accountNamed(week, 'Work')
        .get(`.quota-window[data-window="${window}"] [data-fact="${key}"]`)
        .classes('quota-window-quiet')
    expect([quiet('week', 'forecast'), quiet('week', 'reset')]).toEqual([false, true])
    expect(quiet('week_model', 'forecast')).toBe(true)
    week.unmount()

    stubAnalyticsReads(usage, quotaOf([0, 1, 2, 3]))
    const five = await mountAnalytics({ routeState: { by: 'quota_five_hour' } })
    const zero = windowOf(accountNamed(five, NIGHT_NAME), 'five_hour')
    // Lasting to the reset at 35 %: a tail from the track's start.
    expect(zero).toMatchObject({ lead: '0% used · up to date', filled: false, tail: 1 })
    expect(zero.latest).toBe('Read 3 min ago from the status line')
    // The five hours forecast a point: it lasts with the share spent by the reset, or runs out at
    // a time, drawn to the track's end.
    expect(zero.forecast).toBe('Forecast · By the reset: 35%')
    expect(windowOf(accountNamed(five, 'Work'), 'five_hour')).toMatchObject({
      forecast: expect.stringMatching(/^Forecast · Limit runs out at \d{2}:\d{2}$/u),
      tail: 1,
    })
    expect(windowOf(accountNamed(five, 'Work'), 'five_hour').reset).toMatch(
      /^Resets \d{2}:\d{2}, in 2 h/u,
    )
    // An organization no source read says so, and a week alone says it has no five hours.
    expect(accountNamed(five, UNREAD_NAME).get('[data-state="no-source"]').text()).toBe(
      'No quota data in the past 7 days.',
    )
    // No money stands beside a share, and no share is a total: what used a window is a block of
    // its own under the readings (`analyticsQuotaSpent.spec.ts`). Each account's head is its name
    // and its menu, «Name» after the menu where it has no name of its own — every account but
    // «Work» — and its facts beside them where it has a plan or may be two accounts: «Work» and
    // the account known by its weekly reset.
    const heads = five.findAll('[data-account-head]')
    expect(heads.map((one) => one.attributes('data-account-head')).join(' ')).toBe(
      'name menu facts name menu name-it name menu name-it name menu name-it facts',
    )
    // Each of the three windows of five hours has its bar, its facts and its line; «Work» alone
    // has a window of money, its credits.
    const parts = accounts(five).flatMap((account) =>
      account.findAll('.window-bar, .quota-window-facts, .step-line, .quota-account-others'),
    )
    expect(parts).toHaveLength(3 * 3 + 1)
    const shares = [...heads, ...parts]
    for (const part of shares) expect(part.text()).not.toMatch(/\$|total/iu)
  })

  it('draws each window’s readings as steps, and as a table of when, how much and who read it', async () => {
    stubAnalyticsReads(usage, quotaOf([0]))
    const page = await mountAnalytics({ routeState: { by: 'quota_five_hour' } })
    const work = accountNamed(page, 'Work')
    expect(work.get('.step-line').attributes('aria-label')).toMatch(
      /^Five hours of Work from .+ to .+: 10% at .+, 35% at .+, 62% at .+\. Forecast · Limit runs out at \d{2}:\d{2}$/u,
    )
    // The running window opens on its start to now and a third of that past it, said on the
    // reader's clock: 11:30 to 14:30, and an hour of forecast to 15:30.
    expect(work.findAll('.step-axis span').map((one) => one.text())).toEqual(['11:30', '15:30'])
    // The whole window runs to its reset, two hours after 14:30.
    await radioNamed(work, messages.en.analytics.quota.readings.whole).trigger('click')
    expect(work.findAll('.step-axis span').map((one) => one.text())).toEqual(['11:30', '16:30'])
    // The panel's own switch, not a line's span, turns the readings into a table.
    await showTable(page)
    const readings = accountNamed(page, 'Work')
    expect(readings.find('.step-line').exists()).toBe(false)
    // Its three readings, and the forecast after them.
    const rows = readings.findAll('.quota-window-readings tbody tr').map((row) => plain(row.text()))
    expect(rows).toHaveLength(4)
    expect(rows[0]).toContain('the poll')
    expect(rows[3]).toMatch(/^Forecast by the reset100%Limit runs out at \d{2}:\d{2}; Resets /u)
  })

  it('says a window reset since it was read where its forecast stood, and draws nothing ahead', async () => {
    // Read five hours ago: the five hours ran out at a time since past, and reset since.
    stubAnalyticsReads(usage, () => quotaAnswer(quotaAt(NOW.getTime() - 5 * HOUR)))
    const page = await mountAnalytics({ routeState: { by: 'quota_five_hour' } })
    const reset = expect.stringMatching(/Window reset at \d{2}:\d{2}, no new readings$/u)
    const window = accountNamed(page, 'Work').get('.quota-window[data-window="five_hour"]')
    // It leads with the reset, its share before it a quieter line, and says no fact under its bar
    // (DESIGN.md § Analytics): led by its 62 %, it read as the share spent now.
    expect(window.findAll('[data-lead]').map((one) => plain(one.text()))).toEqual([
      expect.stringMatching(/^Reset at \d{2}:\d{2}, no new readings$/u),
      'before the reset: 62%',
    ])
    expect(window.findAll('[data-fact]')).toHaveLength(0)
    expect(window.findAll('.window-ahead')).toHaveLength(0)
    // The bar's words say the reset and the share before it; its reading, read two minutes before
    // an answer five hours ago, is old by the page's clock.
    expect(plain(window.get('.window-track').attributes('aria-label') ?? '')).toMatch(
      /^Five hours: reset at \d{2}:\d{2}, no new readings; 62% used before the reset\. No change since .+, 5 h 2 min ago, /u,
    )
    expect(window.get('.step-line').attributes('aria-label')).toEqual(reset)
    // As a table, the account's table says the reset in the forecast's column.
    await showTable(page)
    expect(plain(accountNamed(page, 'Work').get('[data-cell="forecast"]').text())).toEqual(reset)
  })

  it('says the quota could not be read, and that an organization with no source has nothing more', async () => {
    stubAnalyticsReads(usage, () => ({ status: 503 }))
    const page = await mountAnalytics({ routeState: { by: 'quota_five_hour' } })
    expect(page.text()).toContain('The quota could not be loaded.')
    page.unmount()

    stubAnalyticsReads(usage, quotaOf([2]))
    const unread = await mountAnalytics({ routeState: { by: 'quota_week' } })
    const only = accountNamed(unread, `${UNREAD.organization.slice(0, 8)} · account not known`)
    expect(only.find('.quota-window').exists()).toBe(false)
    expect(only.find('[data-state="no-source"]').exists()).toBe(true)
    expect(NIGHT.account_uuid.startsWith('7e6d5c4b')).toBe(true)
  })
})
