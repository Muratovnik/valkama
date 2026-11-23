/**
 * A live span's frame follows its running period until the reader scrolls, by the rule
 * `usePlotFrame` states: the frame's own scroll is not the reader's. The browser delivers the
 * scroll event a write causes a frame later, after a layout that may already have moved the
 * running period's place, as a frame that narrows once the words beside the chart are laid out
 * does. happy-dom lays nothing out, so the frame's room and its scroll are set here the way a
 * browser would report them, and the scroll event is sent when a browser would send it.
 */
import { defineComponent, h, ref } from 'vue'

import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { usePlotFrame } from '@/shared/ui/usePlotFrame.ts'

/** What each observer the frame starts watches, to resize them as a browser would. */
const observers: { callback: ResizeObserverCallback; targets: Set<Element> }[] = []

function resized(target: Element, width = 0) {
  for (const observer of observers)
    if (observer.targets.has(target))
      observer.callback(
        [{ target, contentRect: { width } } as unknown as ResizeObserverEntry],
        {} as ResizeObserver,
      )
}

beforeEach(() => {
  observers.length = 0
  vi.stubGlobal(
    'ResizeObserver',
    class {
      private readonly own: { callback: ResizeObserverCallback; targets: Set<Element> }
      constructor(callback: ResizeObserverCallback) {
        this.own = { callback, targets: new Set() }
        observers.push(this.own)
      }
      observe(target: Element) {
        this.own.targets.add(target)
      }
      unobserve(target: Element) {
        this.own.targets.delete(target)
      }
      disconnect() {
        this.own.targets.clear()
      }
    },
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
})

/** Five minutes, the last one running, in a plot wider than its frame. */
const KEYS = ['m1', 'm2', 'm3', 'm4', 'm5']
const PLOT_WIDTH = 1608

/**
 * A frame whose room the test sets: its scroll is clamped to that room as a browser clamps it,
 * and a write sends no event of its own, so the test sends it where the browser would.
 */
function framed(clientWidth: number) {
  const box = { clientWidth, scrollLeft: 0 }
  const Harness = defineComponent({
    setup() {
      const frame = ref<HTMLElement | null>(null)
      const plot = ref<HTMLElement | null>(null)
      const field = ref<HTMLElement | null>(null)
      usePlotFrame(frame, plot, field, { keys: () => KEYS, running: () => 'm5' })
      return () =>
        h('div', { ref: frame, class: 'frame' }, [
          h('div', { ref: plot }, [
            h(
              'div',
              { ref: field },
              KEYS.map((key) => h('div', { key, 'data-key': key })),
            ),
          ]),
        ])
    },
  })
  const wrapper = mount(Harness, { attachTo: document.body })
  const frame = wrapper.get('.frame').element as HTMLElement
  const room = () => PLOT_WIDTH - box.clientWidth
  Object.defineProperties(frame, {
    scrollWidth: { configurable: true, get: () => PLOT_WIDTH },
    clientWidth: { configurable: true, get: () => box.clientWidth },
    scrollLeft: {
      configurable: true,
      get: () => box.scrollLeft,
      set: (left: number) => {
        box.scrollLeft = Math.min(Math.max(left, 0), room())
      },
    },
  })
  const field = frame.querySelector('[data-key]')?.parentElement as HTMLElement
  return {
    frame,
    room,
    /** The field laid out at its width, which is when the frame opens the span. */
    async open() {
      await flushPromises()
      resized(field, 1558)
      await flushPromises()
    },
    /**
     * The frame laid out narrower or wider by what lies beside it. A browser sends the scroll
     * events of a frame before it calls the observers of that frame's new size, so `observed`
     * comes after `scrolled` where both happen.
     */
    laidOut(width: number) {
      box.clientWidth = width
    },
    /** The frame's observers told of the size it was laid out at. */
    observed() {
      resized(frame, box.clientWidth)
    },
    /** The scroll event for where the frame stands now, as the browser sends it a frame later. */
    scrolled() {
      frame.dispatchEvent(new Event('scroll'))
    },
    /** The reader scrolling the frame to `left` themselves. */
    readerTo(left: number) {
      box.scrollLeft = left
      frame.dispatchEvent(new Event('scroll'))
    },
  }
}

describe('a live span’s frame', () => {
  it('stays on its running period when the frame narrows before its own scroll event arrives', async () => {
    const chart = framed(884)
    await chart.open()
    expect(chart.frame.scrollLeft, 'opened at the end').toBe(PLOT_WIDTH - 884)

    // Laid out seven pixels narrower after the write: its scroll event comes on the new layout.
    chart.laidOut(877)
    chart.scrolled()
    chart.observed()
    expect(chart.frame.scrollLeft, 'the running period at the end').toBe(PLOT_WIDTH - 877)
  })

  it('holds the reader’s place once they scroll, and follows again once they scroll back', async () => {
    const chart = framed(884)
    await chart.open()
    chart.scrolled()

    chart.readerTo(300)
    chart.laidOut(877)
    chart.observed()
    expect(chart.frame.scrollLeft, 'the reader’s place').toBe(300)

    chart.readerTo(chart.room())
    chart.laidOut(870)
    chart.observed()
    expect(chart.frame.scrollLeft, 'followed again').toBe(PLOT_WIDTH - 870)
  })
})
