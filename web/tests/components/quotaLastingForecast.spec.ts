/**
 * Five hours that last to their reset draw the share they will have spent by then, as five hours
 * that run out and a week's range do (DESIGN.md, `WindowBar` and the quota's sections): a hatched
 * tail on the bar and the tile from the share spent to the share the answer names at the reset, a
 * corridor on the step line to it, and the forecast's line, words with no swatch, that say that
 * share. The figures are `quotaAt`'s: 7e6d5c4b's five hours stand at a fresh 0 % four hours before
 * their reset and last to it with 35 % spent by then.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { forecastCourses, sectionWindows } from '@/pages/analytics/utils/quotaFigures.ts'

import { serveUsage } from '../fixtures/analytics.ts'
import { quotaAnswer, quotaAt } from '../fixtures/quota.ts'
import { mountAnalytics, stubAnalyticsReads } from '../support/analyticsReads.ts'
import { accountNamed, plain, showTable, tile } from '../support/quotaPanel.ts'

/** The moment the page's reads are asked at, and the answer's. */
const NOW = new Date(2026, 10, 11, 14, 30)
const HOUR = 3_600_000

/** The quota with the account whose five hours last alone, and no work. */
const serveNight = () =>
  stubAnalyticsReads(
    (query) => serveUsage([], query),
    () => {
      const quota = quotaAt(NOW)
      return quotaAnswer({ ...quota, accounts: quota.accounts.slice(1, 2) })
    },
  )

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: NOW })
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

describe('five hours that last to the reset', () => {
  it('run their forecast straight from the share spent to the share named at the reset', () => {
    const night = quotaAt(NOW).accounts[1]
    if (!night) throw new Error('the second account')
    const found = sectionWindows(night, 'quota_five_hour')
    expect(found).toHaveLength(1)
    const [five] = found
    if (!five) throw new Error('its five hours')
    const course = [
      { at: NOW.getTime(), value: 0 },
      { at: NOW.getTime() + 4 * HOUR, value: 35 },
    ]
    expect(forecastCourses(five, NOW.getTime())).toEqual({ high: course, low: course })
  })

  it('draw a keyed tail to that share on the tile and in the panel, and say it in both languages', async () => {
    serveNight()
    const page = await mountAnalytics({ routeState: { by: 'quota_five_hour' } })
    // The tile names the one five hours there are, its tail from the track's start to 35 %.
    const tileTail = tile(page, 'quota_five_hour').findAll('[data-mark="ahead"]')
    expect(tileTail).toHaveLength(1)
    expect(tileTail[0]?.attributes('style')).toContain('inline-size: 35%')
    expect(tile(page, 'quota_five_hour').get('.window-track').attributes('aria-label')).toBe(
      'Five hours: 0% used, steady use since the window started would be at 20% now, up to date. Forecast · By the reset: 35%',
    )
    const window = accountNamed(page, '7e6d5c4b').get('.quota-window[data-window="five_hour"]')
    const tail = window.findAll('[data-mark="ahead"]')
    expect(tail).toHaveLength(1)
    expect(tail[0]?.attributes('style')).toContain('inline-size: 35%')
    // The line is its words alone: no swatch stands before «Forecast».
    expect(window.find('[data-fact="forecast"] [data-mark="hatch"]').exists()).toBe(false)
    expect(plain(window.get('[data-fact="forecast"]').text())).toBe('Forecast · By the reset: 35%')
    // As a table the readings end with the forecast at the reset: the figure says it all.
    await showTable(page)
    const rows = accountNamed(page, '7e6d5c4b')
      .findAll('.quota-window-readings tbody tr')
      .map((row) => plain(row.text()))
    expect(rows).toHaveLength(2)
    expect(rows[1]).toMatch(/^Forecast by the reset35%Resets /u)
    page.unmount()

    serveNight()
    const ru = await mountAnalytics({ routeState: { by: 'quota_five_hour' } }, 'ru')
    const said = accountNamed(ru, '7e6d5c4b').get(
      '.quota-window[data-window="five_hour"] [data-fact="forecast"]',
    )
    expect(plain(said.text())).toBe('Прогноз · К сбросу: 35 %')
  })
})
