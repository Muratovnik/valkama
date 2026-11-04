import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { installBackend } from './backend.ts'
import { openPage } from './documentPageSurface.ts'
import { projectScope } from './planningFixtures.ts'
import { test } from './test.ts'

/**
 * The panel a read stands in for while it is under way or after it failed, on the grounds
 * it is shown on: a card's drawer and a document's page, which share the drawer's tone,
 * and the module's own workspace.
 */

/**
 * The WCAG 2 contrast between the panel's fill and the first opaque ground under it, which
 * is how DESIGN.md measures a seam between two surfaces.
 */
const seam = (panel: Locator) =>
  panel.evaluate((node) => {
    // This body is serialized and evaluated in the page, so a module-scope helper would not
    // be in scope there.
    // eslint-disable-next-line unicorn/consistent-function-scoping -- see above
    const channels = (value: string) => (value.match(/[0-9.]+/gu) ?? []).map(Number)
    const opaque = (value: string) => {
      const parts = channels(value)
      return parts.length === 3 || parts[3] === 1
    }
    const luminance = (value: string) => {
      const [red = 0, green = 0, blue = 0] = channels(value).map((channel) => {
        const unit = channel / 255
        return unit <= 0.04045 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4
      })
      return 0.2126 * red + 0.7152 * green + 0.0722 * blue
    }
    let ground = 'rgb(0, 0, 0)'
    for (let at = node.parentElement; at; at = at.parentElement) {
      const fill = getComputedStyle(at).backgroundColor
      if (opaque(fill)) {
        ground = fill
        break
      }
    }
    const own = getComputedStyle(node).backgroundColor
    const [light = 0, dark = 0] = [
      luminance(opaque(own) ? own : ground),
      luminance(ground),
    ].toSorted((left, right) => right - left)
    return (light + 0.05) / (dark + 0.05)
  })

/** A card whose read fails, or never answers, as the drawer opens it. */
async function cardReading(page: Page, answer: 'fails' | 'waits') {
  await page.setViewportSize({ width: 1500, height: 900 })
  await installBackend(page)
  await page.goto(serializePlatformRoute({ module_id: 'planning', scope: projectScope }))
  await page.route('**/api/modules/planning/work-item?*', async (route) => {
    if (answer === 'fails') await route.fulfill({ status: 503, json: { error: { code: 'busy' } } })
  })
  await page.locator('.work-item-column[data-state="dev"] .work-item-tile').first().click()
  const drawer = page.locator('.drawer')
  await expect(drawer).toHaveCSS('transform', 'none')
  const panel = drawer.locator('.platform-state-panel')
  await expect(panel).toBeVisible()
  return panel
}

test('a failed read in a card is a panel a step above the drawer, its edge a straight line', async ({
  page,
}) => {
  const panel = await cardReading(page, 'fails')
  // A sheet on its ground, as a card on its lane: level with the drawer it drew no box.
  expect(await seam(panel)).toBeGreaterThanOrEqual(1.2)
  await expect(panel).toHaveCSS('border-inline-start-width', '3px')
  await expect(panel).toHaveCSS('border-start-start-radius', '0px')
  await expect(panel).toHaveCSS('border-end-start-radius', '0px')
})

test('a read under way in a card starts at the column the card’s content takes', async ({
  page,
}) => {
  const panel = await cardReading(page, 'waits')
  await expect(panel).toHaveAttribute('aria-busy', 'true')
  const offset = await panel.evaluate((node) => {
    const dots = node.querySelector('.work-dots')?.getBoundingClientRect().left ?? 0
    const body = node.parentElement
    if (!body) return Number.NaN
    const start =
      body.getBoundingClientRect().left + Number.parseFloat(getComputedStyle(body).paddingLeft)
    return dots - start
  })
  // A panel's inset inside the body's own put the dots 24 px right of everything else.
  expect(offset).toBeCloseTo(0, 0)
})

test('a refused read on a document’s page is a panel a step above the page', async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 900 })
  await openPage(page, 'docs/gone.md')
  const panel = page.locator('.document-viewer .platform-state-panel')
  await expect(panel).toContainText('The file docs/gone.md is no longer in the project')
  expect(await seam(panel)).toBeGreaterThanOrEqual(1.2)
})

test('a failed read of the module stands off the workspace it lies on', async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 900 })
  await installBackend(page)
  await page.route('**/api/planning?*', (route) =>
    route.fulfill({ status: 503, json: { error: { code: 'busy' } } }),
  )
  await page.goto(serializePlatformRoute({ module_id: 'planning', scope: projectScope }))
  const panel = page.locator('.planning-frame .platform-state-panel')
  await expect(panel).toBeVisible()
  expect(await seam(panel)).toBeGreaterThanOrEqual(1.15)
})
