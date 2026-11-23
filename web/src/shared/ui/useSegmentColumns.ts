/**
 * The columns a row of segments that may wrap stands in (`segmentColumns`), read off the track.
 *
 * The row is measured while it stands on its one line and the browser has just wrapped it: each
 * segment's words in its font plus its padding make the line, and the widest words in the chosen
 * weight, inside a column's own padding, make a column. So choosing another segment never leaves
 * its words wider than their column, and a column, which centres its words, holds them in less
 * padding than a segment at its own width.
 *
 * The one line is the browser's to break, and the room it broke in is kept. Measured words can
 * come out a hair short of laid-out ones, so the row goes back to its one line only in more room
 * than that, or it would stand on the line, wrap, and stand on it again. New words or a font that
 * arrives put the row back on its one line to be measured afresh.
 */
import { nextTick, shallowRef, watch } from 'vue'
import type { Ref } from 'vue'

import { useEventListener, useResizeObserver } from '@vueuse/core'

import { drawnWidth } from '@/shared/lib/textWidth.ts'
import { segmentColumns } from '@/shared/ui/segmentColumns.ts'

/** Layout rounds a run of words up to 1/64 px, so a measure rounded the same way is never short. */
const LAYOUT_UNIT = 64

const px = (value: string) => Number.parseFloat(value) || 0

/** A segment's words drawn in `weight`, or in its own. */
function wordsWidth(segment: HTMLElement, style: CSSStyleDeclaration, weight?: string): number {
  const font = `${style.fontStyle} ${weight ?? style.fontWeight} ${style.fontSize} ${style.fontFamily}`
  return Math.ceil(drawnWidth(segment.textContent.trim(), font) * LAYOUT_UNIT) / LAYOUT_UNIT
}

/** What a wrapped row is laid out by, read while it stands on its one line. */
interface RowMeasure {
  gap: number
  line: number
  widest: number
}

function measureRow(track: HTMLElement, segments: readonly HTMLElement[]): RowMeasure {
  const style = getComputedStyle(track)
  const gap = px(style.columnGap)
  const chosen = style.getPropertyValue('--segmented-chosen-weight').trim() || undefined
  const inset = 2 * px(style.getPropertyValue('--segmented-column-padding'))
  let line = (segments.length - 1) * gap
  let widest = 0
  for (const segment of segments) {
    const own = getComputedStyle(segment)
    line += wordsWidth(segment, own) + px(own.paddingInlineStart) + px(own.paddingInlineEnd)
    widest = Math.max(widest, wordsWidth(segment, own, chosen) + inset)
  }
  return { gap, line, widest }
}

/**
 * The count of columns, or null while the row stands on its one line. `wrap` says whether the
 * row may wrap at all; `words` changes whenever its segments' words do.
 */
export function useSegmentColumns(
  track: Readonly<Ref<HTMLElement | null>>,
  wrap: () => boolean,
  words: () => string,
) {
  const columns = shallowRef<number | null>(null)
  let measured: RowMeasure | null = null
  /** The room the one line was last seen to wrap in. */
  let wrapsAt = 0

  function measure() {
    const node = track.value
    const segments = node ? [...node.children].filter((one) => one instanceof HTMLElement) : []
    if (!node || !wrap() || segments.length < 2) {
      columns.value = null
      return
    }
    const style = getComputedStyle(node)
    const room = node.clientWidth - px(style.paddingInlineStart) - px(style.paddingInlineEnd)
    if (columns.value === null || !measured) {
      const top = segments[0]?.offsetTop
      if (segments.every((segment) => segment.offsetTop === top)) return
      wrapsAt = room
      measured = measureRow(node, segments)
    }
    const { gap, line, widest } = measured
    const count = segmentColumns({
      count: segments.length,
      gap,
      line: room <= wrapsAt ? Number.POSITIVE_INFINITY : line,
      room,
      widest,
    })
    columns.value = count === segments.length ? null : count
  }

  async function afresh() {
    measured = null
    wrapsAt = 0
    columns.value = null
    await nextTick()
    measure()
  }

  useResizeObserver(track, measure)
  watch([wrap, words], afresh, { flush: 'post' })
  useEventListener(
    () => (typeof document === 'undefined' ? undefined : document.fonts),
    'loadingdone',
    afresh,
  )

  return columns
}
