/**
 * The past window a quota window shows in its place (`usePastWindow`): what it asks the window read
 * by, and which answer it keeps when reads overlap, fail or find nothing. The read itself is
 * replaced here, each call held until the test answers it.
 */
import { effectScope } from 'vue'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { usePastWindow } from '@/pages/analytics/composables/usePastWindow.ts'

import { fetchQuotaWindow } from '@/shared/api/analyticsApi.ts'
import type { QuotaPastWindow, QuotaShareWindow } from '@/shared/api/analyticsApi.ts'

import { quotaAt, share } from './fixtures/quota.ts'

vi.mock('@/shared/api/analyticsApi.ts', async (original) => ({
  ...(await original<typeof import('@/shared/api/analyticsApi.ts')>()),
  fetchQuotaWindow: vi.fn(),
}))

const DAY = 86_400_000
const NOW = Date.UTC(2026, 10, 11, 11, 30)
const OFFSET = 180

const quota = quotaAt(NOW, OFFSET)
const work = quota.accounts[0]
if (!work) throw new Error('the fixture names «Work» first')
const current = work.windows.find((one): one is QuotaShareWindow => one.kind === 'week')
if (!current) throw new Error('«Work» reads its week')

/** A week that reset `daysAgo` days before now, with one reading a day before its reset. */
const weekBefore = (daysAgo: number) =>
  share(NOW, OFFSET, {
    kind: 'week',
    left: -daysAgo * DAY,
    readings: [[(daysAgo + 1) * DAY, 30]],
    source: 'poll',
    forecast: null,
  })
const LAST = weekBefore(4)
const OLDER = weekBefore(11)

const answer = (window: QuotaShareWindow | null): QuotaPastWindow => ({
  now: quota.now,
  utc_offset: OFFSET,
  fresh_for_seconds: 900,
  retained_from: quota.retained_from,
  account: work.account,
  kind: 'week',
  model: null,
  before: quota.now,
  window,
})

/** Each read the composable starts, held until the test answers or fails it. */
function heldReads() {
  const reads: {
    query: Parameters<typeof fetchQuotaWindow>[0]
    signal?: AbortSignal
    fail: () => Promise<void>
    give: (window: QuotaShareWindow | null) => Promise<void>
  }[] = []
  vi.mocked(fetchQuotaWindow).mockImplementation(
    (query, signal) =>
      new Promise((resolve, reject) => {
        reads.push({
          query,
          signal,
          give: async (window) => {
            resolve(answer(window))
            await Promise.resolve()
          },
          fail: async () => {
            reject(new Error('HTTP 500'))
            await Promise.resolve()
          },
        })
      }),
  )
  return reads
}

function mounted() {
  const scope = effectScope()
  const past = present(
    scope.run(() =>
      usePastWindow({ account: () => work, offset: () => OFFSET, window: () => current }),
    ),
  )
  return { past, scope }
}

function present<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('the scope ran')
  return value
}

afterEach(() => vi.mocked(fetchQuotaWindow).mockReset())

describe('the past window of a quota window', () => {
  it('asks by the current window’s start, then by the start of each window shown', async () => {
    const reads = heldReads()
    const { past } = mounted()
    expect(past.status.value).toBe('closed')

    const opening = past.open()
    expect(past.status.value).toBe('reading')
    expect(reads).toHaveLength(1)
    expect(reads[0]?.query).toEqual({
      account: work.account,
      kind: 'week',
      model: null,
      before: current.started_at,
      utcOffset: OFFSET,
    })
    await reads[0]?.give(LAST)
    await opening
    expect(past.status.value).toBe('shown')
    expect(past.shown.value).toBe(LAST)

    const stepping = past.back()
    // The window shown stays while the one before it is read.
    expect(past.shown.value).toBe(LAST)
    expect(reads[1]?.query.before).toBe(LAST.started_at)
    await reads[1]?.give(OLDER)
    await stepping
    expect(past.shown.value).toBe(OLDER)
  })

  it('says a window is no longer kept, and keeps the one shown', async () => {
    const reads = heldReads()
    const { past } = mounted()
    const opening = past.open()
    await reads[0]?.give(LAST)
    await opening
    const stepping = past.back()
    await reads[1]?.give(null)
    await stepping
    expect(past.status.value).toBe('gone')
    expect(past.shown.value).toBe(LAST)
  })

  it('keeps the window shown through a failed read, and retries the same window', async () => {
    const reads = heldReads()
    const { past } = mounted()
    const opening = past.open()
    await reads[0]?.give(LAST)
    await opening
    const stepping = past.back()
    await reads[1]?.fail()
    await stepping
    expect(past.status.value).toBe('failed')
    expect(past.shown.value).toBe(LAST)

    const retrying = past.retry()
    expect(reads).toHaveLength(3)
    expect(reads[2]?.query.before).toBe(reads[1]?.query.before)
    await reads[2]?.give(OLDER)
    await retrying
    expect(past.status.value).toBe('shown')
    expect(past.shown.value).toBe(OLDER)
  })

  it('drops a read that is overtaken or closed, and a closed scope aborts its read', async () => {
    const reads = heldReads()
    const { past, scope } = mounted()
    const first = past.open()
    const second = past.open()
    expect(reads[0]?.signal?.aborted).toBe(true)
    await reads[0]?.give(OLDER)
    await first
    expect(past.shown.value).toBeNull()
    expect(past.status.value).toBe('reading')
    await reads[1]?.give(LAST)
    await second
    expect(past.shown.value).toBe(LAST)

    const stepping = past.back()
    past.close()
    expect(reads[2]?.signal?.aborted).toBe(true)
    await reads[2]?.give(OLDER)
    await stepping
    expect(past.status.value).toBe('closed')
    expect(past.shown.value).toBeNull()

    void past.open()
    scope.stop()
    expect(reads[3]?.signal?.aborted).toBe(true)
  })
})
