/**
 * The card's Execution tab is off until the owner turns it on, against the whole built app.
 *
 * The tab stands on one local setting, so what is proved here is what the setting removes
 * from a card and when: the tab, every read about attempts, and the launch form, with the
 * setting read before anything is drawn and followed without a reload, here and in another
 * window of the same browser.
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { planningWorkItemEntity } from '@/shared/api/platformPlanningRefs.ts'
import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { installBackend } from './backend.ts'
import { enableExecutionTab } from './executionFixtures.ts'
import { expectNoSilentClipping } from './overflow.ts'
import { projectScope, workItemRef } from './planningFixtures.ts'
import { test } from './test.ts'

const CARD = serializePlatformRoute({
  module_id: 'planning',
  scope: projectScope,
  entity: planningWorkItemEntity(workItemRef),
})
const SETTINGS = serializePlatformRoute({ module_id: 'settings', scope: projectScope })
const SWITCH = { name: /^Execution tab on a card/u }

function executionReads(page: Page) {
  const reads: string[] = []
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname
    if (path.startsWith('/api/execution/')) reads.push(path)
  })
  return reads
}

/** Every tab named Execution the page ever drew, however briefly, from its first node on. */
const recordExecutionTabs = (page: Page) =>
  page.addInitScript(() => {
    const seen: string[] = []
    Object.assign(window, { executionTabsDrawn: seen })
    new MutationObserver(() => {
      for (const tab of document.querySelectorAll('[role="tab"]')) {
        if (tab.textContent?.includes('Execution')) seen.push(tab.textContent)
      }
    }).observe(document, { characterData: true, childList: true, subtree: true })
  })

const executionTabsDrawn = (page: Page) =>
  page.evaluate(() => (window as unknown as { executionTabsDrawn: string[] }).executionTabsDrawn)

/** A mark only this document holds, so a reload is seen as its loss. */
const markDocument = (page: Page) =>
  page.evaluate(() => Object.assign(window, { sameDocument: true }))
const stillSameDocument = (page: Page) =>
  page.evaluate(() => (window as unknown as { sameDocument?: boolean }).sameDocument === true)

async function openCard(page: Page) {
  await page.goto(CARD)
  const drawer = page.locator('.drawer')
  await expect(drawer.locator('.card-facts')).toBeVisible()
  await expect(drawer).toHaveCSS('transform', 'none')
  return { drawer, tabs: drawer.locator('.inspector-tabs').getByRole('tab') }
}

test('by default a card has no Execution tab, never drew one and asks nothing about attempts', async ({
  page,
}) => {
  const reads = executionReads(page)
  await recordExecutionTabs(page)
  await installBackend(page)
  const { drawer, tabs } = await openCard(page)

  await expect(tabs).toHaveCount(4)
  await expect(tabs.first()).toHaveText('Overview')
  // The arrows reach every tab there is, one step each, and the panel follows them.
  await tabs.first().focus()
  for (const reached of [1, 2, 3]) {
    await page.keyboard.press('ArrowRight')
    await expect(tabs.nth(reached)).toBeFocused()
    await expect(tabs.nth(reached)).toHaveAttribute('aria-selected', 'true')
    await expect(drawer.locator('.inspector-panel')).toHaveAttribute(
      'aria-labelledby',
      (await tabs.nth(reached).getAttribute('id')) ?? '',
    )
  }
  await page.keyboard.press('ArrowRight')
  await expect(tabs.first()).toBeFocused()
  await page.keyboard.press('ArrowLeft')
  await expect(tabs.last()).toBeFocused()
  // The strip is one Tab stop, on the one shown.
  await page.keyboard.press('Tab')
  await expect(tabs.last()).not.toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await expect(tabs.last()).toBeFocused()

  expect(await executionTabsDrawn(page)).toEqual([])
  expect(reads).toEqual([])
  await expect(page.getByRole('dialog', { name: /Start an attempt/iu })).toHaveCount(0)
})

test('what a build before this setting stored reads as off, and stays off', async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem(
      'valkama-settings',
      JSON.stringify({ editor: 'cursor', openers: { claude: { kind: 'cursor', command: '' } } }),
    ),
  )
  const reads = executionReads(page)
  await recordExecutionTabs(page)
  await installBackend(page)
  const { tabs } = await openCard(page)
  await expect(tabs).toHaveCount(4)
  expect(await executionTabsDrawn(page)).toEqual([])
  expect(reads).toEqual([])
})

test('the setting turns the tab on without a reload, and it stays on after one', async ({
  page,
}) => {
  const reads = executionReads(page)
  await recordExecutionTabs(page)
  await installBackend(page)
  await page.goto(SETTINGS)
  const toggle = page.getByRole('switch', SWITCH)
  await expect(toggle).toHaveAttribute('aria-checked', 'false')
  await markDocument(page)
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-checked', 'true')

  await page
    .getByRole('navigation', { name: 'Product areas' })
    .getByRole('button', { name: 'Work', exact: true })
    .click()
  await page.locator('.work-item-column[data-state="dev"] .work-item-tile').first().click()
  const drawer = page.locator('.drawer')
  const tabs = drawer.locator('.inspector-tabs').getByRole('tab')
  await expect(tabs).toHaveCount(5)
  await expect(tabs.nth(1)).toHaveText('Execution')
  await tabs.nth(1).click()
  await expect(drawer).toContainText('The route is dispatched')
  expect(reads).toContain('/api/execution/history')
  expect(await stillSameDocument(page)).toBe(true)
  // The recorder and the read above can both tell the two apart: this is what off is not.
  expect(await executionTabsDrawn(page)).toContain('Execution')

  await page.reload()
  await expect(drawer.locator('.inspector-tabs').getByRole('tab')).toHaveCount(5)
})

test('turned off in another window while Execution is open, the card goes to Overview', async ({
  context,
  page,
}) => {
  await enableExecutionTab(page)
  await installBackend(page)
  const { drawer, tabs } = await openCard(page)
  await tabs.nth(1).click()
  await expect(drawer).toContainText('The route is dispatched')
  await markDocument(page)

  const other = await context.newPage()
  await installBackend(other)
  await other.goto(SETTINGS)
  const toggle = other.getByRole('switch', SWITCH)
  await expect(toggle).toHaveAttribute('aria-checked', 'true')
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-checked', 'false')

  await expect(tabs).toHaveCount(4)
  await expect(tabs.first()).toHaveAttribute('aria-selected', 'true')
  await expect(drawer.locator('.overview')).toBeVisible()
  await expect(drawer).not.toContainText('The route is dispatched')
  expect(await stillSameDocument(page)).toBe(true)

  // Turned on again the tab is back, and the card stays where it was sent.
  await toggle.click()
  await expect(tabs).toHaveCount(5)
  await expect(tabs.first()).toHaveAttribute('aria-selected', 'true')
})

test('turned off while the launch form is open, the form goes and does not come back', async ({
  context,
  page,
}) => {
  await enableExecutionTab(page)
  await installBackend(page)
  const { drawer, tabs } = await openCard(page)
  await tabs.nth(1).click()
  await drawer.getByRole('button', { name: /Start an attempt/iu }).click()
  const dialog = page.getByRole('dialog', { name: /Start an attempt/iu })
  await expect(dialog).toBeVisible()

  const other = await context.newPage()
  await installBackend(other)
  await other.goto(SETTINGS)
  const toggle = other.getByRole('switch', SWITCH)
  await toggle.click()
  await expect(dialog).toHaveCount(0)

  await toggle.click()
  await expect(tabs).toHaveCount(5)
  await expect(dialog).toHaveCount(0)
})

for (const [locale, label] of [
  ['en', /^Execution tab on a card/u],
  ['ru', /^Вкладка «Исполнение» в карточке/u],
] as const) {
  for (const width of [1280, 390]) {
    test(`the setting reads whole in ${locale} at ${width}px`, async ({ page }) => {
      await page.addInitScript(
        (language) => localStorage.setItem('valkama-locale', language),
        locale,
      )
      await page.setViewportSize({ width, height: 900 })
      await installBackend(page)
      await page.goto(SETTINGS)
      await expect(page.getByRole('switch', { name: label })).toBeVisible()
      await expectNoSilentClipping(page, `the setting in ${locale} at ${width}px`)
    })
  }
}
