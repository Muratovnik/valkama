import type { Locator } from '@playwright/test'

/**
 * How far each condition's box in a window stands from the middle of its text's first line, in
 * pixels, one per row the window lists (`data-step`): a box stands on its condition's first line,
 * as the card's checklist box does, so each is at most a pixel.
 */
export function stepBoxOffsets(window: Locator): Promise<number[]> {
  return window.locator('[data-step]').evaluateAll((rows) =>
    rows.map((row) => {
      const box = row.querySelector('.step-mark')?.getBoundingClientRect()
      const text = row.querySelector('label')
      if (!box || !text) return Number.POSITIVE_INFINITY
      const line = Number.parseFloat(getComputedStyle(text).lineHeight)
      return Math.abs(box.top + box.height / 2 - (text.getBoundingClientRect().top + line / 2))
    }),
  )
}
