/**
 * «Goal and stage» in the list, at the list's widths: a wide desktop's, where the list
 * is 1100px or more and stands every column, and the widths of the mockups' plan, a
 * desktop's, the list's middle fit and a phone's.
 *
 * In the flat list the column stands after the title in a list 1100px wide or more and
 * names each row's goal and stages, goal first; work under no goal says a dash. It sorts
 * the list. Narrower, it folds under the title: on its own line above an open blocker
 * and the labels down to 900px, and first on the line of facts below that. The list by
 * goal draws no such column and names no path under a title, since a row's place there
 * is its goal; the list by project draws it.
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { installBackend } from './backend.ts'
import { boardRoute, routeState } from './boardPage.ts'
import { drawnOf, listOf } from './listTreePage.ts'
import { brief, identity, serveSpace, stateOf, stillFrames } from './longSpace.ts'
import { test } from './test.ts'

/** Each width, and the fit of the list it leaves. */
const WIDTHS = [
  { width: 1600, height: 900, fit: 'full' },
  { width: 1280, height: 900, fit: 'wide' },
  { width: 1024, height: 800, fit: 'medium' },
  { width: 390, height: 844, fit: 'narrow' },
] as const
type Size = (typeof WIDTHS)[number]

const LONG_GOAL = 'A goal whose title runs on past what any title column of the list holds'

function goalSpace() {
  return [
    brief(1, stateOf(1), { kind: 'goal', title: 'Launch' }),
    brief(2, stateOf(1), { kind: 'stage', title: 'Beta', parent_id: identity(1) }),
    brief(3, stateOf(1), { title: 'Write the notes', parent_id: identity(2) }),
    brief(4, stateOf(1), { title: 'Tidy up' }),
    brief(5, stateOf(1), { kind: 'goal', title: LONG_GOAL }),
    brief(6, stateOf(1), { title: 'Ship it', parent_id: identity(5) }),
  ]
}

async function open(page: Page, size: Size, state: Record<string, unknown>) {
  await page.setViewportSize({ width: size.width, height: size.height })
  await installBackend(page)
  await serveSpace(page, goalSpace())
  await page.goto(boardRoute({ view: 'list', sort: 'reference', ...state }))
  await expect(drawnOf(page).first()).toBeVisible()
  await stillFrames(page)
}

/** The column's own heading; a folded column's sort rides the title's heading instead. */
const goalHead = (page: Page) =>
  listOf(page)
    .locator('thead th')
    .filter({ has: page.locator('.list-sort:not(.folded)', { hasText: 'Goal and stage' }) })
/** A row of the flat list by the reference its first cell carries. */
const rowOf = (page: Page, reference: string) =>
  drawnOf(page)
    .and(page.locator(':not(.list-row-held)'))
    .filter({ has: page.locator(`[data-reference="${reference}"]`) })
const order = (page: Page) =>
  drawnOf(page)
    .and(page.locator(':not(.list-row-held)'))
    .locator('[data-reference]')
    .evaluateAll((cells) => cells.map((cell) => (cell as HTMLElement).dataset.reference))
/** The line under a row's title that says its goal and stage: the first there. */
const pathLine = (page: Page, reference: string) =>
  rowOf(page, reference).locator('.list-title .list-facts').first()

test('a list 1100px wide stands goal and stage after the title', async ({ page }) => {
  await open(page, WIDTHS[0], {})
  await expect(listOf(page)).toHaveAttribute('data-fit', 'full')
  await expect(goalHead(page)).toBeVisible()
  await expect(rowOf(page, 'MAIN-3').locator('.list-goal')).toHaveText('Launch › Beta')
  await expect(rowOf(page, 'MAIN-2').locator('.list-goal')).toHaveText('Launch')
  await expect(rowOf(page, 'MAIN-4').locator('.list-goal')).toHaveText('—')
  await expect(listOf(page).locator('.list-title .list-facts')).toHaveCount(0)
  // What each heading shows: the title's choice of order stays in its heading, hidden here.
  const heads = await listOf(page).locator('thead th').allInnerTexts()
  expect(heads.map((head) => head.trim()).slice(1, 3)).toEqual(['Title', 'Goal and stage'])
  const overflow = await listOf(page).evaluate((list) => list.scrollWidth - list.clientWidth)
  expect(overflow, 'nothing is pushed past the list edge').toBeLessThanOrEqual(0)
})

for (const size of WIDTHS.slice(1)) {
  test(`at ${size.width}px goal and stage folds under the title and leads it`, async ({ page }) => {
    await open(page, size, {})
    await expect(listOf(page)).toHaveAttribute('data-fit', size.fit)
    await expect(goalHead(page)).toHaveCount(0)
    await expect(listOf(page).locator('.list-goal')).toHaveCount(0)
    // The path comes first there, whatever follows it.
    await expect(pathLine(page, 'MAIN-3')).toHaveText(/^\s*Launch › Beta/u)
    // A long path stays one line, cut at the row's edge.
    const long = pathLine(page, 'MAIN-6').locator('.list-fact').first()
    await expect(long).toHaveText(LONG_GOAL)
    const lines = await long.evaluate(
      (fact) =>
        fact.getBoundingClientRect().height / Number.parseFloat(getComputedStyle(fact).lineHeight),
    )
    expect(lines, 'the path is one line').toBeLessThan(1.5)
    // Work under no goal says nothing there: the dash is the column's word.
    await expect(rowOf(page, 'MAIN-4').locator('.list-title')).not.toContainText('—')
    const overflow = await listOf(page).evaluate((list) => list.scrollWidth - list.clientWidth)
    expect(overflow, 'nothing is pushed past the list edge').toBeLessThanOrEqual(0)
  })
}

for (const size of WIDTHS) {
  test(`the list by goal draws no goal and stage at ${size.width}px`, async ({ page }) => {
    await open(page, size, { group: 'goal' })
    await expect(goalHead(page)).toHaveCount(0)
    await expect(listOf(page).locator('.list-goal')).toHaveCount(0)
    await expect(listOf(page).locator('.list-title', { hasText: 'Launch › Beta' })).toHaveCount(0)
  })
}

test('a press on the heading sorts the flat list by goal and stage', async ({ page }) => {
  await open(page, WIDTHS[0], {})
  await goalHead(page).getByRole('button').click()
  // Under no goal first, by number; then by the path, «Launch» before «Launch › Beta».
  await expect
    .poll(() => order(page))
    .toEqual(['MAIN-1', 'MAIN-4', 'MAIN-5', 'MAIN-6', 'MAIN-2', 'MAIN-3'])
  expect(routeState(page)).toMatchObject({ sort: 'goal' })
  await expect(goalHead(page)).toHaveAttribute('aria-sort', 'ascending')
})

test('the list by project draws goal and stage', async ({ page }) => {
  await open(page, WIDTHS[0], { group: 'project' })
  await expect(goalHead(page)).toBeVisible()
  await expect(listOf(page).locator('.list-goal', { hasText: 'Launch › Beta' })).toBeVisible()
})
