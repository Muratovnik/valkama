import { afterEach, describe, expect, it, vi } from 'vitest'

import { fetchWorkItemChain } from '@/shared/api/planningChainApi.ts'

import { chainResponse, largeEpicChain } from './fixtures/chain.ts'
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

describe('the chain read', () => {
  it('asks for one root in one scope and reads the planning envelope', async () => {
    const fetchMock = answer(chainResponse(largeEpicChain()))
    const chain = await fetchWorkItemChain('VAL-384', 'epic')
    const url = new URL(requestUrl(fetchMock.mock.calls.at(-1)?.[0] ?? ''), 'https://example.test')
    expect(url.pathname).toBe('/api/planning/work-item/chain')
    expect(Object.fromEntries(url.searchParams)).toEqual({ id: 'VAL-384', scope: 'epic' })
    expect(chain.total).toBe(616)
    expect(chain.members).toHaveLength(616)
  })

  it('refuses a payload without the planning interface or with a field it does not know', async () => {
    answer({ chain: largeEpicChain() })
    await expect(fetchWorkItemChain('VAL-384', 'chain')).rejects.toThrow(/interface_version/u)
    answer(chainResponse({ ...largeEpicChain(), extra: 1 } as ReturnType<typeof largeEpicChain>))
    await expect(fetchWorkItemChain('VAL-384', 'chain')).rejects.toThrow(/unknown field/u)
  })

  it('refuses days out of order and counts that do not add up', async () => {
    const chain = largeEpicChain()
    answer(chainResponse({ ...chain, series: [...chain.series].reverse() }))
    await expect(fetchWorkItemChain('VAL-384', 'chain')).rejects.toThrow(/ascending days/u)
    answer(chainResponse({ ...chain, closed: 482 }))
    await expect(fetchWorkItemChain('VAL-384', 'chain')).rejects.toThrow(/add up/u)
  })

  it('carries the server code and status of a refusal', async () => {
    answer({ error: { code: 'not_found', message: 'no work item VAL-9' } }, 404)
    await expect(fetchWorkItemChain('VAL-9', 'chain')).rejects.toMatchObject({
      code: 'not_found',
      status: 404,
      message: 'no work item VAL-9',
    })
  })
})
