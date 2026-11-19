/**
 * The list grouped by goal on a space as large as a long-lived one, at the list's
 * widths: 1280 and 1024, where its indent steps 24px to the fifth level, and 390,
 * a phone's, where it steps 16px to the third (`listTreePage.ts`).
 *
 * A goal five levels deep stands as five rows, each a level deeper, its
 * references stepping in by the indent until the indent's last level. Under a
 * filter that matches the deepest task alone, the tree shows that task with its
 * goal and stages as path rows: each said to be a path and counting the one match
 * under it, and the counts above the list count the match alone, as the census
 * does, never the path rows the tree draws to reach it.
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { installBackend } from './backend.ts'
import { boardRoute } from './boardPage.ts'
import { DEEP, drawnOf, rowOf, treeSpace } from './listTreePage.ts'
import { serveSpace, stillFrames } from './longSpace.ts'
import { test } from './test.ts'

/** The list's widths: a desktop's, the list's middle fit, a phone's. */
const WIDTHS = [
  { width: 1280, height: 900, step: 24, levels: 5 },
  { width: 1024, height: 800, step: 24, levels: 5 },
  { width: 390, height: 844, step: 16, levels: 3 },
] as const

/** The deepest task's title, which no other card's begins: «Work item 110 …» does not. */
const DEEPEST_TITLE = 'item 11 with'

async function openTree(page: Page, size: (typeof WIDTHS)[number], query?: string) {
  await page.setViewportSize({ width: size.width, height: size.height })
  await installBackend(page)
  await serveSpace(page, treeSpace())
  const state = { view: 'list', group: 'goal', sort: 'updated', desc: true }
  await page.goto(boardRoute(query === undefined ? state : { ...state, query }))
  await expect(drawnOf(page).first()).toBeVisible()
  await stillFrames(page)
}

/** Where each row's reference starts, left to right, for these rows. */
const referenceStarts = (page: Page, references: readonly string[]) =>
  Promise.all(
    references.map(async (reference) => {
      const box = await rowOf(page, reference).locator('button[data-reference]').boundingBox()
      return Math.round(box?.x ?? Number.NaN)
    }),
  )

for (const size of WIDTHS) {
  test(`a goal five levels deep stands as five levels at ${size.width}px`, async ({ page }) => {
    await openTree(page, size)
    await expect(rowOf(page, DEEP[0])).toHaveAttribute('aria-expanded', 'true')
    for (const [depth, reference] of DEEP.entries())
      await expect(rowOf(page, reference)).toHaveAttribute('aria-level', String(depth + 1))

    const starts = await referenceStarts(page, DEEP)
    expect(starts).toHaveLength(DEEP.length)
    // Each level a step in, until the indent's last level; deeper rows stand there.
    const expected = DEEP.map(
      (_, depth) => (starts[0] ?? 0) + Math.min(depth, size.levels - 1) * size.step,
    )
    for (const [depth, start] of starts.entries())
      expect(Math.abs(start - (expected[depth] ?? 0)), `level ${depth + 1}`).toBeLessThanOrEqual(1)
  })

  test(`under a filter the deepest task stands with its path at ${size.width}px`, async ({
    page,
  }) => {
    await openTree(page, size, DEEPEST_TITLE)
    const shown = drawnOf(page).and(page.locator(':not(.list-row-held)'))
    await expect(shown).toHaveCount(DEEP.length)
    expect(await shown.evaluateAll((rows) => rows.map((row) => row.dataset.reference))).toEqual([
      ...DEEP,
    ])

    const path = 'Shown as a path: does not match the filter itself'
    for (const reference of DEEP.slice(0, -1)) {
      const row = rowOf(page, reference)
      await expect(row).toHaveAttribute('aria-description', path)
      await expect(row).toHaveAttribute('aria-expanded', 'true')
      await expect(row).toContainText('1 match')
    }
    const match = rowOf(page, DEEP[4])
    await expect(match).not.toHaveAttribute('aria-description')
    await expect(match).not.toContainText('match')

    // Five rows drawn, one of them the match: the counts say one.
    const counts = page.getByRole('status').filter({ hasText: / open$/u })
    await expect(counts).toHaveText(/^1 of \d+ open$/u)
  })
}
