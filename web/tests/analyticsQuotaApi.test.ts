/**
 * The quota read of the Analytics page, against the contract's own rules rather than the reader:
 * it asks at the caller's offset and nothing else, takes an answer of every state a window has,
 * and refuses what the contract says no answer holds — a field nobody declared, a percent or a
 * forecast on a window of money, a point forecast for a week, a sum across accounts, an account
 * with no source that still has windows, an account whose id does not say its own fields. How the
 * window before a window ended is its own object or an explicit `null`, never missing; one past
 * window is asked by the account, the window and the moment it reset by, and nothing else. Over a
 * period the read asks from its start, and each window may hold the windows before it the period
 * overlaps, each whole, its restarts at its own readings.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

import { fetchQuota, fetchQuotaWindow, validateQuotaAnswer } from '@/shared/api/analyticsApi.ts'
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

/** The answer with «Work»'s five hours holding `earlier`, the windows before it over a period. */
const over = (earlier: unknown) => withWindow(0, 0, (window) => ({ ...window, earlier }))

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
    expect(seated).toMatchObject({
      account: `${seated?.organization}/weekly:7T09:00Z`,
      account_uuid: null,
      weekly_reset: '7T09:00Z',
    })
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
    // The control: a window that lasts, with the share it spends by the reset.
    expect(() =>
      validateQuotaAnswer(withWindow(1, 0, (window) => ({ ...window, forecast: lasts }))),
    ).not.toThrow()
    for (const forecast of [
      { ...lasts, at_reset_percent: null },
      { ...lasts, at_reset_percent: 100.5 },
      { ...lasts, outcome: 'spent' },
    ])
      expect(() =>
        validateQuotaAnswer(withWindow(1, 0, (window) => ({ ...window, forecast }))),
      ).toThrow(/windows\[0\]/u)
  })

  it('takes a restart at a reading’s moment, and refuses one at no reading’s or none', () => {
    const restartAt = (moment: string) =>
      withWindow(0, 0, (window) => ({ ...window, restarts: [moment] }))
    const reading = quotaAt(NOW, 180).accounts[0]?.windows[0]
    const middle = reading && 'readings' in reading ? reading.readings[1]?.at : undefined
    if (!middle) throw new Error('a window of three readings')
    expect(validateQuotaAnswer(restartAt(middle)).accounts[0]?.windows[0]).toMatchObject({
      restarts: [middle],
    })
    expect(() => validateQuotaAnswer(restartAt('2026-11-11T12:00:00.000+03:00'))).toThrow(
      'a restart is the moment of one of the readings',
    )
    const none = withWindow(0, 0, (window) => ({ ...window, restarts: undefined }))
    expect(() => validateQuotaAnswer(none)).toThrow(/accounts\[0\]\.windows\[0\]/u)
  })

  it('refuses an account with no source that has windows, and an id its fields do not fit', () => {
    const quota = quotaAt(NOW, 180)
    const [work, night, unread, seated] = quota.accounts
    if (!work || !night || !unread || !seated) throw new Error('four accounts')
    const read = (accounts: unknown[]) =>
      validateQuotaAnswer(quotaAnswer({ ...quota, accounts } as Quota))
    expect(() => read([work, night, { ...unread, windows: night.windows }, seated])).toThrow(
      /accounts\[2\]\.windows: no source reads no window/u,
    )
    // A UUID beside a weekly id, another organization's id, a UUID on work no account holds.
    expect(() => read([work, night, unread, { ...seated, account_uuid: 'acct-x' }])).toThrow(
      /accounts\[3\]\.account: a weekly account has its weekly reset and no UUID/u,
    )
    expect(() => read([{ ...work, account: 'org-other/acct-x' }, night, unread, seated])).toThrow(
      /accounts\[0\]\.account: an account id starts with its organization/u,
    )
    expect(() => read([work, night, { ...unread, account_uuid: 'acct-x' }, seated])).toThrow(
      /accounts\[2\]\.account/u,
    )
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

  it('takes how the window before ended, or an explicit none, and refuses it missing', () => {
    const ended = {
      started_at: '2026-11-11T05:00:00.000+03:00',
      resets_at: '2026-11-11T10:00:00.000+03:00',
      latest: { at: '2026-11-11T09:40:00.000+03:00', used_percent: 100, source: 'poll' },
      ran_out: true,
    }
    expect(
      validateQuotaAnswer(withWindow(0, 0, (window) => ({ ...window, previous: ended })))
        .accounts[0]?.windows[0],
    ).toMatchObject({ previous: { ran_out: true, latest: { used_percent: 100 } } })
    expect(
      validateQuotaAnswer(quotaAnswer(quotaAt(NOW, 180))).accounts[0]?.windows[0],
    ).toMatchObject({ previous: null })
    const missing = withWindow(0, 0, (window) => ({ ...window, previous: undefined }))
    expect(() => validateQuotaAnswer(missing)).toThrow(/accounts\[0\]\.windows\[0\]/u)
    const unknown = withWindow(0, 0, (window) => ({ ...window, previous: { ...ended, total: 1 } }))
    expect(() => validateQuotaAnswer(unknown)).toThrow(/previous\.total: unknown field/u)
    const noRetention = Object.fromEntries(
      Object.entries(quotaAt(NOW, 180)).filter(([key]) => key !== 'retained_from'),
    )
    expect(() => validateQuotaAnswer(quotaAnswer(noRetention as Quota))).toThrow(
      /quota\.retained_from/u,
    )
  })

  it('asks over a period from its start, and the plain read without one', async () => {
    const fetchMock = answer(quotaAnswer(quotaAt(NOW, 180)))
    await fetchQuota(180, undefined, '2026-10-14T21:00:00.000Z')
    const url = new URL(requestUrl(fetchMock.mock.calls.at(-1)?.[0] ?? ''), 'https://example.test')
    expect(Object.fromEntries(url.searchParams)).toEqual({
      utc_offset: '180',
      from: '2026-10-14T21:00:00.000Z',
    })
    await fetchQuota(180)
    const plain = new URL(
      requestUrl(fetchMock.mock.calls.at(-1)?.[0] ?? ''),
      'https://example.test',
    )
    expect(Object.fromEntries(plain.searchParams)).toEqual({ utc_offset: '180' })
  })

  it('takes the windows before a window over a period, each whole, and refuses a field or restart they do not hold', () => {
    const before = {
      started_at: '2026-11-11T00:00:00.000+03:00',
      resets_at: '2026-11-11T05:00:00.000+03:00',
      readings: [
        { at: '2026-11-11T01:00:00.000+03:00', used_percent: 40, source: 'poll' },
        { at: '2026-11-11T03:00:00.000+03:00', used_percent: 10, source: 'poll' },
      ],
      restarts: ['2026-11-11T03:00:00.000+03:00'],
    }
    expect(validateQuotaAnswer(over([before])).accounts[0]?.windows[0]).toMatchObject({
      earlier: [{ resets_at: before.resets_at, restarts: before.restarts }],
    })
    expect(validateQuotaAnswer(over([])).accounts[0]?.windows[0]).toMatchObject({ earlier: [] })
    expect(() => validateQuotaAnswer(over([{ ...before, latest: before.readings[1] }]))).toThrow(
      /earlier\[0\]\.latest: unknown field/u,
    )
    expect(() =>
      validateQuotaAnswer(over([{ ...before, restarts: ['2026-11-11T02:00:00.000+03:00'] }])),
    ).toThrow('a restart is the moment of one of the readings')
    // A window before the current one always ran to its reset: one with none fits no window.
    expect(() => validateQuotaAnswer(over([{ ...before, resets_at: null }]))).toThrow(
      /accounts\[0\]\.windows\[0\]: unknown value/u,
    )
    expect(() => validateQuotaAnswer(over([before]))).not.toThrow()
  })
})

describe('one past quota window', () => {
  const asked = {
    account: 'org-a/acct-a',
    kind: 'week_model' as const,
    model: 'model-a',
    before: '2026-11-11T05:00:00.000+03:00',
    utcOffset: 180,
  }
  const pastAnswer = (window: unknown) => ({
    interface_version: 'valkama-analytics-api',
    quota_window: {
      now: '2026-11-11T08:30:00.000Z',
      utc_offset: 180,
      fresh_for_seconds: 900,
      retained_from: '2025-11-11T11:30:00.000+03:00',
      account: asked.account,
      kind: asked.kind,
      model: asked.model,
      before: asked.before,
      window,
    },
  })

  it('asks by the account, the window, its model and the moment, at the caller’s offset', async () => {
    const fetchMock = answer(pastAnswer(null))
    const found = await fetchQuotaWindow(asked)
    const url = new URL(requestUrl(fetchMock.mock.calls.at(-1)?.[0] ?? ''), 'https://example.test')
    expect(url.pathname).toBe('/api/analytics/quota/window')
    expect(Object.fromEntries(url.searchParams)).toEqual({
      account: 'org-a/acct-a',
      kind: 'week_model',
      model: 'model-a',
      before: '2026-11-11T05:00:00.000+03:00',
      utc_offset: '180',
    })
    expect(found.window).toBeNull()
    // A window of no model names none.
    const week = answer(pastAnswer(null))
    await fetchQuotaWindow({ ...asked, kind: 'week', model: null })
    const weekUrl = new URL(requestUrl(week.mock.calls.at(-1)?.[0] ?? ''), 'https://example.test')
    expect(weekUrl.searchParams.has('model')).toBe(false)
  })

  it('takes a past window as a current one is given, and refuses a field nobody declared', async () => {
    const week = quotaAt(NOW, 180).accounts[0]?.windows[1]
    answer(pastAnswer({ ...week, even_percent: null, forecast: null }))
    const found = await fetchQuotaWindow(asked)
    expect(found.window).toMatchObject({ kind: 'week', forecast: null })
    answer(pastAnswer({ ...week, total_percent: 3 }))
    await expect(fetchQuotaWindow(asked)).rejects.toThrow(
      /analytics\.quotaWindow\.quota_window\.window\.total_percent: unknown field/u,
    )
    answer({ error: { code: 'invalid_request', message: 'kind' } }, 400)
    await expect(fetchQuotaWindow(asked)).rejects.toThrow(
      /\/api\/analytics\/quota\/window: HTTP 400/u,
    )
  })
})
