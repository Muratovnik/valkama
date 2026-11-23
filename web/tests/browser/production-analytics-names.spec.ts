/**
 * Analytics names a session by the title its client gave it, with its id in the hint, and an
 * organization or an account by the name the owner gave it in Settings, with no hint of its id,
 * which the quota panel's menu copies instead; so no label made only of hex characters stands for
 * a value whose name is known: in the rail, the overview's cards, a section's bars and its table.
 * A session with no title, and an organization with no name, keep the labels they had; an account
 * with none is said by its organization's name and the start of its UUID. The name is the one the
 * owner types in Settings → General → Accounts, kept in Valkama, which this follows from the field
 * through the server to the page; and the names a device kept before, by organization, move there
 * once, never over a name Valkama has, and leave the device. An account with no name of its own
 * whose weekly reset is known is told apart by it, «a1a1a1a1 · resets Thu 12:00», in the filter's
 * choices and the accounts' section, on one line at 1440 and 1024 pixels; an account named keeps
 * its name alone.
 */
import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { seatValue, serveUsage, task } from '../fixtures/analytics.ts'
import type { TimedStretch } from '../fixtures/analytics.ts'
import { quotaAt, withReset } from '../fixtures/quota.ts'
import { openDimension } from './analyticsFilter.ts'
import { openPanel, pageAt, record, serveQuota } from './analyticsPage.ts'
import { installBackend } from './backend.ts'
import { drawLined } from './drawnViews.ts'
import { wholeText } from './hintFramesPage.ts'
import { expectNoSilentClipping } from './overflow.ts'
import { globalScope } from './planningFixtures.ts'
import {
  MAIN,
  MAIN_ACCOUNT,
  MAIN_ID,
  on,
  session,
  SIDE_ACCOUNT,
  SIDE_ID,
  WORLD,
} from './served/analyticsNames.ts'
import { test } from './test.ts'

const NOW = new Date(2026, 10, 11, 14, 30)
/** A label that is only hex characters: the start of an id, said for a value with no name. */
const HEX_ONLY = /^[\da-f]{6,}$/u

async function serve(page: Page, names: Record<string, string> = {}, world = WORLD) {
  await page.clock.setSystemTime(NOW)
  const backend = await installBackend(page, { accountNames: names })
  await serveQuota(page, quotaAt(NOW))
  await page.route('**/api/analytics/usage?*', async (route) => {
    const query = new URL(route.request().url()).searchParams
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(serveUsage(world, query)),
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

test('a session’s cut name with its id after it says itself whole under the keyboard as under the pointer', async ({
  page,
}) => {
  // The longest session leads the table, its title too long for the name's column, so the line
  // of its title and its client with the id's start is cut. The line holds the hint, since the id
  // stands outside the press, and the keyboard's focus lands on the press inside the line.
  const title = 'Rework how the overview reads every long title a session was given by its client'
  const long = session('2c3d4e5f-0000-4000-8000-000000000004', 'claude', title)
  const world: TimedStretch[] = [
    ...WORLD,
    ...[0, 1, 2].map((day) => ({
      at: on(9 + day),
      group: { executor: long, ...MAIN, work_item: task(9, 'Task 9') },
      spend: { seconds: 8 * 3600, tokens: 1000, cost: 1 },
    })),
  ]
  await serve(page, {}, world)
  const executors = await open(page, { by: 'executor' })
  await page.evaluate(() => document.fonts.ready)
  const line = executors.locator('.spending-table tbody .table-name').first()
  await expect(line).toContainText(title)
  const cut = await line.evaluate((name) => name.scrollWidth - name.clientWidth)
  expect(cut, 'the line is cut').toBeGreaterThan(0)
  const whole = `${title} claude · 2c3d4e5f`
  const hint = wholeText(page)

  await page.mouse.move(0, 0)
  await expect(hint).toHaveCount(0)
  await line.hover()
  await expect(hint).toHaveText(whole)

  await page.mouse.move(0, 0)
  await expect(hint).toHaveCount(0)
  // From the last heading of the table, the next stop of the keyboard is the first row's press.
  await executors.locator('.spending-table thead th button').last().focus()
  await page.keyboard.press('Tab')
  await expect(line.locator('button')).toBeFocused()
  await expect(hint).toBeVisible()
  await expect(hint).toHaveText(whole)
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

/** The same work, the main account's week known to reset on Thursday at 09:00 UTC. */
const RESET_WORLD: TimedStretch[] = WORLD.map((stretch) =>
  stretch.group.seat?.id === MAIN_ACCOUNT
    ? {
        ...stretch,
        group: { ...stretch.group, seat: seatValue(MAIN_ACCOUNT, { weeklyReset: '4T09:00Z' }) },
      }
    : stretch,
)

/** How many lines each element `selector` finds holds its text on, by the rects of its text. */
const linesOf = (scope: Locator, selector: string) =>
  scope.locator(selector).evaluateAll((elements) =>
    elements.map((element) => {
      const range = document.createRange()
      range.selectNodeContents(element)
      return new Set([...range.getClientRects()].map((rect) => Math.round(rect.top))).size
    }),
  )

for (const width of [1440, 1024])
  test(`an account with no name of its own is told by when its week resets at ${width}px`, async ({
    page,
  }, info) => {
    await serve(page, { [SIDE_ACCOUNT]: 'Side desk' }, RESET_WORLD)
    await page.setViewportSize({ width, height: 900 })
    await page.goto(pageAt())
    const analytics = page.locator('.analytics-page')
    const reset = withReset('a1a1a1a1', [4, 9, 0], 'en')
    // The rail's tile leads with it too; at 1024 the page opens on the rail alone.
    await expect(lead(analytics, 'seat')).toHaveText(reset)

    // The filter's choices: the unnamed account by the start of its UUID and when its week
    // resets, the named one by its name alone.
    const menu = await openDimension(page, 'Account')
    const options = menu.locator('[role="option"]:has(.option-check)')
    await expect(options.filter({ hasText: reset })).toHaveCount(1)
    await expect(options.filter({ hasText: /^Side desk$/u })).toHaveCount(1)
    const choices = await linesOf(menu, '[role="option"] .option-text')
    await record(info, `account choices at ${width}`, choices)
    expect(choices.length).toBeGreaterThanOrEqual(2)
    for (const lines of choices) expect(lines, 'a choice on one line').toBe(1)
    await page.keyboard.press('Escape')

    // The accounts' section says them alike: whole in the legend of its chart per day, and in its
    // ranked bars on one line, ending in an ellipsis where the name's column cuts it and said
    // whole in the row's hint then (RankedBars), never cut silently.
    const accounts = await openPanel(page, pageAt({ by: 'seat' }))
    await drawLined(accounts.locator('.spending-bars'))
    await expect(accounts.locator('[data-hint-list="legend"]').first()).toBeVisible()
    const keys = accounts.locator('[data-hint-list="legend"] .chart-key-name')
    expect(await texts(keys)).toEqual([reset, 'Side desk'])
    const keyCut = await keys.evaluateAll((names) =>
      names.map((name) => name.scrollWidth - name.clientWidth),
    )
    expect(await texts(accounts.locator('.ranked-label'))).toEqual([reset, 'Side desk'])
    const rows = await accounts.locator('.ranked-line').evaluateAll((lines: HTMLElement[]) =>
      lines.map((line) => {
        const label = line.querySelector('.ranked-label')
        return {
          cut: label ? label.scrollWidth - label.clientWidth : -1,
          hint: line.dataset.tooltip ?? '',
        }
      }),
    )
    await record(info, `account names at ${width}`, { keyCut, rows })
    expect(keyCut).toHaveLength(2)
    for (const by of keyCut) expect(by, 'a legend name cut').toBeLessThanOrEqual(0)
    expect(rows).toHaveLength(2)
    for (const { cut, hint } of rows.filter((row) => row.cut > 0))
      expect(hint, `a ranked name cut by ${cut}px is said whole in its hint`).toContain(reset)
    await expectNoSilentClipping(page, `accounts at ${width}px`, '.analytics-page')
  })
