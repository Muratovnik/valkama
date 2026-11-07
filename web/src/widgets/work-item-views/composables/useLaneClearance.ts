/**
 * What the board brings into view in a lane stands clear of the lane's heading, at the gap the
 * lane keeps under its heading where nothing is scrolled.
 *
 * The scroller's padding stops what it brings into view below the row of state names and a
 * heading of one row. A heading is as tall as its words make it, though — one row to three, by
 * the board's width, the language and what it says is out of sight — and the scroll that brings
 * a tile in can move the board sideways too, which changes what the heading says, and so its
 * height, a frame after the scroll. One padding for every lane could not be right for each: a
 * tile stopped 28px under a heading of three rows and 1px short of the gap under one of one. So
 * once the scroll has happened, and again once what it changed has been drawn, the tile is read
 * against its own lane's heading and moved down to the lane's gap if it stands closer.
 */
import type { Ref } from 'vue'

import { useEventListener } from '@vueuse/core'

import { afterPlaces, placesDue } from '@/widgets/work-item-views/composables/lanePlaceReads.ts'

/** The latest request owns the board's position: an earlier one still settling gives way. */
let latest = 0

/** What the reader sees of a control in a lane: a tile's sheet, or the control itself. */
function drawn(target: Element): Element {
  return target.closest('.work-item-tile') ?? target
}

/** The gap between a lane's heading and the first tile of a cell, as the lane lays them out. */
function laneGap(lane: Element, cell: Element): number {
  const first = cell.querySelector('.work-item-tile') ?? cell
  const inset = first.getBoundingClientRect().top - cell.getBoundingClientRect().top
  return Number.parseFloat(getComputedStyle(lane).rowGap) + inset
}

/** Moves the board up to the lane's gap under the heading if `target` stands closer; false if it did not. */
function clear(target: Element): boolean {
  const lane = target.closest('.board-lane')
  const cell = target.closest('.lane-cells > *')
  const head = lane?.querySelector(':scope > .lane-head')
  const scroller = target.closest('.work-item-lanes')
  if (!lane || !cell || !head || !scroller) return false
  const short =
    head.getBoundingClientRect().bottom +
    laneGap(lane, cell) -
    drawn(target).getBoundingClientRect().top
  if (short <= 0.5) return false
  scroller.scrollTop -= short
  return true
}

/**
 * Keeps `target` clear of its lane's heading after a scroll that brought it into view: once the
 * scroll is done, before it is drawn, and on the next frames, once the board has said what it
 * shows out of sight after that scroll and the heading has taken its height. A lane the scroll
 * laid out again reads its heading's place a frame later still, and a new place moves the board's
 * content (`lanePlaceReads`): so the tile is cleared again each time the places due have been
 * read, until a frame passes with none due.
 */
export function clearOfHeading(target: Element) {
  latest += 1
  const mine = latest
  const live = () => mine === latest && target.isConnected
  const settled = () => {
    if (!live()) return
    clear(target)
    requestAnimationFrame(() => {
      if (live() && placesDue()) afterPlaces(settled)
    })
  }
  let passes = 3
  const pass = () => {
    if (!live()) return
    clear(target)
    passes -= 1
    if (passes > 0) requestAnimationFrame(pass)
    else afterPlaces(settled)
  }
  queueMicrotask(pass)
}

/**
 * The board's own ways of bringing a lane's content into view: the keyboard reaching it, and a
 * press that opens a tile, which leaves the tile in view beside its card.
 */
export function useLaneClearance(scroller: Ref<HTMLElement | null>) {
  useEventListener(scroller, 'focusin', (event: FocusEvent) => {
    if (event.target instanceof Element && event.target.matches(':focus-visible'))
      clearOfHeading(event.target)
  })
  useEventListener(scroller, 'click', (event: MouseEvent) => {
    const opener = event.target instanceof Element ? event.target.closest('.tile-open') : null
    if (opener) clearOfHeading(opener)
  })
}
