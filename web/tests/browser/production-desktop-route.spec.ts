import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { planningWorkItemEntity } from '@/shared/api/platformPlanningRefs.ts'
import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { installBackend } from './backend.ts'
import { blockedWorkItem, projectScope, spaceRef, workItemRef } from './planningFixtures.ts'
import { test } from './test.ts'

/** The route a card has, written from the fixture; the desktop app receives this from the server. */
function cardRoute(reference: string) {
  return serializePlatformRoute({
    module_id: 'planning',
    scope: projectScope,
    entity: planningWorkItemEntity({ space_ref: spaceRef, reference }),
  })
}

/**
 * The page side of the desktop bridge: what the preload exposes, and a way to act as the
 * main process handing a route over. `documents` counts every load of the page itself.
 */
async function openInDesktop(page: Page, reference: string) {
  await page.addInitScript(() => {
    const desktop = window as unknown as Window & { handOver: (route: string) => void }
    window.valkamaDesktop = {
      onOpenRoute(listener: (route: string) => void) {
        desktop.handOver = listener
      },
    } as unknown as typeof window.valkamaDesktop
  })
  const documents: string[] = []
  page.on('request', (request) => {
    if (request.resourceType() === 'document') documents.push(request.url())
  })
  await installBackend(page)
  await page.goto(cardRoute(reference))
  const drawer = page.getByRole('dialog').filter({ has: page.locator('.head-reference') })
  await expect(drawer.locator('.head-reference')).toHaveText(reference)
  await page.evaluate(() => {
    ;(window as unknown as { sameDocument: boolean }).sameDocument = true
  })
  return {
    documents,
    drawer,
    handOver: (route: string) =>
      page.evaluate((target) => {
        ;(window as unknown as { handOver: (route: string) => void }).handOver(target)
      }, route),
    sameDocument: () =>
      page.evaluate(() => (window as unknown as { sameDocument?: boolean }).sameDocument === true),
  }
}

test('a route handed over with no draft opens the card without reloading the page', async ({
  page,
}) => {
  const app = await openInDesktop(page, workItemRef.reference)
  await app.handOver(cardRoute(blockedWorkItem.reference))
  await expect(app.drawer.locator('.head-reference')).toHaveText(blockedWorkItem.reference)
  await expect(page).toHaveURL(cardRoute(blockedWorkItem.reference))
  expect(await app.sameDocument()).toBe(true)
  expect(app.documents).toHaveLength(1)
})

test('a route handed over asks before a draft goes, and keeping it stays on the card', async ({
  page,
}) => {
  const app = await openInDesktop(page, workItemRef.reference)
  const here = page.url()
  const strip = app.drawer.locator('.confirm-strip')
  const comment = app.drawer.getByRole('textbox', { name: 'Comment', exact: true })
  await comment.fill('Half a thought')

  await app.handOver(cardRoute(blockedWorkItem.reference))
  await expect(strip).toContainText('Unsaved changes will be lost: comment')
  await strip.getByRole('button', { name: 'Keep editing', exact: true }).click()
  await expect(strip).toHaveCount(0)
  await expect(page).toHaveURL(here)
  await expect(app.drawer.locator('.head-reference')).toHaveText(workItemRef.reference)
  await expect(comment).toHaveValue('Half a thought')

  await app.handOver(cardRoute(blockedWorkItem.reference))
  await strip.getByRole('button', { name: 'Discard', exact: true }).click()
  await expect(page).toHaveURL(cardRoute(blockedWorkItem.reference))
  await expect(app.drawer.locator('.head-reference')).toHaveText(blockedWorkItem.reference)
  expect(await app.sameDocument()).toBe(true)
  expect(app.documents).toHaveLength(1)
})

test('a route the page cannot read leaves it where it is', async ({ page }) => {
  const app = await openInDesktop(page, workItemRef.reference)
  const here = page.url()
  for (const route of [
    '/modules/nothing/here',
    '/modules/planning/project/example?entity=not-an-entity',
  ]) {
    await app.handOver(route)
    await expect(page).toHaveURL(here)
    await expect(app.drawer.locator('.head-reference')).toHaveText(workItemRef.reference)
  }
  expect(await app.sameDocument()).toBe(true)
})
