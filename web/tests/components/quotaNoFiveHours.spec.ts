/**
 * The five hours' tile and section when the account in use reports no five-hour window, held to
 * DESIGN.md § Analytics: a source sends a five-hour window only for a plan that has one. Where no
 * account's five hours stand, and the account of the answer's newest reading, of any window, has
 * week readings in its current week and no five-hour reading since that week started, the tile
 * names that account with «no window» beside the section's name, and the section says the current
 * account has no five-hour window over its accounts. «Reset since read» there read as a failure of the read.
 *
 * Otherwise nothing changes: where the account in use has five hours that stand, the tile names
 * them; where its own five hours reset inside its week, the tile says they reset, and the window
 * says so in its own words. Every id and figure is made up: the first two accounts of `quotaAt`,
 * «Work» read last and the unnamed account's five hours reset half an hour ago.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Quota, QuotaAccount, QuotaShareWindow } from '@/shared/api/analyticsApi.ts'

import { serveUsage } from '../fixtures/analytics.ts'
import { quotaAnswer, quotaAt, share } from '../fixtures/quota.ts'
import { mountAnalytics, stubAnalyticsReads } from '../support/analyticsReads.ts'
import { says } from '../support/quotaPanel.ts'

const NOW = new Date(2026, 10, 11, 14, 30)
const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

const usage = (query: URLSearchParams) => serveUsage([], query)
const window = (shape: Parameters<typeof share>[2]) =>
  share(NOW.getTime(), -NOW.getTimezoneOffset(), shape)

/** A week that started four days ago, last read `ago` ms before the answer. */
const week = (ago: number) =>
  window({
    kind: 'week',
    left: 3 * DAY,
    source: 'mod',
    readings: [[ago, 30]],
    forecast: { low_percent: 40, high_percent: 45 },
  })

/** Five hours last read `ago` ms before the answer, resetting `left` ms after it. */
const fiveHours = (ago: number, left: number) =>
  window({
    kind: 'five_hour',
    left,
    source: 'mod',
    readings: [[ago, 40]],
    forecast: null,
  })

/**
 * «Work» read last, two minutes before the answer, with `work` as its windows; the unnamed account
 * read an hour before, its five hours reset half an hour ago.
 */
function quotaWith(work: QuotaShareWindow[]): Quota {
  const quota = quotaAt(NOW)
  const [first, second] = quota.accounts
  if (!first || !second) throw new Error('«Work» first, the unnamed account second')
  const night: QuotaAccount = {
    ...second,
    windows: [fiveHours(3 * HOUR, -30 * MINUTE), week(HOUR)],
  }
  return { ...quota, accounts: [{ ...first, windows: work }, night] }
}

async function open(quota: Quota, by?: string) {
  stubAnalyticsReads(usage, () => quotaAnswer(quota))
  return mountAnalytics(by ? { routeState: { by } } : {})
}

const NOTE = '[data-note="no-five-hours"]'

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: NOW })
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

describe('the five hours of an account in use with no five-hour window', () => {
  it('say on the tile and over the section that the current account has none', async () => {
    const quota = quotaWith([week(2 * MINUTE)])
    const page = await open(quota)
    expect(says(page, 'quota_five_hour')).toEqual({ lead: 'Work', aside: '', count: 'no window' })
    // The week is not touched: it names the window nearest its limit as before.
    expect(says(page, 'quota_week').lead).not.toContain('five-hour')
    page.unmount()

    const panel = await open(quota, 'quota_five_hour')
    const note = panel.findAll(NOTE)
    expect(note).toHaveLength(1)
    expect(note[0]?.text()).toBe(
      'The current account, Work, has no five-hour window: this week it sends week readings only.',
    )
    // Said before the accounts, at the section's top.
    const first = panel.get('.quota-account').element
    expect(note[0]?.element.compareDocumentPosition(first)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    panel.unmount()

    // The week's section says nothing of it.
    const weekPanel = await open(quota, 'quota_week')
    expect(weekPanel.findAll(NOTE)).toHaveLength(0)
  })

  it('name the five hours of the account in use where they stand, as before', async () => {
    const quota = quotaWith([fiveHours(2 * MINUTE, 2 * HOUR), week(2 * MINUTE)])
    const page = await open(quota)
    expect(says(page, 'quota_five_hour')).toMatchObject({ lead: 'Work', aside: '40%' })
    page.unmount()
    const panel = await open(quota, 'quota_five_hour')
    expect(panel.findAll(NOTE)).toHaveLength(0)
  })

  it('say the five hours reset where the account in use had five hours this week', async () => {
    // «Work» read its five hours an hour ago, inside its week; they reset ten minutes ago.
    const quota = quotaWith([fiveHours(HOUR, -10 * MINUTE), week(2 * MINUTE)])
    const page = await open(quota)
    expect(says(page, 'quota_five_hour').lead).toBe('Reset since read')
    page.unmount()
    const panel = await open(quota, 'quota_five_hour')
    expect(panel.findAll(NOTE)).toHaveLength(0)
    expect(panel.find('[data-lead="ended"]').exists()).toBe(true)
  })

  it('say the current account has none where its last five hours were read before its week began', async () => {
    // Five hours read five days ago, before the week that started four days ago.
    const quota = quotaWith([fiveHours(5 * DAY, -5 * DAY + 5 * HOUR), week(2 * MINUTE)])
    const page = await open(quota)
    expect(says(page, 'quota_five_hour')).toEqual({ lead: 'Work', aside: '', count: 'no window' })
  })
})
