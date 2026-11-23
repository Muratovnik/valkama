/**
 * A quota window's step line over the page's period, against stand-ins for the page's reads. The
 * oracle is the rule (DESIGN.md, Analytics, the quota's panel): the quota read asks from the
 * period's start; the card's figures and bar stay on the current window, while its line holds
 * every window of its kind the period overlaps, each whole from its start to its reset, one after
 * another, the count falling to nothing at each reset, the windows before the current one drawn in
 * the neutral ink and named apart in the legend, the current one at the right end with its pace,
 * its forecast and now; its axis names the start of the first window it holds and the current
 * reset; its words for a screen reader and its table say the windows before it too.
 *
 * The figures come from `quotaWithHistory`: «Work»'s week started four days before now at 41 %,
 * and the four weeks before it, back to back, reset 28, 21, 14 and 7 days before its start's
 * week was out; «4 weeks» starts at midnight 27 days ago and overlaps all four, «This week» starts
 * on Monday and overlaps none.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { serveUsage } from '../fixtures/analytics.ts'
import { quotaAnswer } from '../fixtures/quota.ts'
import { quotaWithHistory, servedOver } from '../fixtures/quotaHistory.ts'
import { mountAnalytics, stubAnalyticsReads } from '../support/analyticsReads.ts'
import { accountNamed, plain, showTable } from '../support/quotaPanel.ts'
import { corners } from '../support/stepDrawing.ts'

/** Wednesday afternoon, the moment the page's reads are asked at. */
const NOW = new Date(2026, 10, 11, 14, 30)

const usage = (query: URLSearchParams) => serveUsage([], query)
const quota = (query: URLSearchParams) =>
  quotaAnswer(servedOver(quotaWithHistory(NOW), `http://127.0.0.1/?${query.toString()}`))

/** «Work»'s week's line as it is drawn, in the drawing's units, 300 across and 100 down. */
async function weekLine(period: string) {
  const reads = stubAnalyticsReads(usage, quota)
  const page = await mountAnalytics({ routeState: { by: 'quota_week', period } })
  const week = accountNamed(page, 'Work').get('.quota-window[data-window="week"]')
  return { reads, page, week, line: week.get('[data-chart="steps"]') }
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

describe('a quota window’s step line over the page’s period', () => {
  it('over «4 weeks» holds every week the period overlaps, falling to nothing at each reset', async () => {
    const { reads, week, line } = await weekLine('weeks4')
    // The read asks from the period's start: midnight 27 days before today.
    expect(reads.quotaAsked.at(-1)?.get('from')).toBe(new Date(2026, 9, 15).toISOString())
    // The line runs 35 days, the five weeks it holds, so a week is 60 of its 300 across. The
    // weeks before the current one: each from its start, falling to the floor at its reset.
    const earlier = corners(line.get('[data-mark="earlier"]').attributes('d'))
    for (const reset of [60, 120, 180, 240])
      expect(earlier, `the fall at ${reset}`).toContainEqual([reset, 100])
    // It starts at the first reading of the first week, a day into it at 6 %.
    expect(earlier[0]).toEqual([8.57, 94])
    // A restart inside the second week, from 30 % down to 12 %, stays a restart, no fall to nothing.
    expect(earlier).toContainEqual(
      [60 + (4 / 7) * 60, 88].map((one) => Math.round(one * 100) / 100),
    )
    // The current week from nothing at its start, 240 across, to 41 % at now, 4 days in.
    const current = corners(line.get('[data-mark="line"]').attributes('d'))
    expect(current[0]).toEqual([240, 100])
    expect(current.at(-1)).toEqual(
      [240 + (4 / 7) * 60, 59].map((one) => Math.round(one * 100) / 100),
    )
    // The four falls are places of the line, and so is the restart inside the second week.
    expect(line.findAll('[data-target="restart"][data-drop]')).toHaveLength(4)
    expect(line.findAll('[data-target="restart"]')).toHaveLength(5)
    // The readings of the weeks before in the neutral ink, the current week's in its hue.
    const marks = line.findAll('[data-mark="reading"]')
    expect(marks).toHaveLength(13 + 4)
    expect(marks.map((mark) => mark.classes().includes('step-earlier'))).toEqual([
      ...Array.from({ length: 13 }, () => true),
      ...Array.from({ length: 4 }, () => false),
    ])
    // The legend names the weeks before beside the readings; the current week keeps its pace, its
    // forecast and now, each over the current week alone.
    expect(line.get('[data-key="earlier"]').text()).toBe('Earlier windows')
    for (const key of ['ahead', 'even', 'now'])
      expect(line.find(`[data-key="${key}"]`).exists(), key).toBe(true)
    const even = line.get('[data-mark="even"]')
    expect([Number(even.attributes('x1')), Number(even.attributes('x2'))]).toEqual([240, 300])
    // The axis names the first week's start and the current week's reset, both dated.
    expect(
      line.findAll('[data-region="axis"] [data-moment]').map((one) => plain(one.text())),
    ).toEqual(['start Oct 10, 14:30', 'resets Nov 14, 14:30'])
    // The bar and the figures over the line stay the current week's.
    expect(plain(week.get('.quota-window-lead').text())).toMatch(/^41% used/u)
    // Its words for a screen reader say the weeks before, the last of them run out.
    const label = line.attributes('aria-label') ?? ''
    expect(label).toMatch(/Before it: .+, 27%; .+, 44%; .+, 71%; .+, 100%, ran out\.$/u)
  })

  it('over «4 weeks» says each week before in its table, and each reset between them', async () => {
    const { page } = await weekLine('weeks4')
    await showTable(page)
    const rows = accountNamed(page, 'Work')
      .get('.quota-window[data-window="week"] .quota-window-readings')
      .findAll('tbody tr')
    // Every reading of the five weeks, the restart inside the second, a reset ending each week
    // before the current one, which says what it ended at, and the forecast.
    expect(rows).toHaveLength(13 + 4 + 1 + 4 + 1)
    const resets = rows.filter((row) => row.attributes('data-key')?.endsWith('-reset'))
    expect(
      resets.map((row) => plain(row.text()).replace(/^.+?Window reset/u, 'Window reset')),
    ).toEqual(
      [27, 44, 71, 100].map(
        (share) => `Window reset; The window ended at ${share}%; the next one starts from zero`,
      ),
    )
  })

  it('over «This week» holds the current week alone, whole, as it did on no period', async () => {
    const { reads, line, week } = await weekLine('week')
    // Monday's midnight: the weeks before reset before it, so the line holds none of them.
    expect(reads.quotaAsked.at(-1)?.get('from')).toBe(new Date(2026, 10, 9).toISOString())
    expect(line.find('[data-mark="earlier"]').exists()).toBe(false)
    expect(line.find('[data-key="earlier"]').exists()).toBe(false)
    expect(line.find('[data-target="restart"][data-drop]').exists()).toBe(false)
    expect(line.find('.step-earlier').exists()).toBe(false)
    // From its start at the plot's left to its reset at its right: its first reading half a day
    // in at 8 %, now 4 days of 7 in.
    const current = corners(line.get('[data-mark="line"]').attributes('d'))
    expect(current[0]).toEqual([21.43, 92])
    expect(Number(line.get('[data-mark="now"]').attributes('x1'))).toBeCloseTo((4 / 7) * 300, 1)
    expect(
      line.findAll('[data-region="axis"] [data-moment]').map((one) => plain(one.text())),
    ).toEqual(['start Nov 7, 14:30', 'resets Nov 14, 14:30'])
    // The line under the card names the week before, which the line does not hold.
    expect(plain(week.get('[data-past="line"]').text())).toMatch(
      /^Previous window: until .+, ran out$/u,
    )
  })
})
