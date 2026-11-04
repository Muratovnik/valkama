import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { aCardAsking, LINK, linkIn } from './documentBackend.ts'
import { paneOf, settled } from './documentBeside.ts'
import { openPage } from './documentPageSurface.ts'
import { test } from './test.ts'

/**
 * Where the head and the text of a document stand against each other: on a page of its own
 * one column as wide as a line of the text, in the middle of the window, with a table or a
 * block of code free to widen both ways; beside a card, from the pane's start as before.
 */

/** The column a page used to be, which a table or code may still take and no more. */
const OLD_COLUMN = 56 * 16

interface Box {
  left: number
  right: number
}

/** The edges that make the composition, in the window's pixels. */
const edges = (page: Page) =>
  page.evaluate(() => {
    const box = (selector: string) => {
      const node = document.querySelector(selector)
      if (!node) throw new Error(`Nothing drawn for ${selector}`)
      const { left, right } = node.getBoundingClientRect()
      return { left, right }
    }
    const actions = [...document.querySelectorAll('.document-head .overlay-header-actions button')]
    return {
      title: box('.document-head .overlay-header-name'),
      lastAction: actions.at(-1)?.getBoundingClientRect().right ?? Number.NaN,
      text: box('.document-text .document-block:has(.rich-paragraph)'),
      scrolled: document.documentElement.scrollWidth - innerWidth,
    }
  })

/** A table's and a block of code's edges, in a text that has both. */
const wideEdges = (page: Page) =>
  page.evaluate(() =>
    ['.document-text .rich-table-frame', '.document-text .rich-pre'].map((selector) => {
      const node = document.querySelector(selector)
      if (!node) throw new Error(`Nothing drawn for ${selector}`)
      const { left, right } = node.getBoundingClientRect()
      return { left, right }
    }),
  )

/** How far a wide block reaches past the text on each side. */
const overhang = (wide: Box, text: Box) => ({
  start: text.left - wide.left,
  end: wide.right - text.right,
})

for (const width of [1920, 1500, 1280])
  test.describe(`a page ${width}px wide`, () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize({ width, height: 900 })
    })

    test('stands the head over the text in one column in the middle', async ({ page }) => {
      await openPage(page, 'docs/plan.md')
      await expect(page.locator('.document-text .rich-table-frame')).toBeVisible()
      const { title, lastAction, text, scrolled } = await edges(page)
      // The actions stood about 300px past the end of every line, the text kept to the
      // start of a column 56rem wide.
      expect(Math.abs(title.left - text.left)).toBeLessThanOrEqual(1)
      expect(Math.abs(lastAction - text.right)).toBeLessThanOrEqual(1)
      expect(Math.abs(text.left + text.right - width)).toBeLessThanOrEqual(2)
      expect(scrolled).toBe(0)
    })

    test('lets a table and code widen both ways, as far as the old column', async ({ page }) => {
      await openPage(page, 'docs/plan.md')
      await expect(page.locator('.document-text .rich-table-frame')).toBeVisible()
      const { text } = await edges(page)
      for (const wide of await wideEdges(page)) {
        const { start, end } = overhang(wide, text)
        expect(start).toBeGreaterThan(0)
        expect(Math.abs(start - end)).toBeLessThanOrEqual(1)
        expect(wide.right - wide.left).toBeLessThanOrEqual(OLD_COLUMN)
      }
    })

    test('keeps a short text under its head too', async ({ page }) => {
      await openPage(page, 'docs/notes.md')
      await expect(page.locator('.document-text')).toContainText('Back to')
      const { title, lastAction, text } = await edges(page)
      expect(Math.abs(title.left - text.left)).toBeLessThanOrEqual(1)
      expect(Math.abs(lastAction - text.right)).toBeLessThanOrEqual(1)
    })
  })

test('the status line starts where the head does, in a font of its own', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 900 })
  await openPage(page, 'docs/plan.md', '#kb:missing')
  const status = page.locator('.document-status')
  await expect(status).toContainText('#kb:missing')
  // A `ch` counts in the font that spends it: unless the page names the measure as one
  // length, the status line's smaller font would set it several pixels off the head.
  const head = await page
    .locator('.document-head')
    .evaluate((node) => getComputedStyle(node).paddingLeft)
  await expect(status).toHaveCSS('padding-left', head)
})

test('beside a card the text still starts where the pane’s content does', async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 900 })
  const { drawer } = await aCardAsking(page, `Read \`${LINK}\` first.`)
  await linkIn(drawer, LINK).click()
  const { pane, body } = paneOf(page)
  await settled(drawer)
  await expect(pane.locator('.document-text .rich-table-frame')).toBeVisible()
  const start = await body.evaluate(
    (node) =>
      node.getBoundingClientRect().left + Number.parseFloat(getComputedStyle(node).paddingLeft),
  )
  for (const selector of ['.document-block:has(.rich-paragraph)', '.rich-table-frame', '.rich-pre'])
    expect(
      await pane
        .locator(`.document-text ${selector}`)
        .first()
        .evaluate((node) => node.getBoundingClientRect().left),
    ).toBeCloseTo(start, 0)
})
