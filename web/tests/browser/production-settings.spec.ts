import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { installAlerts } from './alertsFixtures.ts'
import { installBackend } from './backend.ts'
import { expectNoSilentClipping } from './overflow.ts'
import { projectScope } from './planningFixtures.ts'
import { test } from './test.ts'

async function openSettingsSection(page: Page, name: 'Diagnostics' | 'General') {
  await page.getByRole('tablist', { name: 'Settings section' }).getByRole('tab', { name }).click()
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

  const sectionControl = page.getByRole('tablist', { name: 'Settings section' })
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
    .locator('.settings-general-control, .settings-alerts-control')
    .evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().left))
  expect(Math.max(...controlLefts) - Math.min(...controlLefts)).toBeLessThan(2)
  expect(controlLefts[0] - (pageBox?.x ?? 0)).toBeGreaterThan((pageBox?.width ?? 0) * 0.48)
  expect(controlLefts[0] - (pageBox?.x ?? 0)).toBeLessThan((pageBox?.width ?? 0) * 0.53)

  await openSettingsSection(page, 'Diagnostics')
  const diagnosticsBox = await page.locator('.installation-health').boundingBox()
  expect(Math.abs((diagnosticsBox?.width ?? 0) - (pageBox?.width ?? 0))).toBeLessThan(2)

  for (const width of [1024, 816, 360]) {
    await page.setViewportSize({ width, height: 900 })
    for (const section of ['General', 'Diagnostics'] as const) {
      await openSettingsSection(page, section)
      await expectNoSilentClipping(page, `English Settings ${section} at ${width}px`)
      const stage = await page.locator('.module-stage').boundingBox()
      const content = await page.locator('.settings-page').boundingBox()
      expect(content && stage && content.x >= stage.x).toBeTruthy()
      expect(content && stage && content.x + content.width <= stage.x + stage.width).toBeTruthy()
    }
  }
})

test('Settings has nothing to switch modules with and nothing the registry used to show', async ({
  page,
}) => {
  await installBackend(page)
  await page.goto(serializePlatformRoute({ module_id: 'settings', scope: projectScope }))
  await expect(page.getByRole('heading', { name: 'Interface', exact: true })).toBeVisible()
  await expect(
    page.getByRole('heading', { name: 'Opening sessions and files', exact: true }),
  ).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Windows notifications' })).toBeVisible()

  // The module list is the build's, so there is no section that changes it.
  const sections = page.getByRole('tablist', { name: 'Settings section' }).getByRole('tab')
  await expect(sections).toHaveText(['General', 'Diagnostics'])
  for (const section of ['General', 'Diagnostics'] as const) {
    await openSettingsSection(page, section)
    for (const heading of ['Modules', 'Integrations', 'Project assignments'])
      await expect(page.getByRole('heading', { name: heading, exact: true })).toHaveCount(0)
    await expect(page.locator('.settings-page').getByRole('switch', { name: 'Work' })).toHaveCount(
      0,
    )
  }
  await expect(
    page
      .getByRole('navigation', { name: 'Product areas' })
      .getByRole('button', { name: 'Work', exact: true }),
  ).toBeVisible()
})

test('the sections are tabs that open on Enter, since Diagnostics runs the checks', async ({
  page,
}) => {
  await installBackend(page)
  await page.goto(serializePlatformRoute({ module_id: 'settings', scope: projectScope }))
  const strip = page.getByRole('tablist', { name: 'Settings section' })
  const [general, diagnostics] = [
    strip.getByRole('tab', { name: 'General' }),
    strip.getByRole('tab', { name: 'Diagnostics' }),
  ]
  const panel = page.getByRole('tabpanel')
  await expect(panel).toHaveAttribute('aria-labelledby', (await general.getAttribute('id')) ?? '')
  await general.focus()
  // The arrows walk the tabs and open nothing: opening Diagnostics reads the installation.
  await page.keyboard.press('ArrowRight')
  await expect(diagnostics).toBeFocused()
  await expect(diagnostics).toHaveAttribute('aria-selected', 'false')
  await expect(page.getByRole('heading', { name: 'Interface', exact: true })).toBeVisible()
  await page.keyboard.press('Enter')
  await expect(diagnostics).toHaveAttribute('aria-selected', 'true')
  await expect(panel).toHaveAttribute(
    'aria-labelledby',
    (await diagnostics.getAttribute('id')) ?? '',
  )
  await expect(diagnostics).toHaveAttribute('aria-controls', (await panel.getAttribute('id')) ?? '')
})

test('a link to the retired Workspace section opens General', async ({ page }) => {
  await installBackend(page)
  await page.goto(
    serializePlatformRoute({
      module_id: 'settings',
      scope: projectScope,
      state: { section: 'workspace' },
    }),
  )
  await expect(page.getByRole('tab', { name: 'General' })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('heading', { name: 'Interface', exact: true })).toBeVisible()
  await expect(page.locator('.route-recovery')).toHaveCount(0)
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

test('Settings diagnostic actions stay readable at working widths', async ({ page }) => {
  await installBackend(page)
  await page.goto(serializePlatformRoute({ module_id: 'settings', scope: projectScope }))
  for (const width of [1440, 900, 390]) {
    await page.setViewportSize({ width, height: 960 })
    await openSettingsSection(page, 'General')
    await expectNoSilentClipping(page, `Readable Settings General at ${width}px`)
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

// A setting whose control column is a stack — a caption over each of two places, a list of
// checkboxes — is named on the line of the first thing in it, not half way down: «Claude
// Code» stood 49px below the first place it names. A row of one control stays centred on it.
test('a setting is named at the top of a stack and beside a single control', async ({ page }) => {
  await installBackend(page)
  await installAlerts(page)
  await page.setViewportSize({ width: 1500, height: 1800 })
  await page.goto(serializePlatformRoute({ module_id: 'settings', scope: projectScope }))
  await expect(page.locator('.settings-row').first()).toBeVisible()
  const rows = await page.locator('.settings-row').evaluateAll((all) =>
    all.map((row) => {
      const label = row.querySelector('.settings-row-label')
      const identity = row.querySelector('.settings-row-identity')?.getBoundingClientRect()
      const control = row.querySelector('.settings-row-control')
      const column = control?.getBoundingClientRect()
      if (!label || !identity || !control || !column) throw new Error('Expected a whole row')
      // The foot of the first line of words the control column shows.
      let first = Number.NaN
      const walker = document.createTreeWalker(control, NodeFilter.SHOW_TEXT)
      for (let at = walker.nextNode(); at && Number.isNaN(first); at = walker.nextNode()) {
        const range = document.createRange()
        range.selectNodeContents(at)
        const [rect] = range.getClientRects()
        if (at.textContent?.trim() && rect && rect.height > 0) first = rect.bottom
      }
      const words = document.createRange()
      words.selectNodeContents(label)
      return {
        label: label.textContent ?? '',
        // One control stands at most 44px high; a caption over it, or a second one, is a stack.
        stack: column.height > 60,
        fromFirstLine: Math.round(words.getClientRects()[0].bottom - first),
        fromMiddle: Math.round(identity.top + identity.height / 2 - column.top - column.height / 2),
      }
    }),
  )
  const stacks = rows.filter(({ stack }) => stack)
  expect(stacks.map(({ label }) => label)).toEqual([
    'Events',
    'Claude Code',
    'Codex',
    'Other clients',
  ])
  expect(stacks.filter(({ fromFirstLine }) => Math.abs(fromFirstLine) > 3)).toEqual([])
  const single = rows.filter(({ stack }) => !stack)
  expect(single.filter(({ fromMiddle }) => Math.abs(fromMiddle) > 2)).toEqual([])
})
