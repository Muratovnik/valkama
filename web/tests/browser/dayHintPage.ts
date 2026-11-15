/**
 * The day chart of the Analytics page as its day-hint specs read it: where a day's parts stand,
 * the hints the page shows, noted every frame, and where a hint stands against its day.
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { openReport, serve } from './analyticsPage.ts'
import type { Answer } from './analyticsPage.ts'

export interface Box {
  bottom: number
  left: number
  right: number
  top: number
}

export interface Shown {
  box: Box
  /** Which element the hint is: a new one for each hint the host opened. */
  id: number
  text: string
}

/** Where one day's parts stand, and where the next day's slot does. */
export const dayParts = (page: Page, index: number) =>
  page.evaluate((at) => {
    // This body runs in the page, so a helper at the module's own scope would not be there.
    // eslint-disable-next-line unicorn/consistent-function-scoping -- see above
    const box = (element: Element | null | undefined): Box => {
      const { left, top, right, bottom } = element?.getBoundingClientRect() ?? new DOMRect()
      return { left, top, right, bottom }
    }
    const days = document.querySelector('.spending-days')
    const slots = [...(days?.querySelectorAll('.period-slot') ?? [])]
    const slot = slots[at]
    return {
      field: box(days?.querySelector('.period-field')),
      slot: box(slot),
      column: box(slot?.querySelector('.period-column')),
      stack: box(slot?.querySelector('.period-stack')),
      // From the foot of the stack up.
      segments: [...(slot?.querySelectorAll('.period-segment') ?? [])]
        .map((segment) => box(segment))
        .sort((low, high) => high.bottom - low.bottom),
      next: box(slots[at + 1]),
    }
  }, index)

export type Parts = Awaited<ReturnType<typeof dayParts>>

/**
 * Teaches the page to note every hint it shows — which element it is, the words it shows and
 * its box — and, from then on, to note them every frame, so a hint that swapped for a frame and
 * back is noted too. The words leave out the copy the popup library keeps for a screen reader,
 * which can trail the words on screen by a render.
 */
const noteHints = (page: Page) =>
  page.evaluate(() => {
    const host = window as unknown as { hintFrames?: Shown[][]; hintsNow?: () => Shown[] }
    const ids = new WeakMap<Element, number>()
    let count = 0
    host.hintsNow = () =>
      [...document.querySelectorAll('.tooltip-hint')].map((hint) => {
        if (!ids.has(hint)) {
          count += 1
          ids.set(hint, count)
        }
        const shown = hint.cloneNode(true) as Element
        for (const copy of shown.querySelectorAll('[role="tooltip"]')) copy.remove()
        const { left, top, right, bottom } = hint.getBoundingClientRect()
        return {
          id: ids.get(hint) ?? 0,
          text: shown.textContent ?? '',
          box: { left, top, right, bottom },
        }
      })
    host.hintFrames = []
    const note = () => {
      host.hintFrames?.push(host.hintsNow?.() ?? [])
      requestAnimationFrame(note)
    }
    requestAnimationFrame(note)
  })

/** Every hint shown now (`noteHints`). */
export const hintsNow = (page: Page) =>
  page.evaluate(() => (window as unknown as { hintsNow: () => Shown[] }).hintsNow())

/** The hints noted every frame since the last call (`noteHints`). */
export const hintFrames = (page: Page) =>
  page.evaluate(
    () => (window as unknown as { hintFrames: Shown[][] }).hintFrames.splice(0) as Shown[][],
  )

/** Two frames, so what the last move asked for is drawn. */
export const frames = (page: Page) =>
  page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  )

/** The one hint shown, once it has stood still for two frames. */
export async function settledHint(page: Page): Promise<Shown> {
  let last: Shown[] = []
  await expect
    .poll(async () => {
      const shown = await hintsNow(page)
      await frames(page)
      last = await hintsNow(page)
      return last.length === 1 && JSON.stringify(shown) === JSON.stringify(last)
    }, 'one hint, standing still')
    .toBe(true)
  return last[0] as Shown
}

export const middleOf = (box: Box) => ({
  x: (box.left + box.right) / 2,
  y: (box.top + box.bottom) / 2,
})

const overlaps = (one: Box, other: Box) =>
  one.left < other.right &&
  other.left < one.right &&
  one.top < other.bottom &&
  other.top < one.bottom

/** Where a hint stands against the day's column: beside it, and over none of it. */
export function placeOf(hint: Box, parts: Parts) {
  const { column, slot, stack } = parts
  let side = 'neither'
  if (hint.left >= column.right) side = 'right'
  else if (hint.right <= column.left) side = 'left'
  return {
    side,
    // Beside means level with the column too, not over the plot or under it.
    level: hint.top < column.bottom && hint.bottom > column.top,
    covers: overlaps(hint, column) || overlaps(hint, slot) || overlaps(hint, stack),
  }
}

/** The days of the task section, drawn as a plot at `width`. */
export async function openDays(page: Page, width: number, answer?: Answer) {
  await serve(page, answer)
  const analytics = await openReport(page, width)
  const days = analytics.locator('.spending-days')
  await expect(days).toHaveAttribute('data-shown', 'chart')
  // The plot in the middle of the window, so a hint has room over and under it.
  await days
    .locator('.period-field')
    .evaluate((field) => field.scrollIntoView({ block: 'center', inline: 'nearest' }))
  await noteHints(page)
  return days
}
