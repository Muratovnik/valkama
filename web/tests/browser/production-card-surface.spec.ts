import { expect } from '@playwright/test'

import { planningWorkItemEntity } from '@/shared/api/platformPlanningRefs.ts'
import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { installBackend } from './backend.ts'
import { projectScope, workItemRef } from './planningFixtures.ts'
import { test } from './test.ts'

const CARD = serializePlatformRoute({
  module_id: 'planning',
  scope: projectScope,
  entity: planningWorkItemEntity(workItemRef),
})

/**
 * Going from a card to a card the panel does not close, so it does not open either:
 * the surface is one element across a link and Back, and only the first open slides.
 * The starts are counted as they happen: on a busy machine the first open can end
 * before anything reads it, and a replay could too.
 */
for (const width of [1440, 390]) {
  test(`a link and Back keep the panel, and only the first open animates, at ${width}px`, async ({
    page,
  }) => {
    await page.addInitScript(() => {
      const count = (event: Event) => {
        if (!(event.target instanceof Element && event.target.matches('.drawer'))) return
        const root = document.documentElement
        root.dataset.surfaceStarts = String(Number(root.dataset.surfaceStarts ?? 0) + 1)
      }
      document.addEventListener('animationstart', count, true)
      document.addEventListener('transitionrun', count, true)
    })
    await page.setViewportSize({ width, height: 900 })
    await installBackend(page)
    await page.goto(CARD)
    const drawer = page.locator('.drawer')
    const moving = () => drawer.evaluate((node) => node.getAnimations().length)
    const starts = () =>
      page.evaluate(() => Number(document.documentElement.dataset.surfaceStarts ?? 0))
    await expect.poll(starts).toBeGreaterThan(0)
    await expect.poll(moving).toBe(0)
    const opened = await starts()
    await drawer.evaluate((node) => {
      node.dataset.firstSurface = ''
    })

    await drawer.getByRole('button', { name: /Relations/iu }).click()
    await drawer.locator('.link-open').first().click()
    const back = drawer.locator('.head-back')
    await expect(back).toBeVisible()
    await expect(page.locator('.drawer[data-first-surface]')).toHaveCount(1)
    expect(await moving()).toBe(0)
    expect(await starts()).toBe(opened)
    // Focus went with the card, to its first control, as it does on any open.
    await expect(back).toBeFocused()

    await back.click()
    await expect(back).toHaveCount(0)
    await expect(page.locator('.drawer[data-first-surface]')).toHaveCount(1)
    expect(await moving()).toBe(0)
    expect(await starts()).toBe(opened)
    await expect(drawer.locator('.drawer-frame-close')).toBeFocused()

    // Closing leaves through the guard's door and the surface goes with it.
    await drawer.locator('.drawer-frame-close').click()
    await expect(drawer).toHaveCount(0)
  })
}

/**
 * The panel outlives the card, and the card still answers for its own drafts: Escape,
 * the scrim, Close and a link all ask first, whichever of them the panel heard.
 */
test('every way out of a card with a draft asks first, and the panel stays while it does', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await installBackend(page)
  await page.goto(CARD)
  const drawer = page.locator('.drawer')
  const strip = drawer.locator('.confirm-strip')
  const comment = drawer.getByRole('textbox', { name: 'Comment', exact: true })
  await comment.fill('Half a thought')
  await expect(drawer).toHaveCSS('transform', 'none')
  await drawer.evaluate((node) => {
    node.dataset.firstSurface = ''
  })

  const keep = async () => {
    await expect(strip).toContainText('Unsaved changes will be lost: comment')
    await strip.getByRole('button', { name: 'Keep editing', exact: true }).click()
    await expect(strip).toHaveCount(0)
    await expect(comment).toHaveValue('Half a thought')
  }
  await page.keyboard.press('Escape')
  await keep()
  await page.locator('.overlay-scrim').click({ position: { x: 8, y: 8 } })
  await keep()
  await drawer.locator('.drawer-frame-close').click()
  await keep()

  await drawer.getByRole('button', { name: /Relations/iu }).click()
  await drawer.locator('.link-open').first().click()
  await strip.getByRole('button', { name: 'Discard', exact: true }).click()
  await expect(drawer.locator('.head-back')).toBeVisible()
  await expect(page.locator('.drawer[data-first-surface]')).toHaveCount(1)
  await expect(comment).toHaveValue('')
})
