/**
 * A title with code in it, selected on the screen and copied, is the title as written: each
 * piece of code the selection holds whole goes to the clipboard between its backticks, though
 * the screen draws it without them (`textRuns.ts`). The clipboard is the test browser's own,
 * read back through its permission, and the copy is the browser's own Ctrl+C.
 */
import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import { test } from './test.ts'
import { TITLE_SURFACES } from './titleSurfaces.ts'

const CODED = 'Raise `STORE_SCHEMA_VERSION` in `web/src/work-item/title-runs.ts` after MAIN-12'

/** Selects `text` from its `start`th character to its `end`th, as drawn, and copies it. */
async function copySelected(page: Page, text: Locator, start: number, end?: number) {
  await text.evaluate(
    (element, [from, to]) => {
      const nodes: Text[] = []
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
      for (let node = walker.nextNode(); node; node = walker.nextNode()) nodes.push(node as Text)
      const place = (at: number): [Text, number] => {
        let left = at
        for (const node of nodes) {
          if (left <= node.data.length) return [node, left]
          left -= node.data.length
        }
        const last = nodes.at(-1)
        if (!last) throw new Error('no text drawn')
        return [last, last.data.length]
      }
      const range = document.createRange()
      range.setStart(...place(from))
      range.setEnd(...place(to ?? (element.textContent ?? '').length))
      const selection = getSelection()
      selection?.removeAllRanges()
      selection?.addRange(range)
    },
    [start, end] as const,
  )
  await page.keyboard.press('Control+c')
  return page.evaluate(() => navigator.clipboard.readText())
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
})

for (const surface of ["a card's head", 'the list', "a reference's card"] as const) {
  test(`a whole title copied from ${surface} holds its backticks`, async ({ page }) => {
    const text = await TITLE_SURFACES[surface](page, CODED)
    await expect(text.locator('code')).toHaveCount(2)
    await expect(text).not.toContainText('`')
    expect(await copySelected(page, text, 0)).toBe(CODED)
  })
}

test('a selection holds the backticks of the code it holds whole, and no others', async ({
  page,
}) => {
  const text = await TITLE_SURFACES["a card's head"](page, CODED)
  await expect(text.locator('code')).toHaveCount(2)
  const drawn = CODED.replaceAll('`', '')
  // From the first word into the middle of the path: the first code whole, the path cut.
  const cut = drawn.indexOf('/work-item')
  expect(await copySelected(page, text, 0, cut)).toBe('Raise `STORE_SCHEMA_VERSION` in web/src')
  // Inside one piece of code: what the screen shows.
  const inside = drawn.indexOf('SCHEMA')
  expect(await copySelected(page, text, inside, inside + 'SCHEMA'.length)).toBe('SCHEMA')
})
