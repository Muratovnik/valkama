/**
 * The Work filter's browser-spec harness: a space whose labels overlap, so «all» and «any»
 * let different work through, and the parts of the bar those specs read.
 */
import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import { parsePlatformRoute } from '@/shared/api/platformRoute.ts'

import { installBackend } from './backend.ts'
import type { Brief } from './boardFixtures.ts'
import { boardRoute } from './boardPage.ts'
import { filterSpace } from './served/filter.ts'
import { spaceAnswer } from './servedAnswers.ts'

async function serveSpace(page: Page, items?: Brief[], workflow?: unknown) {
  await page.route('**/api/planning?*', (route) =>
    route.fulfill(
      spaceAnswer(new URL(route.request().url()).searchParams, filterSpace(items, workflow)),
    ),
  )
}

/** The flat board, or the view the state names, over the labelled space. */
export async function openSpace(
  page: Page,
  { height = 900, items, state = {}, width = 1440, workflow }: OpenSpace = {},
) {
  await page.setViewportSize({ width, height })
  await installBackend(page)
  await serveSpace(page, items, workflow)
  await page.goto(boardRoute(state))
  await expect(page.locator('.workspace-head')).toBeVisible()
}

interface OpenSpace {
  height?: number
  items?: Brief[]
  state?: Record<string, string>
  width?: number
  /** The space's own workflow, where the fixture's three states say too little. */
  workflow?: unknown
}

export const field = (page: Page) => page.getByRole('combobox', { name: 'Filter work' })
export const menu = (page: Page) => page.getByRole('listbox', { name: 'Facets to filter by' })
export const allOf = (page: Page) => page.getByRole('option', { name: 'Labels: all of those' })
export const anyOf = (page: Page) => page.getByRole('option', { name: 'Labels: any of those' })
export const chips = (page: Page) => page.locator('.workspace-chips .filter-chip')
export const words = (page: Page) => page.locator('.workspace-chips .filter-chip-join')

/** Where something stands on screen, which a test goes on to measure. */
export async function boxOf(what: Locator) {
  const box = await what.boundingBox()
  if (!box) throw new Error('nothing to measure on screen')
  return box
}

/** The tiles the board draws, by reference and in no particular order. */
export const shownTiles = (page: Page) =>
  page
    .locator('.work-item-board li[data-reference]')
    .evaluateAll((nodes) =>
      nodes
        .map((node) => (node as HTMLElement).dataset.reference ?? '')
        .toSorted((left, right) => left.localeCompare(right)),
    )

/** The module state the address holds now. */
export function addressState(page: Page) {
  const url = new URL(page.url())
  return parsePlatformRoute(`${url.pathname}${url.search}`).state ?? {}
}

/** What the menu's rows are, in the order it draws them, with a mark on each one that is in. */
export const menuLabels = (page: Page) =>
  menu(page)
    .getByRole('group', { name: 'Label', exact: true })
    .locator('.option-row')
    .evaluateAll((rows) =>
      rows.map(
        (row) =>
          `${row.getAttribute('aria-selected') === 'true' ? '+' : ''}${row.textContent?.trim()}`,
      ),
    )

/**
 * The menu stepped into one facet's values: the field pressed where the menu is not open yet,
 * then the facet's row. The menu opens on the facets.
 */
export async function openFacet(page: Page, facet: string) {
  if (!(await menu(page).isVisible())) await field(page).click()
  await menu(page).getByRole('option', { name: facet, exact: true }).click()
  await expect(menu(page).getByRole('option', { name: 'Back to the facets' })).toHaveText(facet)
}
