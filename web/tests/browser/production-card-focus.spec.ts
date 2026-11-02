import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import { planningWorkItemEntity } from '@/shared/api/platformPlanningRefs.ts'
import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { installBackend } from './backend.ts'
import { blockedWorkItem, projectScope, workItem, workItemRef } from './planningFixtures.ts'
import { test } from './test.ts'

const CARD = serializePlatformRoute({
  module_id: 'planning',
  scope: projectScope,
  entity: planningWorkItemEntity(workItemRef),
})
const OTHER_CARD = serializePlatformRoute({
  module_id: 'planning',
  scope: projectScope,
  entity: planningWorkItemEntity({ ...workItemRef, reference: blockedWorkItem.reference }),
})
const BOARD = serializePlatformRoute({ module_id: 'planning', scope: projectScope })

const ringed = (control: Locator) => control.evaluate((node) => node.matches(':focus-visible'))

/** A page that hears routes from outside as the desktop app hands them over, from no input. */
async function canBeHandedRoutes(page: Page) {
  await page.addInitScript(() => {
    const heard: ((route: string) => void)[] = []
    Object.assign(window, {
      handOver: (route: string) => {
        for (const listener of heard) listener(route)
      },
      valkamaDesktop: { onOpenRoute: (listener: (route: string) => void) => heard.push(listener) },
    })
  })
}

const handOver = (page: Page, route: string) =>
  page.evaluate((to) => (window as unknown as { handOver(to: string): void }).handOver(to), route)

async function cardBeingRead(page: Page) {
  const drawer = page.locator('.drawer')
  await expect(drawer.locator('.card-facts')).toBeVisible()
  await expect(drawer).toHaveCSS('transform', 'none')
  return drawer
}

for (const width of [1440, 390]) {
  test(`a card opened by its address rings nothing, and Tab starts at its first control, at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 })
    await installBackend(page)
    await page.goto(CARD)
    const drawer = await cardBeingRead(page)

    // Nobody pressed anything yet, so nothing answers a press: focus is on the dialog,
    // where a screen reader hears its name, and no control wears a ring.
    await expect(drawer).toBeFocused()
    await expect(drawer).toHaveRole('dialog')
    await expect(drawer).toHaveAccessibleName(workItem.title)
    await expect(drawer).toHaveCSS('outline-style', 'none')
    await expect(page.locator('.drawer :focus-visible')).toHaveCount(0)

    const close = drawer.locator('.drawer-frame-close')
    await page.keyboard.press('Tab')
    await expect(close).toBeFocused()
    expect(await ringed(close)).toBe(true)
  })
}

test('Shift+Tab from a card opened by its address stays in it, at its last control', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await installBackend(page)
  await page.goto(CARD)
  const drawer = await cardBeingRead(page)
  await expect(drawer).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  const inside = await page.evaluate(() => {
    const focused = document.activeElement
    return focused?.closest('.drawer') !== null && focused !== document.querySelector('.drawer')
  })
  expect(inside).toBe(true)
})

test('Escape closes a card opened by its address', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await installBackend(page)
  await page.goto(CARD)
  const drawer = await cardBeingRead(page)
  await expect(drawer).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(drawer).toHaveCount(0)
})

test('a card opened from the keyboard shows where focus is', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await installBackend(page)
  await page.goto(BOARD)
  const opener = page.locator('.work-item-column[data-state="dev"] .tile-open').first()
  await opener.focus()
  await page.keyboard.press('Enter')
  const drawer = await cardBeingRead(page)
  const close = drawer.locator('.drawer-frame-close')
  await expect(close).toBeFocused()
  expect(await ringed(close)).toBe(true)
})

test('a card opened with the pointer has focus on its first control and no ring', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await installBackend(page)
  await page.goto(BOARD)
  await page.locator('.work-item-column[data-state="dev"] .tile-open').first().click()
  const drawer = await cardBeingRead(page)
  const close = drawer.locator('.drawer-frame-close')
  await expect(close).toBeFocused()
  expect(await ringed(close)).toBe(false)
})

test('a reload forgets the input before it: the card it opens rings nothing', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await installBackend(page)
  await page.goto(CARD)
  const before = await cardBeingRead(page)
  await page.keyboard.press('Tab')
  await expect(before.locator('.drawer-frame-close')).toBeFocused()
  await page.reload()
  const drawer = await cardBeingRead(page)
  await expect(drawer).toBeFocused()
  await expect(page.locator('.drawer :focus-visible')).toHaveCount(0)
})

test('a route handed over to a card nobody has touched moves focus nowhere and rings nothing', async ({
  page,
}) => {
  await canBeHandedRoutes(page)
  await page.setViewportSize({ width: 1440, height: 900 })
  await installBackend(page)
  await page.goto(CARD)
  const drawer = await cardBeingRead(page)
  await expect(drawer).toBeFocused()
  await handOver(page, OTHER_CARD)
  await expect(drawer.locator('.head-reference')).toHaveText(blockedWorkItem.reference)
  await expect(drawer).toBeFocused()
  await expect(page.locator('.drawer :focus-visible')).toHaveCount(0)
  await page.keyboard.press('Tab')
  await expect(drawer.locator('.drawer-frame-close')).toBeFocused()
})

test('a route handed over to a card read from the keyboard shows where focus went', async ({
  page,
}) => {
  await canBeHandedRoutes(page)
  await page.setViewportSize({ width: 1440, height: 900 })
  await installBackend(page)
  await page.goto(CARD)
  const drawer = await cardBeingRead(page)
  await page.keyboard.press('Tab')
  await expect(drawer.locator('.drawer-frame-close')).toBeFocused()
  await handOver(page, OTHER_CARD)
  await expect(drawer.locator('.head-reference')).toHaveText(blockedWorkItem.reference)
  const close = drawer.locator('.drawer-frame-close')
  await expect(close).toBeFocused()
  expect(await ringed(close)).toBe(true)
})
