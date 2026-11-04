import { expect } from '@playwright/test'

import { openPage } from './documentPageSurface.ts'
import { test } from './test.ts'

/**
 * How a document's text is set, apart from where it lands: the length of its lines on a
 * wide page.
 */

test('on a wide page the text keeps a reading measure, and a table takes the column', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1920, height: 1000 })
  await openPage(page, 'docs/plan.md')
  const paragraph = page.locator('.document-text .rich-paragraph').first()
  await expect(paragraph).toBeVisible()
  const { letters, table, text } = await paragraph.evaluate((node) => {
    const range = document.createRange()
    const lines = new Map<number, number>()
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT)
    for (let words = walker.nextNode(); words; words = walker.nextNode())
      for (let at = 0; at < (words.textContent?.length ?? 0); at += 1) {
        range.setStart(words, at)
        range.setEnd(words, at + 1)
        const top = Math.round(range.getBoundingClientRect().top)
        lines.set(top, (lines.get(top) ?? 0) + 1)
      }
    const column = node.closest('.document-text')
    return {
      letters: Math.max(...lines.values()),
      table: column?.querySelector('.rich-table-frame')?.getBoundingClientRect().width ?? 0,
      text: node.getBoundingClientRect().width,
    }
  })
  // About seventy letters to a line, where the whole column held over a hundred.
  expect(letters).toBeGreaterThan(60)
  expect(letters).toBeLessThanOrEqual(76)
  // A table is scanned across, not read along, and keeps the column's width.
  expect(table).toBeGreaterThan(text * 1.4)
})
