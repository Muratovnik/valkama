/**
 * The overview of the Analytics page as its specs open it: a week of work to Wednesday
 * afternoon beside the same days of the week before, and the opener that waits for every read
 * of the overview to land. Every id, name and number is made up.
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { pageAt } from './analyticsPage.ts'
export { WORLD } from './served/overviewPage.ts'
/** Opens the page at an address and waits until the overview's reads have all landed. */
export async function openOverview(page: Page, width: number, height: number, address = pageAt()) {
  await page.setViewportSize({ width, height })
  await page.goto(address)
  const panel = page.locator('.analytics-panel')
  await expect(panel.locator('.overview-panel')).toBeVisible()
  await expect(panel.locator('.overview-top')).not.toHaveCount(0)
  for (const card of await panel.locator('.overview-top').all())
    await expect(card.locator('.ranked-row').first()).toBeVisible()
  await expect(panel.locator('.period-before').first()).toBeAttached()
  return panel
}
