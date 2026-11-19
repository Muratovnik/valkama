/**
 * The row of a quota window past its reset in its account's table, held to DESIGN.md § Analytics:
 * where the share stood it says that the window reset and has no reading since, the share before
 * the reset under that in the quiet ink, and a dash for its pace and its forecast; the window says
 * no reset under the table. Its old share alone once led the row, and its forecast's cell said the
 * reset again as a forecast. A window still standing keeps its share, its pace and its forecast.
 *
 * «Work» is read five hours before the answer, so its five hours, last read at 62 %, reset since;
 * the other accounts of `quotaAt` are read at the answer, the fourth one's five hours at 74 %.
 */
import type { DOMWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { serveUsage } from '../fixtures/analytics.ts'
import { quotaAnswer, quotaAt } from '../fixtures/quota.ts'
import { mountAnalytics, stubAnalyticsReads } from '../support/analyticsReads.ts'
import { accountNamed, plain, showTable } from '../support/quotaPanel.ts'

const NOW = new Date(2026, 10, 11, 14, 30)
const HOUR = 3_600_000

const usage = (query: URLSearchParams) => serveUsage([], query)

/** The answer with «Work»'s windows as read five hours before it. */
function workReadEarlier() {
  const late = quotaAt(NOW.getTime() - 5 * HOUR)
  const quota = quotaAt(NOW)
  const [work] = late.accounts
  if (!work) throw new Error('«Work» first')
  return quotaAnswer({
    ...quota,
    accounts: quota.accounts.map((one, index) => (index === 0 ? work : one)),
  })
}

/** A row's cells after its name: the share, the pace, the state and the forecast. */
const cellsOf = (row: Pick<DOMWrapper<Element>, 'findAll'>) =>
  row.findAll('td').map((one) => plain(one.text()))

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: NOW })
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

describe('an ended window in its account’s table', () => {
  it('leads its row with the reset, the share before it under that, and forecasts nothing', async () => {
    stubAnalyticsReads(usage, workReadEarlier)
    const page = await mountAnalytics({ routeState: { by: 'quota_five_hour' } })
    await showTable(page)
    const work = accountNamed(page, 'Work')
    const row = work.get('.quota-account-table tbody tr')
    // Its state is the reading's, as any window's: how long it has had no data.
    const [lead, pace, , forecast] = cellsOf(row)
    expect(lead).toMatch(/^Reset at \d{2}:\d{2}, no new readings, before the reset: 62%$/u)
    expect(row.get('[data-cell="value"] .chart-detail').text()).toBe('before the reset: 62%')
    expect([pace, forecast]).toEqual(['—', '—'])
    expect(work.find('[data-fact="reset"]').exists()).toBe(false)

    // The control: the fourth account's five hours stand, their share alone and a forecast.
    const standing = page
      .findAll('.quota-account-table tbody tr')
      .find((one) => cellsOf(one)[0] === '74%')
    if (!standing) throw new Error('the standing 74 % row')
    expect(standing.find('.chart-detail').exists()).toBe(false)
    expect(cellsOf(standing)[1]).toMatch(/^\d+%$/u)
    expect(cellsOf(standing)[3]).toMatch(/^Limit runs out at \d{2}:\d{2}$/u)
    // Every window but «Work»'s still says its reset under the table.
    expect(page.findAll('[data-fact="reset"]')).toHaveLength(
      page.findAll('.quota-window[data-window="five_hour"]').length - 1,
    )
  })
})
