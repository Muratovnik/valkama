/**
 * The quota read of the Analytics page, against the contract's own rules rather than the reader:
 * it asks at the caller's offset and nothing else, takes an answer of every state a window has,
 * and refuses what the contract says no answer holds — a field nobody declared, a percent or a
 * forecast on a window of money, a point forecast for a week, a sum across accounts, an account
 * with no source that still has windows, a provisional seat beside an account's UUID.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

import { fetchQuota, validateQuotaAnswer } from '@/shared/api/analyticsApi.ts'
import type { Quota } from '@/shared/api/analyticsApi.ts'
import { uiDegraded } from '@/shared/api/platformUiState.ts'

import { quotaAnswer, quotaAt } from './fixtures/quota.ts'
import { requestUrl, withSecurityBootstrap } from './support/request.ts'

const NOW = new Date(Date.UTC(2026, 10, 11, 11, 30))

function answer(payload: unknown, status = 200) {
  const fetchMock = vi
    .fn<typeof fetch>()
    .mockImplementation(
      withSecurityBootstrap(async () => new Response(JSON.stringify(payload), { status })),
    )
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

afterEach(() => vi.unstubAllGlobals())

/** The answer with one account's one window replaced by `change` of it. */
function withWindow(account: number, window: number, change: (value: object) => object) {
  const quota = structuredClone(quotaAt(NOW, 180))
  const accounts = quota.accounts.map((one, index) =>
    index === account
      ? {
          ...one,
          windows: one.windows.map((found, at) => (at === window ? change(found) : found)),
        }
      : one,
  )
  return quotaAnswer({ ...quota, accounts } as Quota)
}

describe('the quota read', () => {
  it('asks for every account at the caller’s offset, and nothing else', async () => {
    const fetchMock = answer(quotaAnswer(quotaAt(NOW, 180)))
    const quota = await fetchQuota(180)
    const url = new URL(requestUrl(fetchMock.mock.calls.at(-1)?.[0] ?? ''), 'https://example.test')
    expect(url.pathname).toBe('/api/analytics/quota')
    expect(Object.fromEntries(url.searchParams)).toEqual({ utc_offset: '180' })
    expect(quota.accounts.map((account) => account.no_source)).toEqual([false, false, true, false])
  })

  it('takes a fresh zero, a silent window, no source and a seat as the values they are', () => {
    const quota = validateQuotaAnswer(quotaAnswer(quotaAt(NOW, 180)))
    const [work, night, unread, seated] = quota.accounts
    expect(night?.windows[0]).toMatchObject({ state: 'fresh', latest: { used_percent: 0 } })
    expect(night?.windows[1]).toMatchObject({ state: 'silent', latest: { used_percent: 88 } })
    expect(unread).toMatchObject({ no_source: true, windows: [] })
    expect(seated).toMatchObject({ account_uuid: null, seat: 'week:2026-11-15T09:00Z' })
    expect(work?.windows.map((window) => window.kind)).toEqual([
      'five_hour',
      'week',
      'week_model',
      'extra_usage',
    ])
  })

  it('refuses an answer under another interface, or with a field it does not know', async () => {
    answer({ quota: quotaAt(NOW, 180) })
    await expect(fetchQuota(180)).rejects.toThrow(/interface_version/u)
    answer(quotaAnswer({ ...quotaAt(NOW, 180), total_percent: 150 } as Quota))
    await expect(fetchQuota(180)).rejects.toThrow(
      /analytics\.quota\.quota\.total_percent: unknown field/u,
    )
  })

  it('refuses a percent or a forecast on a window of money', () => {
    expect(() =>
      validateQuotaAnswer(
        withWindow(0, 3, (window) => ({
          ...window,
          latest: { ...(window as { latest: object }).latest, used_percent: 3 },
        })),
      ),
    ).toThrow(/analytics\.quota\.quota\.accounts\[0\]\.windows\[3\]/u)
    expect(() =>
      validateQuotaAnswer(withWindow(0, 3, (window) => ({ ...window, amount: 4 }))),
    ).toThrow(/windows\[3\]/u)
  })

  it('refuses a point forecast for a week and a range for the five hours', () => {
    const point = {
      outcome: 'runs_out',
      runs_out_at: '2026-11-11T15:00:00+03:00',
      at_reset_percent: null,
      basis: 'blend',
    }
    expect(() =>
      validateQuotaAnswer(withWindow(0, 1, (window) => ({ ...window, forecast: point }))),
    ).toThrow(/windows\[1\]/u)
    expect(() =>
      validateQuotaAnswer(
        withWindow(0, 0, (window) => ({
          ...window,
          forecast: { low_percent: 70, high_percent: 80 },
        })),
      ),
    ).toThrow(/windows\[0\]/u)
  })

  it('refuses a time to run out at beside a window that lasts', () => {
    const lasts = {
      outcome: 'lasts',
      runs_out_at: '2026-11-11T15:00:00+03:00',
      at_reset_percent: 35,
      basis: 'window',
    }
    expect(() =>
      validateQuotaAnswer(withWindow(1, 0, (window) => ({ ...window, forecast: lasts }))),
    ).toThrow(/windows\[0\]/u)
  })

  it('takes a share at the reset where the five hours last, and nowhere else', () => {
    const lasts = { outcome: 'lasts', runs_out_at: null, at_reset_percent: 35, basis: 'window' }
    const withForecast = (forecast: object) =>
      withWindow(1, 0, (window) => ({ ...window, forecast }))
    // The control: a window that lasts, with the share it spends by the reset.
    expect(() => validateQuotaAnswer(withForecast(lasts))).not.toThrow()
    for (const forecast of [
      { ...lasts, at_reset_percent: null },
      { ...lasts, at_reset_percent: 100.5 },
      { ...lasts, outcome: 'spent' },
    ])
      expect(() => validateQuotaAnswer(withForecast(forecast))).toThrow(/windows\[0\]/u)
  })

  it('refuses an account with no source that has windows, and a seat beside a UUID', () => {
    const quota = quotaAt(NOW, 180)
    const [work, night, unread, seated] = quota.accounts
    if (!work || !night || !unread || !seated) throw new Error('four accounts')
    const read = (accounts: unknown[]) =>
      validateQuotaAnswer(quotaAnswer({ ...quota, accounts } as Quota))
    expect(() => read([work, night, { ...unread, windows: night.windows }, seated])).toThrow(
      /accounts\[2\]\.windows: no source reads no window/u,
    )
    expect(() =>
      read([{ ...work, seat: 'week:2026-11-15T09:00Z' }, night, unread, seated]),
    ).toThrow(/accounts\[0\]\.seat/u)
  })

  it('gives the moment the page state takes the one form that state checks', async () => {
    const payload = quotaAnswer({ ...quotaAt(NOW, 0), now: '2026-11-11T11:30:00.629+00:00' })
    answer(payload)
    const quota = await fetchQuota(0)
    expect(() => uiDegraded(quota, quota.now)).not.toThrow()
    expect(uiDegraded(quota, quota.now)).toMatchObject({
      status: 'degraded',
      observed_at: '2026-11-11T11:30:00.629Z',
    })
  })

  it('refuses a moment that names no time', () => {
    expect(() =>
      validateQuotaAnswer(quotaAnswer({ ...quotaAt(NOW, 0), now: '2026-13-45T99:99:00+00:00' })),
    ).toThrow(/analytics\.quota\.quota\.now/u)
  })

  it('says what failed when the read is refused', async () => {
    answer({ error: { code: 'invalid_request', message: 'utc_offset' } }, 400)
    await expect(fetchQuota(9999)).rejects.toThrow(/\/api\/analytics\/quota: HTTP 400/u)
  })
})
