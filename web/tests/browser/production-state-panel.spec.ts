import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { installBackend } from './backend.ts'
import { openPage } from './documentPageSurface.ts'
import { globalScope, projectScope, spaceRef } from './planningFixtures.ts'
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

test('a failed read of the alerts lies inside its settings group, apart from the head', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await installBackend(page)
  await page.route('**/api/alerts/settings', (route) =>
    route.fulfill({ status: 503, json: { error: { code: 'busy' } } }),
  )
  await page.goto(serializePlatformRoute({ module_id: 'settings', scope: projectScope }))
  const group = page.locator('.settings-group').filter({ hasText: 'Windows notifications' })
  const panel = group.locator('.platform-state-panel')
  await expect(panel).toBeVisible()
  const room = await panel.evaluate((node) => {
    const box = node.getBoundingClientRect()
    const head = node.closest('.settings-group')?.querySelector('.settings-group-head')
    const sheet = node.closest('.settings-general-sheet')
    const headBox = head?.getBoundingClientRect()
    const sheetBox = sheet?.getBoundingClientRect()
    if (!headBox || !sheetBox) return null
    return {
      above: box.top - headBox.bottom,
      start: box.left - sheetBox.left,
      end: sheetBox.right - box.right,
    }
  })
  // Flush under the head it was the head's tone running on, and its round corners stood
  // on the group's edge.
  expect(room?.above).toBeGreaterThanOrEqual(12)
  expect(room?.start).toBeGreaterThanOrEqual(12)
  expect(room?.end).toBeGreaterThanOrEqual(12)
  expect(await seam(panel)).toBeGreaterThanOrEqual(1.2)
})

const BUSY = { status: 503, json: { error: { code: 'busy' } } }

/** The Work module whose read failed: the panel on the workspace panel, in the module's frame. */
async function openModule(page: Page) {
  await page.route('**/api/planning?*', (route) => route.fulfill(BUSY))
  await page.goto(serializePlatformRoute({ module_id: 'planning', scope: projectScope }))
  return page.locator('.planning-frame .platform-state-panel')
}

/**
 * Where a failed read lies on the workspace panel itself, and how each is brought about.
 * The sheet stands two steps above that panel, 1.41 to it, which reads as a panel lifted
 * off the page rather than lying on it.
 */
const ON_THE_WORKSPACE: { name: string; open: (page: Page) => Promise<Locator> }[] = [
  { name: 'the module', open: openModule },
  {
    name: 'every project’s work',
    open: async (page) => {
      await page.route('**/api/platform/planning?*', (route) => route.fulfill(BUSY))
      await page.goto(serializePlatformRoute({ module_id: 'planning', scope: globalScope }))
      return page.locator('.planning-frame .platform-state-panel')
    },
  },
  {
    name: 'the installation’s health',
    open: async (page) => {
      await page.route('**/api/doctor', (route) => route.fulfill(BUSY))
      await page.goto(serializePlatformRoute({ module_id: 'settings', scope: projectScope }))
      await page.locator('.settings-page-sections').getByRole('tab').nth(1).click()
      return page.locator('.installation-health .platform-state-panel')
    },
  },
  {
    name: 'the sections',
    open: async (page) => {
      await page.route('**/api/modules', (route) => route.fulfill(BUSY))
      await page.goto(serializePlatformRoute({ module_id: 'planning', scope: projectScope }))
      return page.locator('.route-recovery .platform-state-panel')
    },
  },
  {
    name: 'a task’s link',
    open: async (page) => {
      await page.route('**/api/modules/planning/search?*', (route) =>
        route.fulfill({ status: 500, json: { error: { code: 'request_failed' } } }),
      )
      await page.goto(`/open/${spaceRef.space_key}-7`)
      return page.locator('.work-item-link .platform-state-panel')
    },
  },
]

for (const { name, open } of ON_THE_WORKSPACE)
  test(`a failed read of ${name} lies one step above the workspace, not two`, async ({ page }) => {
    await page.setViewportSize({ width: 1500, height: 900 })
    await installBackend(page)
    const panel = await open(page)
    await expect(panel).toBeVisible()
    const ratio = await seam(panel)
    expect(ratio).toBeGreaterThanOrEqual(1.15)
    expect(ratio).toBeLessThan(1.3)
  })

for (const colorScheme of ['dark', 'light'] as const)
  test(`in the ${colorScheme} forced palette a failed read keeps the disc that says so`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme, forcedColors: 'active' })
    await page.setViewportSize({ width: 1500, height: 900 })
    await installBackend(page)
    const panel = await openModule(page)
    await expect(panel).toBeVisible()
    const paint = await panel.evaluate((node) => {
      const mark = node.querySelector('.platform-state-mark')
      return {
        disc: mark ? getComputedStyle(mark, '::before').backgroundColor : '',
        ground: getComputedStyle(node).backgroundColor,
      }
    })
    // The palette cleared the disc's red to the ground, and only the edge was left.
    expect(paint.disc).not.toBe('')
    expect(paint.disc).not.toBe(paint.ground)
  })

for (const colorScheme of ['dark', 'light'] as const)
  test(`in the ${colorScheme} forced palette a read under way keeps its dots`, async ({ page }) => {
    await page.emulateMedia({ colorScheme, forcedColors: 'active' })
    const panel = await cardReading(page, 'waits')
    await expect(panel).toHaveAttribute('aria-busy', 'true')
    const paint = await panel.evaluate((node) => ({
      dots: [...node.querySelectorAll('.work-dots i')].map(
        (dot) => getComputedStyle(dot).backgroundColor,
      ),
      ground: getComputedStyle(document.body).backgroundColor,
    }))
    // The palette cleared a fill drawn in the text's colour to the ground, and the dots with it.
    expect(paint.dots).toHaveLength(3)
    for (const dot of paint.dots) {
      expect(dot).not.toBe('rgba(0, 0, 0, 0)')
      expect(dot).not.toBe(paint.ground)
    }
  })
