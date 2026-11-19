/**
 * An open popup silences the hints of everything outside it, in the built app: one surface speaks
 * at a time. With the view menu open, resting on the rail's brand showed its hint, drawn over the
 * open menu, at 1440, 1280, 1024 and 360px: the hint manager closed a hint for a dialog or a drawer
 * it was told of, and a menu, a choice list, a combobox's list or a help pinned open told it
 * nothing. Now while one is open no hint or whole words of an element outside it show, the hints of
 * its own rows still do, and once it closes the hints outside it speak again.
 */
import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import { planningWorkItemEntity } from '@/shared/api/platformPlanningRefs.ts'
import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { openDimension } from './analyticsFilter.ts'
import { openReport, serve as serveAnalytics } from './analyticsPage.ts'
import { installBackend } from './backend.ts'
import { openBoard, serve } from './boardPage.ts'
import { projectScope, workItemRef } from './planningFixtures.ts'
import { test } from './test.ts'

/** Every surface a hint draws: a hint beside its element, or a cut text's whole words. */
const hints = (page: Page) => page.locator('.tooltip-hint, .whole-text')

/** Longer than the rest a hint waits for, and the grace it stays after the pointer leaves. */
const PAST_REST = 1000

/** Rests the pointer on `what`, from a place with no hint, past the time a hint waits for. */
async function restOn(page: Page, what: Locator) {
  const viewport = page.viewportSize() ?? { width: 0, height: 0 }
  await page.mouse.move(viewport.width - 2, viewport.height - 2)
  await page.clock.runFor(PAST_REST)
  const box = await what.boundingBox()
  expect(box, 'the element to rest on, drawn').not.toBeNull()
  await page.mouse.move(
    (box?.x ?? 0) + (box?.width ?? 0) / 2,
    (box?.y ?? 0) + (box?.height ?? 0) / 2,
  )
  await page.clock.runFor(PAST_REST)
}

/**
 * An element outside every popup whose hint always shows: the rail's brand, or on a phone, where
 * the rail draws its icons alone, its Settings, whose name its hint says.
 */
async function outside(page: Page) {
  const brand = page.locator('.app-brand')
  return (await brand.isVisible()) ? brand : page.locator('.nav-item.module-settings')
}

/**
 * How many hints show resting outside the popup `open` while it is open, and once `close` closed
 * it: none, then the one of the element rested on.
 */
async function hintsAround(page: Page, open: Locator, close: () => Promise<void>) {
  await expect(open).toBeVisible()
  const element = await outside(page)
  await restOn(page, element)
  const whileOpen = await hints(page).count()
  await close()
  await expect(open).toBeHidden()
  await restOn(page, element)
  return { whileOpen, onceClosed: await page.locator('.tooltip-hint:visible').count() }
}

/** What `hintsAround` reads where the popup silences the hints outside it until it closes. */
const SILENCED = { whileOpen: 0, onceClosed: 1 }

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('valkama-locale', 'en'))
  // The hint's delay runs on this clock, so each rest is read after it.
  await page.clock.install()
})

for (const width of [1440, 1280, 1024, 360]) {
  test(`at ${width}px the open view menu silences the hints outside it until it closes`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 })
    await installBackend(page)
    await serve(page)
    await openBoard(page)
    // Its word where the bar has room, its sign alone on a phone.
    await page.getByRole('button', { name: 'View', exact: true }).locator('visible=true').click()
    expect(
      await hintsAround(page, page.getByRole('menu'), () => page.keyboard.press('Escape')),
    ).toEqual(SILENCED)
  })
}

test('at 360px the hint of the view menu’s own button goes as a key opens the menu under it', async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 900 })
  await installBackend(page)
  await serve(page)
  await openBoard(page)
  const button = page.getByRole('button', { name: 'View', exact: true }).locator('visible=true')
  // Focus a press would leave, which raises no hint: the pointer resting on it does.
  await button.evaluate((element) => (element as HTMLElement).focus())
  await restOn(page, button)
  await expect(page.locator('.tooltip-hint')).toHaveText('View')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('menu')).toBeVisible()
  await expect(hints(page), 'no hint of the button over the menu it opened').toHaveCount(0)
})

for (const width of [1440, 360]) {
  test.describe(`at ${width}px`, () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize({ width, height: 900 })
    })

    test('an open choice list silences the hints outside it', async ({ page }) => {
      await installBackend(page)
      await page.goto(serializePlatformRoute({ module_id: 'settings', scope: projectScope }))
      await page.getByRole('combobox', { name: 'Language', exact: true }).click()
      expect(
        await hintsAround(page, page.getByRole('listbox'), () => page.keyboard.press('Escape')),
      ).toEqual(SILENCED)
    })

    test('an open filter’s menu silences the hints outside it', async ({ page }) => {
      await serveAnalytics(page)
      await openReport(page, width)
      const menu = await openDimension(page, 'Model')
      expect(await hintsAround(page, menu, () => page.keyboard.press('Escape'))).toEqual(SILENCED)
    })

    test('a help pinned open by a press silences the hints outside it', async ({ page }) => {
      await serveAnalytics(page)
      const analytics = await openReport(page, width)
      const about = analytics.locator('.analytics-panel .level-about-press').first()
      await about.click()
      const panel = page.locator('.info-tip-panel')
      expect(await hintsAround(page, panel, () => about.click())).toEqual(SILENCED)
    })
  })
}

const LONG_STATE = 'Waiting for the release owner to sign off the installer build and its notes'

test('an open choice list’s own option still says its cut words whole', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await installBackend(page, {
    card: (read) => ({ ...read, state: { ...(read.state as object), name: LONG_STATE } }),
  })
  await page.goto(
    serializePlatformRoute({
      module_id: 'planning',
      scope: projectScope,
      entity: planningWorkItemEntity(workItemRef),
    }),
  )
  const drawer = page.locator('.drawer')
  await expect(drawer.locator('.card-facts .card-row-value')).toBeVisible()
  await drawer.locator('.card-state .choice-trigger').click()
  const word = page.getByRole('option').locator('.state-label', { hasText: LONG_STATE })
  await restOn(page, word)
  await expect(page.locator('.whole-text')).toHaveText(LONG_STATE)
})
