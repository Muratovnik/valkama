import { expect } from '@playwright/test'
import type { BrowserContext, Locator, Page } from '@playwright/test'

import { installBackend } from './backend.ts'
import {
  addressOf,
  installDocuments,
  linkIn,
  openPage,
  shot,
  target,
} from './documentPageSurface.ts'
import { test } from './test.ts'

/**
 * How `/doc` is drawn where the drawing can go wrong without a computed style saying so:
 * a font that arrives after the text, and a forced palette that drops every fill.
 */

const doNothing = () => {}

/**
 * The page at an anchor, with its fonts held back until the answer is released. The fonts
 * swap in, so the text is drawn, and scrolled to its anchor, in the fallback first.
 */
async function openWithFontsHeld(page: Page) {
  let release = doNothing
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route('**/*.woff2', async (route) => {
    await held
    await route.continue()
  })
  await installBackend(page)
  await installDocuments(page)
  // A load waits for the fonts, which are what is held.
  await page.goto(addressOf('docs/plan.md', '#kb:a7f3'), { waitUntil: 'commit' })
  await expect(target(page)).toContainText('The target')
  await expect(page.locator('.document-body')).toBeFocused()
  return release
}

/** How far the target's top stands below the scroller's, in pixels. */
const targetTop = (page: Page) =>
  page.evaluate(() => {
    const block = document.querySelector('.document-block.is-target')
    const body = document.querySelector('.document-body')
    return block && body
      ? block.getBoundingClientRect().top - body.getBoundingClientRect().top
      : Number.NaN
  })

test.describe('a font that arrives after the text', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
  })

  test('the anchor stays at the top when the font arrives after the text', async ({ page }) => {
    const release = await openWithFontsHeld(page)
    release()
    await page.evaluate(() => document.fonts.ready)
    // Where a link lands it: at the scroller's top edge, less the block's own margin.
    await expect.poll(() => targetTop(page)).toBeGreaterThanOrEqual(0)
    await expect.poll(() => targetTop(page)).toBeLessThan(16)
  })

  test('a reader who moved before the font arrived is left where they are', async ({ page }) => {
    const release = await openWithFontsHeld(page)
    await page.keyboard.press('PageDown')
    await expect.poll(() => targetTop(page)).toBeLessThan(-100)
    const moved = await page.locator('.document-body').evaluate((node) => node.scrollTop)
    release()
    await page.evaluate(() => document.fonts.ready)
    // The text reflowed under them; it was not taken back to the anchor.
    await expect.poll(() => targetTop(page)).toBeLessThan(-100)
    expect(await page.locator('.document-body').evaluate((node) => node.scrollTop)).toBeGreaterThan(
      moved - 100,
    )
  })
})

type Point = { x: number; y: number }

/**
 * The colours a screenshot holds at some points, read by the browser itself in a blank
 * page of its own, since nothing here decodes a PNG. A pixel is what a forced palette
 * left on screen, which a computed style does not say.
 */
async function pixelsAt(context: BrowserContext, png: Buffer, points: Point[]) {
  const decoder = await context.newPage()
  try {
    return await decoder.evaluate(
      async ({ source, at }) => {
        const image = new Image()
        image.src = source
        await image.decode()
        const canvas = document.createElement('canvas')
        canvas.width = image.width
        canvas.height = image.height
        const drawing = canvas.getContext('2d')
        if (!drawing) throw new Error('No canvas')
        drawing.drawImage(image, 0, 0)
        return at.map(({ x, y }) => drawing.getImageData(x, y, 1, 1).data.slice(0, 3).join(','))
      },
      { source: `data:image/png;base64,${png.toString('base64')}`, at: points },
    )
  } finally {
    await decoder.close()
  }
}

/** The mark's column and the ring's, against the ground beside each, at the block's middle. */
async function edges(page: Page, context: BrowserContext, block: Locator) {
  const box = await block.boundingBox()
  if (!box) throw new Error('No block')
  const middle = Math.round(box.y + box.height / 2)
  const left = Math.round(box.x)
  const right = Math.round(box.x + box.width)
  const below = Math.round(box.y + box.height + 6)
  const [ground, mark, gap, ring, beyond] = await pixelsAt(context, await page.screenshot(), [
    { x: left - 8, y: middle },
    { x: left + 1, y: middle },
    { x: left + 1, y: below },
    { x: right + 3, y: middle },
    { x: right + 14, y: middle },
  ])
  return { ground, mark, gap, ring, beyond }
}

test.describe('in a forced palette', () => {
  test.use({ forcedColors: 'active' })

  test('the mark and the ring on the target are still drawn when the fills go', async ({
    page,
    context,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    await openPage(page, 'docs/plan.md', '#kb:a7f3')
    await expect(target(page)).toBeInViewport()

    // Opened by the address: marked, and focused with no ring, since nobody pressed.
    const opened = await edges(page, context, target(page))
    expect(opened.mark).not.toBe(opened.ground)
    expect(opened.gap).toBe(opened.ground)
    expect(opened.ring).toBe(opened.beyond)
    await shot(page, 'forced-1280')

    // Sent there by a key: the ring the reader follows is drawn too.
    await linkIn(page, 'notes.md').focus()
    await page.keyboard.press('Enter')
    await expect(page).toHaveTitle('The notes')
    await linkIn(page, 'plan.md#part-two').focus()
    await page.keyboard.press('Enter')
    await expect(target(page)).toContainText('Part two')
    await expect(target(page)).toBeFocused()
    const pressed = await edges(page, context, target(page))
    expect(pressed.mark).not.toBe(pressed.ground)
    expect(pressed.ring).not.toBe(pressed.beyond)
    await shot(page, 'forced-1280-ring')
  })
})
