/**
 * The usage reads on the wire: the path the server's prefix answers, the strictness of every
 * planning contract, and a kind nobody reported staying null rather than becoming a zero.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

import { fetchItemUsage, fetchSessionUsage } from '@/shared/api/planningUsageApi.ts'

import { noUsage, richUsage, sessionUsage, usageAnswer } from './fixtures/usage.ts'
import { withSecurityBootstrap } from './support/request.ts'

afterEach(() => vi.unstubAllGlobals())

function serve(payload: unknown, status = 200) {
  const asked: URL[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>().mockImplementation(
      withSecurityBootstrap(async (input) => {
        asked.push(new URL(String(input), 'http://127.0.0.1'))
        return new Response(JSON.stringify(payload), { status })
      }),
    ),
  )
  return asked
}

describe('an item’s usage', () => {
  it('is read on the planning prefix, by the item and the scope, with no data scope', async () => {
    const asked = serve(usageAnswer(richUsage({ scope: 'epic' })))
    const usage = await fetchItemUsage('MAIN-12', 'epic')
    expect(asked.map((url) => url.pathname)).toEqual(['/api/planning/work-item/usage'])
    expect(Object.fromEntries(asked[0].searchParams)).toEqual({ id: 'MAIN-12', scope: 'epic' })
    expect(usage.scope).toBe('epic')
  })

  it('keeps a kind nobody reported null', async () => {
    serve(usageAnswer(noUsage()))
    const usage = await fetchItemUsage('MAIN-12', 'item')
    expect(usage.tokens.cached_read).toBeNull()
    expect(usage.estimated_api_cost_usd).toBeNull()
    expect(usage.quality).toBeNull()
  })

  it('refuses a field nobody declared', async () => {
    serve(usageAnswer({ ...noUsage(), invented: 1 } as never))
    await expect(fetchItemUsage('MAIN-12', 'item')).rejects.toThrow(/invented/u)
  })

  it('takes a refusal for a failure and not for an answer', async () => {
    serve({ error: { code: 'not_found', message: 'no such item' } }, 404)
    await expect(fetchItemUsage('MAIN-12', 'item')).rejects.toThrow(/404/u)
  })
})

describe('a session’s usage', () => {
  it('is read by the session and ends with what no item took', async () => {
    const asked = serve(usageAnswer(sessionUsage()))
    const usage = await fetchSessionUsage('sess-1')
    expect(asked.map((url) => url.pathname)).toEqual(['/api/planning/session/usage'])
    expect(asked[0].searchParams.get('session_id')).toBe('sess-1')
    expect(usage.by_item.at(-1)?.work_item_id).toBeNull()
  })
})
