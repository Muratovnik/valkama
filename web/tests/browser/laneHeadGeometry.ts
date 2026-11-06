/**
 * What a lane heading draws, read from the page, and the comparisons the lane-heading specs make
 * of it: a box, a heading's drawn parts, and whether two boxes overlap or agree.
 */
import type { Locator } from '@playwright/test'

export interface Box {
  bottom: number
  left: number
  right: number
  top: number
}

/** What one heading draws, with every box relative to the heading's own corner. */
export interface Drawn {
  actions: Box[]
  counts: Box[]
  elsewhere: Box[]
  height: number
  title: Box[]
  toggle: Box
}

/** The drawn text of the title (cut to its own box) and the boxes of the other parts. */
export const drawnParts = (head: Element): Drawn => {
  const origin = head.getBoundingClientRect()
  const local = (rect: { bottom: number; left: number; right: number; top: number }): Box => ({
    bottom: rect.bottom - origin.top,
    left: rect.left - origin.left,
    right: rect.right - origin.left,
    top: rect.top - origin.top,
  })
  const boxes = (selector: string) =>
    [...head.querySelectorAll(selector)].map((node) => local(node.getBoundingClientRect()))
  const title = head.querySelector('.lane-title')
  const own = title?.getBoundingClientRect()
  const range = document.createRange()
  if (title) range.selectNodeContents(title)
  const drawnTitle = own
    ? [...range.getClientRects()].map((rect) =>
        local({
          bottom: Math.min(rect.bottom, own.bottom),
          left: Math.max(rect.left, own.left),
          right: Math.min(rect.right, own.right),
          top: Math.max(rect.top, own.top),
        }),
      )
    : []
  const toggle = head.querySelector('.lane-toggle')
  return {
    actions: boxes('.lane-actions > *'),
    counts: boxes('.lane-counts'),
    elsewhere: boxes('.lane-elsewhere'),
    height: origin.height,
    title: drawnTitle,
    toggle: local(toggle?.getBoundingClientRect() ?? origin),
  }
}

export const overlaps = (one: Box, two: Box) =>
  one.left < two.right - 0.5 &&
  two.left < one.right - 0.5 &&
  one.top < two.bottom - 0.5 &&
  two.top < one.bottom - 0.5

/** Waits for two frames, so the layout a scroll started has been drawn before it is read. */
export const settle = (locator: Locator) =>
  locator.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  )

export const sameBoxes = (one: Box[], two: Box[]) =>
  one.length === two.length &&
  one.every((box, index) => {
    const other = two[index]
    return (
      other !== undefined &&
      Math.abs(box.left - other.left) <= 0.5 &&
      Math.abs(box.top - other.top) <= 0.5 &&
      Math.abs(box.right - other.right) <= 0.5 &&
      Math.abs(box.bottom - other.bottom) <= 0.5
    )
  })
