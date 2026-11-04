import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import { aCardAsking, linkIn } from './documentBackend.ts'
import { paneOf, settled } from './documentBeside.ts'
import { openPage } from './documentPageSurface.ts'
import { NESTED_PATH } from './nestedDocumentFixture.ts'
import { test } from './test.ts'

/**
 * What stands inside a list and a table of a document. Code in a list item widens past the
 * text as a top block of code does, from the item's own start and as far as a top block may;
 * the words of the item around it still end where the text does. On a phone a table's
 * column of labels leaves the frame room for the columns after it.
 */

/** The column a page used to be, which a table or code may take and no more. */
const OLD_COLUMN = 56 * 16

const edgesOf = (locator: Locator) =>
  locator.evaluate((node) => {
    const { left, right, width } = node.getBoundingClientRect()
    return { left, right, width }
  })

const widthOf = async (locator: Locator) => {
  const { width } = await edgesOf(locator)
  return width
}

/** The first item's long line of code and the words around it, and the second's short line. */
async function listEdges(scope: Locator | Page) {
  const items = scope.locator('.document-text .rich-item')
  const first = items.first()
  return {
    code: await edgesOf(first.locator('.rich-pre')),
    words: await edgesOf(first.locator('.rich-paragraph').first()),
    after: await edgesOf(first.locator('.rich-paragraph').last()),
    short: await edgesOf(items.nth(1).locator('.rich-pre')),
  }
}

const pageScroll = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - innerWidth)

test.describe('code in a list item', () => {
  test('on a wide page widens past the text from the item’s start', async ({ page }) => {
    const width = 1500
    await page.setViewportSize({ width, height: 900 })
    await openPage(page, NESTED_PATH)
    await expect(page.locator('.document-text .rich-pre').first()).toBeVisible()
    const { code, words, after, short } = await listEdges(page)
    // Kept to the text's end it scrolled inside 537 px while a table beside it took 876.
    expect(code.right).toBeGreaterThan(words.right + 1)
    expect(code.right).toBeLessThanOrEqual((width + OLD_COLUMN) / 2 + 1)
    expect(Math.abs(code.left - words.left)).toBeLessThanOrEqual(1)
    // The item's words still end where the text does, and a short line keeps the item's width.
    expect(Math.abs(after.right - words.right)).toBeLessThanOrEqual(1)
    expect(Math.abs(short.right - words.right)).toBeLessThanOrEqual(1)
    expect(await pageScroll(page)).toBe(0)
  })

  test('on a phone has no room past the text and scrolls in its own frame', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await openPage(page, NESTED_PATH)
    const frame = page.locator('.document-text .rich-pre').first()
    await expect(frame).toHaveAttribute('data-more', 'end')
    const { code, words } = await listEdges(page)
    expect(Math.abs(code.left - words.left)).toBeLessThanOrEqual(1)
    expect(code.right).toBeLessThanOrEqual(words.right + 1)
    expect(await pageScroll(page)).toBe(0)
  })

  test('beside a card, widened past a line of the text, widens as far as the pane’s content', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1920, height: 900 })
    const { drawer } = await aCardAsking(page, `Read \`${NESTED_PATH}\` first.`)
    await linkIn(drawer, NESTED_PATH).click()
    const { pane, body, edge } = paneOf(page)
    await settled(drawer)
    // A pane no wider than a line of the text has no room past it: only a wider one does.
    await edge.focus()
    await page.keyboard.press('End')
    const text = pane.locator('.document-text')
    await expect.poll(() => widthOf(text)).toBeGreaterThan(800)
    const { code, after, words: line } = await listEdges(pane)
    const end = await body.evaluate(
      (node) =>
        node.getBoundingClientRect().left +
        node.clientWidth -
        Number.parseFloat(getComputedStyle(node).paddingRight),
    )
    expect(code.right).toBeGreaterThan(line.right + 1)
    expect(code.right).toBeLessThanOrEqual(end + 1)
    expect(Math.abs(code.left - line.left)).toBeLessThanOrEqual(1)
    expect(Math.abs(after.right - line.right)).toBeLessThanOrEqual(1)
  })
})

const frameOf = (page: Page) => page.locator('.document-text .rich-table-frame')

test.describe('a table of counts', () => {
  test('on a phone leaves room past its labels for the columns after them', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await openPage(page, NESTED_PATH)
    const frame = frameOf(page)
    await expect(frame).toBeVisible()
    const box = await edgesOf(frame)
    const heads = frame.locator('.rich-head')
    await expect(heads).toHaveCount(3)
    // The labels took 339 px, the whole frame, and the counts stood past its edge.
    const [labels, counts] = [await edgesOf(heads.first()), await edgesOf(heads.nth(1))]
    expect(labels.width).toBeLessThan(box.width * 0.7)
    // The column after them starts in view, with room to be read in.
    expect(counts.left).toBeLessThan(box.right - 64)
  })

  test('on a wide page keeps its labels to the measure a line of prose reads at', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1500, height: 900 })
    await openPage(page, NESTED_PATH)
    const words = frameOf(page).locator('tbody tr:last-child .rich-cell-words').first()
    await expect(words).toBeVisible()
    const { width, measure } = await words.evaluate((node) => {
      const probe = document.createElement('span')
      probe.style.cssText = 'position: absolute; width: 32ch'
      node.append(probe)
      const result = {
        width: node.getBoundingClientRect().width,
        measure: probe.getBoundingClientRect().width,
      }
      probe.remove()
      return result
    })
    expect(Math.abs(width - measure)).toBeLessThanOrEqual(1)
  })
})
