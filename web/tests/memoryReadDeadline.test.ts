import { afterEach, describe, expect, it, vi } from 'vitest'

import { fetchMemoryProviders } from '@/shared/api/memoryApi.ts'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('Memory provider read deadline', () => {
  it.each(['headers', 'body'])(
    'settles stalled provider %s after fifteen seconds and aborts transport',
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
      const read = fetchMemoryProviders()
      const refusal = expect(read).rejects.toMatchObject({ code: 'request_timeout' })
      await vi.advanceTimersByTimeAsync(14_999)
      expect(fetchMock).toHaveBeenCalledWith('/api/memory/providers', expect.any(Object))
      expect(fetchMock.mock.calls[0]?.[1]?.signal?.aborted).toBe(false)
      await vi.advanceTimersByTimeAsync(1)
      await refusal
      expect(fetchMock.mock.calls[0]?.[1]?.signal?.aborted).toBe(true)
      expect(vi.getTimerCount()).toBe(0)
    },
  )

  it('preserves successful provider JSON and rejects server JSON errors with their status', async () => {
    vi.useFakeTimers()
    vi.stubGlobal(
      'fetch',
      vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          new Response('{"interface_version":"valkama-memory-api","providers":[]}'),
        )
        .mockResolvedValueOnce(new Response('{"error":"provider offline"}', { status: 503 })),
    )
    await expect(fetchMemoryProviders()).resolves.toEqual({
      interface_version: 'valkama-memory-api',
      providers: [],
    })
    await expect(fetchMemoryProviders()).rejects.toThrow('503 {"error":"provider offline"}')
    expect(vi.getTimerCount()).toBe(0)
  })
})
