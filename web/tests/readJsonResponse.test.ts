import { afterEach, expect, it, vi } from 'vitest'

import { readJsonResponse } from '@/shared/api/readJsonResponse.ts'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

it.each(['headers', 'body'])(
  'times out a stalled %s read and aborts the request',
  async (phase) => {
    vi.useFakeTimers()
    const pending = new Promise<Response>(() => {})
    const response = new Response('{}')
    vi.spyOn(response, 'json').mockReturnValue(new Promise(() => {}))
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockReturnValue(phase === 'headers' ? pending : Promise.resolve(response))
    vi.stubGlobal('fetch', fetchMock)
    const read = readJsonResponse('/api/planning?project=example')
    const refused = expect(read).rejects.toMatchObject({ code: 'request_timeout' })
    await vi.advanceTimersByTimeAsync(15_000)
    await refused
    expect(fetchMock.mock.calls[0]?.[1]?.signal?.aborted).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  },
)

it('cleans up a completed read without changing response status or JSON', async () => {
  vi.useFakeTimers()
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('{"reason":"unavailable"}', { status: 409 })),
  )
  const result = await readJsonResponse('/api/planning')
  expect(result.response.status).toBe(409)
  expect(result.payload).toEqual({ reason: 'unavailable' })
  expect(vi.getTimerCount()).toBe(0)
})

it('preserves caller cancellation and clears the deadline', async () => {
  vi.useFakeTimers()
  vi.stubGlobal(
    'fetch',
    vi.fn(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('Cancelled', 'AbortError')),
          )
        }),
    ),
  )
  const controller = new AbortController()
  const result = readJsonResponse('/api/modules', { signal: controller.signal })
  const refused = expect(result).rejects.toMatchObject({ name: 'AbortError' })
  controller.abort()
  await refused
  expect(vi.getTimerCount()).toBe(0)
})

it('preserves cancellation while the JSON body is still arriving', async () => {
  vi.useFakeTimers()
  const controller = new AbortController()
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(
          new ReadableStream({
            start(stream) {
              controller.signal.addEventListener('abort', () =>
                stream.error(controller.signal.reason),
              )
            },
          }),
        ),
    ),
  )
  const read = readJsonResponse('/api/planning', { signal: controller.signal })
  const refused = expect(read).rejects.toMatchObject({ name: 'AbortError' })
  await vi.advanceTimersByTimeAsync(0)
  controller.abort()
  await refused
  expect(vi.getTimerCount()).toBe(0)
})
