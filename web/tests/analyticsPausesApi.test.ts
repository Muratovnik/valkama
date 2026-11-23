/**
 * The pauses read of the Analytics page, against the contract `docs/guides/commands.md` states for
 * `valkama usage pauses --json`: it asks for its period and the caller's offset and nothing else,
 * takes an answer with a wait no request followed and a client whose background work is not
 * known, and refuses what no answer holds — a field nobody declared, another interface, a share
 * past the whole, a wait or a role the contract does not name, and a refusal of the read itself.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

import { fetchPauses, validatePausesAnswer } from '@/shared/api/analyticsPausesApi.ts'

import { PAUSES, pausesAnswer, pausesOf, row } from './fixtures/pauses.ts'
import { requestUrl, withSecurityBootstrap } from './support/request.ts'

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

const QUERY = { from: '2026-11-04T00:00', to: '2026-11-11T15:00', utcOffset: 180 }

describe('the pauses read', () => {
  it('asks for its period at the caller’s offset, and nothing else', async () => {
    const fetchMock = answer(pausesAnswer(PAUSES))
    const pauses = await fetchPauses(QUERY)
    const url = new URL(requestUrl(fetchMock.mock.calls.at(-1)?.[0] ?? ''), 'https://example.test')
    expect(url.pathname).toBe('/api/analytics/pauses')
    expect(Object.fromEntries(url.searchParams)).toEqual({
      from: '2026-11-04T00:00',
      to: '2026-11-11T15:00',
      utc_offset: '180',
    })
    expect(pauses.rows.map((one) => one.client)).toEqual(['claude', 'claude', 'codex', 'claude'])
  })

  it('takes a client whose background work is not known and an answer with no row', () => {
    const codex = validatePausesAnswer(pausesAnswer(PAUSES)).rows[2]
    expect([codex.background_known, codex.background_requests]).toEqual([false, null])
    expect(validatePausesAnswer(pausesAnswer(pausesOf([]))).rows).toEqual([])
  })

  it('refuses what the contract says no answer holds', () => {
    const one = row({ bucket: '0-4m', requests: 1, context: 10, read: 5 })
    const refused = [
      { ...pausesAnswer(PAUSES), extra: 1 },
      { ...pausesAnswer(PAUSES), interface_version: 'valkama-usage-api' },
      pausesAnswer({ ...PAUSES, interface_version: 'valkama-usage' } as never),
      pausesAnswer(pausesOf([{ ...one, read_share: 1.5 }])),
      pausesAnswer(pausesOf([{ ...one, wait: 'idle' } as never])),
      pausesAnswer(pausesOf([{ ...one, role: 'agent' } as never])),
      pausesAnswer(pausesOf([{ ...one, undeclared: 0 } as never])),
      pausesAnswer({ ...PAUSES, from: '2026-11-04T00:00:00+03:00' }),
    ]
    for (const payload of refused) expect(() => validatePausesAnswer(payload)).toThrow()
  })

  it('fails on a refusal of the read', async () => {
    answer({}, 503)
    await expect(fetchPauses(QUERY)).rejects.toThrow('HTTP 503')
  })
})
