/**
 * What used each window of the quota panel, against stand-ins for the usage and quota reads. The
 * oracle is the requirement: under each window that has a start, the work Valkama recorded on that
 * account from the window's start to the answer's moment, ranked by its API price estimate with
 * each item's share of that estimate, by task first and by project or model on choice; the first
 * five items and one line for the rest; a heading that names the period it covers, and the
 * section's «ⓘ» that says once it is the API price estimate and not quota points, and that
 * claude.ai and the desktop app are not in it. Another
 * account's work is never in it, and its organization's work with no account known is said apart
 * and never counted to it. No work, only such work, a wait and a failed read each say so in words
 * of their own, and a failed read is retried in its block while the quota panel stands.
 *
 * The work is the fixture's (`quotaSpent.ts`): «Work» spent 13 dollars in its five hours, its
 * organization 2 more with no account known and another account of it 20 on MAIN-1; an account of
 * another organization 100 on MAIN-1, and the provisional seat's organization 4 with no account.
 */
import type { DOMWrapper, VueWrapper } from '@vue/test-utils'
import { flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { LOADING_DELAY_MS, LOADING_MIN_SHOWN_MS } from '@/shared/ui/loadingPresence.ts'

import { momentAt, serveUsage } from '../fixtures/analytics.ts'
import { quotaAnswer, quotaAt } from '../fixtures/quota.ts'
import {
  isSpendRead as isSpend,
  NIGHT,
  SPENT_NOW as NOW,
  SEATED,
  seatOf,
  WORK,
  SPENT_WORLD as WORLD,
} from '../fixtures/quotaSpent.ts'
import { mountAnalytics, stubAnalyticsReads } from '../support/analyticsReads.ts'

const WORK_SEAT = seatOf(WORK)
const NIGHT_SEAT = seatOf(NIGHT)
const quota = () => quotaAnswer(quotaAt(NOW))
const usage = (query: URLSearchParams) => serveUsage(WORLD, query)

/** Words as a reader reads them: the app keeps a figure and its unit together with a no-break space. */
const plain = (text: string) => text.replaceAll('\u{A0}', ' ')

function accountNamed(page: VueWrapper, name: string) {
  const found = page
    .findAll('.quota-account')
    .find((one) => one.get('.quota-account-name').text() === name)
  if (!found) throw new Error(`no account ${name}`)
  return found
}
const blockOf = (page: VueWrapper, name: string, kind = 'five_hour') =>
  accountNamed(page, name).get(`.quota-window[data-window="${kind}"] .window-spend`)
/** An element found in the page, as `get` gives it. */
type Found = Omit<DOMWrapper<Element>, 'exists'>

/** Each line of a block's chart: its name and its value. */
const lines = (block: Found) =>
  block
    .findAll('.ranked-row')
    .map((row) => [row.get('.ranked-label').text(), plain(row.get('.ranked-value').text())])
/** Each row of a block's table: its name and its value. */
const tableRows = (block: Found) =>
  block.findAll('tbody tr').map((row) => [row.get('th').text(), plain(row.get('td').text())])
const radio = (within: Found | VueWrapper, label: string) => {
  const found = within.findAll('[role="radio"]').find((one) => one.text() === label)
  if (!found) throw new Error(`no choice ${label}`)
  return found
}
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const openFiveHours = () => mountAnalytics({ routeState: { by: 'quota_five_hour' } })

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: NOW })
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

describe('where a window went', () => {
  it('reads the account’s seat over the window’s span, for the windows shown and no other', async () => {
    const reads = stubAnalyticsReads(usage, quota)
    await openFiveHours()
    const asked = reads.asked.filter((query) => isSpend(query))
    // Work, the account with no name and the provisional seat each have five hours; the
    // organization no source read has none, and no week is shown.
    expect(asked.map((query) => query.get('seat'))).toEqual([
      WORK_SEAT.id,
      NIGHT_SEAT.id,
      seatOf(SEATED).id,
    ])
    const [work] = asked
    const five = WORK.windows[0]
    expect(Object.fromEntries(work ?? [])).toEqual({
      from: five && 'started_at' in five ? five.started_at : '',
      to: momentAt(NOW),
      step: 'day',
      utc_offset: String(-NOW.getTimezoneOffset()),
      group_by: 'work_item,seat',
      account: WORK.organization,
      seat: WORK_SEAT.id,
      none: 'seat',
    })
    // The quota itself is read once, as before.
    expect(reads.quotaAsked).toHaveLength(1)
  })

  it('names its period in its heading, and leaves what it is and is not to the section’s «ⓘ»', async () => {
    stubAnalyticsReads(usage, quota)
    const page = await openFiveHours()
    const block = blockOf(page, 'Work')
    expect(block.get('h5').text()).toBe('Where the window went from 11:30 to 14:30')
    expect(block.text()).not.toContain('quota points')
    await page.get('.quota-panel .chart-section > .level-head .level-about-press').trigger('click')
    expect(document.querySelector('.info-tip-panel')?.textContent).toContain(
      'Where a window went is the API price estimate of the work Valkama recorded on the account, not quota points, without the work in claude.ai and the desktop app.',
    )
    expect(block.get('.ranked-bars').attributes('aria-label')).toBe(
      'Where Five hours of Work went by task, by API price estimate',
    )
  })

  it('ranks the account’s tasks by their estimate with their shares, the first five and the rest in one line', async () => {
    stubAnalyticsReads(usage, quota)
    const page = await openFiveHours()
    const block = blockOf(page, 'Work')
    expect(block.attributes('data-state')).toBe('spent')
    // Shares of the account's 13 dollars; the other accounts' 20 and 100 on MAIN-1 are not in them.
    expect(lines(block)).toEqual([
      ['MAIN-1 Answer a review', '≈ $6.00 · 46%'],
      ['MAIN-2 Fix the import', '≈ $3.00 · 23%'],
      ['No task', '≈ $1.00 · 8%'],
      ['MAIN-3 Small step 3', '≈ $0.50 · 4%'],
      ['MAIN-4 Small step 4', '≈ $0.50 · 4%'],
      ['Other, 4 more', '≈ $2.00 · 15%'],
    ])
    expect(block.text()).not.toMatch(/\$(20|26|100|106|126)\./u)
    // Its organization's work with no account known is said apart and not counted.
    expect(plain(block.get('[data-note="unplaced"]').text())).toBe(
      'Not counted here: ≈ $2.00 of work in its organization with the account unknown.',
    )
    // The window's own bar and facts carry no money.
    const window = accountNamed(page, 'Work').get('.quota-window[data-window="five_hour"]')
    for (const part of ['.window-bar', '.quota-window-facts', '.step-line'])
      expect(window.get(part).text()).not.toContain('$')
  })

  it('breaks the window down by project or model, and keeps the choice when the panel turns to its table', async () => {
    stubAnalyticsReads(usage, quota)
    const page = await openFiveHours()
    await radio(blockOf(page, 'Work'), 'Projects').trigger('click')
    await flushPromises()
    expect(lines(blockOf(page, 'Work'))).toEqual([
      ['Atlas', '≈ $9.00 · 69%'],
      ['Beacon', '≈ $3.00 · 23%'],
      ['Unknown', '≈ $1.00 · 8%'],
    ])
    await radio(blockOf(page, 'Work'), 'Models').trigger('click')
    await flushPromises()
    expect(lines(blockOf(page, 'Work'))).toEqual([
      ['m-a', '≈ $10.00 · 77%'],
      ['m-b', '≈ $3.00 · 23%'],
    ])
    // Another account's block still breaks down by task.
    expect(radio(blockOf(page, '7e6d5c4b'), 'Tasks').attributes('aria-checked')).toBe('true')

    await radio(page.get('.quota-panel .chart-section > .level-head'), 'Table').trigger('click')
    await flushPromises()
    const table = blockOf(page, 'Work')
    expect(table.find('.ranked-bars').exists()).toBe(false)
    expect(radio(table, 'Models').attributes('aria-checked')).toBe('true')
    expect(tableRows(table)).toEqual([
      ['m-a', '≈ $10.00 · 77%'],
      ['m-b', '≈ $3.00 · 23%'],
    ])
  })

  it('reads a week from its own start', async () => {
    stubAnalyticsReads(usage, quota)
    const page = await mountAnalytics({ routeState: { by: 'quota_week' } })
    const week = blockOf(page, 'Work', 'week')
    expect(week.get('h5').text()).toContain('from Nov 7, 14:30 to 14:30')
    expect(lines(week)[0]).toEqual(['MAIN-9 Earlier', '≈ $50.00 · 79%'])
  })
})

describe('the states of what used a window', () => {
  it('says apart no work on the account and work only its organization recorded with no account known', async () => {
    stubAnalyticsReads(usage, quota)
    const page = await openFiveHours()
    // The other account's work on MAIN-1 was before its five hours began.
    const none = blockOf(page, '7e6d5c4b')
    expect(none.attributes('data-state')).toBe('none')
    expect(none.get('.window-spend-body').text()).toBe(
      'No work was recorded on this account in this window.',
    )
    const unplaced = blockOf(page, 'a1b2c3d4')
    expect(unplaced.attributes('data-state')).toBe('unplaced')
    expect(plain(unplaced.get('.window-spend-body').text())).toBe(
      'No work was recorded on this account in this window. Not counted here: ≈ $4.00 of work in its organization with the account unknown.',
    )
    expect(unplaced.find('.ranked-bars').exists()).toBe(false)
    // An organization no source read has no window, and so no block.
    expect(accountNamed(page, '9f8e7d6c').find('.window-spend').exists()).toBe(false)
  })

  it('says it is waiting once the wait has lasted, and then what it read', async () => {
    const reads = stubAnalyticsReads((query) => (isSpend(query) ? 'hold' : usage(query)), quota)
    const page = await openFiveHours()
    expect(blockOf(page, 'Work').get('.window-spend-body').text()).toBe('')
    await wait(LOADING_DELAY_MS + 50)
    const waiting = blockOf(page, 'Work')
    expect(waiting.attributes('data-state')).toBe('loading')
    expect(waiting.get('.window-spend-body').text()).toBe('Loading')
    // The panel's own figures stand meanwhile.
    expect(accountNamed(page, 'Work').get('.window-value').text()).toBe('62% used')
    for (const held of reads.held) held.release(usage(held.query))
    await flushPromises()
    await wait(LOADING_MIN_SHOWN_MS + 50)
    expect(blockOf(page, 'Work').attributes('data-state')).toBe('spent')
  })

  it('says a read that failed in its block, with a retry, while the panel stands', async () => {
    let fails = true
    stubAnalyticsReads((query) => (isSpend(query) && fails ? { status: 503 } : usage(query)), quota)
    const page = await openFiveHours()
    const failed = blockOf(page, 'Work')
    expect(failed.attributes('data-state')).toBe('failed')
    expect(failed.get('.window-spend-body').text()).toBe(
      'What used this window could not be read. Retry',
    )
    expect(page.text()).not.toContain('The quota could not be read.')
    expect(accountNamed(page, 'Work').get('.window-value').text()).toBe('62% used')
    fails = false
    await failed.get('.window-spend-failed button').trigger('click')
    await flushPromises()
    expect(blockOf(page, 'Work').attributes('data-state')).toBe('spent')
    expect(lines(blockOf(page, 'Work'))[0]).toEqual(['MAIN-1 Answer a review', '≈ $6.00 · 46%'])
  })
})
