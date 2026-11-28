import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import { planningWorkItemEntity } from '@/shared/api/platformPlanningRefs.ts'
import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { installBackend } from './backend.ts'
import { PLAN_PATH } from './planDocumentFixture.ts'
import { spaceScope, workItemRef } from './planningFixtures.ts'

/**
 * A card with a plan anchor, in a browser or in the desktop app, and the viewer it opens
 * (`production-card-source.spec.ts`, `production-card-source-clipboard.spec.ts`).
 */

export const ANCHOR = `${PLAN_PATH}#kb:architecture`

/** The page's side of the desktop bridge, and what it was asked to carry out. */
export async function inTheApp(page: Page) {
  await page.addInitScript(() => {
    const asked: unknown[] = []
    Object.assign(window, {
      asked,
      valkamaDesktop: {
        onOpenRoute: () => {},
        openSession(request: unknown) {
          asked.push(request)
          return Promise.resolve({ ok: true, mode: 'opened', next: null })
        },
      },
    })
  })
}

/** Nothing in a browser, where no bridge stands to be asked. */
export const askedOfTheApp = (page: Page) =>
  page.evaluate(() => (window as unknown as { asked?: unknown[] }).asked ?? [])

export async function openCard(
  page: Page,
  {
    locale = 'en',
    source,
    width = 1280,
  }: { locale?: string; source?: string; width?: number } = {},
) {
  await page.addInitScript((chosen) => localStorage.setItem('valkama-locale', chosen), locale)
  await page.setViewportSize({ width, height: 900 })
  await installBackend(page, source === undefined ? {} : { source })
  await page.goto(
    serializePlatformRoute({
      module_id: 'planning',
      scope: spaceScope,
      entity: planningWorkItemEntity(workItemRef),
    }),
  )
  const drawer = page.getByRole('dialog').filter({ has: page.locator('.head-reference') })
  await expect(drawer.locator('.card-identity')).toBeVisible()
  await expect(drawer).toHaveCSS('transform', 'none')
  return drawer
}

export async function toRelations(drawer: Locator, name = 'Relations') {
  await drawer.getByRole('tab', { name, exact: true }).click()
  return drawer.locator('.ref-row').first()
}

/** The viewer stands at the anchor's block, which holds focus and is on screen. */
export async function expectViewerAtAnchor(page: Page) {
  const viewer = page.locator('.document-drawer')
  await expect(viewer).toHaveCSS('transform', 'none')
  await expect(viewer.locator('.overlay-header-name')).toHaveText('The platform plan')
  const target = viewer.locator('.document-block.is-target')
  await expect(target).toContainText('The architecture')
  await expect(target).toBeFocused()
  await expect(target).toBeInViewport()
  await expect
    .poll(() => viewer.locator('.document-body').evaluate((n) => n.scrollTop))
    .toBeGreaterThan(0)
}
