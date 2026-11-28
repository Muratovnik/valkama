/**
 * «Copy ID» in the menu at an account's name on the quota's panel, in the real app: it puts the
 * account's whole id on the clipboard and says so, and no hint says that id (`DESIGN.md`,
 * Analytics, the quota's panel). The id is read back from the system clipboard, which this spec
 * is granted (`clipboardSpecs.ts`); the rest of the menu is in
 * `production-analytics-quota-account-actions.spec.ts`.
 */
import { expect } from '@playwright/test'

import { openMenu, openQuota, WORK_UUID } from './quotaAccountsPage.ts'
import { test } from './test.ts'

test('«Copy ID» puts the account’s whole id on the clipboard, which no hint says', async ({
  page,
}) => {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
  const { analytics } = await openQuota(page)
  const account = analytics.locator('[data-account="Work"]')
  expect(await account.evaluate((one) => one.outerHTML)).not.toContain(WORK_UUID)

  const { menu } = await openMenu(page, 'Work')
  await menu.getByRole('menuitem', { name: 'Copy ID' }).click()
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(WORK_UUID)
  await expect(account.locator('[data-account-head="menu"]')).toContainText('ID copied')
})
