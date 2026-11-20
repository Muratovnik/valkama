/**
 * The list grouped by goal fits its frame with a tree five levels deep and long titles, at
 * 1280px and 390px in both languages. The oracle is the list's rule in DESIGN.md («Work»):
 * the widths its columns stand from are met by the room beside the first column, and a
 * tree's first column is wider by its lead. Measured on the list's width alone, such a tree
 * at 1280px stood every column but two, left its title 131px with words broken inside, put
 * its head on two lines and ran 24px past the list's frame.
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { installBackend } from './backend.ts'
import { boardRoute } from './boardPage.ts'
import { brief, identity, serveSpace, stateOf, stillFrames } from './longSpace.ts'
import { test } from './test.ts'

/** Titles as agents write them, one long word in each. */
const TITLES = [
  'Переосмысление участия: кто решает в каждой точке, и почему владелец видит это первым',
  'Rethinking participation: who decides at each point, and why the owner sees it first',
]

/** A goal five levels deep, each level's first row holding the next, three rows at each. */
function deepTree() {
  const now = new Date().toISOString()
  const items = [brief(1, stateOf(1), { kind: 'goal', title: TITLES[0], updated_at: now })]
  for (const [level, first] of [2, 5, 8, 11].entries())
    for (let at = 0; at < 3; at += 1)
      items.push(
        brief(first + at, stateOf(first + at), {
          kind: at === 0 && level < 3 ? 'stage' : 'task',
          parent_id: identity(level === 0 ? 1 : first - 3),
          title: TITLES[(first + at) % 2],
          updated_at: now,
        }),
      )
  return items
}

/** The deepest row, at the fifth level. */
const DEEPEST = 'MAIN-11'

async function openDeep(page: Page, locale: string, width: number) {
  await page.addInitScript((chosen) => localStorage.setItem('valkama-locale', chosen), locale)
  await page.setViewportSize({ width, height: 900 })
  await installBackend(page)
  await serveSpace(page, deepTree())
  await page.goto(boardRoute({ view: 'list', group: 'goal' }))
  await expect(
    page.locator(`.work-item-list tbody tr.list-row[data-reference="${DEEPEST}"]`).first(),
  ).toBeVisible()
  await stillFrames(page)
}

/** How the list stands in its frame, and how its head and deepest title are set. */
const measure = (page: Page) =>
  page.locator('.work-item-list').evaluate((list, deepest) => {
    const table = list.querySelector('table') as HTMLElement
    /** The distinct line tops of a range's letters. */
    const lines = (range: Range) =>
      new Set(
        [...range.getClientRects()]
          .filter((box) => box.width > 0)
          .map((box) => Math.round(box.top)),
      ).size
    /** The words of an element whose letters stand on more than one line. */
    function broken(element: Element) {
      const found: string[] = []
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
      for (let node = walker.nextNode(); node; node = walker.nextNode())
        for (const word of (node.textContent ?? '').matchAll(/[^\s/-]{2,}/gu)) {
          const range = document.createRange()
          range.setStart(node, word.index)
          range.setEnd(node, word.index + word[0].length)
          if (lines(range) > 1) found.push(word[0])
        }
      return found
    }
    /** The most lines any visible text of a head cell stands on; hidden words are a pixel. */
    function headLines(cell: Element) {
      let most = 0
      const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT)
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (!node.textContent?.trim()) continue
        const range = document.createRange()
        range.selectNodeContents(node)
        const shown = [...range.getClientRects()].filter((box) => box.width > 1 && box.height > 1)
        most = Math.max(most, new Set(shown.map((box) => Math.round(box.top))).size)
      }
      return most
    }
    const heads = [...table.querySelectorAll('thead th')].map((cell) => ({
      text: cell.textContent.trim(),
      width: Math.round(cell.getBoundingClientRect().width),
      lines: headLines(cell),
    }))
    const row = list.querySelector(`tr.list-row:not(.list-row-held)[data-reference="${deepest}"]`)
    const title = row?.querySelector('.list-name')
    return {
      fit: (list as HTMLElement).dataset.fit,
      past: Math.round(table.getBoundingClientRect().width - list.clientWidth),
      sideways: list.scrollWidth - list.clientWidth,
      heads,
      title: heads[1]?.width ?? 0,
      brokenTitle: title ? broken(title) : ['no title'],
    }
  }, DEEPEST)

for (const locale of ['en', 'ru']) {
  test(`a tree five levels deep fits its frame at 1280px in ${locale}`, async ({ page }, info) => {
    await openDeep(page, locale, 1280)
    const seen = await measure(page)
    const said = JSON.stringify(seen)
    expect(seen.past, said).toBeLessThanOrEqual(0)
    expect(seen.sideways, said).toBeLessThanOrEqual(0)
    // The head on one line, the title a column a reader reads, no word broken inside it.
    expect(
      seen.heads.filter((head) => head.lines > 1),
      said,
    ).toEqual([])
    expect(seen.title, said).toBeGreaterThanOrEqual(240)
    expect(seen.brokenTitle, said).toEqual([])
    await page.screenshot({ path: info.outputPath(`list-tree-fit-${locale}-1280.png`) })
    await info.attach('measured', { body: said, contentType: 'application/json' })
  })

  test(`a tree five levels deep stays inside its frame at 390px in ${locale}`, async ({
    page,
  }, info) => {
    await openDeep(page, locale, 390)
    const seen = await measure(page)
    const said = JSON.stringify(seen)
    expect(seen.past, said).toBeLessThanOrEqual(0)
    expect(seen.sideways, said).toBeLessThanOrEqual(0)
    await page.screenshot({ path: info.outputPath(`list-tree-fit-${locale}-390.png`) })
    await info.attach('measured', { body: said, contentType: 'application/json' })
  })
}
