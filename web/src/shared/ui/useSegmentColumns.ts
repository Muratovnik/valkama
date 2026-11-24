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
 *
 * What the row would stand in across another width (`columnsAt`) is read off the same measure, so
 * a host that lays the row out by how its lines fall reads them for the width it would give it,
 * not for the one it gives it now.
 */
import { nextTick, shallowRef, watch } from 'vue'
import type { Ref } from 'vue'

import { useEventListener, useResizeObserver } from '@vueuse/core'

import { canvasFont, laidOutWidth } from '@/shared/lib/textWidth.ts'
import { segmentColumns } from '@/shared/ui/segmentColumns.ts'

const px = (value: string) => Number.parseFloat(value) || 0

/** A segment's words drawn in `weight`, or in its own. */
function wordsWidth(segment: HTMLElement, style: CSSStyleDeclaration, weight?: string): number {
  return laidOutWidth(segment.textContent.trim(), canvasFont(style, weight))
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
 * The count of columns, or null while the row stands on its one line (`columns`), and the count
 * the row would stand in across a track of another width, null on one line there or before the
 * row is measured (`columnsAt`). `wrap` says whether the row may wrap at all; `words` changes
 * whenever its segments' words do.
 */
export function useSegmentColumns(
  track: Readonly<Ref<HTMLElement | null>>,
  wrap: () => boolean,
  words: () => string,
) {
  const columns = shallowRef<number | null>(null)
  const measured = shallowRef<RowMeasure | null>(null)
  /** The room the one line was last seen to wrap in. */
  let wrapsAt = 0

  const segmentsOf = (node: HTMLElement) =>
    [...node.children].filter((one) => one instanceof HTMLElement)
  const inset = (node: HTMLElement) => {
    const style = getComputedStyle(node)
    return px(style.paddingInlineStart) + px(style.paddingInlineEnd)
  }

  /** The columns in `room`, by the row's measure, or null where its one line fits. */
  function countIn(row: RowMeasure, count: number, room: number) {
    const { gap, line, widest } = row
    const fit = segmentColumns({
      count,
      gap,
      line: room <= wrapsAt ? Number.POSITIVE_INFINITY : line,
      room,
      widest,
    })
    return fit === count ? null : fit
  }

  function measure() {
    const node = track.value
    const segments = node ? segmentsOf(node) : []
    if (!node || !wrap() || segments.length < 2) {
      columns.value = null
      return
    }
    const room = node.clientWidth - inset(node)
    if (columns.value === null || !measured.value) {
      const top = segments[0]?.offsetTop
      if (segments.every((segment) => segment.offsetTop === top)) return
      wrapsAt = room
      measured.value = measureRow(node, segments)
    }
    columns.value = countIn(measured.value, segments.length, room)
  }

  /** The columns across a track `width` px wide, its padding included. */
  function columnsAt(width: number): number | null {
    const node = track.value
    const row = measured.value
    if (!node || !row || !wrap()) return null
    const count = segmentsOf(node).length
    return count < 2 ? null : countIn(row, count, width - inset(node))
  }

  async function afresh() {
    measured.value = null
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

  return { columns, columnsAt }
}
