/**
 * The live period reads itself again every interval while the page is seen, and never while it is
 * hidden. The oracle is the requirement, counted in reads against a clock the test moves: N
 * intervals seen are N reads; hidden for several intervals is none; shown again after a missed one
 * is one read at once; a period that is not live is never read again.
 */
import { effectScope, nextTick, ref } from 'vue'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { LIVE_INTERVAL, useLiveRefresh } from '@/pages/analytics/composables/useLiveRefresh.ts'

let shown: DocumentVisibilityState = 'visible'

/** Shows or hides the document, as a switch of tabs does, and lets the page hear of it. */
async function show(state: DocumentVisibilityState) {
  shown = state
  document.dispatchEvent(new Event('visibilitychange'))
  await nextTick()
}

function live(initially = true) {
  const scope = effectScope()
  const isLive = ref(initially)
  const refresh = vi.fn()
  const handle = scope.run(() => useLiveRefresh({ live: () => isLive.value, refresh }))
  if (!handle) throw new Error('no live refresh')
  return { ...handle, isLive, refresh, stop: () => scope.stop() }
}

beforeEach(() => {
  vi.useFakeTimers({ now: new Date(2026, 10, 11, 14, 30) })
  shown = 'visible'
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => shown)
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('the live period reads itself again', () => {
  it('once each interval the page is seen', () => {
    const page = live()
    vi.advanceTimersByTime(LIVE_INTERVAL - 1)
    expect(page.refresh).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(page.refresh).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(3 * LIVE_INTERVAL)
    expect(page.refresh).toHaveBeenCalledTimes(4)
    page.stop()
  })

  it('not at all while hidden, and once at once when shown after a missed interval', async () => {
    const page = live()
    vi.advanceTimersByTime(LIVE_INTERVAL)
    expect(page.refresh).toHaveBeenCalledTimes(1)
    await show('hidden')
    vi.advanceTimersByTime(4 * LIVE_INTERVAL)
    expect(page.refresh).toHaveBeenCalledTimes(1)
    await show('visible')
    expect(page.refresh).toHaveBeenCalledTimes(2)
    // And then on its interval from that read again, not twice for the missed ones.
    vi.advanceTimersByTime(LIVE_INTERVAL - 1)
    expect(page.refresh).toHaveBeenCalledTimes(2)
    vi.advanceTimersByTime(1)
    expect(page.refresh).toHaveBeenCalledTimes(3)
    page.stop()
  })

  it('waits out the interval running when hidden for less than it', async () => {
    const page = live()
    vi.advanceTimersByTime(10_000)
    await show('hidden')
    vi.advanceTimersByTime(10_000)
    await show('visible')
    expect(page.refresh).not.toHaveBeenCalled()
    vi.advanceTimersByTime(LIVE_INTERVAL - 20_000)
    expect(page.refresh).toHaveBeenCalledTimes(1)
    page.stop()
  })

  it('an interval after any read of the view, not only its own', () => {
    const page = live()
    vi.advanceTimersByTime(20_000)
    page.restart()
    vi.advanceTimersByTime(LIVE_INTERVAL - 1)
    expect(page.refresh).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(page.refresh).toHaveBeenCalledTimes(1)
    page.stop()
  })

  it('never for a period that is not live, and from the moment one becomes live', async () => {
    const page = live(false)
    vi.advanceTimersByTime(5 * LIVE_INTERVAL)
    expect(page.refresh).not.toHaveBeenCalled()
    page.isLive.value = true
    await nextTick()
    vi.advanceTimersByTime(LIVE_INTERVAL)
    expect(page.refresh).toHaveBeenCalledTimes(1)
    page.isLive.value = false
    await nextTick()
    vi.advanceTimersByTime(5 * LIVE_INTERVAL)
    expect(page.refresh).toHaveBeenCalledTimes(1)
    page.stop()
  })

  it('no more once the page is left', () => {
    const page = live()
    page.stop()
    vi.advanceTimersByTime(5 * LIVE_INTERVAL)
    expect(page.refresh).not.toHaveBeenCalled()
  })
})
