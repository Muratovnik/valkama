import { expect } from '@playwright/test'
import type { Locator } from '@playwright/test'

/**
 * Who wrote an entry and when, on one line however long the name: the date stands where it
 * stands on the line beside it, at the end of the first line, and the name takes the rest,
 * whole. A name too long for the line used to push the date under it, to the start.
 */
export async function expectDateHeld(meta: Locator, where: string) {
  const place = await meta.evaluate((line) => {
    const [who, when] = [line.firstElementChild, line.lastElementChild]
    const box = line.getBoundingClientRect()
    const range = document.createRange()
    if (who) range.selectNodeContents(who)
    const whose = [...range.getClientRects()].filter((rect) => rect.width > 0)
    return {
      firstLine: whose[0]?.top ?? Number.NaN,
      // The name and the date laid end to end, against the line they have to share.
      crowded:
        whose.reduce((sum, rect) => sum + rect.width, 0) +
          (when?.getBoundingClientRect().width ?? 0) >
        box.width,
      whenTop: when?.getBoundingClientRect().top ?? Number.NaN,
      whenRight: when?.getBoundingClientRect().right ?? Number.NaN,
      right: box.right,
      whoWidth: who?.scrollWidth ?? 0,
      whoRoom: who?.clientWidth ?? 0,
    }
  })
  expect(place.crowded, `${where}: the name and the date do not fit one line`).toBe(true)
  expect(
    Math.abs(place.whenTop - place.firstLine),
    `${where}: the date's line`,
  ).toBeLessThanOrEqual(2)
  expect(Math.abs(place.whenRight - place.right), `${where}: the date's end`).toBeLessThanOrEqual(1)
  expect(place.whoWidth, `${where}: the name whole`).toBeLessThanOrEqual(place.whoRoom)
}
