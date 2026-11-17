/**
 * The task finder («Go to a task») open over the board, listing one result for each title it is
 * given, in that order: `MAIN-41`, `MAIN-42` and on, alternately in Dev and in Backlog.
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { installBackend } from './backend.ts'
import { spaceRef, spaceScope, workItem } from './planningFixtures.ts'

/** The search's answer: a result for each title, in their order. */
const resultsFor = (titles: readonly string[]) =>
  titles.map((title, index) => ({
    target: {
      space_ref: spaceRef,
      reference: `MAIN-${41 + index}`,
      writable: true,
    },
    item: {
      work_item_id: `00000000-0000-4000-8000-0000000002${String(index).padStart(2, '0')}`,
      planning_space_id: workItem.planning_space_id,
      reference: `MAIN-${41 + index}`,
      title,
      state: { name: index % 2 ? 'Backlog' : 'Dev' },
      open: true,
      container_state: null,
      claim_ref: '',
    },
  }))

/** Opens the finder over the board in a window this wide and returns it, its results listed. */
export async function openFinder(page: Page, width: number, titles: readonly string[]) {
  await page.setViewportSize({ width, height: 900 })
  await installBackend(page)
  await page.route('**/api/modules/planning/search?*', (route) =>
    route.fulfill({
      json: {
        interface_version: 'valkama-planning-search',
        query: 'main',
        limit: 50,
        has_more: false,
        items: resultsFor(titles),
        coverage: [{ space_ref: spaceRef, status: 'searched', reason: null }],
      },
    }),
  )
  await page.goto(
    serializePlatformRoute({
      module_id: 'planning',
      scope: spaceScope,
    }),
  )
  await expect(page.locator('.work-item-board')).toBeVisible()
  await page.keyboard.press('Control+k')
  const dialog = page.getByRole('dialog', { name: 'Go to a task', exact: true })
  await dialog.getByRole('combobox').fill('main')
  await expect(dialog.getByRole('option')).toHaveCount(titles.length)
  return dialog
}
