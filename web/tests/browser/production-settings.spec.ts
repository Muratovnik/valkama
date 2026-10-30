import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { installBackend } from './backend.ts'
import { expectNoSilentClipping } from './overflow.ts'
import { projectScope } from './planningFixtures.ts'

async function openSettingsSection(page: Page, name: 'Diagnostics' | 'General' | 'Workspace') {
  await page.getByRole('group', { name: 'Settings section' }).getByRole('button', { name }).click()
}

test('Settings sections share one measure and one compact control lane', async ({ page }) => {
  await installBackend(page)
  await page.setViewportSize({ width: 1920, height: 1009 })
  await page.goto(serializePlatformRoute({ module_id: 'settings', scope: projectScope }))

  const settings = page.locator('.settings-page')
  const pageBox = await settings.boundingBox()
  const generalBox = await page.locator('.settings-general').boundingBox()
  expect(pageBox).not.toBeNull()
  expect(generalBox).not.toBeNull()
  expect(Math.abs((generalBox?.width ?? 0) - (pageBox?.width ?? 0))).toBeLessThan(2)

  const sectionControl = page.getByRole('group', { name: 'Settings section' })
  const sectionIntro = page.locator('.settings-page-intro')
  const sectionControlBox = await sectionControl.boundingBox()
  const sectionIntroBox = await sectionIntro.boundingBox()
  expect(Math.abs((sectionControlBox?.x ?? 0) - (pageBox?.x ?? 0))).toBeLessThan(2)
  expect(
    (sectionIntroBox?.x ?? 0) - ((sectionControlBox?.x ?? 0) + (sectionControlBox?.width ?? 0)),
  ).toBeGreaterThanOrEqual(23)
  expect(
    (sectionIntroBox?.x ?? 0) - ((sectionControlBox?.x ?? 0) + (sectionControlBox?.width ?? 0)),
  ).toBeLessThanOrEqual(25)

  const controlLefts = await page
    .locator('.settings-general-control, .settings-general-toggle, .settings-general-checkbox')
    .evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().left))
  expect(Math.max(...controlLefts) - Math.min(...controlLefts)).toBeLessThan(2)
  expect(controlLefts[0] - (pageBox?.x ?? 0)).toBeGreaterThan((pageBox?.width ?? 0) * 0.48)
  expect(controlLefts[0] - (pageBox?.x ?? 0)).toBeLessThan((pageBox?.width ?? 0) * 0.53)

  await openSettingsSection(page, 'Workspace')
  const modules = page.locator('.settings-modules')
  const modulesBox = await modules.boundingBox()
  expect(Math.abs((modulesBox?.width ?? 0) - (pageBox?.width ?? 0))).toBeLessThan(2)
  const trackLefts = await modules
    .locator('.settings-module .toggle-track')
    .evaluateAll((tracks) => tracks.map((track) => track.getBoundingClientRect().left))
  expect(trackLefts.length).toBeGreaterThan(1)
  expect(Math.max(...trackLefts) - Math.min(...trackLefts)).toBeLessThan(2)
  await expect(
    modules.locator('.settings-module').filter({ hasText: 'Settings' }).getByRole('switch'),
  ).toHaveCount(0)

  await openSettingsSection(page, 'Diagnostics')
  const diagnosticsBox = await page.locator('.installation-health').boundingBox()
  expect(Math.abs((diagnosticsBox?.width ?? 0) - (pageBox?.width ?? 0))).toBeLessThan(2)

  for (const width of [1024, 816, 360]) {
    await page.setViewportSize({ width, height: 900 })
    for (const section of ['General', 'Workspace', 'Diagnostics'] as const) {
      await openSettingsSection(page, section)
      await expectNoSilentClipping(page, `English Settings ${section} at ${width}px`)
      const stage = await page.locator('.module-stage').boundingBox()
      const content = await page.locator('.settings-page').boundingBox()
      expect(content && stage && content.x >= stage.x).toBeTruthy()
      expect(content && stage && content.x + content.width <= stage.x + stage.width).toBeTruthy()
    }
  }
})

test('Workspace lists the modules and nothing the extension registry used to show', async ({
  page,
}) => {
  await installBackend(page)
  await page.goto(serializePlatformRoute({ module_id: 'settings', scope: projectScope }))
  await expect(page.getByRole('heading', { name: 'Interface', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Opening sessions', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Notifications', exact: true })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Modules', exact: true })).toBeHidden()

  await openSettingsSection(page, 'Workspace')
  await expect(page.getByRole('heading', { name: 'Modules', exact: true })).toBeVisible()
  for (const heading of ['Integrations', 'Project assignments'])
    await expect(page.getByRole('heading', { name: heading, exact: true })).toHaveCount(0)

  await page.reload()
  await expect(page.getByRole('button', { name: 'Workspace' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
})

test('Settings reads the installation in levels, each problem with its fix', async ({ page }) => {
  await installBackend(page)
  await page.goto(serializePlatformRoute({ module_id: 'settings', scope: projectScope }))
  await openSettingsSection(page, 'Diagnostics')
  const health = page.locator('.installation-health')
  await expect(health).toBeVisible()

  // The order is causal rather than by severity: a store that cannot be opened
  // makes every capability underneath it unknowable, so a reader working down
  // reaches a cause before its symptoms.
  const levels = health.locator('.health-level')
  await expect(levels).toHaveCount(2)
  const titles = ['Projects', 'Connections']
  for (const [index, title] of titles.entries()) {
    const label = levels.nth(index).locator('.health-level-head .state-label')
    await expect(label).toBeVisible()
    await expect(label).toHaveText(title)
  }
  // The failure remains after the earlier project warning rather than being
  // hoisted above it by a global severity sort.
  await expect(levels.nth(0)).toContainText('Project registry is unavailable')
  await expect(levels.nth(1)).toContainText('A stale server is running')

  // A red dot with nothing beside it sends somebody to read source at the
  // moment they are least able to, so every problem carries what to do.
  await expect(levels.nth(1)).toContainText('Stop that process')
  await expect(levels.nth(0)).toContainText('Check that the registry file exists')
  const summaryCounts = health.locator('.health-summary-counts .health-countline')
  await expect(summaryCounts).toHaveCount(2)
  await expect(summaryCounts.nth(0)).toContainText('Needs attention2')
  await expect(summaryCounts.nth(1)).toContainText('Passed checks1')

  // Passed checks remain available without competing with work that needs action.
  const passed = health.locator('.health-passed-summary')
  await expect(passed).toContainText('Passed checks1')
  await passed.click()
  await expect(health).toContainText('Store schema')
  await expect(health).toContainText('Schema 5 is supported by this build')
})

test('Settings modules and diagnostic actions stay readable at working widths', async ({
  page,
}) => {
  await installBackend(page)
  await page.goto(serializePlatformRoute({ module_id: 'settings', scope: projectScope }))
  for (const width of [1440, 900, 390]) {
    await page.setViewportSize({ width, height: 960 })
    await openSettingsSection(page, 'Workspace')
    await expect(page.locator('.settings-module').first()).toBeVisible()
    await expectNoSilentClipping(page, `Readable Settings modules at ${width}px`)
    await openSettingsSection(page, 'Diagnostics')
    const finding = page.locator('.health-finding').first()
    await expect(finding.locator('.health-action')).toBeVisible()
    const spacing = await finding.evaluate((element) => {
      const title = element.querySelector('.health-finding-state')?.getBoundingClientRect()
      const detail = element.querySelector('.health-detail')?.getBoundingClientRect()
      const action = element.querySelector('.health-action')?.getBoundingClientRect()
      if (!title || !detail || !action) throw new Error('Expected a complete diagnostic finding')
      return { titleGap: detail.top - title.bottom, actionGap: action.top - detail.bottom }
    })
    expect(spacing.titleGap).toBeGreaterThanOrEqual(10)
    expect(spacing.actionGap).toBeGreaterThanOrEqual(10)
    await expectNoSilentClipping(page, `Readable diagnostics at ${width}px`)
  }
})
