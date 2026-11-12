/**
 * The two small charts a tile of a rail draws, in the browser at a tile's width on its ground:
 * a trend of a month of days and a share bar, with a bar that has nothing to share. Each is one
 * image named in words; in the light and the dark theme every mark stands apart from its ground
 * by a contrast a reader can see and from its neighbour by a gap of ground, so no part is told by
 * its hue alone; and a forced palette keeps every mark in its inks. Each theme attaches what it
 * measured.
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { test } from './test.ts'

const HALF_PIXEL = 0.5

/** WCAG's least contrast for a part of a graphic a reader must tell from what is around it. */
const GRAPHIC_CONTRAST = 3

/**
 * The small charts as drawn: each mark's box and paint, the ground they stand on, and the
 * contrast between them. A colour is read back through a canvas, which turns any notation the
 * tokens use into the sRGB the screen shows.
 */
function minis(page: Page) {
  return page.evaluate(() => {
    const canvas = document.createElement('canvas')
    canvas.width = 1
    canvas.height = 1
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) throw new Error('no canvas to read colours with')
    const rgb = (color: string) => {
      context.clearRect(0, 0, 1, 1)
      context.fillStyle = color
      context.fillRect(0, 0, 1, 1)
      return Array.from(context.getImageData(0, 0, 1, 1).data.subarray(0, 3))
    }
    const luminance = (color: string) => {
      const [red = 0, green = 0, blue = 0] = rgb(color).map((channel) => {
        const unit = channel / 255
        return unit <= 0.04045 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4
      })
      return 0.2126 * red + 0.7152 * green + 0.0722 * blue
    }
    const contrast = (first: string, second: string) => {
      const [light = 0, dark = 0] = [luminance(first), luminance(second)].sort((a, b) => b - a)
      return (light + 0.05) / (dark + 0.05)
    }
    const section = document.querySelector('[data-harness="mini"]')
    if (!section) throw new Error('the small charts are not drawn')
    const ground = getComputedStyle(section).backgroundColor
    const [trend, bar, empty] = [...section.querySelectorAll('[role="img"]')]
    if (!trend || !bar || !empty) throw new Error('a small chart is missing')
    const mark = (element: Element) => {
      const { left, right, top, bottom } = element.getBoundingClientRect()
      const paint = getComputedStyle(element).backgroundColor
      return {
        key: (element as HTMLElement).dataset.key ?? '',
        slot: (element as HTMLElement).dataset.slot ?? '',
        left,
        right,
        top,
        bottom,
        contrast: contrast(paint, ground),
        mask: getComputedStyle(element).maskImage,
      }
    }
    // This body runs in the page, so a helper at the module's own scope would not be there.
    // eslint-disable-next-line unicorn/consistent-function-scoping -- see above
    const box = (element: Element) => {
      const { top, bottom } = element.getBoundingClientRect()
      return { top, bottom, name: element.getAttribute('aria-label') ?? '' }
    }
    return {
      trend: {
        ...box(trend),
        periods: trend.querySelectorAll('.mini-trend-period').length,
        // Which period each column stands in, and the column itself.
        columns: [...trend.querySelectorAll('.mini-trend-period')].map((period) => {
          const column = period.querySelector('.mini-trend-column')
          return column ? mark(column) : null
        }),
        floor: contrast(
          getComputedStyle(trend.querySelector('.mini-trend-floor') ?? trend).backgroundColor,
          ground,
        ),
      },
      bar: {
        ...box(bar),
        parts: [...bar.querySelectorAll('.mini-share-part')].map((part) => mark(part)),
      },
      empty: {
        ...box(empty),
        parts: empty.querySelectorAll('.mini-share-part').length,
        track: contrast(getComputedStyle(empty).backgroundColor, ground),
      },
    }
  })
}

for (const colorScheme of ['light', 'dark'] as const)
  test(`in the ${colorScheme} theme the small charts say what they draw and draw it apart from their ground`, async ({
    page,
  }, testInfo) => {
    await page.emulateMedia({ colorScheme })
    await page.setViewportSize({ width: 1024, height: 900 })
    await page.goto('/tests/browser/harness.html?lang=en&surface=charts')
    const mini = page.locator('[data-harness="mini"]')
    // Each is one image named in words, which is all a reader who cannot see it is given.
    await expect(
      mini.getByRole('img', { name: 'Time per day in October, the last day so far' }),
    ).toBeVisible()
    await expect(
      mini.getByRole('img', { name: 'Shares of time: core 50%, web 26%, docs 4%, the rest 20%' }),
    ).toBeVisible()
    const seen = await minis(page)
    await testInfo.attach(`minis-${colorScheme}`, {
      body: JSON.stringify(seen, null, 2),
      contentType: 'application/json',
    })

    // The trend: a period each, the day with no figure drawn as nothing, the tallest day the
    // whole height, the running day hatched; every column and the floor apart from the ground.
    const { trend } = seen
    expect(trend.periods).toBe(30)
    expect(trend.columns[3], 'a day with no figure').toBeNull()
    const drawn = trend.columns.filter((column) => column !== null)
    const top = Math.min(...drawn.map((column) => column.top))
    expect(Math.abs(top - trend.top), 'the tallest day').toBeLessThanOrEqual(HALF_PIXEL)
    for (const column of drawn)
      expect(Math.abs(column.bottom - trend.bottom), 'a column off the floor').toBeLessThanOrEqual(
        1,
      )
    expect(trend.columns.at(-1)?.mask, 'the running day').toContain('repeating-linear-gradient')
    for (const column of drawn)
      expect(column.contrast, `day ${column.key}`).toBeGreaterThanOrEqual(GRAPHIC_CONTRAST)

    // The share bar: each part as long as its share, largest first and the rest last, apart from
    // the next by a gap of ground, so no part is told from another by its hue alone.
    const { parts } = seen.bar
    expect(parts.map((part) => part.key)).toEqual(['core', 'web', 'docs', 'rest'])
    expect(parts.at(-1)?.slot).toBe('other')
    const lengths = parts.map((part) => part.right - part.left)
    const whole = lengths.reduce((sum, length) => sum + length, 0)
    for (const [index, share] of [0.5, 0.26, 0.04, 0.2].entries())
      expect(Math.abs((lengths[index] ?? 0) - share * whole), `part ${index}`).toBeLessThanOrEqual(
        1,
      )
    for (const [index, part] of parts.slice(1).entries())
      expect(part.left - (parts[index]?.right ?? 0), 'a gap of ground').toBeGreaterThanOrEqual(2)
    for (const part of parts)
      expect(part.contrast, `part ${part.key}`).toBeGreaterThanOrEqual(GRAPHIC_CONTRAST)

    // With nothing to share, the track alone at the same height, so a tile does not move.
    expect(seen.empty.parts).toBe(0)
    expect(seen.empty.bottom - seen.empty.top).toBeCloseTo(seen.bar.bottom - seen.bar.top, 1)
    expect(seen.empty.track).toBeGreaterThan(1)
  })

test('in a forced palette the small charts keep their marks in the palette’s inks', async ({
  page,
}) => {
  await page.emulateMedia({ forcedColors: 'active' })
  await page.goto('/tests/browser/harness.html?lang=en&surface=charts')
  const paints = await page.evaluate(() => {
    const probe = document.createElement('i')
    document.body.append(probe)
    const system = (name: string) => {
      probe.style.color = name
      return getComputedStyle(probe).color
    }
    const paint = (selector: string) => {
      const found = document.querySelector(`[data-harness="mini"] ${selector}`)
      if (!found) throw new Error(`${selector} is not drawn`)
      return getComputedStyle(found).backgroundColor
    }
    const result = {
      canvasText: system('CanvasText'),
      grayText: system('GrayText'),
      column: paint('.mini-trend-column'),
      floor: paint('.mini-trend-floor'),
      part: paint('.mini-share-part[data-slot="1"], .mini-share-part:not([data-slot="other"])'),
      rest: paint('.mini-share-part[data-slot="other"]'),
      track: paint('.mini-share-empty'),
    }
    probe.remove()
    return result
  })
  expect(paints.column).toBe(paints.canvasText)
  expect(paints.part).toBe(paints.canvasText)
  expect(paints.rest).toBe(paints.grayText)
  expect(paints.floor).toBe(paints.grayText)
  expect(paints.track).toBe(paints.grayText)
})
