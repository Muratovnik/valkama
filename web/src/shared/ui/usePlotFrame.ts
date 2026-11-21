/**
 * The frame a chart's plot scrolls in when its periods, held to a width a pointer can hit, take
 * more room than the chart has. It measures the field the periods stand in, says how far into
 * the plot they start (the room the scale takes, which stays in view over the plot's start, so a
 * period scrolled to must stand clear of it), and opens a span where it reads. A past span opens
 * on its start, the period's first day beside the scale, so the span reads from where it begins.
 * A live span (`running` names its period still running) opens scrolled on only as far as that
 * period needs to stand at the frame's end, where the last one stands with the frame scrolled all
 * the way, or one period in from it where later periods follow, so what just happened is in view
 * beside the earlier periods leading to it. It says at which edge periods lie out of view (`hidden`), for the
 * frame to show there that the plot goes on.
 *
 * While the frame stands where a live span opens, it follows the running period: a span moved on
 * a period, a new period running and a plot or window that changes width keep it at the frame's
 * end. A reader who scrolled away keeps their place instead: the period they read first stays
 * where it stood as the span moves on, and scrolled back to the running period, the frame follows
 * it again. A reader's place in a past span holds while the plot's width settles and while the
 * window changes.
 *
 * A period the keyboard reaches is brought clear of the scale here (`reveal`), not left to the
 * browser. Focus scrolls a frame only when what it lands on lies outside the frame's box, and
 * the scale is in that box: a span a few pixels wider than the chart opens with its first
 * period inside the box but under the scale, so Home stood on a period nobody could see.
 */
import type { Ref } from 'vue'
import { computed, ref, watch } from 'vue'

import { useEventListener, useResizeObserver } from '@vueuse/core'

/** What a box's edge may stray from another's by rounding alone, in pixels. */
const ROUNDING = 1

/** A span as one name: other keys are another span. */
const named = (keys: readonly string[]) => keys.join(' ')

/** The periods a frame shows, by their keys in the order of time, and the one still running. */
export interface FrameSpan {
  /** The keys of the periods shown: other keys are another span. */
  keys: () => readonly string[]
  /** The key of the period a live span keeps in view; null for a span that opens on its start. */
  running: () => string | null
}

export function usePlotFrame(
  frame: Ref<HTMLElement | null>,
  plot: Ref<HTMLElement | null>,
  field: Ref<HTMLElement | null>,
  span: FrameSpan,
) {
  const width = ref(0)
  /** How far into the plot the periods start, in pixels. */
  const gutter = ref(0)
  /** Whether periods lie out of view before the scale's end, and past the frame's end. */
  const hiddenStart = ref(false)
  const hiddenEnd = ref(false)

  /** The slot of the period keyed `key`, as the plot draws it. */
  const slotOf = (key: string) =>
    [...(field.value?.querySelectorAll<HTMLElement>('[data-key]') ?? [])].find(
      (slot) => slot.dataset.key === key,
    )

  /**
   * The span opened, by its keys; whether it opened live, on its running period; whether the
   * frame still stands on that period; and, in a live span, the period the reader's view starts
   * at, with how far into the frame it stands.
   */
  let opened: readonly string[] | null = null
  let openedLive = false
  let following = false
  let anchor: { key: string; left: number } | null = null

  /** The scale can change its width under a field that keeps its own, so both observers measure. */
  const measure = () => {
    if (!field.value || !plot.value || !frame.value) return
    const periods = field.value.getBoundingClientRect()
    const room = frame.value.getBoundingClientRect()
    gutter.value = periods.left - plot.value.getBoundingClientRect().left
    hiddenStart.value = periods.left < room.left + gutter.value - ROUNDING
    hiddenEnd.value = periods.right > room.right + ROUNDING
    if (openedLive) anchor = firstInView(field.value, room.left + gutter.value - ROUNDING)
  }

  /** The first period whole past `start`, by its key, and how far into the frame it stands. */
  function firstInView(periods: HTMLElement, start: number) {
    const room = frame.value?.getBoundingClientRect().left ?? 0
    for (const slot of periods.querySelectorAll<HTMLElement>('[data-key]')) {
      const left = slot.getBoundingClientRect().left
      if (left >= start && slot.dataset.key) return { key: slot.dataset.key, left: left - room }
    }
    return null
  }

  /**
   * Where the frame stands with the running period at its end, where the last period stands with
   * the frame scrolled all the way; where later periods follow it, the one after it stands there,
   * so the fade toward them falls on that one and the running period and its name stand clear of
   * it. No further on than that takes, and at the start where it is in view there already. Null
   * where the span keeps no period in view.
   */
  function runningPlace() {
    const box = frame.value
    const key = span.running()
    const slot = key === null ? undefined : slotOf(key)
    const last = field.value?.querySelector<HTMLElement>('[data-key]:last-child')
    if (!box || !slot || !last) return null
    const end = slot.nextElementSibling ?? slot
    const room = box.scrollWidth - box.clientWidth
    const after = last.getBoundingClientRect().right - end.getBoundingClientRect().right
    return Math.min(Math.max(room - after, 0), room)
  }

  /**
   * Where the frame's own last scroll left it, until the scroll event that scroll causes arrives.
   * The browser sends that event a frame later, after a layout that may have moved the running
   * period's place: a frame laid out a few pixels narrower once the words beside its chart were,
   * judged its own scroll against the new place, took it for the reader's and stopped following.
   */
  let ownScroll: number | null = null

  /** Scrolls the frame to `left` on the frame's own account, never the reader's. */
  function scrollFrame(box: HTMLElement, left: number) {
    const from = box.scrollLeft
    box.scrollLeft = left
    if (box.scrollLeft !== from) ownScroll = box.scrollLeft
  }

  /** Whether the frame stands where its own last scroll left it; asked once per scroll event. */
  function scrolledByFrame(box: HTMLElement) {
    const own = ownScroll !== null && Math.abs(box.scrollLeft - ownScroll) <= ROUNDING
    ownScroll = null
    return own
  }

  const toRunning = () => {
    const place = runningPlace()
    if (frame.value && place !== null) scrollFrame(frame.value, place)
  }

  useEventListener(
    frame,
    'scroll',
    () => {
      const box = frame.value
      if (box && !scrolledByFrame(box) && openedLive) {
        const place = runningPlace()
        following = place !== null && Math.abs(box.scrollLeft - place) <= ROUNDING
      }
      measure()
    },
    { passive: true },
  )
  useResizeObserver(field, ([entry]) => {
    if (!entry) return
    width.value = entry.contentRect.width
    measure()
  })
  // The room to scroll changes with the plot's width and with the frame's: a window made
  // narrower leaves the plot as wide as it was and hides more of its periods.
  const settle = () => {
    if (following) toRunning()
    measure()
  }
  useResizeObserver(plot, settle)
  useResizeObserver(frame, settle)

  /** Whether `keys` are the span opened moved on: as many periods, the last one opened still in. */
  const movedOn = (keys: readonly string[]) =>
    openedLive &&
    opened !== null &&
    opened.length === keys.length &&
    keys.includes(opened.at(-1) ?? '')

  /** The reader's first period put back where it stood, if it is still there. */
  function holdPlace() {
    const box = frame.value
    const slot = anchor ? slotOf(anchor.key) : undefined
    if (!box || !slot || !anchor) return
    const left = slot.getBoundingClientRect().left - box.getBoundingClientRect().left
    scrollFrame(box, box.scrollLeft + left - anchor.left)
  }

  watch(
    [() => named(span.keys()), span.running, width],
    () => {
      if (!frame.value || !width.value) return
      const keys = span.keys()
      if (opened === null || named(opened) !== named(keys)) {
        const live = span.running() !== null
        if (live && movedOn(keys)) {
          if (!following) holdPlace()
        } else {
          scrollFrame(frame.value, 0)
          openedLive = live
          following = live
        }
        opened = [...keys]
      }
      if (following) toRunning()
      measure()
    },
    { flush: 'post' },
  )

  /**
   * Scrolls the frame, as far as it must, so `element` stands whole between the scale and the
   * frame's end. The room past the scale is the gap the plot keeps after it, which holds the
   * focus ring, as the frame's reach past the chart's end does at the other side.
   */
  function reveal(element: HTMLElement) {
    const box = frame.value
    if (!box) return
    const room = box.getBoundingClientRect()
    const own = element.getBoundingClientRect()
    const start = room.left + gutter.value
    if (own.left < start) box.scrollLeft -= start - own.left
    else if (own.right > room.right) box.scrollLeft += own.right - room.right
  }

  return {
    gutter: computed(() => `${gutter.value}px`),
    hidden: computed(() => ({ start: hiddenStart.value, end: hiddenEnd.value })),
    reveal,
    width,
  }
}
