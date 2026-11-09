import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { installBackend } from './backend.ts'
import { projectScope } from './planningFixtures.ts'
import { test } from './test.ts'

/** The board with a label picked, whose chip's operator is the pressed chip read here. */
const BOARD = serializePlatformRoute({
  module_id: 'planning',
  scope: projectScope,
  state: { labels: 'phase-1' },
})

/** How far around the chip is read: its focus ring stands outside it. */
const AROUND = 4

type Rgb = [number, number, number]

const luminance = (rgb: Rgb) => {
  const [red = 0, green = 0, blue = 0] = rgb.map((value) => {
    const unit = value / 255
    return unit <= 0.04045 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue
}

const contrast = (first: Rgb, second: Rgb) => {
  const [light = 0, dark = 0] = [luminance(first), luminance(second)].toSorted((a, b) => b - a)
  return (light + 0.05) / (dark + 0.05)
}

/** The colour most of these pixels are: what the rest of them are read against. */
const commonest = (pixels: Rgb[]) => {
  const tally = new Map<string, number>()
  for (const pixel of pixels) tally.set(pixel.join(','), (tally.get(pixel.join(',')) ?? 0) + 1)
  const [top] = [...tally].toSorted((left, right) => right[1] - left[1])
  return (top?.[0] ?? '0,0,0').split(',').map(Number) as Rgb
}

/**
 * The chip and a little around it as they were painted, row by row. Only the pixels say what
 * a forced palette has done: a computed style answers with what was asked for, and knows
 * nothing of the plate the palette lays behind a word. A blank page reads them, because the
 * app's own policy refuses an image from data.
 */
async function paintedRows(page: Page, chip: Locator) {
  const { height, width, x, y } = (await chip.boundingBox()) ?? { height: 0, width: 0, x: 0, y: 0 }
  const shot = await page.screenshot({
    clip: {
      height: height + AROUND * 2,
      width: width + AROUND * 2,
      x: x - AROUND,
      y: y - AROUND,
    },
  })
  const blank = await page.context().newPage()
  const rows = await blank.evaluate(async (data) => {
    const image = new Image()
    image.src = `data:image/png;base64,${data}`
    await image.decode()
    const canvas = document.createElement('canvas')
    canvas.width = image.width
    canvas.height = image.height
    const context = canvas.getContext('2d')
    context?.drawImage(image, 0, 0)
    const pixels = context?.getImageData(0, 0, image.width, image.height).data ?? []
    return Array.from({ length: image.height }, (_, row) =>
      Array.from({ length: image.width }, (__, column) => {
        const at = (row * image.width + column) * 4
        return [pixels[at], pixels[at + 1], pixels[at + 2]] as Rgb
      }),
    )
  }, shot.toString('base64'))
  await blank.close()
  return rows
}

for (const colorScheme of ['light', 'dark'] as const) {
  test(`a pressed chip is plain in the ${colorScheme} forced palette`, async ({ page }) => {
    await page.emulateMedia({ colorScheme, forcedColors: 'active' })
    await installBackend(page)
    await page.goto(BOARD)
    const chip = page.locator('.workspace-chips .filter-chip-operator').first()
    await chip.click()
    await expect(chip).toHaveAttribute('aria-pressed', 'true')
    await page.mouse.move(0, 0)

    const parts = await chip.evaluate((node) => {
      const box = node.getBoundingClientRect()
      const range = document.createRange()
      range.selectNodeContents(node)
      const word = range.getBoundingClientRect()
      const { bottom, height } = getComputedStyle(node, '::after')
      return {
        barRow: Math.round(box.height - Number.parseFloat(bottom) - Number.parseFloat(height) / 2),
        middle: Math.round(box.width / 2),
        word: {
          bottom: Math.round(word.bottom - box.top),
          left: Math.round(word.left - box.left),
          right: Math.round(word.right - box.left),
          top: Math.round(word.top - box.top),
        },
      }
    })
    const column = parts.middle + AROUND
    const rows = await paintedRows(page, chip)
    const at = (row: number): Rgb => rows[row + AROUND]?.[column] ?? [0, 0, 0]

    // The bar stands off what it lies on.
    expect(contrast(at(parts.barRow), at(1))).toBeGreaterThanOrEqual(3)

    // The word can be read against whatever the palette has put behind it.
    const word = rows
      .slice(parts.word.top + AROUND, parts.word.bottom + AROUND)
      .flatMap((row) => row.slice(parts.word.left + AROUND, parts.word.right + AROUND))
    const behind = commonest(word)
    expect(Math.max(...word.map((pixel) => contrast(pixel, behind)))).toBeGreaterThanOrEqual(4.5)

    // The ring from the keyboard is still there, off the page beside it.
    await page.keyboard.press('Shift+Tab')
    await page.keyboard.press('Tab')
    await expect(chip).toBeFocused()
    const ringed = await paintedRows(page, chip)
    const [ring, gap] = [ringed[1]?.[column], ringed[3]?.[column]] as [Rgb, Rgb]
    expect(contrast(ring, gap)).toBeGreaterThanOrEqual(3)
  })
}
