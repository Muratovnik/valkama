/**
 * A lane heading held at the top of the board covers what scrolls under it with its ground: its
 * own box, and the room the board keeps for rings beside it, where a tile passing under it would
 * show. Not below it: the tile coming out from under the heading shows from the heading's edge
 * on, where a ground spread round the heading hid its first 4px. And in a forced palette, which
 * draws no shadow, the room beside it is covered too: a tile's edge showed there as a stripe
 * beside the heading.
 *
 * Read off the pixels the page draws: the band under the heading's edge, over a tile, and the
 * strip beside the heading's start, over a tile whose edge crosses it.
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { installBackend } from './backend.ts'
import { openBoard, serve } from './boardPage.ts'
import type { Box } from './graphPixels.ts'
import { picture } from './graphPixels.ts'
import { serveWide } from './laneWideFixture.ts'
import { test } from './test.ts'

/**
 * The board scrolled so that an open lane's heading is held at the top, over a tile of a column
 * past the first: that tile's top `down` px above the heading's foot, or with `beside`, its top
 * `down` px under the heading's top and its start 30px past the board's start. The heading, the
 * tile and the board as drawn then.
 */
async function holdLane(page: Page, down: number, beside: boolean) {
  return page.locator('.work-item-lanes').evaluate(
    async (scroller, [by, side]) => {
      // This body runs in the page, so a module-scope helper is out of its reach.
      // eslint-disable-next-line unicorn/consistent-function-scoping -- see above
      const frame = () => new Promise((done) => requestAnimationFrame(done))
      // eslint-disable-next-line unicorn/consistent-function-scoping -- see above
      const rect = (box: DOMRect) => ({
        top: box.top,
        bottom: box.bottom,
        left: box.left,
        right: box.right,
      })
      const view = scroller.getBoundingClientRect()
      for (const lane of scroller.querySelectorAll<HTMLElement>('.board-lane.open')) {
        const head = lane.querySelector<HTMLElement>(':scope > .lane-head')
        // Beside, one past the first column, its middle brought to the board's start, as a
        // board scrolled sideways by hand stops anywhere; else one wholly in sight.
        const tile = [...lane.querySelectorAll<HTMLElement>('.work-item-tile')].find((one) => {
          const box = one.getBoundingClientRect()
          return side
            ? box.left - view.left > 100
            : box.left >= view.left && box.right <= view.right
        })
        if (!head || !tile) continue
        if (side) {
          const box = tile.getBoundingClientRect()
          scroller.style.scrollSnapType = 'none'
          scroller.scrollLeft += box.left - view.left + box.width / 2
        }
        scroller.scrollTop += lane.getBoundingClientRect().top - view.top
        await frame()
        const edge = side
          ? head.getBoundingClientRect().top + by
          : head.getBoundingClientRect().bottom - by
        scroller.scrollTop += tile.getBoundingClientRect().top - edge
        await frame()
        await frame()
        return {
          head: rect(head.getBoundingClientRect()),
          tile: rect(tile.getBoundingClientRect()),
          view: rect(scroller.getBoundingClientRect()),
        }
      }
      return null
    },
    [down, beside] as [number, boolean],
  )
}

/** How many of an area's pixels differ from the colour `paint` names, and how many it has. */
async function otherThan(page: Page, area: Box, paint: string) {
  const source = await picture(page, area)
  return page.evaluate(
    async ({ shot, colour }) => {
      const probe = document.createElement('span')
      probe.style.color = colour
      document.body.append(probe)
      const [r = 0, g = 0, b = 0] = (getComputedStyle(probe).color.match(/\d+/gu) ?? []).map(Number)
      probe.remove()
      const image = new Image()
      image.src = `data:image/png;base64,${shot}`
      await image.decode()
      const canvas = document.createElement('canvas')
      canvas.width = image.width
      canvas.height = image.height
      const context = canvas.getContext('2d') as CanvasRenderingContext2D
      context.drawImage(image, 0, 0)
      const { data } = context.getImageData(0, 0, image.width, image.height)
      let other = 0
      for (let at = 0; at < data.length; at += 4) {
        const off =
          Math.abs((data[at] ?? 0) - r) +
          Math.abs((data[at + 1] ?? 0) - g) +
          Math.abs((data[at + 2] ?? 0) - b)
        if (off > 6) other += 1
      }
      return { other, of: data.length / 4 }
    },
    { shot: source, colour: paint },
  )
}

async function openWideBoard(page: Page, width: number, forced: boolean) {
  await page.setViewportSize({ width, height: 900 })
  await page.emulateMedia({ reducedMotion: 'reduce', forcedColors: forced ? 'active' : 'none' })
  await installBackend(page)
  await serve(page)
  await serveWide(page)
  await openBoard(page)
  await page.evaluate(async () => document.fonts.ready)
  await page.mouse.move(0, 0)
}

for (const width of [1280, 390])
  test(`at ${width} the tile under a held heading shows from the heading's edge on`, async ({
    page,
  }) => {
    await openWideBoard(page, width, false)
    const held = await holdLane(page, 12, false)
    expect(held, 'a lane with a tile to hold its heading over').not.toBeNull()
    const { head, tile } = held ?? { head: { bottom: 0 }, tile: { left: 0, right: 0 } }
    // Across the tile, inside its edge, and down to 4px under the heading's foot.
    const band = {
      left: Math.ceil(tile.left) + 4,
      right: Math.floor(tile.right) - 4,
      top: Math.ceil(head.bottom),
      bottom: Math.ceil(head.bottom) + 4,
    }
    const drawn = await otherThan(page, band, 'var(--color-canvas)')
    expect(drawn.other, "the tile's pixels in the band under the heading").toBe(drawn.of)
  })

for (const width of [1280, 390])
  test(`at ${width} in a forced palette nothing shows beside a held heading`, async ({ page }) => {
    await openWideBoard(page, width, true)
    const held = await holdLane(page, 10, true)
    expect(held, 'a lane with a tile to hold its heading over').not.toBeNull()
    const { head, tile, view } = held ?? {
      head: { left: 0, top: 0, bottom: 0 },
      tile: { left: 0, top: 0 },
      view: { left: 0 },
    }
    // The tile crosses the strip, and its top edge runs through it.
    expect(tile.left).toBeLessThan(view.left)
    expect(tile.top).toBeGreaterThan(head.top)
    const strip = {
      left: Math.ceil(view.left),
      right: Math.floor(head.left),
      top: Math.ceil(head.top),
      bottom: Math.floor(head.bottom),
    }
    expect(strip.right - strip.left, 'the room beside the heading').toBeGreaterThan(1)
    const drawn = await otherThan(page, strip, 'Canvas')
    expect(drawn.other, 'pixels other than the ground beside the heading').toBe(0)
  })
