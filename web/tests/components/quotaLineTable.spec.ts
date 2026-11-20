/**
 * The decision table of a quota window card's step line, against stand-ins for the page's reads.
 * The oracle is the rule (DESIGN.md, Analytics, the quota's panel): how far back from now the
 * period starts decides what a line holds. No further back than the card's window lasts — «Now»,
 * «Today» and «This week» for a week — the line is that one window, whole across the plot, and the
 * section's scale one window; further back, every window of its kind the period overlaps.
 *
 * The figures come from `quotaTable` on a Wednesday afternoon: «Alpha»'s live week started a day
 * before now and resets in six, so «This week», from Monday's midnight, starts in the week before
 * it; «Beta»'s week started five days and three hours before now.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Quota } from '@/shared/api/analyticsApi.ts'

import { serveUsage } from '../fixtures/analytics.ts'
import { quotaAnswer } from '../fixtures/quota.ts'
import { earlierWindows, servedOver } from '../fixtures/quotaHistory.ts'
import { quotaTable } from '../fixtures/quotaTable.ts'
import { mountAnalytics, stubAnalyticsReads } from '../support/analyticsReads.ts'
import { accountNamed } from '../support/quotaPanel.ts'
import { corners } from '../support/stepDrawing.ts'

/** Wednesday afternoon, the moment the page's reads are asked at. */
const NOW = new Date(2026, 10, 11, 14, 30)
const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
/** The drawing's width: a moment's x is its share of the span, 300 across. */
const ACROSS = 300

const usage = (query: URLSearchParams) => serveUsage([], query)
/** A moment as the answer writes it. */
const at = (ms: number) => new Date(ms).toISOString()

/** The page at `route`, its quota read answering `quota` over the period it asks from. */
async function pageOver(quota: Quota, route: Record<string, string>) {
  const answer = (query: URLSearchParams) =>
    quotaAnswer(servedOver(quota, `http://127.0.0.1/?${query.toString()}`))
  const reads = stubAnalyticsReads(usage, answer)
  const page = await mountAnalytics({ routeState: route })
  return { reads, page }
}

/** A card's step line by its account and window, as it is drawn. */
function lineOf(page: Awaited<ReturnType<typeof pageOver>>['page'], name: string, kind: string) {
  const line = accountNamed(page, name).get(
    `.quota-window[data-window="${kind}"] [data-chart="steps"]`,
  )
  const now = line.find('[data-mark="now"]')
  const path = line.find('[data-mark="line"]')
  return {
    line,
    earlier: line.find('[data-mark="earlier"]').exists(),
    drops: line.findAll('[data-target="restart"][data-drop]').length,
    now: now.exists() ? Number(now.attributes('x1')) : null,
    current: path.exists() ? corners(path.attributes('d') ?? '') : [],
  }
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: NOW })
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  localStorage.clear()
  document.body.innerHTML = ''
})

describe('a quota window’s line at a period no longer than its window', () => {
  it('at «This week» with a mid-week reset draws one week across the plot, the scale one week', async () => {
    const { reads, page } = await pageOver(quotaTable(NOW), { by: 'quota_week', period: 'week' })
    // Monday's midnight: two and a half days back, after the week before «Alpha»'s reset.
    expect(reads.quotaAsked.at(-1)?.get('from')).toBe(new Date(2026, 10, 9).toISOString())
    const alpha = lineOf(page, 'Alpha', 'week')
    expect(alpha.earlier, 'no week before drawn').toBe(false)
    expect(alpha.drops, 'no fall at a reset').toBe(0)
    // The current week from its start at the plot's left: its first reading 4 hours in, now 1 day in.
    expect(alpha.current[0]?.[0]).toBeCloseTo(((4 * HOUR) / (7 * DAY)) * ACROSS, 1)
    expect(alpha.now).toBeCloseTo(ACROSS / 7, 1)
    // The section's scale is one week: «Beta»'s now stands five days and three hours into its week.
    const beta = lineOf(page, 'Beta', 'week')
    expect(beta.now).toBeCloseTo(((5 * DAY + 3 * HOUR) / (7 * DAY)) * ACROSS, 1)
    // The line under «Alpha»'s card names the week before, which its line does not hold.
    expect(
      accountNamed(page, 'Alpha')
        .find('.quota-window[data-window="week"] [data-past="line"]')
        .exists(),
    ).toBe(true)
  })

  it('at «Today» on a reset day draws the week that started today alone', async () => {
    const quota = quotaTable(NOW)
    const week = quota.accounts[0]?.windows[1]
    if (!week || !('readings' in week)) throw new Error('«Alpha» reads its week')
    // The week reset at 09:00 today, after the period's midnight, and was read twice since.
    const reset = new Date(2026, 10, 11, 9).getTime()
    Object.assign(week, {
      started_at: at(reset),
      resets_at: at(reset + 7 * DAY),
      latest: { at: at(NOW.getTime() - 2 * MINUTE), used_percent: 4, source: 'poll' },
      readings: [
        { at: at(reset + HOUR), used_percent: 1, source: 'poll' },
        { at: at(NOW.getTime() - 2 * MINUTE), used_percent: 4, source: 'poll' },
      ],
      earlier: earlierWindows(reset, -NOW.getTimezoneOffset(), { kind: 'week', source: 'poll' }, [
        { readings: [[DAY, 30]] },
      ]),
    })
    const { page } = await pageOver(quota, { by: 'quota_week', period: 'today' })
    const alpha = lineOf(page, 'Alpha', 'week')
    expect(alpha.earlier).toBe(false)
    expect(alpha.now).toBeCloseTo(((NOW.getTime() - reset) / (7 * DAY)) * ACROSS, 1)
  })

  it('at «Now» just after a reset draws the five hours that started since alone', async () => {
    const quota = quotaTable(NOW)
    const five = quota.accounts[0]?.windows[0]
    if (!five || !('readings' in five)) throw new Error('«Alpha» reads its five hours')
    // The five hours reset half an hour ago, inside «Now»'s hour, and the next started 20 min ago.
    const start = NOW.getTime() - 20 * MINUTE
    const latest = { at: at(NOW.getTime() - 2 * MINUTE), used_percent: 3, source: 'poll' as const }
    Object.assign(five, {
      started_at: at(start),
      resets_at: at(start + 5 * HOUR),
      latest,
      readings: [latest],
      earlier: [
        {
          started_at: at(NOW.getTime() - 330 * MINUTE),
          resets_at: at(NOW.getTime() - 30 * MINUTE),
          readings: [{ at: at(NOW.getTime() - 2 * HOUR), used_percent: 70, source: 'poll' }],
          restarts: [],
        },
      ],
    })
    const { page } = await pageOver(quota, { by: 'quota_five_hour', period: 'now' })
    const alpha = lineOf(page, 'Alpha', 'five_hour')
    expect(alpha.earlier).toBe(false)
    expect(alpha.now).toBeCloseTo(((20 * MINUTE) / (5 * HOUR)) * ACROSS, 1)
  })
})

describe('a quota window’s line at a period further back than its window', () => {
  it('reaches a custom range of a day three weeks back, shorter than a week', async () => {
    const { page } = await pageOver(quotaTable(NOW), {
      by: 'quota_week',
      period: 'custom',
      from: '2026-10-21',
      to: '2026-10-21',
    })
    // The three weeks that reset after its start, then the current one: four falls to nothing
    // would be one too many, the week that reset before the range stays out.
    const alpha = lineOf(page, 'Alpha', 'week')
    expect(alpha.earlier).toBe(true)
    expect(alpha.drops).toBe(3)
  })

  it('at «Today» five hours hold the windows that reset since midnight', async () => {
    const { page } = await pageOver(quotaTable(NOW), { by: 'quota_five_hour', period: 'today' })
    const alpha = lineOf(page, 'Alpha', 'five_hour')
    expect(alpha.earlier).toBe(true)
    expect(alpha.drops).toBe(2)
  })
})

/** Where each fall to nothing at a reset stands across a line's drawing, in %, from its box. */
const resetsOf = (line: ReturnType<typeof lineOf>['line']) =>
  line
    .findAll('[data-target="restart"][data-drop]')
    .map((one) => Number(/calc\(([\d.]+)%/u.exec(one.attributes('style') ?? '')?.[1] ?? 'NaN'))

/** The words of a line's axis, from its start to its end. */
const axisOf = (line: ReturnType<typeof lineOf>['line']) =>
  line
    .findAll('[data-region="axis"] [data-moment]')
    .map((one) => one.text().replaceAll('\u{A0}', ' '))

describe('the two windows of one account on one time axis', () => {
  for (const [period, route] of [
    ['«4 weeks»', { by: 'quota_week', period: 'weeks4' }],
    [
      'a custom past range',
      { by: 'quota_week', period: 'custom', from: '2026-10-26', to: '2026-11-04' },
    ],
  ] as const)
    it(`over ${period} the model week with no reading since its reset stands moment for moment with the live week`, async () => {
      const { page } = await pageOver(quotaTable(NOW), route)
      const week = lineOf(page, 'Alpha', 'week')
      const model = lineOf(page, 'Alpha', 'week_model')
      // Every reset the model week falls to nothing at, the live week falls at too, at the same x:
      // both lines end at the live week's reset and run over one length.
      const weekResets = resetsOf(week.line)
      const modelResets = resetsOf(model.line)
      expect(modelResets.length).toBeGreaterThan(0)
      for (const at of modelResets)
        expect(
          weekResets.some((one) => Math.abs(one - at) < 0.01),
          `${at}% on both`,
        ).toBe(true)
      // Past its last reset nothing was read: the line stops, and its axis says so at its end.
      expect(model.now).toBeNull()
      expect(axisOf(model.line).at(-1)).toMatch(/^no new readings since /u)
      expect(axisOf(week.line).at(-1)).toMatch(/^resets /u)
    })

  it('at «This week» the model week shows the account’s current week, empty, on the live week’s axis', async () => {
    const { page } = await pageOver(quotaTable(NOW), { by: 'quota_week', period: 'week' })
    const week = lineOf(page, 'Alpha', 'week')
    const model = lineOf(page, 'Alpha', 'week_model')
    // Now and the reset at the same x: the same span, now one day into it.
    expect(model.now).not.toBeNull()
    expect(model.now).toBeCloseTo(week.now ?? -1, 5)
    expect(axisOf(model.line)).toEqual(axisOf(week.line))
    // Its plot is empty, and says what the card's lead says.
    expect(model.line.findAll('[data-mark="reading"]')).toHaveLength(0)
    expect(model.line.find('[data-mark="line"]').exists()).toBe(false)
    const card = accountNamed(page, 'Alpha').get('.quota-window[data-window="week_model"]')
    const lead = card.get('[data-lead="ended"]').text()
    expect(model.line.text()).toContain(lead)
    expect(model.line.attributes('aria-label')).toContain(lead)
    // Its «Previous window» names its last window, which reset where the live week started.
    expect(card.get('[data-past="line"]').text()).toMatch(/^Previous window: until .+ — 15%$/u)
  })

  it('at «This week» an account with no reading since any reset keeps its last window whole, muted', async () => {
    const { page } = await pageOver(quotaTable(NOW), { by: 'quota_week', period: 'week' })
    const gamma = lineOf(page, 'Gamma', 'week')
    expect(gamma.line.attributes('data-muted')).toBeDefined()
    expect(gamma.now).toBeNull()
    // Its two readings from its start: the first three days in.
    expect(gamma.line.findAll('[data-mark="reading"]')).toHaveLength(2)
    expect(gamma.current[0]?.[0]).toBeCloseTo((3 * ACROSS) / 7, 1)
    expect(axisOf(gamma.line).at(-1)).toMatch(/^reset at /u)
  })
})
