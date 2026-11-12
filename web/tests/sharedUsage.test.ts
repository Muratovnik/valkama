/**
 * The Analytics page's shared reads. The oracle is the requirement: a usage read asked again for
 * the view on show — while the first is in flight, or once it was answered — is one request, and
 * every reader takes the same answer; a new view or a refresh asks anew, as of a new moment; a
 * reader that stops waiting stops nobody else, and a request nobody waits for is dropped; a read
 * that failed is asked again.
 */
import assert from 'node:assert/strict'

import { afterEach, describe, test, vi } from 'vitest'

import { createSharedUsage } from '@/pages/analytics/composables/useSharedUsage.ts'

import type { UsageDimension, UsageQuery } from '@/shared/api/analyticsApi.ts'

import { usageAnswer } from './fixtures/analytics.ts'

/** A request the stand-in holds until the test answers it, with the signal it was asked with. */
interface Asked {
  signal: AbortSignal | undefined
  url: string
  answer: (status?: number) => void
}

/** The server, as a list of what was asked; each request waits for the test to answer it. */
function server() {
  const asked: Asked[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof fetch>(
      (input, init) =>
        new Promise<Response>((resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('aborted', 'AbortError'))
          })
          asked.push({
            url: input as string,
            signal: init?.signal ?? undefined,
            answer: (status = 200) => {
              const body = usageAnswer({
                days: 1,
                first: new Date(2026, 10, 9),
                groupBy: [],
                stretches: [],
              })
              resolve(
                new Response(status === 200 ? JSON.stringify(body) : '{}', {
                  status,
                  headers: { 'Content-Type': 'application/json' },
                }),
              )
            },
          })
        }),
    ),
  )
  return asked
}

const query = (by: UsageDimension): UsageQuery => ({
  from: '2026-11-09',
  to: '2026-11-11T11:30:00.000Z',
  utcOffset: 180,
  groupBy: [by],
  filters: {},
  compare: false,
})

/** Lets every answer in flight reach its readers. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the shared reads of the Analytics page', () => {
  test('ask once for a read asked twice while it is in flight, and both take its answer', async () => {
    const asked = server()
    const shared = createSharedUsage(() => 'week')
    const first = shared.read(query('model'))
    const second = shared.read(query('model'))
    await settle()
    assert.equal(asked.length, 1)
    asked[0]?.answer()
    assert.equal(await first, await second)
  })

  test('ask nothing for a read the view has an answer to, and ask another read', async () => {
    const asked = server()
    const shared = createSharedUsage(() => 'week')
    const first = shared.read(query('model'))
    await settle()
    asked[0]?.answer()
    const answer = await first
    assert.equal(await shared.read(query('model')), answer)
    assert.equal(asked.length, 1)
    void shared.read(query('role'))
    await settle()
    assert.equal(asked.length, 2)
    assert.match(asked[1]?.url ?? '', /group_by=role/u)
  })

  test('ask anew, as of a new moment, for another view or after a refresh', async () => {
    const asked = server()
    let view = 'week'
    let tick = 0
    const shared = createSharedUsage(
      () => view,
      () => new Date(2026, 10, 11, 14, 30, tick++),
    )
    const moment = shared.now()
    assert.equal(shared.now(), moment)
    const first = shared.read(query('model'))
    await settle()
    asked[0]?.answer()
    await first

    view = 'weeks4'
    assert.notEqual(shared.now(), moment)
    void shared.read(query('model'))
    await settle()
    assert.equal(asked.length, 2)
    asked[1]?.answer()
    await settle()

    const before = shared.now()
    shared.renew()
    assert.notEqual(shared.now(), before)
    void shared.read(query('model'))
    await settle()
    assert.equal(asked.length, 3)
  })

  test('let a reader stop waiting without stopping the others, and drop a request nobody waits for', async () => {
    const asked = server()
    const shared = createSharedUsage(() => 'week')
    const leaving = new AbortController()
    const left = shared.read(query('model'), leaving.signal)
    const staying = shared.read(query('model'), new AbortController().signal)
    await settle()
    leaving.abort()
    await assert.rejects(left)
    assert.equal(asked[0]?.signal?.aborted, false)
    asked[0]?.answer()
    const kept = await staying
    assert.equal(kept.period.step, 'day')

    const alone = new AbortController()
    const dropped = shared.read(query('role'), alone.signal)
    await settle()
    alone.abort()
    await assert.rejects(dropped)
    assert.equal(asked[1]?.signal?.aborted, true)
    // Dropped, it is asked again by the next reader.
    void shared.read(query('role'))
    await settle()
    assert.equal(asked.length, 3)
  })

  test('ask again for a read that failed', async () => {
    const asked = server()
    const shared = createSharedUsage(() => 'week')
    const failing = shared.read(query('model'))
    await settle()
    asked[0]?.answer(500)
    await assert.rejects(failing)
    void shared.read(query('model'))
    await settle()
    assert.equal(asked.length, 2)
  })
})
