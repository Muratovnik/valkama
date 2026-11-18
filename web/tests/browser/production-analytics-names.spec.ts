/**
 * Analytics names a session by the title its client gave it, with its id in the hint, and an
 * organization or an account by the name the owner gave it in Settings, with no hint of its id,
 * which the quota panel's menu copies instead; so no label made only of hex characters stands for
 * a value whose name is known: in the rail, the overview's cards, a section's bars and its table.
 * A session with no title, and an organization with no name, keep the labels they had; an account
 * with none is said by its organization's name and the start of its UUID. The name is the one the
 * owner types in Settings → General → Accounts, kept in Valkama, which this follows from the field
 * through the server to the page; and the names a device kept before, by organization, move there
 * once, never over a name Valkama has, and leave the device.
 */
import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { seatValue, serveUsage, task, value } from '../fixtures/analytics.ts'
import type { TimedStretch } from '../fixtures/analytics.ts'
import { quotaAt } from '../fixtures/quota.ts'
import { pageAt, serveQuota } from './analyticsPage.ts'
import { installBackend } from './backend.ts'
import { drawLined } from './drawnViews.ts'
import { globalScope } from './planningFixtures.ts'
import { test } from './test.ts'

const NOW = new Date(2026, 10, 11, 14, 30)
const on = (day: number) => new Date(2026, 10, day, 10)

const MAIN_ID = 'f0f0f0f0-1111-4222-8333-444455556666'
const SIDE_ID = '9c0de5b1-2222-4333-8444-555566667777'
/** Each organization's one account, which the work was spent on. */
const MAIN_ACCOUNT = `${MAIN_ID}/a1a1a1a1-2222-4333-8444-555566667777`
const SIDE_ACCOUNT = `${SIDE_ID}/b2b2b2b2-2222-4333-8444-555566667777`
const MAIN = { account: value(MAIN_ID), seat: seatValue(MAIN_ACCOUNT) }
const SIDE = { account: value(SIDE_ID), seat: seatValue(SIDE_ACCOUNT) }

const session = (id: string, family: string, title: string | null) => ({
  id,
  unknown: false,
  family,
  opened_in: '',
  opened_host: '',
  title,
})
const RAIL = session('1a2b3c4d-0000-4000-8000-000000000001', 'claude', 'Fix the rail')
const REVIEW = session('5e6f7a8b-0000-4000-8000-000000000002', 'claude', 'Review the overview')
const CODEX = session('9f8e7d6c-0000-4000-8000-000000000003', 'codex', null)

/** Three sessions over three days, on the main account but for the codex one. */
const WORLD: TimedStretch[] = [
  { executor: RAIL, account: MAIN, seconds: 5 * 3600 },
  { executor: REVIEW, account: MAIN, seconds: 3 * 3600 },
  { executor: CODEX, account: SIDE, seconds: 3600 },
].flatMap(({ executor, account, seconds }, index) =>
  [0, 1, 2].map((day) => ({
    at: on(9 + day),
    group: { executor, ...account, work_item: task(index + 1, `Task ${index + 1}`) },
    spend: { seconds, tokens: 1000, cost: 1 },
  })),
)

/** A label that is only hex characters: the start of an id, said for a value with no name. */
const HEX_ONLY = /^[\da-f]{6,}$/u

async function serve(page: Page, names: Record<string, string> = {}) {
  await page.clock.setSystemTime(NOW)
  const backend = await installBackend(page, { accountNames: names })
  await serveQuota(page, quotaAt(NOW))
  await page.route('**/api/analytics/usage?*', async (route) => {
    const query = new URL(route.request().url()).searchParams
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(serveUsage(WORLD, query)),
    })
  })
  return backend
}

async function open(page: Page, state: Record<string, string> = {}) {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(pageAt(state))
  const analytics = page.locator('.analytics-page')
  await expect(analytics.locator('.tile-figure[data-measure="time"]')).toBeVisible()
  // A section's names are read in its bars, whichever drawing it opens on.
  if (state.by) await drawLined(analytics.locator('.spending-bars'))
  return analytics
}

const lead = (analytics: Locator, section: string) =>
  analytics.locator(`[data-section="${section}"] .rail-tile-lead`)

async function texts(labels: Locator) {
  const said = await labels.allTextContents()
  return said.map((text) => text.trim()).filter(Boolean)
}

test('a session is named by its title, its id in the hint, and an account by the owner’s name', async ({
  page,
}) => {
  await serve(page, { [MAIN_ID]: 'Main account' })
  const analytics = await open(page)

  // The rail: the first value of each, by its name; a session's id in the hint, an account's not.
  await expect(lead(analytics, 'executor')).toHaveText('Fix the rail')
  await expect(lead(analytics, 'executor')).toHaveAttribute('data-tooltip', /claude · 1a2b3c4d/u)
  await expect(lead(analytics, 'account')).toHaveText('Main account')
  await expect(lead(analytics, 'account')).not.toHaveAttribute(
    'data-tooltip',
    new RegExp(MAIN_ID, 'u'),
  )

  // The overview's cards hold no hex-only label either.
  for (const label of await texts(analytics.locator('.ranked-label')))
    expect(label).not.toMatch(HEX_ONLY)

  // The executor's section: its bars by title, the untitled codex session as before.
  const executors = await open(page, { by: 'executor' })
  const bars = await texts(executors.locator('.ranked-label'))
  expect(bars).toEqual(['Fix the rail', 'Review the overview', 'codex · 9f8e7d6c'])
  // The id is in the hint of the bar's row, the mark the name stands in.
  await expect(executors.locator('.ranked-line').first()).toHaveAttribute(
    'data-tooltip',
    /claude · 1a2b3c4d/u,
  )
  const names = await texts(executors.locator('.table-name'))
  expect(names[0]).toContain('Fix the rail')
  expect(names[0]).toContain('claude · 1a2b3c4d')
  for (const name of names) expect(name.split(' ')[0]).not.toMatch(HEX_ONLY)

  // The organizations' section: the named one by its name, the other by the start of its id, and
  // no row's hint says a whole id.
  const organizations = await open(page, { by: 'account' })
  expect(await texts(organizations.locator('.ranked-label'))).toEqual(['Main account', '9c0de5b1'])
  for (const [index, id] of [MAIN_ID, SIDE_ID].entries())
    await expect(organizations.locator('.ranked-line').nth(index)).not.toHaveAttribute(
      'data-tooltip',
      new RegExp(id, 'u'),
    )
  // The accounts' section: each by its organization's name, or its start, and its UUID's start.
  const accounts = await open(page, { by: 'seat' })
  expect(await texts(accounts.locator('.ranked-label'))).toEqual([
    'Main account · a1a1a1a1',
    'b2b2b2b2',
  ])
  for (const [index, id] of [MAIN_ACCOUNT, SIDE_ACCOUNT].entries())
    await expect(accounts.locator('.ranked-line').nth(index)).not.toHaveAttribute(
      'data-tooltip',
      new RegExp(id, 'u'),
    )
})

test('a name typed in Settings is the name Analytics gives the account', async ({ page }) => {
  const backend = await serve(page)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(serializePlatformRoute({ module_id: 'settings', scope: globalScope }))
  const field = page.getByRole('textbox', { name: `Name of account ${SIDE_ACCOUNT}` })
  const status = page.locator('.accounts-status [role="status"]')
  await expect(field).toHaveAttribute('placeholder', 'No name: Analytics shows b2b2b2b2')
  await field.fill('Night shift')
  await field.blur()
  await expect(status).toHaveText('Saved the name of account b2b2b2b2.')
  expect(backend.accountNames).toEqual({ [SIDE_ACCOUNT]: 'Night shift' })

  const accounts = await open(page, { by: 'seat' })
  const labels = accounts.locator('.ranked-label')
  await expect(labels.nth(1)).toHaveText('Night shift')

  // Cleared, the account reads as before; its organization named, it says that name first.
  await page.goto(serializePlatformRoute({ module_id: 'settings', scope: globalScope }))
  await page.getByRole('button', { name: `Clear the name of account ${SIDE_ACCOUNT}` }).click()
  await expect(field).toHaveValue('')
  await expect(status).toHaveText('Cleared the name of account b2b2b2b2.')
  expect(backend.accountNames).toEqual({})
  const organization = page.getByRole('textbox', { name: `Name of organization ${SIDE_ID}` })
  await expect(organization).toHaveAttribute('placeholder', 'No name: Analytics shows 9c0de5b1')
  await organization.fill('Side')
  await organization.press('Enter')
  await expect(status).toHaveText('Saved the name of organization 9c0de5b1.')
  const again = await open(page, { by: 'seat' })
  await expect(again.locator('.ranked-label').nth(1)).toHaveText('Side · b2b2b2b2')
})

test('names a device kept move to Valkama once, never over a name it has, and leave the device', async ({
  page,
}) => {
  const backend = await serve(page, { [MAIN_ID]: 'Given since' })
  await page.addInitScript(
    ([main, side]) => {
      if (!localStorage.getItem('valkama-settings'))
        localStorage.setItem(
          'valkama-settings',
          JSON.stringify({ accountAliases: { [main]: 'Kept on this device', [side]: 'Side' } }),
        )
    },
    [MAIN_ID, SIDE_ID],
  )
  const accounts = await open(page, { by: 'account' })
  const labels = accounts.locator('.ranked-label')
  await expect(labels).toHaveText(['Given since', 'Side'])
  expect(backend.accountNameWrites).toEqual([
    { names: { [MAIN_ID]: 'Kept on this device', [SIDE_ID]: 'Side' }, replace: false },
  ])
  expect(backend.accountNames).toEqual({ [MAIN_ID]: 'Given since', [SIDE_ID]: 'Side' })
  const kept = await page.evaluate(
    () =>
      (JSON.parse(localStorage.getItem('valkama-settings') ?? '{}') as Record<string, unknown>)
        .accountAliases,
  )
  expect(kept).toEqual({})

  // Opened again, the page reads Valkama's names and moves nothing.
  const again = await open(page, { by: 'account' })
  await expect(again.locator('.ranked-label')).toHaveText(['Given since', 'Side'])
  expect(backend.accountNameWrites).toHaveLength(1)
})
