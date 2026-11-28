import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { openPanel, pageAt, serve, WORLD } from './analyticsPage.ts'

/**
 * The quota's panel of Analytics with an account named «Work» and one with no name of its own,
 * and the menu at an account's name (`production-analytics-quota-account-actions.spec.ts`,
 * `production-analytics-quota-account-actions-clipboard.spec.ts`).
 */

/** The account the quota names «Work», by the key Valkama keeps its name under: its id. */
const WORK_ORGANIZATION = '5b0c7e21-4a3f-4d8e-9c16-2f7a8b9d0e1f'
export const WORK_UUID = '0b7d4e19-1c2d-4e3f-8a4b-5c6d7e8f9a0b'
export const WORK_ID = `${WORK_ORGANIZATION}/${WORK_UUID}`

export async function openQuota(page: Page) {
  const backend = await serve(page, WORLD, false, { accountNames: { [WORK_ID]: 'Work' } })
  await page.setViewportSize({ width: 1440, height: 900 })
  const analytics = await openPanel(page, pageAt({ by: 'quota_week' }))
  await expect(analytics.locator('[data-account="Work"]')).toBeVisible()
  return { analytics, backend }
}

/** The menu of the account named `name`, opened, and its button. */
export async function openMenu(page: Page, name: string) {
  const button = page.getByRole('button', { name: `Account actions: ${name}` })
  await button.click()
  const menu = page.getByRole('menu')
  await expect(menu).toBeVisible()
  return { button, menu }
}
