/**
 * The list's own find on a list short enough to draw every row. At each of the
 * list's widths and in Russian, what the find counts is what the rows show, in
 * rows that carry labels past the two shown, a holder, steps, a blocker and a
 * cancelled state: every match it counts is marked, in words a reader sees. A
 * match far down is brought to the middle of the room under the head; a sort
 * and a filter move the list no more than they do with the find closed; and a
 * printed list carries neither the bar nor the marks.
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { installBackend } from './backend.ts'
import { openList } from './boardPage.ts'
import { picture } from './graphPixels.ts'
import { barOf, expectCurrentIn, listOf, marksOf, yellowIn } from './listFindPage.ts'
import type { Box, Mark } from './listFindPage.ts'
import { serveSpace, stillFrames } from './longSpace.ts'
import { short, SHORT_STATES, shortLinks, shortWithoutL } from './served/listFind.ts'
import { test } from './test.ts'

/** The matches a reader sees: a term in the text the rows draw where it has room to show. */
const shownCount = (page: Page, term: string) =>
  listOf(page).evaluate((list, wanted) => {
    let count = 0
    const walker = document.createTreeWalker(
      list.querySelector('tbody') as Node,
      NodeFilter.SHOW_TEXT,
    )
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const parent = node.parentElement
      if (!parent?.checkVisibility({ visibilityProperty: true })) continue
      // Words kept for assistive technology alone stand in a box a pixel wide, which
      // clips them; a box that draws none of its own is its parent's.
      let box: Element | null = parent
      while (box && getComputedStyle(box).display === 'contents') box = box.parentElement
      const drawn = box?.getBoundingClientRect()
      if (!drawn || drawn.width <= 1 || drawn.height <= 1) continue
      const text = (node.textContent ?? '').toLowerCase()
      for (let at = text.indexOf(wanted); at >= 0; at = text.indexOf(wanted, at + wanted.length))
        count += 1
    }
    return count
  }, term.toLowerCase())

/**
 * The words of the dressed rows, an urgent one that waits among them, text by text
 * as they are drawn, the words kept for assistive technology alone included: what a
 * reader would type, and what a reader cannot see and should not find.
 */
const wordsOf = (page: Page) =>
  listOf(page).evaluate((list) => {
    const words = new Set<string>()
    for (const reference of ['MAIN-1000', 'MAIN-1001', 'MAIN-1003']) {
      const row = list.querySelector(`.list-open[data-reference="${reference}"]`)?.closest('tr')
      const walker = document.createTreeWalker(row as Node, NodeFilter.SHOW_TEXT)
      for (let node = walker.nextNode(); node; node = walker.nextNode())
        for (const word of node.textContent?.match(/\p{L}{3,}|\d+/gu) ?? []) words.add(word)
    }
    return [...words]
  })

/** What the count says for `expected` matches: «n of m», whatever n is, or the words for none. */
const totalOf = (expected: number, none: string) =>
  expected ? new RegExp(`\\s${expected}$`, 'u') : none

async function openShort(page: Page, locale: string, width: number, items = short()) {
  await page.addInitScript((chosen) => localStorage.setItem('valkama-locale', chosen), locale)
  await page.setViewportSize({ width, height: 900 })
  await installBackend(page)
  await serveSpace(page, items, shortLinks(), { states: SHORT_STATES })
  // Newest first, so a press on Updated turns the order over and a second turns it back.
  await openList(page, { sort: 'updated', desc: true })
  await stillFrames(page)
  await page.locator('.work-item-list tbody .list-open').first().focus()
  await page.keyboard.press('Control+f')
  const bar = page.getByRole('search')
  await expect(bar).toBeVisible()
  return { count: bar.locator('.list-find-now'), field: bar.getByRole('textbox') }
}

for (const { fit, locale, none, width } of [
  { fit: 'full', locale: 'en', none: 'No matches', width: 1440 },
  { fit: 'wide', locale: 'en', none: 'No matches', width: 1280 },
  { fit: 'medium', locale: 'en', none: 'No matches', width: 1000 },
  { fit: 'narrow', locale: 'en', none: 'No matches', width: 390 },
  { fit: 'full', locale: 'ru', none: 'Нет совпадений', width: 1440 },
] as const) {
  test(`on a ${fit} list in ${locale} the find counts what the rows show`, async ({ page }) => {
    const { count, field } = await openShort(page, locale, width)
    await expect(listOf(page)).toHaveAttribute('data-fit', fit)
    // Every row's words, and the priority's, where a glyph stands for it.
    const terms = [...(await wordsOf(page)), 'high', 'medium']
    const counted: number[] = []
    for (const term of terms) {
      await field.fill(term)
      const expected = await shownCount(page, term)
      counted.push(expected)
      await expect(count, `«${term}»`).toHaveText(totalOf(expected, none))
      const { current, others } = await marksOf(page)
      const marks = [...current, ...others]
      expect(marks, `«${term}» marked`).toHaveLength(expected)
      for (const mark of marks) expect(mark.text.toLowerCase()).toBe(term.toLowerCase())
    }
    // The rows' words were many, and most of them were found.
    expect(counted.filter(Boolean).length).toBeGreaterThanOrEqual(6)
  })
}

test('a match far down a list drawn whole is brought to the middle of the room', async ({
  page,
}) => {
  const { count, field } = await openShort(page, 'en', 1440)
  await field.fill('quartz')
  await expect(count).toHaveText('1 of 3')
  await page.keyboard.press('Enter')
  await expect(count).toHaveText('2 of 3')
  await stillFrames(page)
  await expectCurrentIn(page, 60, true)
})

/**
 * Where the list stands after a sort by Updated the other way and then a filter that lets
 * the current row and a hundred others through, from a scroll of `from`; the filter is
 * taken off and the order turned back after.
 */
async function sortAndFilter(page: Page, from: number) {
  const list = listOf(page)
  const scrolled = () => list.evaluate((element) => element.scrollTop)
  await list.evaluate((element, top) => (element.scrollTop = top), from)
  await stillFrames(page)
  expect(await scrolled()).toBe(from)
  const sort = page.locator('thead .list-sort', { hasText: 'Updated' })
  const first = list.locator('tbody .list-open').first()
  const leading = await first.getAttribute('data-reference')
  await sort.click()
  await stillFrames(page)
  await expect(first).not.toHaveAttribute('data-reference', leading ?? '')
  const sorted = await scrolled()
  const filter = page.getByRole('combobox', { name: 'Filter work' })
  await filter.fill('l')
  await stillFrames(page)
  await expect(list.locator('tbody .list-open')).toHaveCount(101)
  const filtered = await scrolled()
  await filter.fill('')
  await expect(list.locator('tbody .list-open')).toHaveCount(120)
  await sort.click()
  await expect(first).toHaveAttribute('data-reference', leading ?? '')
  return { filtered, sorted }
}

test('a sort and a filter move the list no more with the find open than with it closed', async ({
  page,
}) => {
  // The last twenty rows but the one with «quartz» have no «l» in their title.
  const { count, field } = await openShort(page, 'en', 1440, shortWithoutL())
  await field.fill('quartz')
  await page.keyboard.press('Enter')
  await expect(count).toHaveText('2 of 3')
  await stillFrames(page)
  await expectCurrentIn(page, 60, true)
  const from = await listOf(page).evaluate((list) => list.scrollTop)
  expect(from).toBeGreaterThan(0)

  // With the find open, the current match stays counted through both.
  const open = await sortAndFilter(page, from)
  await expect(count).toHaveText(/ of 3$/u)

  // The same from the same place with the find closed: what the list does of itself.
  await field.press('Escape')
  await expect(barOf(page)).toBeHidden()
  expect(await sortAndFilter(page, from)).toEqual(open)
})

/** Whether the marks change what a box shows: its picture with them, and with them taken off. */
async function markedIn(page: Page, box: Box) {
  const area = {
    bottom: Math.floor(box.bottom),
    left: Math.ceil(box.left),
    right: Math.floor(box.right),
    top: Math.ceil(box.top),
  }
  const marked = await picture(page, area)
  await page.evaluate(() => {
    const kept = new Map(CSS.highlights)
    CSS.highlights.clear()
    Object.assign(globalThis, { keptMarks: kept })
  })
  const bare = await picture(page, area)
  await page.evaluate(() => {
    const { keptMarks } = globalThis as unknown as { keptMarks: Map<string, Highlight> }
    for (const [name, marks] of keptMarks) CSS.highlights.set(name, marks)
  })
  return marked !== bare
}

test('a printed list carries neither the find bar nor its marks', async ({ page }) => {
  const { count, field } = await openShort(page, 'en', 1440)
  // The state of every fifth row: the current match and others in sight.
  await field.fill('backlog')
  await expect(count).toHaveText(/^1 of \d+$/u)
  await stillFrames(page)
  const marked = async () => {
    const { current, others } = await marksOf(page)
    expect(current).toHaveLength(1)
    expect(others.length).toBeGreaterThan(1)
    return {
      current: await markedIn(page, (current[0] as Mark).box),
      others: await markedIn(page, (others[0] as Mark).box),
    }
  }
  expect(await marked()).toEqual({ current: true, others: true })
  const {
    current: [mark],
  } = await marksOf(page)
  expect(await yellowIn(page, (mark as Mark).box)).toBeGreaterThan(0.3)

  await page.emulateMedia({ media: 'print' })
  await expect(barOf(page)).toBeHidden()
  expect(await marked()).toEqual({ current: false, others: false })

  await page.emulateMedia({ media: 'screen' })
  await expect(barOf(page)).toBeVisible()
  expect(await marked()).toEqual({ current: true, others: true })
})
