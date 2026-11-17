/**
 * The three summary tiles stand one height at every width the page is read at, the height of
 * the widest, because each line under a figure keeps one line; a cut line says itself whole
 * over its own place, never in an empty hint. A tile not chosen answers the pointer with a ground of
 * its own, as a segment of the period does with its ink, and nothing moves.
 */
import { expect } from '@playwright/test'

import { openReport, pageAt, record, serve, shortfalls } from './analyticsPage.ts'
import { test } from './test.ts'

const WIDTHS = [1280, 1440, 1920]

test('the summary tiles stand one height at every width, each cut line whole over itself', async ({
  page,
}, info) => {
  await serve(page)
  const heights: Record<number, number[]> = {}
  for (const width of WIDTHS) {
    await openReport(page, width)
    const tiles = page.locator('.spending-tiles .segmented-option')
    await expect(tiles).toHaveCount(3)
    heights[width] = await tiles.evaluateAll((all) =>
      all.map((tile) => Math.round(tile.getBoundingClientRect().height * 10) / 10),
    )
    // Each line under a figure is one line high, however long its words at this width.
    const lines = await tiles
      .locator('.tile-change, .tile-rate, .tile-note')
      .evaluateAll((all) =>
        all.map(
          (line) =>
            line.getBoundingClientRect().height /
            Number.parseFloat(getComputedStyle(line).lineHeight),
        ),
      )
    for (const line of lines) expect(line).toBeLessThan(1.5)
    // The trend beside a figure gives way first: no figure is cut for it, by any fraction of a
    // pixel, which whole-pixel `scrollWidth` would not see.
    const figures = await shortfalls(page, '.spending-tiles .tile-figure')
    expect(figures, `the figures at ${width}px`).toHaveLength(3)
    for (const figure of figures)
      expect(figure.short, `«${figure.text}» at ${width}px`).toBeLessThanOrEqual(0.01)
  }
  await record(info, 'tiles-heights', heights)
  const widest = heights[1920] ?? []
  expect(new Set(widest).size, 'the three tiles at 1920px').toBe(1)
  for (const width of WIDTHS) expect(heights[width], `the tiles at ${width}px`).toEqual(widest)

  // At the narrowest width the tokens' notes are cut, and each says itself whole over its place.
  await openReport(page, 1280)
  const tokens = page.locator('.spending-tiles .segmented-option', {
    has: page.locator('[data-measure="tokens"]'),
  })
  const texts = await tokens.locator('.tile-note').allTextContents()
  const notes = texts.map((note) => note.trim())
  expect(notes).toHaveLength(2)
  const cut = await tokens.locator('.tile-note').evaluateAll((all) =>
    all
      .map((note, index) => ({ index, cut: note.scrollWidth > note.clientWidth }))
      .filter((note) => note.cut)
      .map((note) => note.index),
  )
  expect(cut.length, 'the tokens notes cut at 1280px').toBeGreaterThan(0)
  const whole = page.locator('.whole-text')
  for (const index of cut) {
    await tokens.locator('.tile-note').nth(index).hover()
    await expect(whole, `the cut note ${index + 1}`).toHaveText(notes[index] ?? '')
  }
})

test('a tile not chosen takes a ground under the pointer, and nothing moves', async ({
  page,
}, info) => {
  await serve(page)
  await openReport(page, 1440, pageAt())
  const tiles = page.locator('.spending-tiles .segmented-option')
  await expect(tiles).toHaveCount(3)
  await expect(tiles.nth(0)).toHaveAttribute('aria-checked', 'true')
  const look = () =>
    tiles.evaluateAll((all) =>
      all.map((tile) => {
        const box = tile.getBoundingClientRect()
        const parts = [...tile.querySelectorAll('*')].map((part) => {
          const { x, y, width, height } = part.getBoundingClientRect()
          return [x, y, width, height].map((side) => Math.round(side)).join(',')
        })
        return {
          ground: getComputedStyle(tile).backgroundColor,
          box: [box.x, box.y, box.width, box.height].map((side) => Math.round(side)).join(','),
          parts: parts.join(' '),
        }
      }),
    )
  await page.mouse.move(0, 0)
  const resting = await look()
  await tiles.nth(1).hover()
  const hovered = await look()
  await record(info, 'tiles-hover', { resting, hovered })
  expect(hovered[1]?.ground, 'the hovered tile').not.toBe(resting[1]?.ground)
  expect(hovered[0]?.ground, 'the chosen tile').toBe(resting[0]?.ground)
  expect(hovered[2]?.ground, 'the other tile').toBe(resting[2]?.ground)
  // A hovered tile does not read as the chosen one.
  expect(hovered[1]?.ground).not.toBe(resting[0]?.ground)
  for (const [index, tile] of hovered.entries()) {
    expect(tile.box, `tile ${index + 1}`).toBe(resting[index]?.box)
    expect(tile.parts, `the words of tile ${index + 1}`).toBe(resting[index]?.parts)
  }
})
