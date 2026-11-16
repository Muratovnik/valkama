/**
 * The whole words of a text a clamp cuts to its lines cover every line it shows, in the built app.
 * A card's title on the graph is clamped to two lines and a frame's to three. Laid from the first
 * letter, the whole words ran on to the window's edge on one line, over the first line alone: at
 * a zoom of 0.75 and 0.625 the clamp's second line and its ellipsis showed under them, and the
 * title read twice. Now the whole words are as high and wide as the lines the clamp shows, at
 * every zoom, their first letter still on the cut text's.
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { markCut, openCutField, standing } from './cutFieldPage.ts'
import { settledZoom, zoomOutButton } from './graphFieldCamera.ts'
import { test } from './test.ts'

/**
 * What of the marked cut text shows outside the whole words: its box, whose lines and ellipsis
 * the clamp shows, and each of its lines that the clamp lets show. A pixel of rim is no gap.
 */
const uncovered = (page: Page) =>
  page.evaluate(() => {
    const cut = document.querySelector('[data-probe-cut]')
    const laid = document.querySelector('.whole-text')?.getBoundingClientRect()
    if (!cut || !laid) return ['no whole words over a cut text']
    const clamp = cut.getBoundingClientRect()
    const outside = (box: DOMRect) =>
      box.left < laid.left - 1 ||
      box.right > laid.right + 1 ||
      box.top < laid.top - 1 ||
      box.bottom > laid.bottom + 1
    const found: string[] = []
    if (outside(clamp))
      found.push(
        `the clamp's box ${JSON.stringify(clamp)} past the whole words ${JSON.stringify(laid)}`,
      )
    const range = document.createRange()
    range.selectNodeContents(cut)
    for (const line of range.getClientRects()) {
      // What the clamp lets show of the line: the lines past its last are laid out and hidden.
      const shown = new DOMRect(
        Math.max(line.left, clamp.left),
        Math.max(line.top, clamp.top),
        Math.min(line.right, clamp.right) - Math.max(line.left, clamp.left),
        Math.min(line.bottom, clamp.bottom) - Math.max(line.top, clamp.top),
      )
      if (shown.width > 1 && shown.height > 1 && outside(shown))
        found.push(`a line ${JSON.stringify(shown)} past the whole words ${JSON.stringify(laid)}`)
    }
    return found
  })

/** Brings the field from the zoom it opens at to `zoom`: a button's step, or the wheel's. */
async function zoomTo(page: Page, zoom: number) {
  const opened = await settledZoom(page)
  expect(opened, 'the field opens at its reading zoom').toBeCloseTo(0.75, 2)
  if (zoom < opened) await zoomOutButton(page).click()
  for (let step = opened; step < zoom - 0.01; step *= 1.2) {
    if (zoom === 1) {
      // The wheel zooms by two to the power of its delta times 0.002: 0.75 to 1 is -207.5.
      const view = await page.locator('.graph-flow').boundingBox()
      await page.mouse.move((view?.x ?? 0) + 20, (view?.y ?? 0) + 20)
      await page.mouse.wheel(0, Math.log2(opened / zoom) / 0.002)
      break
    }
    await page.getByRole('button', { name: 'Zoom in', exact: true }).click()
    await settledZoom(page)
  }
  expect(await settledZoom(page)).toBeCloseTo(zoom, 2)
}

/** Rests on the first cut text of `selector` in sight, and reads its whole words against it. */
async function restOnCut(page: Page, selector?: string) {
  const point = await markCut(page, selector)
  expect(point, 'a text the clamp cuts, in sight').not.toBeNull()
  await page.mouse.move(point?.x ?? 0, point?.y ?? 0)
  await expect(page.locator('.whole-text')).toBeVisible()
  await expect.poll(() => standing(page)).toBe('on its text')
  return uncovered(page)
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('valkama-locale', 'en'))
})

for (const zoom of [0.625, 0.75, 1, 1.296]) {
  test(`at a zoom of ${zoom} the whole words of a card's title cover both lines its clamp shows`, async ({
    page,
  }) => {
    await openCutField(page, 1440)
    await zoomTo(page, zoom)
    expect(await restOnCut(page)).toEqual([])
  })
}

/** Long enough that a frame's header cuts it at its third line. */
const FRAME_LONGER =
  ': a title that runs on past the three lines a frame gives it, and on past them again, and on once more'

// At its own size, and at the reading zoom the field opens at.
for (const zoom of [1, 0.75]) {
  test(`at a zoom of ${zoom} the whole words of a frame’s title cover the three lines its clamp shows`, async ({
    page,
  }) => {
    await openCutField(page, 1440, FRAME_LONGER)
    await zoomTo(page, zoom)
    expect(await restOnCut(page, '.graph-frame-title')).toEqual([])
  })
}
