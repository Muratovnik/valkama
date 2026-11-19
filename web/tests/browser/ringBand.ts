/** Where a browser spec points at a ring's sector. */
import type { Locator } from '@playwright/test'

/**
 * The middle of the band of a ring's sector, in the page, where its hint stands
 * (`data-hint-point`, in the ring's box of 100 units): a point in that sector, where the middle of
 * its box would be the ring's hole or another sector.
 */
export const sectorBand = (sector: Locator) =>
  sector.evaluate((drawn: SVGElement) => {
    const [x = 0, y = 0] = (drawn.dataset.hintPoint ?? '').split(' ').map(Number)
    const box = drawn.closest('.donut-ring')?.getBoundingClientRect() ?? new DOMRect()
    return { x: box.x + (x / 100) * box.width, y: box.y + (y / 100) * box.height }
  })
