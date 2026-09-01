import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { installBackend } from './backend.ts'
import { expectNoSilentClipping } from './overflow.ts'
import { globalScope, projectScope } from './planningFixtures.ts'

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
  const modules = page.locator('.registry-section.modules')
  await modules
    .locator('.registry-availability .state-label')
    .first()
    .evaluate((node) => {
      node.textContent = 'Available with a longer heterogeneous label'
    })
  const modulesBox = await modules.boundingBox()
  expect(Math.abs((modulesBox?.width ?? 0) - (pageBox?.width ?? 0))).toBeLessThan(2)
  const laneGeometry = await modules.locator('.registry-row').evaluateAll((rows) =>
    rows.map((row) => {
      const lane = row.querySelector('.registry-control-lane')?.getBoundingClientRect()
      const availability = row.querySelector('.registry-availability')?.getBoundingClientRect()
      const enablement = row.querySelector('.registry-enablement')?.getBoundingClientRect()
      const track = row.querySelector('.toggle-track')?.getBoundingClientRect()
      return {
        laneLeft: lane?.left ?? 0,
        laneWidth: lane?.width ?? 0,
        availabilityLeft: availability?.left ?? 0,
        availabilityRight: availability?.right ?? 0,
        enablementLeft: enablement?.left ?? 0,
        trackLeft: track?.left ?? 0,
      }
    }),
  )
  expect(
    Math.max(...laneGeometry.map(({ laneLeft }) => laneLeft)) -
      Math.min(...laneGeometry.map(({ laneLeft }) => laneLeft)),
  ).toBeLessThan(2)
  expect(
    Math.max(
      ...laneGeometry.map(
        ({ availabilityRight, enablementLeft }) => enablementLeft - availabilityRight,
      ),
    ),
  ).toBeLessThanOrEqual(24)
  expect(
    Math.max(...laneGeometry.map(({ laneWidth }) => laneWidth)) -
      Math.min(...laneGeometry.map(({ laneWidth }) => laneWidth)),
  ).toBeLessThan(2)
  expect(
    Math.max(...laneGeometry.map(({ availabilityLeft }) => availabilityLeft)) -
      Math.min(...laneGeometry.map(({ availabilityLeft }) => availabilityLeft)),
  ).toBeLessThan(2)
  expect(
    Math.max(...laneGeometry.map(({ enablementLeft }) => enablementLeft)) -
      Math.min(...laneGeometry.map(({ enablementLeft }) => enablementLeft)),
  ).toBeLessThan(2)
  const mutableTracks = laneGeometry.map(({ trackLeft }) => trackLeft).filter((left) => left > 0)
  expect(Math.max(...mutableTracks) - Math.min(...mutableTracks)).toBeLessThan(2)
  await expect(
    modules.locator('.registry-row').filter({ hasText: 'Settings' }).getByRole('switch'),
  ).toHaveCount(0)

  await openSettingsSection(page, 'Diagnostics')
  const diagnosticsBox = await page.locator('.installation-health').boundingBox()
  expect(Math.abs((diagnosticsBox?.width ?? 0) - (pageBox?.width ?? 0))).toBeLessThan(2)

  for (const width of [1024, 816, 360]) {
    await page.setViewportSize({ width, height: 900 })
    for (const section of ['General', 'Workspace', 'Diagnostics'] as const) {
      await openSettingsSection(page, section)
      await expectNoSilentClipping(page, `English Settings ${section} at ${width}px`)
    }
  }
})

test('Settings groups Connections by capability and keeps project assignments distinct', async ({
  page,
}) => {
  await installBackend(page)
  await page.goto(serializePlatformRoute({ module_id: 'settings', scope: projectScope }))
  await expect(page.getByRole('heading', { name: 'Interface', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Opening sessions', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Notifications', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Modules', exact: true })).toBeHidden()

  await openSettingsSection(page, 'Workspace')
  for (const heading of [
    'Modules',
    'Integrations',
    'Execution',
    'Telemetry',
    'Skills',
    'Memory',
    'Artifacts',
    'Project assignments',
  ])
    await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible()

  await expect
    .poll(() =>
      page.locator('.registry-stack').evaluate((stack) => {
        const width = stack.getBoundingClientRect().width
        return [...stack.children].every(
          (child) => Math.abs(child.getBoundingClientRect().width - width) < 2,
        )
      }),
    )
    .toBe(true)

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

test('Settings presents every built-in Connection fact and accessible bounded diagnostics', async ({
  page,
}) => {
  await installBackend(page)
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto(serializePlatformRoute({ module_id: 'settings', scope: projectScope }))
  await openSettingsSection(page, 'Workspace')
  for (const name of [
    'Claude Code execution',
    'Codex execution',
    'Claude local journal',
    'Codex rollout telemetry',
    'AgentMemory',
    'Codex skills',
    'Claude skills',
    'Git artifacts',
  ])
    await expect(page.locator('.registry-name').filter({ hasText: name })).toBeVisible()

  const git = page
    .getByRole('region', { name: 'Integrations' })
    .locator('.registry-row')
    .filter({ hasText: 'Git artifacts' })
  for (const fact of [
    'Transport',
    'built-in',
    'Capabilities',
    'artifact.inspect',
    'State',
    'Registered',
    'Scope',
    'Global',
    'Configuration owner',
    'git-artifacts',
    'Last checked',
  ])
    await expect(git).toContainText(fact)

  const details = git.getByText('Details', { exact: true })
  await details.click()
  await expect(git).toContainText('Bounded diagnostic detail')
  await details.click()
  await details.focus()
  await page.keyboard.press('Enter')
  await expect(git).toContainText('Bounded diagnostic detail')
  await expectNoSilentClipping(page, 'Settings Connections at 1280x900')

  await page.setViewportSize({ width: 816, height: 900 })
  await expect
    .poll(() =>
      page.locator('.module-stage').evaluate((node) => node.getBoundingClientRect().width),
    )
    .toBe(556)
  await expectNoSilentClipping(page, 'Settings Connections in a 556px module container')
})

test('project assignment override survives reload, resets to installation, and reports unavailable', async ({
  page,
}) => {
  const { assignmentSelectionCommands } = await installBackend(page)
  await page.goto(serializePlatformRoute({ module_id: 'settings', scope: projectScope }))
  await openSettingsSection(page, 'Workspace')
  const telemetry = page
    .locator('.project-assignments .registry-row')
    .filter({ hasText: 'telemetry.query' })
  await expect(telemetry).toContainText('Codex rollout telemetry')
  await expect(telemetry).toContainText('Claude local journal')
  await expect(telemetry).toContainText('Effective source: project')

  await page.reload()
  await expect(telemetry).toContainText('Effective source: project')
  await telemetry.getByRole('button', { name: 'Reset to default' }).click()
  await expect.poll(() => assignmentSelectionCommands.length).toBe(1)
  expect(assignmentSelectionCommands[0]).toMatchObject({
    operation: 'reset',
    capability_id: 'telemetry.query',
    expected_revision: 1,
  })
  await expect(telemetry).toContainText('Effective source: installation')
  await expect(telemetry).toContainText('Codex rollout telemetry')
  await expect(telemetry).toContainText('Project override')
  await expect(telemetry).toContainText('None')

  const unavailablePage = await page.context().newPage()
  await installBackend(unavailablePage, { telemetryUnavailable: true })
  await unavailablePage.goto(serializePlatformRoute({ module_id: 'settings', scope: projectScope }))
  await openSettingsSection(unavailablePage, 'Workspace')
  const unavailable = unavailablePage
    .locator('.project-assignments .registry-row')
    .filter({ hasText: 'telemetry.query' })
  await expect(unavailable).toContainText('Effective source: Unavailable')
  // The reason reads as a sentence; the identifier stays off the screen.
  await expect(unavailable).toContainText('No tool assigned')
  await expect(unavailable).not.toContainText('assignment-missing')
  await unavailablePage.close()
})

test('Skills keeps inventory primary and bounds comparison to one responsive skill', async ({
  page,
}) => {
  await installBackend(page)
  await page.goto(serializePlatformRoute({ module_id: 'skills', scope: globalScope }))
  await expect(page.locator('.catalog-pane')).toBeVisible()
  await expect(page.locator('.skill-table-head [role="columnheader"]')).toHaveCount(3)
  await expect(page.locator('.skill-table-head')).not.toContainText('Codex')
  await expectNoSilentClipping(page, 'Skills inventory at 1280x900')

  await page.goto(
    serializePlatformRoute({
      module_id: 'skills',
      scope: globalScope,
      state: { query: 'review', status: 'enabled', view: 'matrix' },
    }),
  )

  const matrix = page.locator('.skill-matrix')
  await expect(matrix).toBeVisible()

  // The server fixture carries eighteen skills, but comparison discloses one
  // of them across the four project rows instead of drawing 144 peer cells.
  await expect(matrix.locator('.matrix-project')).toHaveCount(4)
  await expect(matrix.locator('.matrix-cell')).toHaveCount(8)
  await expect(matrix.locator('[role="switch"]')).toHaveCount(4)
  await expect(matrix.locator('.matrix-client-scope').first()).toContainText(
    'One setting everywhere',
  )

  await expectNoSilentClipping(page, 'Skills applicability at 1280x900')

  // Query, status, and view have one route owner: reload returns to the same
  // comparison, and Inventory below receives the two still-active filters.
  await page.reload()
  await expect(page.locator('.skill-matrix')).toBeVisible()

  await page.setViewportSize({ width: 360, height: 900 })
  await expect(matrix.locator('.matrix-client-name').first()).toBeVisible()
  await expect
    .poll(() =>
      matrix
        .locator('.matrix-scroll')
        .evaluate((element) => element.scrollWidth - element.clientWidth),
    )
    .toBeLessThanOrEqual(1)
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
    )
    .toBeLessThanOrEqual(1)
  await expectNoSilentClipping(page, 'Skills applicability at 360x900')

  await page.getByRole('button', { name: 'Inventory' }).click()
  await expect(page.locator('.catalog-pane')).toBeVisible()
  await expect(page.getByRole('searchbox', { name: 'Search skills' })).toHaveValue('review')
  await expect(page.getByRole('combobox', { name: 'Skill status' })).toContainText(
    'Enabled somewhere',
  )
  await expect
    .poll(() =>
      page
        .locator('.skill-results')
        .evaluate((element) => element.scrollWidth - element.clientWidth),
    )
    .toBeLessThanOrEqual(1)
  await expectNoSilentClipping(page, 'Skills inventory at 360x900')

  await page.locator('.skill-row').first().click()
  await expect(page.locator('.skill-drawer')).toBeVisible()
  await page.reload()
  await expect(page.locator('.skill-drawer')).toBeVisible()
  await expect(page.getByRole('searchbox', { name: 'Search skills' })).toHaveValue('review')
})
