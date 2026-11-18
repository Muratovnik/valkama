/**
 * The menu at an account's name on the quota's panel, in the real app. The oracle is the
 * requirement (`DESIGN.md`, Analytics, the quota's panel): three entries and no more; «Rename»
 * opens a field in the name's place that saves through the names Valkama keeps, the name Settings
 * then shows, on Enter, leaves the name on Escape, and gives the focus back to the menu's button
 * either way; «Add to filter» adds the account to the page's filter, a chip in the bar, and the
 * page stays on its section, after which the entry is disabled, «Already in filter»; «Copy ID»
 * puts the account's whole id on the clipboard and says so. No hint says that id.
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { NIGHT } from '../fixtures/quota.ts'
import { openPanel, pageAt, serve, WORLD } from './analyticsPage.ts'
import { globalScope } from './planningFixtures.ts'
import { test } from './test.ts'

/** The account the quota names «Work», by the organization Valkama keeps its name under. */
const WORK_ORGANIZATION = '5b0c7e21-4a3f-4d8e-9c16-2f7a8b9d0e1f'
const WORK_UUID = '0b7d4e19-1c2d-4e3f-8a4b-5c6d7e8f9a0b'

const path = (page: Page) => page.url().slice(new URL(page.url()).origin.length)

async function openQuota(page: Page) {
  const backend = await serve(page, WORLD, false, { accountNames: { [WORK_ORGANIZATION]: 'Work' } })
  await page.setViewportSize({ width: 1440, height: 900 })
  const analytics = await openPanel(page, pageAt({ by: 'quota_week' }))
  await expect(analytics.locator('[data-account="Work"]')).toBeVisible()
  return { analytics, backend }
}

/** The menu of the account named `name`, opened, and its button. */
async function openMenu(page: Page, name: string) {
  const button = page.getByRole('button', { name: `Account actions: ${name}` })
  await button.click()
  const menu = page.getByRole('menu')
  await expect(menu).toBeVisible()
  return { button, menu }
}

test('«Rename» saves the name Settings shows on Enter, leaves it on Escape, and gives the focus back', async ({
  page,
}) => {
  const { analytics, backend } = await openQuota(page)
  const { menu } = await openMenu(page, '7e6d5c4b')
  await expect(menu.getByRole('menuitem')).toHaveText(['Rename', 'Add to filter', 'Copy ID'])
  await menu.getByRole('menuitem', { name: 'Rename' }).click()
  const field = analytics.getByRole('textbox', { name: 'Account name' })
  await expect(field).toBeFocused()
  await expect(field).toHaveValue('')
  await field.fill('Night shift')
  await field.press('Enter')
  await expect(field).toHaveCount(0)
  await expect.poll(() => backend.accountNames[NIGHT.organization]).toBe('Night shift')
  await expect(analytics.locator('[data-account="Night shift"] .quota-account-name')).toHaveText(
    'Night shift',
  )
  const renamed = page.getByRole('button', { name: 'Account actions: Night shift' })
  await expect(renamed).toBeFocused()

  // Escape leaves the name as it was, and writes nothing.
  const writes = backend.accountNameWrites.length
  await renamed.click()
  await page.getByRole('menuitem', { name: 'Rename' }).click()
  const again = analytics.getByRole('textbox', { name: 'Account name' })
  await expect(again).toHaveValue('Night shift')
  await again.fill('Day shift')
  await again.press('Escape')
  await expect(again).toHaveCount(0)
  await expect(renamed).toBeFocused()
  await expect(analytics.locator('[data-account="Night shift"]')).toBeVisible()
  expect(backend.accountNameWrites).toHaveLength(writes)

  // Settings names the account by what was saved.
  await page.goto(serializePlatformRoute({ module_id: 'settings', scope: globalScope }))
  await expect(
    page.getByRole('textbox', { name: `Name of account ${NIGHT.organization}` }),
  ).toHaveValue('Night shift')
})

test('«Add to filter» adds the account as a chip and keeps the section; then it is held', async ({
  page,
}) => {
  const { analytics } = await openQuota(page)
  const section = analytics.locator('.analytics-rail [aria-current="page"]')
  const before = await section.textContent()
  const chips = analytics.locator('.analytics-bar-filters .combo-chip')
  await expect(chips).toHaveCount(0)

  const { menu } = await openMenu(page, 'Work')
  await menu.getByRole('menuitem', { name: 'Add to filter' }).click()
  await expect(chips).toHaveText(['Account: Work'])
  await expect
    .poll(() => path(page))
    .toBe(pageAt({ by: 'quota_week', filters: JSON.stringify({ account: [WORK_ORGANIZATION] }) }))
  await expect(section).toHaveText(before ?? '')

  const held = await openMenu(page, 'Work')
  const entry = held.menu.getByRole('menuitem', { name: 'Already in filter' })
  await expect(entry).toHaveAttribute('aria-disabled', 'true')
  await expect(held.menu.getByRole('menuitem', { name: 'Add to filter' })).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(held.menu).toBeHidden()
})

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
