/**
 * The work outside goals in Volumes where its rows stand as blocks (`stack`), at the widths the
 * shell takes on a phone and a narrow window, in both languages, and as columns at 1280px. The
 * oracle is DESIGN.md (Volumes; Rows and tables): a block draws only its figures above zero, each
 * beside its category's name, in columns alike in every block, while every figure, zeros
 * included, is still read with its column's heading; the columns of the wide table keep their
 * zeros. Drawing every category, a block was eight lines of mostly zeros, and the section ran
 * the page six times longer on a phone.
 */
import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { volumesAnswer } from '../support/volumesDouble.ts'
import { installBackend } from './backend.ts'
import { spaceScope } from './planningFixtures.ts'
import { test } from './test.ts'

const OUTSIDE_WORDS = { en: 'Outside goals', ru: 'Вне целей' } as const

/**
 * Rows whose figures above zero stand in different categories, one in every category, and a
 * label of one long word, which keeps the columns from fitting a frame of 760px even at their least.
 */
const OUTSIDE = {
  byProject: [
    { project: 'alpha', name: 'Alpha app', categories: { ready: 7, active: 2, completed: 4 } },
    { project: 'beta', name: 'Beta lib', categories: { triage: 1, blocked: 3 } },
    {
      project: 'gamma',
      name: 'Gamma site',
      categories: {
        triage: 1,
        deferred: 2,
        ready: 3,
        active: 4,
        review: 5,
        completed: 6,
        blocked: 7,
        cancelled: 8,
      },
    },
  ],
  byLabel: [
    { label: 'internationalization', categories: { review: 5 } },
    { label: null, categories: { deferred: 1, cancelled: 2 } },
  ],
}

const ROWS = OUTSIDE.byProject.length + OUTSIDE.byLabel.length
/** The categories above zero of each row, in the fixture's order. */
const SHOWN = [...OUTSIDE.byProject, ...OUTSIDE.byLabel].map(
  (row) => Object.values(row.categories).filter((count) => count > 0).length,
)

async function openPage(page: Page, width: number) {
  await installBackend(page)
  // Routed after the backend's own, so these answer.
  await page.route('**/api/planning/volumes?*', (route) =>
    route.fulfill({ json: volumesAnswer({ outside: OUTSIDE }) }),
  )
  await page.route('**/api/planning/commits/unattached?*', (route) =>
    route.fulfill({ json: { total: 0, items: [] } }),
  )
  await page.setViewportSize({ width, height: 900 })
  await page.goto(serializePlatformRoute({ module_id: 'volumes', scope: spaceScope, state: {} }))
}

/**
 * Each row's figures: its count, whether it is drawn — a cell cut to nothing is read aloud only —
 * and the left edge of what is drawn; with the section's step.
 */
const figuresOf = (section: Locator) =>
  section.evaluate((root) => ({
    fit: root.closest<HTMLElement>('[data-fit]')?.dataset.fit,
    rows: [...root.querySelectorAll('tr[data-row]')].map((row) =>
      [...row.querySelectorAll<HTMLElement>('[data-category]')].map((cell) => {
        const box = cell.getBoundingClientRect()
        return {
          count: Number(cell.textContent.trim()),
          drawn: box.width > 1 && box.height > 1 && getComputedStyle(cell).clipPath === 'none',
          left: box.left,
        }
      }),
    ),
  }))

/** The section's step (`useTableFit`). */
async function stepOf(section: Locator) {
  const { fit } = await figuresOf(section)
  return fit
}

for (const locale of ['en', 'ru'] as const)
  for (const width of [390, 620, 760])
    test(`a block outside goals draws only its figures above zero at ${width}px in ${locale}`, async ({
      page,
    }) => {
      await page.addInitScript((chosen) => localStorage.setItem('valkama-locale', chosen), locale)
      await openPage(page, width)
      const outside = page.getByRole('region', { name: OUTSIDE_WORDS[locale], exact: true })
      await expect(outside.locator('tr[data-row]')).toHaveCount(ROWS)
      await page.evaluate(() => document.fonts.ready)
      await expect.poll(() => stepOf(outside)).toBe('stack')
      const { rows } = await figuresOf(outside)
      expect(rows).toHaveLength(ROWS)
      // Every category is still in each row, read with its heading; only those above zero drawn.
      for (const row of rows) expect(row).toHaveLength(8)
      expect(rows.map((row) => row.filter((one) => one.drawn).length)).toEqual(SHOWN)
      for (const row of rows) for (const one of row) expect(one.drawn).toBe(one.count > 0)
      // The figures drawn stand in columns alike in every block: the n-th of each at one edge.
      const lefts = rows.map((row) => row.filter((one) => one.drawn).map((one) => one.left))
      const full = lefts.find((one) => one.length === 8) ?? []
      expect(full).toHaveLength(8)
      for (const block of lefts)
        for (const [at, left] of block.entries())
          expect(Math.abs(left - (full[at] ?? Number.NaN))).toBeLessThanOrEqual(0.5)
    })

test('the columns of the work outside goals keep their zeros at 1280px', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('valkama-locale', 'en'))
  await openPage(page, 1280)
  const outside = page.getByRole('region', { name: OUTSIDE_WORDS.en, exact: true })
  await expect(outside.locator('tr[data-row]')).toHaveCount(ROWS)
  await expect.poll(() => stepOf(outside)).not.toBe('stack')
  const { rows } = await figuresOf(outside)
  expect(rows.flat()).toHaveLength(ROWS * 8)
  expect(rows.flat().filter((one) => one.count === 0).length).toBeGreaterThan(0)
  for (const one of rows.flat()) expect(one.drawn).toBe(true)
})
