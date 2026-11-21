/**
 * What used each window of the quota panel, against stand-ins for the usage and quota reads. The
 * oracle is the requirement: each window that has a start offers «Breakdown», which
 * opens in the side panel over the page the work Valkama recorded on that account from the
 * window's start to the answer's moment, ranked by its API price estimate with
 * each item's share of that estimate, by task first and by project or model on choice, drawn or, by
 * the panel's own switch, read as its table; the first
 * five items and one line for the rest, or by project or model a ring of every item, which it
 * opens on, while the tasks, named by free text, are a list only, the rest and work on no task
 * apart after the five; a heading that names the period it covers and what its lines add up to,
 * and none where it has no lines; and the
 * section's «ⓘ» that says once it is the API price estimate and not quota points, and that
 * claude.ai and the desktop app are not in it. Another
 * account's work is never in it, and its organization's work with no account known is said apart
 * and never counted to it. No work, only such work, a wait and a failed read each say so in words
 * of their own, and a failed read is retried in its block while the side panel stands.
 *
 * The work is the fixture's (`quotaSpent.ts`): «Work» spent 13 dollars in its five hours, its
 * organization 2 more with no account known and another account of it 20 on MAIN-1; an account of
 * another organization 100 on MAIN-1, and the organization of the account known by its weekly
 * reset 4 with no account.
 */
import type { DOMWrapper, VueWrapper } from '@vue/test-utils'
import { flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import WindowDetail from '@/pages/analytics/components/WindowDetail.vue'

import { LOADING_DELAY_MS, LOADING_MIN_SHOWN_MS } from '@/shared/ui/loadingPresence.ts'

import { momentAt, serveUsage } from '../fixtures/analytics.ts'
import { NIGHT_NAME, quotaAnswer, quotaAt, SEATED_NAME, UNREAD_NAME } from '../fixtures/quota.ts'
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
import { seriesEntries } from '../support/legend.ts'

/** The seats a window's read asks for: the account, and its organization's work on no account. */
const seatsOf = (account: typeof WORK) => `${seatOf(account).id ?? ''},${account.organization}/`
const quota = () => quotaAnswer(quotaAt(NOW))
const usage = (query: URLSearchParams) => serveUsage(WORLD, query)

/** Words as a reader reads them: the app keeps a figure and its unit together with a no-break space. */
const plain = (text: string) => text.replaceAll('\u{A0}', ' ')
/** What a part says to a reader: its words without the room it keeps unseen (`aria-hidden`). */
function said(part: Omit<DOMWrapper<Element>, 'exists'>) {
  const copy = part.element.cloneNode(true) as Element
  for (const unseen of copy.querySelectorAll('[aria-hidden="true"]')) unseen.remove()
  return plain(copy.textContent ?? '')
    .replaceAll(/\s+/gu, ' ')
    .trim()
}

function accountNamed(page: VueWrapper, name: string) {
  const found = page
    .findAll('.quota-account')
    .find((one) => one.get('.quota-account-name').text() === name)
  if (!found) throw new Error(`no account ${name}`)
  return found
}
/** A window's «Breakdown», which opens what used it in the side panel. */
const spendOf = (page: VueWrapper, name: string, kind = 'five_hour') =>
  accountNamed(page, name).get(`.quota-window[data-window="${kind}"] [data-spend]`)

type Written = [Record<string, string>, ('push' | 'replace')?]
const written = (page: VueWrapper) => page.emitted<Written>('state') ?? []

/**
 * Opens what used a window in the side panel, as the shell does with the address its press
 * writes, from the section with no panel over it; the block the panel shows.
 */
async function openSpend(page: VueWrapper, name: string, kind = 'five_hour') {
  const { routeState } = page.props() as { routeState?: Record<string, string> }
  const section = { by: routeState?.by ?? 'quota_five_hour' }
  await page.setProps({ routeState: section })
  await flushPromises()
  await spendOf(page, name, kind).trigger('click')
  const [state, mode] = written(page).at(-1) ?? []
  expect(mode).toBe('push')
  await page.setProps({ routeState: state })
  await flushPromises()
  return blockIn(page)
}
/** The block of what used the window the side panel shows. */
const blockIn = (page: VueWrapper) =>
  page.getComponent(WindowDetail).get('[data-detail="window"] .window-spend')
/** An element found in the page, as `get` gives it. */
type Found = Omit<DOMWrapper<Element>, 'exists'> | VueWrapper

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
  it('reads the account and its organization’s work on no account over the window’s span, for the window opened and no other', async () => {
    const reads = stubAnalyticsReads(usage, quota)
    const page = await openFiveHours()
    // Work, the account with no name and the weekly account each offer their five hours; the
    // organization no source read has none. Nothing is read until one opens.
    const accounts = page.findAll('.quota-account')
    expect(accounts).toHaveLength(4)
    const offering = accounts.filter((one) =>
      one.find('.quota-window[data-window="five_hour"] [data-spend]').exists(),
    )
    expect(offering).toHaveLength(3)
    expect(reads.asked.filter((query) => isSpend(query))).toEqual([])
    for (const name of offering.map((one) => one.get('.quota-account-name').text()))
      await openSpend(page, name)
    const asked = reads.asked.filter((query) => isSpend(query))
    expect(asked.map((query) => query.get('seat'))).toEqual([
      seatsOf(WORK),
      seatsOf(NIGHT),
      seatsOf(SEATED),
    ])
    const [work] = asked
    const five = WORK.windows[0]
    expect(Object.fromEntries(work ?? [])).toEqual({
      from: five && 'started_at' in five ? five.started_at : '',
      to: momentAt(NOW),
      step: 'day',
      utc_offset: String(-NOW.getTimezoneOffset()),
      group_by: 'work_item,seat',
      seat: seatsOf(WORK),
    })
    // The quota itself is read once, as before.
    expect(reads.quotaAsked).toHaveLength(1)
  })

  it('names its period in its heading, and leaves what it is and is not to an «ⓘ»', async () => {
    stubAnalyticsReads(usage, quota)
    const page = await openFiveHours()
    // The section's «ⓘ», by its name: the quota shows one section.
    const named = 'button[aria-label="About this section"]'
    expect(page.findAll(named)).toHaveLength(1)
    const sectionAbout = page.get(named)
    await sectionAbout.trigger('click')
    const basis =
      'The window breakdown is the API price estimate of the work Valkama recorded on the account, not quota points, without the work in claude.ai and the desktop app.'
    expect(document.querySelector('.info-tip-panel')?.textContent).toContain(basis)
    await sectionAbout.trigger('click')
    expect(document.querySelectorAll('.info-tip-panel')).toHaveLength(0)
    const block = await openSpend(page, 'Work')
    // Under the panel's name, one rank under it: the section's «ⓘ» is under the panel, so the
    // panel's own «ⓘ» says what the figures are and are not, and neither the panel nor the block
    // says it as a line.
    // Its lines add up to the account's 13 dollars: 6, 3, 0.5, 0.5, 2 for the rest and 1 on no task.
    expect(plain(block.get('h3').text())).toBe('Window breakdown: 11:30 – 14:30 · ≈ $13.00')
    expect(lines(block).map(([, value]) => value)).toEqual([
      '≈ $6.00 · 46%',
      '≈ $3.00 · 23%',
      '≈ $0.50 · 4%',
      '≈ $0.50 · 4%',
      '≈ $2.00 · 15%',
      '≈ $1.00 · 8%',
    ])
    const frame = document.querySelector('[data-detail="window"]')?.closest('.drawer-frame')
    expect(plain(frame?.textContent ?? '')).toContain('Window breakdown: 11:30 – 14:30 · ≈ $13.00')
    expect(frame?.textContent).not.toContain('quota points')
    const about = [...(frame?.querySelectorAll('button') ?? [])].filter(
      (button) => button.getAttribute('aria-label') === 'About these figures',
    )
    expect(about).toHaveLength(1)
    about[0]?.click()
    await flushPromises()
    const tips = document.querySelectorAll('.info-tip-panel')
    expect(tips).toHaveLength(1)
    expect(tips[0]?.textContent).toContain(basis)
    expect(block.get('.ranked-bars').attributes('aria-label')).toBe(
      'Breakdown of Five hours of Work by task, by API price estimate',
    )
  })

  it('ranks the account’s tasks by their estimate with their shares, the first five, then the rest in one line and work on no task apart', async () => {
    stubAnalyticsReads(usage, quota)
    const page = await openFiveHours()
    const block = await openSpend(page, 'Work')
    expect(block.attributes('data-state')).toBe('spent')
    // Shares of the account's 13 dollars; the other accounts' 20 and 100 on MAIN-1 are not in them.
    expect(lines(block)).toEqual([
      ['MAIN-1 Answer a review', '≈ $6.00 · 46%'],
      ['MAIN-2 Fix the import', '≈ $3.00 · 23%'],
      ['MAIN-3 Small step 3', '≈ $0.50 · 4%'],
      ['MAIN-4 Small step 4', '≈ $0.50 · 4%'],
      ['Other, 4 more', '≈ $2.00 · 15%'],
      ['No task', '≈ $1.00 · 8%'],
    ])
    expect(
      block.findAll('.ranked-rest .ranked-row').map((row) => row.attributes('data-kind')),
    ).toEqual(['other', 'none'])
    expect(block.text()).not.toMatch(/\$(20|26|100|106|126)\./u)
    // Its organization's work with no account known is said apart and not counted.
    expect(plain(block.get('[data-note="unplaced"]').text())).toBe(
      'Not counted here: ≈ $2.00 of work in its organization with the account unknown.',
    )
    // The window's own bar and facts carry no money.
    const window = accountNamed(page, 'Work').get('.quota-window[data-window="five_hour"]')
    expect(window.text()).not.toContain('$')
    for (const part of ['.window-bar', '.quota-window-facts', '.step-line'])
      expect(window.get(part).text()).not.toContain('$')
  })

  it('breaks the window down by project or model, and keeps the choice when it opens again and turns to its table', async () => {
    stubAnalyticsReads(usage, quota)
    const page = await openFiveHours()
    await openSpend(page, 'Work')
    await radio(blockIn(page), 'Projects').trigger('click')
    await flushPromises()
    await radio(blockIn(page), 'Bars').trigger('click')
    expect(lines(blockIn(page))).toEqual([
      ['Atlas', '≈ $9.00 · 69%'],
      ['Beacon', '≈ $3.00 · 23%'],
      ['Unknown', '≈ $1.00 · 8%'],
    ])
    await radio(blockIn(page), 'Models').trigger('click')
    await flushPromises()
    expect(lines(blockIn(page))).toEqual([
      ['m-a', '≈ $10.00 · 77%'],
      ['m-b', '≈ $3.00 · 23%'],
    ])
    // Another account's block still breaks down by task.
    expect(radio(await openSpend(page, NIGHT_NAME), 'Tasks').attributes('aria-checked')).toBe(
      'true',
    )
    // Opened again, the window keeps its breakdown and its drawing.
    const again = await openSpend(page, 'Work')
    expect(radio(again, 'Models').attributes('aria-checked')).toBe('true')
    expect(lines(again)).toEqual([
      ['m-a', '≈ $10.00 · 77%'],
      ['m-b', '≈ $3.00 · 23%'],
    ])
    // The panel's own switch turns it to its table, which keeps the breakdown.
    // The panel's switch stands over the block and its own choices.
    const [shownAs] = page.getComponent(WindowDetail).findAll('[role="radiogroup"]')
    const choices = shownAs?.findAll('[role="radio"]') ?? []
    expect(choices.map((one) => one.text())).toEqual(['Chart', 'Table'])
    await choices[1]?.trigger('click')
    await flushPromises()
    const table = blockIn(page)
    expect(table.find('.ranked-bars').exists()).toBe(false)
    expect(radio(table, 'Models').attributes('aria-checked')).toBe('true')
    expect(tableRows(table)).toEqual([
      ['m-a', '≈ $10.00 · 77%'],
      ['m-b', '≈ $3.00 · 23%'],
    ])
  })

  it('draws the items as a ring by project, with the bars’ figures in its legend, and the tasks as a list only', async () => {
    stubAnalyticsReads(usage, quota)
    const page = await openFiveHours()
    await openSpend(page, 'Work')
    const block = () => blockIn(page)
    // By task it is a list only: no ring and no switch to one.
    expect(block().find('.donut-chart').exists()).toBe(false)
    expect(
      block()
        .findAll('[role="radio"]')
        .map((one) => one.text()),
    ).toEqual(['Tasks', 'Projects', 'Models'])

    await radio(block(), 'Projects').trigger('click')
    await flushPromises()
    expect(radio(block(), 'Ring').attributes('aria-checked')).toBe('true')
    expect(block().find('.ranked-bars').exists()).toBe(false)
    // The bars' figures and shares, each at the end of its legend line, no words on a sector.
    expect(
      seriesEntries(block()).map((one) => [
        one.get('[data-series]').text(),
        plain(one.get('.chart-figure').text()),
      ]),
    ).toEqual([
      ['Atlas', '≈ $9.00 · 69%'],
      ['Beacon', '≈ $3.00 · 23%'],
      ['Unknown', '≈ $1.00 · 8%'],
    ])
    expect(block().get('.donut-ring').text()).toBe('')

    // Chosen, the bars stand for every breakdown until the page is left.
    await radio(block(), 'Bars').trigger('click')
    await radio(block(), 'Models').trigger('click')
    await flushPromises()
    expect(block().find('.donut-chart').exists()).toBe(false)
    expect(lines(block())[0]).toEqual(['m-a', '≈ $10.00 · 77%'])
  })

  it('reads a week from its own start', async () => {
    stubAnalyticsReads(usage, quota)
    const page = await mountAnalytics({ routeState: { by: 'quota_week' } })
    const week = await openSpend(page, 'Work', 'week')
    expect(week.get('h3').text()).toContain(': Nov 7, 14:30 – 14:30')
    expect(lines(week)[0]).toEqual(['MAIN-9 Earlier', '≈ $50.00 · 79%'])
    // The week's lines: the five hours' 13 dollars and the 50 before them.
    expect(plain(week.get('h3').text())).toMatch(/ · ≈ \$63\.00$/u)
  })
})

describe('the states of what used a window', () => {
  it('says apart no work on the account and work only its organization recorded with no account known', async () => {
    stubAnalyticsReads(usage, quota)
    const page = await openFiveHours()
    // The other account's work on MAIN-1 was before its five hours began.
    const none = await openSpend(page, NIGHT_NAME)
    expect(none.attributes('data-state')).toBe('none')
    expect(said(none.get('.window-spend-body'))).toBe(
      'No work was recorded on this account in this window.',
    )
    // With no lines its heading names the stretch alone, no sum.
    expect(none.get('h3').text()).toMatch(/^Window breakdown: \d{2}:\d{2} – \d{2}:\d{2}$/u)
    const unplaced = await openSpend(page, SEATED_NAME)
    expect(unplaced.attributes('data-state')).toBe('unplaced')
    expect(said(unplaced.get('.window-spend-body'))).toBe(
      'No work was recorded on this account in this window. Not counted here: ≈ $4.00 of work in its organization with the account unknown.',
    )
    expect(unplaced.find('.ranked-bars').exists()).toBe(false)
    // The organization's work apart is no line of it, so it is no sum in its heading either.
    expect(unplaced.get('h3').text()).not.toContain('$')
    // An organization no source read has no window, and so nothing to open; Work has.
    expect(accountNamed(page, UNREAD_NAME).find('[data-spend]').exists()).toBe(false)
    expect(accountNamed(page, 'Work').find('[data-spend]').exists()).toBe(true)
  })

  it('says it is waiting once the wait has lasted, and then what it read', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'], now: NOW })
    const reads = stubAnalyticsReads((query) => (isSpend(query) ? 'hold' : usage(query)), quota)
    const page = await openFiveHours()
    await openSpend(page, 'Work')
    expect(blockIn(page).get('.window-spend-body').text()).toBe('')
    vi.advanceTimersByTime(LOADING_DELAY_MS - 1)
    await page.vm.$nextTick()
    expect(blockIn(page).get('.window-spend-body').text()).toBe('')
    vi.advanceTimersByTime(1)
    await page.vm.$nextTick()
    const waiting = blockIn(page)
    expect(waiting.attributes('data-state')).toBe('loading')
    expect(waiting.get('.window-spend-body').text()).toBe('Loading')
    // The panel's own figures stand meanwhile.
    expect(accountNamed(page, 'Work').get('.quota-window-lead').text()).toBe(
      '62% used · up to date',
    )
    for (const held of reads.held) held.release(usage(held.query))
    await flushPromises()
    // What it read waits for the minimum the wait was shown for, then takes its place.
    vi.advanceTimersByTime(LOADING_MIN_SHOWN_MS - 1)
    await page.vm.$nextTick()
    expect(blockIn(page).attributes('data-state')).toBe('loading')
    vi.advanceTimersByTime(1)
    await page.vm.$nextTick()
    expect(blockIn(page).attributes('data-state')).toBe('spent')
  })

  it('says a read that failed in its block, with a retry, while the panel stands', async () => {
    let fails = true
    stubAnalyticsReads((query) => (isSpend(query) && fails ? { status: 503 } : usage(query)), quota)
    const page = await openFiveHours()
    const failed = await openSpend(page, 'Work')
    expect(failed.attributes('data-state')).toBe('failed')
    expect(failed.get('.window-spend-body').text()).toBe(
      'The window breakdown could not be loaded. Retry',
    )
    expect(page.text()).not.toContain('The quota could not be loaded.')
    expect(accountNamed(page, 'Work').get('.quota-window-lead').text()).toBe(
      '62% used · up to date',
    )
    fails = false
    await failed.get('.window-spend-failed button').trigger('click')
    await flushPromises()
    expect(blockIn(page).attributes('data-state')).toBe('spent')
    expect(lines(blockIn(page))[0]).toEqual(['MAIN-1 Answer a review', '≈ $6.00 · 46%'])
  })

  it('keeps the room of the headings a newer answer can give it, with no sum and with five figures of one', async () => {
    stubAnalyticsReads(usage, quota)
    const page = await openFiveHours()
    const block = await openSpend(page, 'Work')
    const stretch = 'Window breakdown: 11:30 – 14:30'
    expect(plain(block.get('.window-spend-title').text())).toBe(`${stretch} · ≈ $13.00`)
    // Unseen in the heading's place (DESIGN.md § Analytics: the breakdowns beside it and the
    // lines under it stay where they stand when a newer answer changes it).
    const room = block
      .findAll('.window-spend-heading [aria-hidden="true"]')
      .map((one) => plain(one.text()))
    // And as a later day says it, a moment of another day dated: past midnight a time takes its
    // date (`datedStretches`).
    const dated = 'Window breakdown: Nov 11, 11:30 – 14:30'
    const allDated = 'Window breakdown: Nov 11, 11:30 – Nov 11, 14:30'
    expect(room).toEqual([
      stretch,
      `${stretch} · ≈ $99,999.99`,
      dated,
      `${dated} · ≈ $99,999.99`,
      allDated,
      `${allDated} · ≈ $99,999.99`,
    ])
    expect(said(block.get('.window-spend-head'))).not.toContain('99,999')
  })

  it('keeps before midnight the room of the heading it takes after, a time taking its date', async () => {
    // The quota is read at ten to midnight, its five hours begun at 20:50, and again at ten past,
    // the same window: the heading's start is then a moment of another day.
    const evening = new Date(2026, 10, 11, 23, 50)
    const night = new Date(2026, 10, 12, 0, 10)
    vi.setSystemTime(evening)
    let at = evening
    const answered = () => {
      const window = quotaAt(evening)
      return quotaAnswer({ ...window, now: momentAt(at.getTime(), -at.getTimezoneOffset()) })
    }
    stubAnalyticsReads(usage, answered)
    const page = await openFiveHours()
    await openSpend(page, 'Work')
    const heading = () => plain(blockIn(page).get('.window-spend-title').text())
    const room = () =>
      blockIn(page)
        .findAll('.window-spend-heading [aria-hidden="true"]')
        .map((one) => plain(one.text()))
    expect(heading()).toBe('Window breakdown: 20:50 – 23:50')
    // Figures are of one width each, so a heading is kept for by its shape, whichever minute.
    const shape = (text: string) => text.replaceAll(/[0-9]/gu, '0')
    const kept = [heading(), ...room()].map(shape)

    at = night
    vi.setSystemTime(night)
    await page.get('.analytics-refresh').trigger('click')
    await flushPromises()
    const after = heading()
    expect(after, 'the start dated past midnight').toMatch(/^Window breakdown: Nov 11, 20:50 – /u)
    expect(kept, 'its room kept before midnight').toContain(shape(after))
  })

  it('keeps its lines when a read again fails, and says so in the room it kept for those words', async () => {
    let at = NOW
    let fails = false
    const reads = stubAnalyticsReads(
      (query) => (isSpend(query) && fails ? { status: 503 } : usage(query)),
      () => quotaAnswer(quotaAt(at)),
    )
    const page = await openFiveHours()
    await openSpend(page, 'Work')
    const first = lines(blockIn(page))[0]
    expect(first).toEqual(['MAIN-1 Answer a review', '≈ $6.00 · 46%'])
    // The words a read again that fails would say stand in the block unseen while an answer
    // stands, under the status that says them (DESIGN.md § Analytics: nothing moves when it is
    // said or when the next answer replaces it).
    const room = () => blockIn(page).get('.window-spend-again [aria-hidden="true"]')
    const status = () => blockIn(page).get('.window-spend-again [role="status"]')
    expect(plain(room().text())).toMatch(/^Could not refresh; .+ Retry$/u)
    expect(status().text()).toBe('')

    // The quota answers ten minutes on, a new step of what used the window, and its read fails.
    fails = true
    at = new Date(NOW.getTime() + 10 * 60_000)
    await page.get('.analytics-refresh').trigger('click')
    await flushPromises()
    expect(reads.quotaAsked).toHaveLength(2)
    expect(lines(blockIn(page))[0], 'the lines it showed stay').toEqual(first)
    expect(plain(status().text()), 'said in the words whose room it kept').toBe(
      plain(room().text()),
    )
    expect(blockIn(page).findAll('.window-spend-again')).toHaveLength(1)

    fails = false
    await status().get('button').trigger('click')
    await flushPromises()
    expect(status().text()).toBe('')
    expect(plain(room().text())).toMatch(/^Could not refresh; .+ Retry$/u)
  })
})
