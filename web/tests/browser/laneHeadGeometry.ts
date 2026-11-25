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

/** The parts a heading's rows are told by, each by its class. */
export const ROW_PARTS = [
  'lane-toggle',
  'lane-state',
  'lane-counts',
  'lane-elsewhere',
  'lane-actions',
]

/** Where the board is scrolled: to its first states, or to its middle ones, from the third on. */
export type Scroll = 'start' | 'middle'

/**
 * Waits until the headings have been drawn as the last scroll or width left them: a new width
 * reaches the board a frame before its headings, which are measured a frame later still, so it
 * waits until three frames running draw every heading and each of its parts alike.
 *
 * Given a `scroll`, the locator is the board, and it is held there: scrolled to it again before
 * each frame, and settled only while it stays at its aim and the aim has not moved. The third
 * state stands where the columns are as wide as the width they were last measured at, which a new
 * width reaches a frame later: aimed once, as the width was set, a walk that crossed a width where
 * one more column fits scrolled to another state on the way up than on the way down.
 */
export const settle = (locator: Locator, scroll: Scroll | null = null) =>
  locator.evaluate(
    async (node, [where, names]) => {
      const board = node as HTMLElement
      const aim = () =>
        where === 'start'
          ? 0
          : (board.querySelectorAll<HTMLElement>('.lanes-state')[2]?.offsetLeft ?? 0)
      // Each heading by its classes, its box and the boxes of the parts its rows are told by.
      const parts = names.map((name) => `.${name}`).join(', ')
      let drawn = ''
      for (let same = 0, at = 0; same < 3 && at < 60; at += 1) {
        if (where) board.scrollLeft = aim()
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
        const heads = [...document.querySelectorAll('.lane-head')].map((head) =>
          [
            head.className,
            ...[head, ...head.querySelectorAll(parts)].map((part) =>
              JSON.stringify(part.getBoundingClientRect()),
            ),
          ].join(' '),
        )
        const now = [where ? `${board.scrollLeft} ${aim()}` : '', ...heads].join('|')
        same = now === drawn ? same + 1 : 0
        drawn = now
      }
    },
    [scroll, ROW_PARTS] as const,
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
