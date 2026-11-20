/**
 * The list grouped by goal fits its frame with a tree five levels deep and long titles, at
 * 1280px and 390px in both languages. The oracle is the list's rule in DESIGN.md («Work»):
 * the widths its columns stand from are met by the room beside the first column, and a
 * tree's first column is wider by its lead. Measured on the list's width alone, such a tree
 * at 1280px stood every column but two, left its title 131px with words broken inside, put
 * its head on two lines and ran 24px past the list's frame. At 390px, with the cells' inset
 * of a wider list, the title kept 16 characters and «Переосмысление» broke inside; a narrow
 * list's cells take its head's half inset, so the title's heading starts where its titles do.
 * An urgent row's priority stands after its reference where its column has folded, and the
 * first column counts it: counted as nothing, the glyph of one five levels deep stood 6px past
 * its cell, over the title's inset, and counted with a narrow indent stepping to the third
 * level, the table ran 9px past its frame. The indent steps to the second, and a row deeper
 * names its parent.
 * The scroll bars are drawn, as the reader sees them: hidden, the frame was 10px wider.
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { installBackend } from './backend.ts'
import { boardRoute } from './boardPage.ts'
import { brief, identity, serveSpace, stateOf, stillFrames } from './longSpace.ts'
import { test } from './test.ts'

test.use({ launchOptions: { ignoreDefaultArgs: ['--hide-scrollbars'] } })

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
          // The second row of each level urgent, its glyph after its reference.
          priority: at === 1 ? 'urgent' : 'medium',
          updated_at: now,
        }),
      )
  return items
}

/** The deepest row, at the fifth level. */
const DEEPEST = 'MAIN-11'
/** The goal and each level's first row, down to the deepest. */
const CHAIN = ['MAIN-1', 'MAIN-2', 'MAIN-5', 'MAIN-8', DEEPEST] as const

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
  page.locator('.work-item-list').evaluate((list, chain) => {
    const deepest = chain.at(-1)
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
    /** Where the first letter of an element's first words stands. */
    function firstLetter(element: Element | null | undefined) {
      const walker = document.createTreeWalker(element ?? document.body, NodeFilter.SHOW_TEXT)
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (!node.textContent?.trim()) continue
        const range = document.createRange()
        range.setStart(node, node.textContent.search(/\S/u))
        range.setEnd(node, node.textContent.search(/\S/u) + 1)
        return Math.round(range.getBoundingClientRect().left * 10) / 10
      }
      return Number.NaN
    }
    return {
      fit: (list as HTMLElement).dataset.fit,
      past: Math.round(table.getBoundingClientRect().width - list.clientWidth),
      sideways: list.scrollWidth - list.clientWidth,
      heads,
      title: heads[1]?.width ?? 0,
      brokenTitle: title ? broken(title) : ['no title'],
      // Every title shares the column, the Russian ones with the longest word.
      titles: [...list.querySelectorAll('tr.list-row:not(.list-row-held) .list-name')].length,
      brokenAny: [...list.querySelectorAll('tr.list-row:not(.list-row-held) .list-name')].flatMap(
        (name) => broken(name),
      ),
      // The title's heading against the deepest title under it.
      edge: [firstLetter(table.querySelectorAll('thead th')[1]), firstLetter(title)],
      // How far each priority glyph after a reference reaches past its cell's inset.
      glyphs: [
        ...list.querySelectorAll('tr.list-row:not(.list-row-held) .list-after:not(:empty)'),
      ].map((glyph) => {
        const cell = glyph.closest('td') as HTMLElement
        const end =
          cell.getBoundingClientRect().right -
          Number.parseFloat(getComputedStyle(cell).paddingInlineEnd)
        return Math.round((glyph.getBoundingClientRect().right - end) * 10) / 10
      }),
      // Each level's reference start, and whether its row names its parent under its title.
      levels: chain.map((reference) => {
        const at = list.querySelector(
          `tr.list-row:not(.list-row-held)[data-reference="${reference}"]`,
        )
        const x = at?.querySelector('button[data-reference]')?.getBoundingClientRect().left
        return {
          x: Math.round(x ?? Number.NaN),
          parent: Boolean(at?.querySelector('.list-parent')),
        }
      }),
    }
  }, CHAIN)

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
    expect(seen.fit, said).toBe('narrow')
    expect(seen.past, said).toBeLessThanOrEqual(0)
    expect(seen.sideways, said).toBeLessThanOrEqual(0)
    // No word of any title broken inside, and the title's heading on its titles' edge.
    expect(seen.titles, said).toBe(13)
    expect(seen.brokenAny, said).toEqual([])
    expect(Math.abs(seen.edge[0] - seen.edge[1]), said).toBeLessThanOrEqual(1)
    // Every urgent row's glyph inside its cell, the deepest's too.
    expect(seen.glyphs, said).toHaveLength(4)
    expect(Math.max(...seen.glyphs), said).toBeLessThanOrEqual(0)
    // Two levels a step apart, and every row past them naming its parent.
    const [goal, stage] = seen.levels
    expect((stage?.x ?? 0) - (goal?.x ?? 0), said).toBe(16)
    expect(new Set(seen.levels.slice(1).map((level) => level.x)).size, said).toBe(1)
    expect(
      seen.levels.map((level) => level.parent),
      said,
    ).toEqual([false, false, true, true, true])
    await page.screenshot({ path: info.outputPath(`list-tree-fit-${locale}-390.png`) })
    await info.attach('measured', { body: said, contentType: 'application/json' })
  })
}
