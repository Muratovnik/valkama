/**
 * The list grouped by goal on a space as large as a long-lived one, in the
 * built application at 1440×900 (`listTreePage.ts`).
 *
 * The tree draws only its window wherever it scrolls, while its scroll bar is as
 * long as every row it shows, and its columns stand where they stood, as wide as
 * its deepest rows need, when it scrolls, when a goal folds and when a row that
 * started folded away and is widest in every column comes into view. The keys go
 * by the whole tree: End and Home reach its last and first rows, ← folds a row or
 * goes to its parent and → opens it or goes to its first cell, at every one of
 * five levels, and folding the row focus is under takes focus to that row.
 * Folding the largest goal and twenty steps down run no task of 50 ms, and End
 * and Page Down run no more long tasks than in the flat list of the same space.
 * A reader hears a tree grid whose rows say their level and whether they are
 * open; where a row stands among its siblings is read from its attributes, which
 * Chromium's accessibility tree does not report.
 * A fold the reader chose survives a reload; one that agrees with the rule is
 * forgotten, so the row follows its work again.
 */
import { expect } from '@playwright/test'

import { boardRoute } from './boardPage.ts'
import {
  CHAIN,
  columnsOf,
  CROWDED,
  DEEP,
  drawnOf,
  focusedOf,
  keyTasks,
  LARGEST,
  listOf,
  longTasks,
  openTree,
  reach,
  readerTree,
  rowOf,
  scrollOf,
  scrollTo,
  tableOf,
  treeSpace,
  watchLongTasks,
  WIDEST,
} from './listTreePage.ts'
import { identity, stillFrames } from './longSpace.ts'
import { test } from './test.ts'

test('the tree draws fewer than 100 rows anywhere it scrolls, and its columns stay', async ({
  page,
}) => {
  await openTree(page, treeSpace())
  await expect(tableOf(page)).toHaveAttribute('role', 'treegrid')
  await expect(tableOf(page)).toHaveAttribute('aria-rowcount')
  const first = await columnsOf(page)
  for (let step = 0; step <= 20; step += 1) {
    await scrollTo(page, step / 20)
    await stillFrames(page)
    expect(await drawnOf(page).count(), `rows drawn at ${step * 5}%`).toBeLessThan(100)
    expect(await columnsOf(page), `columns at ${step * 5}%`).toEqual(first)
    // The gaps keep the scroll as long as every row the tree shows would make
    // it, by the floor `production-list-window.spec.ts` holds a flat list to.
    const { length, shown } = await scrollOf(page)
    expect(length, `scroll at ${step * 5}% for ${shown} rows`).toBeGreaterThan(shown * 40)
  }
  // A goal folded and opened again moves no column either.
  await scrollTo(page, 0)
  await stillFrames(page)
  const toggle = rowOf(page, LARGEST).locator('.tree-toggle')
  await toggle.click()
  await expect(rowOf(page, LARGEST)).toHaveAttribute('aria-expanded', 'false')
  await stillFrames(page)
  expect(await columnsOf(page), 'columns with the largest goal folded').toEqual(first)
  await toggle.click()
  await expect(rowOf(page, LARGEST)).toHaveAttribute('aria-expanded', 'true')
  await stillFrames(page)
  expect(await columnsOf(page), 'columns with it open again').toEqual(first)

  // The widest row stands under the crowded goal and four stages, all folded by
  // the rule: opening them down to it moves no column either, so the widths
  // were found in the whole tree and not in the rows it showed.
  await expect(rowOf(page, WIDEST)).toHaveCount(0)
  for (const reference of [CROWDED, ...CHAIN]) {
    await reach(page, reference)
    await expect(rowOf(page, reference)).toHaveAttribute('aria-expanded', 'false')
    await rowOf(page, reference).locator('.tree-toggle').click()
    await expect(rowOf(page, reference)).toHaveAttribute('aria-expanded', 'true')
  }
  await reach(page, WIDEST)
  await expect(rowOf(page, WIDEST)).toHaveAttribute('aria-level', '6')
  await stillFrames(page)
  expect(await columnsOf(page), 'columns with the widest row in view').toEqual(first)
})

test("End and Home reach the tree's ends, and ← and → go through all five levels", async ({
  page,
}) => {
  await openTree(page, treeSpace())
  const focused = focusedOf(page)
  await rowOf(page, DEEP[0]).focus()
  await page.keyboard.press('End')
  const count = await tableOf(page).getAttribute('aria-rowcount')
  await expect(focused).toHaveAttribute('aria-rowindex', count ?? '')
  await stillFrames(page)
  expect(await drawnOf(page).count()).toBeLessThan(100)
  await page.keyboard.press('Home')
  await expect(focused).toHaveAttribute('data-reference', DEEP[0])
  await stillFrames(page)
  expect(await listOf(page).evaluate((element) => element.scrollTop)).toBe(0)

  // Down to the deepest level, each level's first row the one under the last.
  for (const [depth, reference] of DEEP.entries()) {
    await expect(focused).toHaveAttribute('data-reference', reference)
    await expect(focused).toHaveAttribute('aria-level', String(depth + 1))
    await expect(focused).toHaveAttribute('aria-posinset', '1')
    await page.keyboard.press('ArrowDown')
  }
  await expect(focused).toHaveAttribute('data-reference', 'MAIN-12')
  for (const reference of DEEP.slice(0, -1))
    await expect(rowOf(page, reference)).toHaveAttribute('aria-expanded', 'true')
  // The deepest row holds nothing, so it is neither open nor folded.
  await expect(rowOf(page, DEEP[4])).not.toHaveAttribute('aria-expanded')
  await page.keyboard.press('ArrowUp')

  // ← from the deepest row: to its parent, which it then folds, level by level.
  for (let depth = DEEP.length - 2; depth >= 0; depth -= 1) {
    await page.keyboard.press('ArrowLeft')
    await expect(focused).toHaveAttribute('data-reference', DEEP[depth])
    await expect(focused).toHaveAttribute('aria-expanded', 'true')
    await page.keyboard.press('ArrowLeft')
    await expect(focused).toHaveAttribute('aria-expanded', 'false')
    await expect(rowOf(page, DEEP[depth + 1])).toHaveCount(0)
  }
  // A top row has no parent to go to.
  await page.keyboard.press('ArrowLeft')
  await expect(focused).toHaveAttribute('data-reference', DEEP[0])

  // → opens a folded row and keeps focus on it; ↓ goes to its first child.
  for (let depth = 0; depth < DEEP.length - 1; depth += 1) {
    await page.keyboard.press('ArrowRight')
    await expect(focused).toHaveAttribute('data-reference', DEEP[depth])
    await expect(focused).toHaveAttribute('aria-expanded', 'true')
    await page.keyboard.press('ArrowDown')
    await expect(focused).toHaveAttribute('data-reference', DEEP[depth + 1])
  }
  await expect(focused).toHaveAttribute('aria-setsize', '3')
  // → on a row with nothing under it goes to its first cell, and ← comes back.
  const deepest = rowOf(page, DEEP[4])
  await page.keyboard.press('ArrowRight')
  await expect(deepest.locator('td').first()).toBeFocused()
  await page.keyboard.press('ArrowLeft')
  await expect(deepest).toBeFocused()
  // → on an open row goes to its first cell too.
  await rowOf(page, DEEP[3]).focus()
  await page.keyboard.press('ArrowRight')
  await expect(rowOf(page, DEEP[3]).locator('td').first()).toBeFocused()

  // Folding a row focus is under takes focus to the folded row.
  await deepest.focus()
  await rowOf(page, DEEP[1]).locator('.tree-toggle').click()
  await expect(focused).toHaveAttribute('data-reference', DEEP[1])
  await expect(focused).toHaveAttribute('aria-expanded', 'false')
  await expect(deepest).toHaveCount(0)
})

test('folding the largest goal and twenty steps down run no task of 50 ms', async ({ page }) => {
  await openTree(page, treeSpace())
  const focused = focusedOf(page)
  await rowOf(page, LARGEST).focus()
  await watchLongTasks(page)

  await page.keyboard.press('ArrowLeft')
  await expect(focused).toHaveAttribute('aria-expanded', 'false')
  await stillFrames(page)
  expect(await longTasks(page), 'long tasks folding the largest goal').toEqual([])
  await page.keyboard.press('ArrowRight')
  await expect(focused).toHaveAttribute('aria-expanded', 'true')
  await stillFrames(page)
  expect(await longTasks(page), 'long tasks opening it again').toEqual([])

  const from = Number(await focused.getAttribute('aria-rowindex'))
  for (let step = 1; step <= 20; step += 1) {
    await page.keyboard.press('ArrowDown')
    await expect(focused).toHaveAttribute('aria-rowindex', String(from + step))
  }
  await stillFrames(page)
  expect(await longTasks(page), 'long tasks over twenty steps down').toEqual([])
})

test('End and Page Down run no more long tasks in the tree than in the flat list', async ({
  page,
}) => {
  // One space, grouped by goal and then flat, in the same run and the same page.
  await openTree(page, treeSpace())
  const tree = await keyTasks(page)
  await page.goto(boardRoute({ view: 'list' }))
  await expect(drawnOf(page).first()).toBeVisible()
  await stillFrames(page)
  const flat = await keyTasks(page)
  const said = (key: 'end' | 'pageDown') => `${key}: tree ${tree[key]} ms, flat ${flat[key]} ms`
  expect(tree.end.length, said('end')).toBeLessThanOrEqual(flat.end.length)
  expect(tree.pageDown.length, said('pageDown')).toBeLessThanOrEqual(flat.pageDown.length)
  await test.info().attach('long-tasks', { body: JSON.stringify({ flat, tree }) })
})

test('a reader hears a tree grid whose rows say their level, state and place', async ({ page }) => {
  await openTree(page, treeSpace())
  const { grids, rows } = await readerTree(page)
  expect(grids).toBe(1)
  const heard = (reference: string) => rows.find((row) => row.name.startsWith(reference))
  expect(heard(DEEP[0])).toMatchObject({ expanded: true, level: 1 })
  expect(heard(DEEP[1])).toMatchObject({ expanded: true, level: 2 })
  expect(heard(DEEP[4])).toMatchObject({ expanded: null, level: 5 })
  expect(heard('MAIN-13')).toMatchObject({ expanded: null, level: 5 })
  for (const [reference, place] of [
    [DEEP[4], '1'],
    ['MAIN-13', '3'],
  ]) {
    await expect(rowOf(page, reference)).toHaveAttribute('aria-posinset', place)
    await expect(rowOf(page, reference)).toHaveAttribute('aria-setsize', '3')
  }
  // The rule folds a goal with more than twenty open.
  await reach(page, CROWDED)
  const again = await readerTree(page)
  const crowded = again.rows.find((row) => row.name.startsWith(CROWDED))
  expect(crowded).toMatchObject({ expanded: false, level: 1 })
})

test('a chosen fold survives a reload, and one that agrees with the rule is forgotten', async ({
  page,
}) => {
  await openTree(page, treeSpace())
  const stored = () => page.evaluate(() => localStorage.getItem('valkama-tree-folds') ?? '')
  const largest = identity(100)
  const toggle = rowOf(page, LARGEST).locator('.tree-toggle')
  await toggle.click()
  await expect(rowOf(page, LARGEST)).toHaveAttribute('aria-expanded', 'false')
  expect(await stored()).toContain(largest)

  await page.reload()
  await expect(rowOf(page, LARGEST)).toHaveAttribute('aria-expanded', 'false')
  await toggle.click()
  await expect(rowOf(page, LARGEST)).toHaveAttribute('aria-expanded', 'true')
  expect(await stored()).not.toContain(largest)
})
