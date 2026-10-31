import { afterEach, describe, expect, it, vi } from 'vitest'

import { searchGlobalPlanningWorkItems } from '@/shared/api/planningGlobalSearchApi.ts'
import { planningTargetSchema, serializePlanningTarget } from '@/shared/api/planningTarget.ts'

import { finderResponse, finderTarget } from './support/globalFinder.ts'
import { present } from './support/present.ts'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

function serve(value: unknown, status = 200) {
  const fetchMock = vi
    .fn<typeof fetch>()
    .mockResolvedValue(new Response(JSON.stringify(value), { status }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('global Planning search contract', () => {
  it('preserves attached identity and serializes exact target fields', async () => {
    const fetchMock = serve(finderResponse('a & b'))
    const result = await searchGlobalPlanningWorkItems('a & b', new AbortController().signal)
    expect(result.items[0]?.target).toEqual(finderTarget())
    expect(serializePlanningTarget(finderTarget())).toEqual({
      project_id: 'attached-project',
      data_scope_id: '11111111-1111-4111-8111-111111111111',
      space_key: 'TASK',
    })
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/modules/planning/search?q=a+%26+b&limit=50')
  })

  it('rejects target references belonging to another space and unknown fields', () => {
    expect(
      planningTargetSchema.safeParse({ ...finderTarget(), reference: 'OTHER-7' }).success,
    ).toBe(false)
    expect(
      planningTargetSchema.safeParse({ ...finderTarget(), path: '/wrong-store' }).success,
    ).toBe(false)
    expect(
      planningTargetSchema.safeParse({ ...finderTarget(), project_id: '../other' }).success,
    ).toBe(false)
  })

  it('rejects a result whose item reference differs from its target', async () => {
    const payload = finderResponse()
    present(payload.items[0], 'search item').item.reference = 'TASK-8'
    serve(payload)
    await expect(
      searchGlobalPlanningWorkItems('needle', new AbortController().signal),
    ).rejects.toThrow('does not match')
  })

  it('carries a named refusal of the whole search and nothing else the body says', async () => {
    serve({ error: { code: 'unavailable', message: 'project_registry_unavailable' } }, 409)
    await expect(
      searchGlobalPlanningWorkItems('needle', new AbortController().signal),
    ).rejects.toMatchObject({ code: 'project_registry_unavailable', status: 409 })
    serve({ error: { code: 'unavailable', message: 'C:/private/store is locked' } }, 409)
    await expect(
      searchGlobalPlanningWorkItems('needle', new AbortController().signal),
    ).rejects.toMatchObject({ code: 'request_failed', status: 409 })
  })

  it('rejects oversized responses and stale response queries', async () => {
    const payload = finderResponse()
    const item = present(payload.items[0], 'search item')
    payload.items = Array.from({ length: 101 }, () => item)
    serve(payload)
    await expect(
      searchGlobalPlanningWorkItems('needle', new AbortController().signal),
    ).rejects.toThrow()
    serve(finderResponse('old query'))
    await expect(
      searchGlobalPlanningWorkItems('needle', new AbortController().signal),
    ).rejects.toThrow('mismatch')
  })

  it('aborts the underlying read when cancelled', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('Cancelled', 'AbortError')),
          )
        }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const controller = new AbortController()
    const request = searchGlobalPlanningWorkItems('needle', controller.signal)
    const rejected = expect(request).rejects.toMatchObject({ name: 'AbortError' })
    controller.abort()
    await rejected
    expect(fetchMock.mock.calls[0]?.[1]?.signal?.aborted).toBe(true)
  })

  it('keeps the existing timeout over stalled reads and refuses HTTP failures', async () => {
    vi.useFakeTimers()
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>(() => {})),
    )
    const request = searchGlobalPlanningWorkItems('needle', new AbortController().signal)
    const rejected = expect(request).rejects.toMatchObject({ code: 'request_timeout' })
    await vi.advanceTimersByTimeAsync(15_000)
    await rejected
    serve({ reason: 'source path is private' }, 503)
    await expect(
      searchGlobalPlanningWorkItems('needle', new AbortController().signal),
    ).rejects.toThrow('HTTP 503')
  })
})
