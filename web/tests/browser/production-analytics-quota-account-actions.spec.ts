/**
 * The menu at an account's name on the quota's panel, in the real app. The oracle is the
 * requirement (`DESIGN.md`, Analytics, the quota's panel): three entries and no more, with no
 * «Rename» on an account with no name of its own, which «Name» beside the menu names; «Rename»
 * opens a field in the name's place, starting where the name did, that saves through the names
 * Valkama keeps, the name Settings then shows, on Enter, leaves the name on Escape, and gives the
 * focus back to the menu's button either way; «Add to filter» adds the account to the page's filter, a chip in the bar, and the
 * page stays on its section, after which the entry is disabled, «Already in filter»; «Copy ID»
 * puts the account's whole id on the clipboard and says so. No hint says that id. An account with
 * no name of its own has «Name» beside the menu, which opens the same field and is gone once the
 * account has a name. «Copy ID», which reads the system clipboard back, is in
 * `production-analytics-quota-account-actions-clipboard.spec.ts`.
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { NIGHT, NIGHT_NAME } from '../fixtures/quota.ts'
import { pageAt } from './analyticsPage.ts'
import { globalScope } from './planningFixtures.ts'
import { openMenu, openQuota, WORK_ID } from './quotaAccountsPage.ts'
import { test } from './test.ts'

const NIGHT_ID = `${NIGHT.organization}/${NIGHT.account_uuid}`

const path = (page: Page) => page.url().slice(new URL(page.url()).origin.length)

test('«Rename» saves the name Settings shows on Enter, leaves it on Escape, and gives the focus back', async ({
  page,
}) => {
  const { analytics, backend } = await openQuota(page)
  const name = await analytics
    .locator(`[data-account="${NIGHT_NAME}"] .quota-account-name`)
    .boundingBox()
  // With no name of its own the menu has no «Rename»: «Name» beside it opens the field.
  const { menu } = await openMenu(page, NIGHT_NAME)
  await expect(menu.getByRole('menuitem')).toHaveText(['Add to filter', 'Copy ID'])
  await page.keyboard.press('Escape')
  await expect(menu).toHaveCount(0)
  await page.getByRole('button', { name: `Name account ${NIGHT_NAME}` }).click()
  const field = analytics.getByRole('textbox', { name: 'Account name' })
  await expect(field).toBeFocused()
  await expect(field).toHaveValue('')
  // The field stands in the name's place: it starts where the name did.
  const placed = await field.boundingBox()
  expect(
    Math.abs((placed?.x ?? 0) - (name?.x ?? -1)),
    'the field where the name was',
  ).toBeLessThanOrEqual(1)
  await field.fill('Night shift')
  await field.press('Enter')
  await expect(field).toHaveCount(0)
  await expect.poll(() => backend.accountNames[NIGHT_ID]).toBe('Night shift')
  await expect(analytics.locator('[data-account="Night shift"] .quota-account-name')).toHaveText(
    'Night shift',
  )
  const renamed = page.getByRole('button', { name: 'Account actions: Night shift' })
  await expect(renamed).toBeFocused()

  // Escape leaves the name as it was, and writes nothing.
  const writes = backend.accountNameWrites.length
  await renamed.click()
  await expect(page.getByRole('menu').getByRole('menuitem')).toHaveText([
    'Rename',
    'Add to filter',
    'Copy ID',
  ])
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
  await expect(page.getByRole('textbox', { name: `Name of account ${NIGHT_ID}` })).toHaveValue(
    'Night shift',
  )
})

test('«Name» stands at an account with no name of its own, opens the rename field and is gone once named', async ({
  page,
}) => {
  const { analytics, backend } = await openQuota(page)
  const nameIt = (name: string) =>
    analytics.locator(`[data-account="${name}"] [data-account-head="name-it"]`)
  // «Work» has its name, so only the menu renames it; the night account, known by the start of
  // its UUID and when its week resets, is offered a name in sight.
  await expect(nameIt('Work')).toHaveCount(0)
  const offer = page.getByRole('button', { name: `Name account ${NIGHT_NAME}` })
  await expect(offer).toBeVisible()
  await expect(offer).toHaveText('Name')
  await offer.click()
  const field = analytics.getByRole('textbox', { name: 'Account name' })
  await expect(field).toBeFocused()
  await expect(field).toHaveValue('')
  await expect(nameIt(NIGHT_NAME)).toHaveCount(0)
  await field.fill('Night shift')
  await field.press('Enter')
  await expect.poll(() => backend.accountNames[NIGHT_ID]).toBe('Night shift')
  await expect(analytics.locator('[data-account="Night shift"] .quota-account-name')).toBeVisible()
  await expect(nameIt('Night shift')).toHaveCount(0)
})

test('«Add to filter» adds the account as a chip and keeps the section; then it is held', async ({
  page,
}) => {
  const { analytics } = await openQuota(page)
  const section = analytics.locator('.analytics-rail [aria-current="page"]')
  const before = await section.textContent()
  const chips = analytics.locator('.analytics-bar-chips [data-filter-chip]')
  await expect(chips).toHaveCount(0)

  const { menu } = await openMenu(page, 'Work')
  await menu.getByRole('menuitem', { name: 'Add to filter' }).click()
  await expect(chips).toHaveText(['Account: Work'])
  await expect
    .poll(() => path(page))
    .toBe(pageAt({ by: 'quota_week', filters: JSON.stringify({ seat: [WORK_ID] }) }))
  await expect(section).toHaveText(before ?? '')

  const held = await openMenu(page, 'Work')
  const entry = held.menu.getByRole('menuitem', { name: 'Already in filter' })
  await expect(entry).toHaveAttribute('aria-disabled', 'true')
  await expect(held.menu.getByRole('menuitem', { name: 'Add to filter' })).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(held.menu).toBeHidden()
})
