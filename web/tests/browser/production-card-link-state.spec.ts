/**
 * The state of the work a card links to, measured where Relations draws it: one place on
 * every row, whatever the length of the title beside it, in every group of links.
 *
 * The mark followed its title in a row that wrapped, so it stood at the end of a short
 * title's line and on a line of its own under a long one, and down a list of links it
 * jumped from one to the other. Where the list has room for a column the mark stands in
 * it, on the title's first line; on a phone's list it stands under the title, at the
 * title's edge, on every row alike.
 */
import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import { planningWorkItemEntity } from '@/shared/api/platformPlanningRefs.ts'
import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { installBackend } from './backend.ts'
import { projectScope, workItemRef } from './planningFixtures.ts'
import { test } from './test.ts'

/** Under a pixel: two places a reader sees as one. */
const ONE_PLACE = 0.5

const SHORT = 'Ask the vendor'
const LONG =
  'Move the store integrity check into a build stage of its own, describe how it is rolled back and what a failed check leaves for the next run to find'

/** Two groups, each with a short and a long title, and four state words of different lengths. */
const LINKS = [
  ['discovered-from', 'MAIN-777', SHORT, 'Dev', 'active'],
  ['discovered-from', 'MAIN-778', LONG, 'Done', 'completed'],
  ['relates-to', 'MAIN-779', LONG, 'Backlog', 'triage'],
  ['relates-to', 'MAIN-780', SHORT, 'Review', 'review'],
].map(([kind, reference, title, name, category], index) => ({
  kind,
  direction: 'outgoing',
  work_item_id: `00000000-0000-4000-8000-00000000077${index}`,
  reference,
  title,
  state_name: name,
  state_category: category,
  is_terminal: category === 'completed',
  state_unavailable: null,
}))

const CARD = serializePlatformRoute({
  module_id: 'planning',
  scope: projectScope,
  entity: planningWorkItemEntity(workItemRef),
})

async function openRelations(page: Page, width: number, locale: string) {
  await page.setViewportSize({ width, height: 900 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await installBackend(page, { card: (card) => ({ ...card, links: LINKS }) })
  await page.goto(CARD)
  const drawer = page.locator('.drawer')
  await expect(drawer).toHaveCSS('transform', 'none')
  await drawer
    .getByRole('tab', { name: locale === 'ru-RU' ? 'Связи' : 'Relations', exact: true })
    .click()
  const relations = drawer.locator('.relations')
  await expect(relations.locator('.link-row .semantic-state')).toHaveCount(LINKS.length)
  await relations.evaluate(async () => document.fonts.ready)
  return relations
}

/**
 * Each marked row: how many lines its title takes, where its state's dot starts, and the
 * dot's middle against the middle of the title's first line and its top against the title's
 * foot. In the page.
 */
function rows(relations: Locator) {
  return relations.evaluate((root) =>
    [...root.querySelectorAll('.link-row:has(.semantic-state)')].map((row) => {
      const title = row.querySelector('.link-title')
      const dot = row.querySelector('.state-dot')?.getBoundingClientRect()
      if (!title || !dot) throw new Error('a marked row without its title or its dot')
      const range = document.createRange()
      range.selectNodeContents(title)
      const lines = [...range.getClientRects()].filter((rect) => rect.width > 0)
      const first = lines[0]
      if (!first) throw new Error('a title with no line drawn')
      const foot = title.getBoundingClientRect().bottom
      return {
        reference: row.querySelector('.link-reference')?.textContent?.trim() ?? '',
        lines: new Set(lines.map((rect) => Math.round(rect.top))).size,
        firstLine: first.height,
        left: dot.left,
        // The dot's middle against the first line's: the page has no helper of the spec's.
        fromFirstLine: (dot.top + dot.bottom) / 2 - (first.top + first.bottom) / 2,
        underFoot: dot.top - foot,
      }
    }),
  )
}

function spread(values: number[]): number {
  return Math.max(...values) - Math.min(...values)
}

for (const locale of ['ru-RU', 'en-US'])
  test.describe(locale, () => {
    test.use({ locale })

    test('at 1280px the state stands in one column, on the first line of every title', async ({
      page,
    }) => {
      const measured = await rows(await openRelations(page, 1280, locale))
      // The case the row used to get wrong: a title of one line beside one of several.
      expect(measured.find((row) => row.reference === 'MAIN-777')?.lines).toBe(1)
      expect(measured.find((row) => row.reference === 'MAIN-779')?.lines).toBeGreaterThan(1)
      expect(spread(measured.map((row) => row.left))).toBeLessThanOrEqual(ONE_PLACE)
      for (const row of measured)
        expect(Math.abs(row.fromFirstLine), row.reference).toBeLessThan(row.firstLine / 2)
      expect(spread(measured.map((row) => row.fromFirstLine))).toBeLessThanOrEqual(ONE_PLACE)
    })

    test('at 390px the state stands under every title, at one edge', async ({ page }) => {
      const measured = await rows(await openRelations(page, 390, locale))
      expect(measured.find((row) => row.reference === 'MAIN-780')?.lines).toBe(1)
      expect(measured.find((row) => row.reference === 'MAIN-778')?.lines).toBeGreaterThan(1)
      expect(spread(measured.map((row) => row.left))).toBeLessThanOrEqual(ONE_PLACE)
      for (const row of measured)
        expect(row.underFoot, row.reference).toBeGreaterThanOrEqual(-ONE_PLACE)
      expect(spread(measured.map((row) => row.underFoot))).toBeLessThanOrEqual(ONE_PLACE)
    })
  })
