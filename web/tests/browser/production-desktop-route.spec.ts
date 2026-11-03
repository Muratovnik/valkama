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

const PANEL_ROUTE = '/modules/planning/global?panel=questions'
const panel = (page: Page) => page.getByRole('dialog', { name: 'Needs my answer' })

test('an address opens the panel on first load, once, and a reload does not bring it back', async ({
  page,
}) => {
  await installBackend(page)
  await page.goto(PANEL_ROUTE)
  await expect(panel(page)).toBeVisible()
  // The order is taken out of the address, and no part of it reads as a dropped query.
  await expect(page).toHaveURL('/modules/planning/global')
  await expect(page.getByText('Part of the address', { exact: false })).toHaveCount(0)

  await panel(page).getByRole('button', { name: 'Close questions' }).click()
  await expect(panel(page)).toHaveCount(0)
  await page.reload()
  await expect(page.getByRole('navigation').first()).toBeVisible()
  await expect(panel(page)).toHaveCount(0)
})

test('a page that is up opens the panel over what it shows, without moving or reloading', async ({
  page,
}) => {
  const app = await openInDesktop(page, workItemRef.reference)
  const before = page.url()
  await app.handOver(PANEL_ROUTE)
  await expect(panel(page)).toBeVisible()
  expect(page.url()).toBe(before)
  expect(await app.sameDocument()).toBe(true)
  expect(app.documents).toHaveLength(1)

  // A second ask while it is closed opens it again; the first close did not spend it.
  await panel(page).getByRole('button', { name: 'Close questions' }).click()
  await expect(panel(page)).toHaveCount(0)
  await app.handOver(PANEL_ROUTE)
  await expect(panel(page)).toBeVisible()
})

test('a toast for an item reaches its card through the redirect, without reloading', async ({
  page,
}) => {
  const app = await openInDesktop(page, workItemRef.reference)
  const reference = blockedWorkItem.reference
  await page.route(`**/open/${reference}?in=browser`, (route) =>
    route.fulfill({ status: 302, headers: { Location: cardRoute(reference) } }),
  )
  await app.handOver(`/open/${reference}?in=browser`)
  await expect(app.drawer.locator('.head-reference')).toHaveText(reference)
  await expect(page).toHaveURL(cardRoute(reference))
  expect(await app.sameDocument()).toBe(true)
  expect(app.documents).toHaveLength(1)
})

test('a toast for an item that is gone leaves the shell to say so', async ({ page }) => {
  const app = await openInDesktop(page, workItemRef.reference)
  await page.route('**/open/MAIN-999?in=browser', (route) =>
    route.fulfill({ status: 404, contentType: 'text/html', body: '<!doctype html>' }),
  )
  await app.handOver('/open/MAIN-999?in=browser')
  await expect(page).toHaveURL(/\/open\/MAIN-999\?in=browser$/)
  expect(await app.sameDocument()).toBe(true)
})

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
