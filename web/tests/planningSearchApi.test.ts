import { afterEach, describe, expect, it, vi } from 'vitest'

import { searchPlanningWorkItems } from '@/shared/api/planningSearchApi.ts'

const space = '123e4567-e89b-42d3-a456-426614174000'
const item = {
  work_item_id: '123e4567-e89b-42d3-a456-426614174001',
  planning_space_id: space,
  reference: 'QA-42',
  title: 'Delivery milestone',
  state: { name: 'Dev', key: 'dev' },
  claim_ref: 'Alex',
  comment_count: 2,
  comment_hit: 'Delivery evidence',
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('Planning related-task search', () => {
  it('encodes exact space and bounded query, and projects brief records', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ interface_version: 'valkama-planning-api', work_items: [item] }),
        ),
      )
    vi.stubGlobal('fetch', fetchMock)
    const result = await searchPlanningWorkItems(
      '42 & delivery',
      space,
      new AbortController().signal,
    )
    const input = fetchMock.mock.calls[0][0]
    if (typeof input !== 'string') throw new TypeError('Expected a URL string')
    const url = new URL(input, 'https://example.test')
    expect(url.pathname).toBe('/api/planning/search')
    expect(Object.fromEntries(url.searchParams)).toEqual({ q: '42 & delivery', space, limit: '50' })
    expect(result).toEqual([
      {
        work_item_id: item.work_item_id,
        planning_space_id: space,
        reference: 'QA-42',
        title: item.title,
        state: { name: 'Dev' },
        claim_ref: 'Alex',
      },
    ])
  })

  it.each(['headers', 'body'])(
    'bounds stalled %s to fifteen seconds and aborts transport',
    async (phase) => {
      vi.useFakeTimers()
      const stalledBody = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"interface_version":'))
        },
      })
      const fetchMock = vi
        .fn<typeof fetch>()
        .mockReturnValue(
          phase === 'headers'
            ? new Promise<Response>(() => {})
            : Promise.resolve(new Response(stalledBody)),
        )
      vi.stubGlobal('fetch', fetchMock)
      const result = searchPlanningWorkItems('42', space, new AbortController().signal)
      const failure = expect(result).rejects.toMatchObject({ code: 'request_timeout' })
      await vi.advanceTimersByTimeAsync(15_000)
      await failure
      expect(fetchMock.mock.calls[0][1]?.signal?.aborted).toBe(true)
      expect(vi.getTimerCount()).toBe(0)
    },
  )

  it('rejects malformed search results and HTTP failures', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              interface_version: 'valkama-planning-api',
              work_items: [{ ...item, reference: 'invalid' }],
            }),
          ),
        )
        .mockResolvedValueOnce(new Response('{}', { status: 503 })),
    )
    await expect(
      searchPlanningWorkItems('bad', space, new AbortController().signal),
    ).rejects.toThrow()
    await expect(
      searchPlanningWorkItems('offline', space, new AbortController().signal),
    ).rejects.toThrow('HTTP 503')
  })
})
