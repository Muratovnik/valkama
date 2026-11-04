/**
 * Whether live work moves on the graph: a reader's pause kept across reloads,
 * a system asking for less motion outranking it, and storage that refuses a
 * write costing nothing but the memory.
 */
import { effectScope, nextTick } from 'vue'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { movesOn, useGraphMotion } from '@/widgets/work-item-graph/composables/useGraphMotion.ts'

const KEY = 'valkama-graph-motion'

/** A system that does or does not ask for less motion. */
function preferReducedMotion(reduce: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: reduce && query.includes('reduce'),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }))
}

/** One page's motion: the composable as a field mounts it. */
function page() {
  const scope = effectScope()
  const motion = scope.run(() => useGraphMotion())
  if (!motion) throw new Error('the scope ran')
  return { ...motion, stop: () => scope.stop() }
}

beforeEach(() => {
  localStorage.clear()
  preferReducedMotion(false)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("the graph's motion", () => {
  it('runs until the reader stops it, and runs again when asked', () => {
    const field = page()
    expect(field.motion.value).toBe('running')
    field.toggle()
    expect(field.motion.value).toBe('paused')
    field.toggle()
    expect(field.motion.value).toBe('running')
    field.stop()
  })

  it('keeps a pause across a reload, under the one key for every space', async () => {
    const first = page()
    first.toggle()
    await nextTick()
    first.stop()
    expect(localStorage.getItem(KEY)).toBe('paused')
    const reloaded = page()
    expect(reloaded.motion.value).toBe('paused')
    reloaded.stop()
  })

  it('stands still when the system asks for less motion, whatever was kept', () => {
    localStorage.setItem(KEY, 'running')
    preferReducedMotion(true)
    const field = page()
    expect(field.motion.value).toBe('reduced')
    field.stop()
  })

  it('keeps the choice for the page when storage refuses to write it', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota')
    })
    const field = page()
    expect(() => field.toggle()).not.toThrow()
    expect(field.motion.value).toBe('paused')
    field.stop()
  })

  it('moves only a turn running now, not an item held aside, a session waiting or fallen silent', () => {
    expect(movesOn({ state: 'working' })).toBe(true)
    expect(movesOn({ state: 'held' })).toBe(false)
    expect(movesOn({ state: 'waiting' })).toBe(false)
    expect(movesOn({ state: 'quiet', quiet_since: '2026-11-02T08:00:00Z' })).toBe(false)
    expect(movesOn(undefined)).toBe(false)
  })
})
