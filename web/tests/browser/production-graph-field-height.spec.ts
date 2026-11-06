/**
 * The graph's field is as tall as the row its canvas leaves it, at every window: on a short
 * one it stops at the camera's strip, whose buttons stay in sight and take a press at their
 * middles. A floor of its own had kept the field 360px tall in a shorter row, so it ran over
 * the strip, and a press on «Fit whole graph» landed on a card.
 *
 * Served the broad synthetic space.
 */
import { expect } from '@playwright/test'

import { openBroadField, settledCamera } from './graphFieldCamera.ts'
import { test } from './test.ts'

for (const [width, height] of [
  [1280, 600],
  [1600, 500],
  [390, 600],
  [1280, 900],
] as const) {
  test(`at ${width}x${height} the field fills its row and the camera's buttons take a press`, async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await openBroadField(page, width, height)
    await settledCamera(page)
    const drawn = await page.evaluate(() => {
      const box = (selector: string) =>
        (document.querySelector(selector) as Element).getBoundingClientRect()
      const canvas = box('.graph-canvas')
      const key = box('.graph-legend-place')
      const field = box('.graph-flow')
      const strip = box('.graph-controls')
      const buttons = [...document.querySelectorAll('.graph-controls button')].map((button) => {
        const { left, right, top, bottom } = button.getBoundingClientRect()
        const hit = document.elementFromPoint((left + right) / 2, (top + bottom) / 2)
        return {
          name: button.textContent?.trim() ?? '',
          taken: hit !== null && button.contains(hit),
          hit: hit?.className.toString() ?? 'none',
          inSight: top >= 0 && bottom <= window.innerHeight,
        }
      })
      return {
        canvas: { top: canvas.top, bottom: canvas.bottom },
        key: { bottom: key.bottom },
        field: { top: field.top, bottom: field.bottom, height: field.height },
        // The strip's row starts at its margin, above its border.
        strip: {
          row:
            strip.top -
            Number.parseFloat(
              getComputedStyle(document.querySelector('.graph-controls') as Element).marginTop,
            ),
          bottom: strip.bottom,
        },
        buttons,
      }
    })
    expect(drawn.buttons, 'the three camera buttons').toHaveLength(3)
    for (const button of drawn.buttons)
      expect(button, `«${button.name}» in sight and pressed at its middle`).toMatchObject({
        taken: true,
        inSight: true,
      })
    // The field runs from the key's row to the strip, no further: the row is its size.
    expect(drawn.field.top, 'the field starts under the key').toBeCloseTo(drawn.key.bottom, 0)
    expect(drawn.field.bottom, "the field stops at the strip's row").toBeCloseTo(drawn.strip.row, 0)
    expect(drawn.strip.bottom, 'the strip inside the canvas').toBeLessThanOrEqual(
      drawn.canvas.bottom + 0.5,
    )
    expect(drawn.field.height, 'the field keeps room to draw').toBeGreaterThan(80)
  })
}
