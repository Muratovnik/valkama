/**
 * A card's chain members walked from the keyboard in the built application: a
 * long group opened and closed again without focus falling out of the drawer, and
 * a member opened and left by Back, which brings the reader to the same place.
 */
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

import { planningWorkItemEntity } from '@/shared/api/platformPlanningRefs.ts'
import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { installBackend } from './backend.ts'
import { largeChainHere, serve } from './chainFixtures.ts'
import { projectScope, workItemRef } from './planningFixtures.ts'

async function openChain(page: Page, width: number) {
  await page.setViewportSize({ width, height: 900 })
  await installBackend(page)
  await serve(page, largeChainHere())
  await page.goto(
    serializePlatformRoute({
      module_id: 'planning',
      scope: projectScope,
      entity: planningWorkItemEntity(workItemRef),
    }),
  )
  const section = page.locator('.drawer section.chain')
  await expect(section).toBeVisible()
  return section
}

const focusOnPage = (page: Page) => page.evaluate(() => document.activeElement === document.body)

for (const width of [1440, 390]) {
  test(`a long member group opens and closes from the keyboard, focus held, at ${width}px`, async ({
    page,
  }) => {
    const section = await openChain(page, width)
    const group = section.locator('section.chain-group[aria-label="Backlog"]')
    const toggle = group.locator('.chain-more')
    await expect(toggle).toHaveText('Show all · 107')
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    const list = await toggle.getAttribute('aria-controls')
    await expect(group.locator('ul')).toHaveAttribute('id', list ?? '')

    // Opened: focus moves to the first row it revealed, inside the drawer's view.
    await toggle.focus()
    await page.keyboard.press('Enter')
    const revealed = group.locator('.chain-row').nth(8)
    await expect(revealed).toBeFocused()
    await expect(revealed).toBeInViewport()
    await expect(toggle).toHaveText('Show fewer')
    await expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(await focusOnPage(page)).toBe(false)

    // Closed: the short list, and focus back on the toggle, brought into view.
    await toggle.focus()
    await page.keyboard.press('Enter')
    await expect(toggle).toBeFocused()
    await expect(toggle).toBeInViewport()
    await expect(group.locator('.chain-row')).toHaveCount(8)
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(await focusOnPage(page)).toBe(false)
  })

  test(`Back reopens the parent where it was read, focus on the member it opened, at ${width}px`, async ({
    page,
  }) => {
    const section = await openChain(page, width)
    const drawer = page.locator('.drawer')
    const body = drawer.locator('.drawer-frame-body')
    const group = section.locator('section.chain-group[aria-label="Backlog"]')
    await group.locator('.chain-more').click()
    const row = group.locator('.chain-row').nth(20)
    const reference = (await row.getAttribute('data-reference')) ?? ''
    await row.evaluate((element) => element.scrollIntoView({ block: 'center' }))
    const before = await body.evaluate((element) => element.scrollTop)
    const rowTop = () =>
      drawer
        .locator(`.chain-row[data-reference="${reference}"]`)
        .evaluate((element) => element.getBoundingClientRect().top)
    const topBefore = await rowTop()
    expect(before).toBeGreaterThan(300)

    await row.focus()
    await page.keyboard.press('Enter')
    await expect(drawer.locator('.head-back')).toBeVisible()
    await drawer.locator('.head-back').click()

    // The parent is read again from the same depth, with the member's row under focus.
    const back = drawer.locator(`.chain-row[data-reference="${reference}"]`)
    await expect(back).toBeFocused()
    expect(Math.abs((await body.evaluate((element) => element.scrollTop)) - before)).toBeLessThan(2)
    expect(Math.abs((await rowTop()) - topBefore)).toBeLessThan(2)
  })
}
