/**
 * Hover intent on the graph, on a fake clock: a card takes over only after the
 * pointer has stayed on it, the lit card keeps the field while the pointer
 * crosses to the next, and leaving for empty ground lets the field go.
 *
 * The field here is the real focus reducer, so what is lit at each moment is
 * what the graph would draw.
 */
import { effectScope } from 'vue'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  GRAPH_HOVER_HOLD_MS,
  GRAPH_HOVER_TAKE_MS,
  useGraphHover,
} from '@/widgets/work-item-graph/composables/useGraphHover.ts'
import {
  activeGraphFocus,
  createGraphFocus,
  reduceGraphFocus,
} from '@/widgets/work-item-graph/utils/graphFocus.ts'
import type { GraphFocusEvent } from '@/widgets/work-item-graph/utils/graphFocus.ts'

/** A field of cards A, B and C, with its focus, the events it was handed and what it lit. */
function field(cards = new Set(['A', 'B', 'C'])) {
  let focus = createGraphFocus({
    epicId: null,
    open: true,
    scopeKind: 'all',
    showDone: false,
    space: 'MAIN',
    version: 1,
  })
  const events: GraphFocusEvent[] = []
  /** What was lit after each event, in order. */
  const lit: Array<string | null> = []
  const apply = (event: GraphFocusEvent) => {
    events.push(event)
    focus = reduceGraphFocus(focus, event)
    lit.push(activeGraphFocus(focus))
  }
  const scope = effectScope()
  const hover = scope.run(() =>
    useGraphHover({ apply, accepts: (id) => cards.has(id), hovered: () => focus.hovered }),
  )
  if (!hover) throw new Error('the scope ran')
  return {
    ...hover,
    apply,
    cards,
    events,
    lit,
    litNow: () => activeGraphFocus(focus),
    stop: () => scope.stop(),
  }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('hover intent on the graph', () => {
  it('lights a card only once the pointer has stayed on it', () => {
    const graph = field()
    graph.enter('A')
    vi.advanceTimersByTime(GRAPH_HOVER_TAKE_MS - 1)
    expect(graph.litNow()).toBeNull()
    vi.advanceTimersByTime(1)
    expect(graph.litNow()).toBe('A')
    expect(graph.events).toEqual([{ type: 'pointer-enter', id: 'A' }])
    graph.stop()
  })

  it('passes the light straight from a card to the next, with nothing lit in between', () => {
    const graph = field()
    graph.enter('A')
    vi.advanceTimersByTime(GRAPH_HOVER_TAKE_MS)
    graph.leave('A')
    // Crossing the gap takes most of the hold.
    vi.advanceTimersByTime(GRAPH_HOVER_HOLD_MS - 1)
    expect(graph.litNow()).toBe('A')
    graph.enter('B')
    vi.advanceTimersByTime(GRAPH_HOVER_TAKE_MS - 1)
    expect(graph.litNow()).toBe('A')
    vi.advanceTimersByTime(1)
    expect(graph.litNow()).toBe('B')
    // Nothing was ever lit as nothing: no frame of the whole field back up.
    expect(graph.lit).toEqual(['A', 'B'])
    graph.stop()
  })

  it('lights no card a sweep crosses quicker than a take', () => {
    const graph = field()
    graph.enter('A')
    vi.advanceTimersByTime(GRAPH_HOVER_TAKE_MS)
    graph.leave('A')
    graph.enter('B')
    vi.advanceTimersByTime(GRAPH_HOVER_TAKE_MS - 1)
    graph.leave('B')
    vi.advanceTimersByTime(10)
    graph.enter('C')
    vi.advanceTimersByTime(GRAPH_HOVER_TAKE_MS)
    expect(graph.lit).toEqual(['A', 'C'])
    graph.stop()
  })

  it('lets the field go a hold after the pointer leaves for empty ground', () => {
    const graph = field()
    graph.enter('A')
    vi.advanceTimersByTime(GRAPH_HOVER_TAKE_MS)
    graph.leave('A')
    vi.advanceTimersByTime(GRAPH_HOVER_HOLD_MS - 1)
    expect(graph.litNow()).toBe('A')
    vi.advanceTimersByTime(1)
    expect(graph.litNow()).toBeNull()
    graph.stop()
  })

  it('lets the lit card go when the pointer leaves a card before it took over', () => {
    const graph = field()
    graph.enter('A')
    vi.advanceTimersByTime(GRAPH_HOVER_TAKE_MS)
    graph.leave('A')
    graph.enter('B')
    vi.advanceTimersByTime(50)
    graph.leave('B')
    vi.advanceTimersByTime(GRAPH_HOVER_HOLD_MS)
    expect(graph.litNow()).toBeNull()
    expect(graph.lit).toEqual(['A', null])
    graph.stop()
  })

  it('keeps the field when the pointer slips off a card and back within the hold', () => {
    const graph = field()
    graph.enter('A')
    vi.advanceTimersByTime(GRAPH_HOVER_TAKE_MS)
    graph.leave('A')
    vi.advanceTimersByTime(GRAPH_HOVER_HOLD_MS / 2)
    graph.enter('A')
    vi.advanceTimersByTime(GRAPH_HOVER_HOLD_MS * 2)
    expect(graph.lit).toEqual(['A'])
    graph.stop()
  })

  it('ignores a leave that arrives after the next card was entered', () => {
    const graph = field()
    graph.enter('A')
    vi.advanceTimersByTime(GRAPH_HOVER_TAKE_MS)
    graph.enter('B')
    graph.leave('A')
    vi.advanceTimersByTime(GRAPH_HOVER_TAKE_MS)
    expect(graph.lit).toEqual(['A', 'B'])
    graph.stop()
  })

  it('does not stretch the hold when the pointer then leaves the field itself', () => {
    const graph = field()
    graph.enter('A')
    vi.advanceTimersByTime(GRAPH_HOVER_TAKE_MS)
    graph.leave('A')
    vi.advanceTimersByTime(GRAPH_HOVER_HOLD_MS - 50)
    graph.leaveField()
    vi.advanceTimersByTime(50)
    expect(graph.litNow()).toBeNull()
    graph.stop()
  })

  it('lights nothing for a frame, or for a card no longer drawn when its take comes', () => {
    const graph = field()
    graph.enter('frame-1')
    vi.advanceTimersByTime(GRAPH_HOVER_TAKE_MS)
    graph.enter('C')
    graph.cards.delete('C')
    vi.advanceTimersByTime(GRAPH_HOVER_TAKE_MS)
    expect(graph.events).toEqual([])
    graph.stop()
  })

  it("leaves the keyboard's focus to light at once, and gives it back after the hold", () => {
    const graph = field()
    graph.apply({ type: 'focus', id: 'C' })
    expect(graph.litNow()).toBe('C')
    graph.enter('A')
    vi.advanceTimersByTime(GRAPH_HOVER_TAKE_MS)
    expect(graph.litNow()).toBe('A')
    graph.leaveField()
    vi.advanceTimersByTime(GRAPH_HOVER_HOLD_MS)
    expect(graph.litNow()).toBe('C')
    expect(graph.lit).toEqual(['C', 'A', 'C'])
    graph.stop()
  })

  it('fires nothing once the field is gone', () => {
    const graph = field()
    graph.enter('A')
    graph.stop()
    vi.advanceTimersByTime(GRAPH_HOVER_TAKE_MS * 2)
    expect(graph.events).toEqual([])
  })
})
