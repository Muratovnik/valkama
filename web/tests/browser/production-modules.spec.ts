import { expect, test } from '@playwright/test'

import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { installBackend } from './backend.ts'
import { globalScope } from './planningFixtures.ts'

const openWorkspaceSettings = async (page: Parameters<typeof installBackend>[0]) => {
  await page.goto(serializePlatformRoute({ module_id: 'settings', scope: globalScope }))
  await page
    .getByRole('group', { name: 'Settings section' })
    .getByRole('button', { name: 'Workspace', exact: true })
    .click()
}

test('module disablement persists through reload, removes navigation, and has typed route recovery', async ({
  page,
}) => {
  await installBackend(page)
  await openWorkspaceSettings(page)
  const analyticsToggle = page.getByRole('switch', { name: 'Analytics' })
  await expect(page.getByRole('switch', { name: 'Settings' })).toHaveCount(0)
  await expect(analyticsToggle).toBeChecked()
  await analyticsToggle.click()
  await expect(page.getByRole('button', { name: 'Analytics' })).toHaveCount(0)
  await page.reload()
  await expect(page.getByRole('button', { name: 'Analytics' })).toHaveCount(0)

  await page.goto(serializePlatformRoute({ module_id: 'analytics', scope: globalScope }))
  await expect(page.locator('.route-recovery')).toBeVisible()
  await expect(page.locator('.module-stage')).toContainText('analytics')

  await openWorkspaceSettings(page)
  const disabledToggle = page.getByRole('switch', { name: 'Analytics' })
  await expect(disabledToggle).not.toBeChecked()
  await disabledToggle.click()
  await expect(page.getByRole('button', { name: 'Analytics' })).toBeVisible()
})

test('stale module revisions reload authority before the control is reusable', async ({ page }) => {
  await installBackend(page, { moduleConflictOnce: 'analytics' })
  // The control is busy only while its own write is in flight. Against a stub
  // that answers at once that window can close before the first assertion
  // polls, so the first write is held until this test has seen the busy state.
  let releaseWrite: (() => void) | undefined
  const writeReleased = new Promise<void>((resolve) => {
    releaseWrite = resolve
  })
  let holdNextWrite = true
  await page.route('**/api/modules/state', async (route) => {
    if (holdNextWrite) {
      holdNextWrite = false
      await writeReleased
    }
    await route.fallback()
  })
  await openWorkspaceSettings(page)
  const analyticsToggle = page.getByRole('switch', { name: 'Analytics' })
  await analyticsToggle.click()
  await expect(analyticsToggle).toHaveAttribute('aria-busy', 'true')
  releaseWrite?.()
  await expect(analyticsToggle).not.toHaveAttribute('aria-busy', 'true')
  await expect(analyticsToggle).toBeEnabled()
  await expect(analyticsToggle).toBeChecked()
  await analyticsToggle.click()
  await expect(page.getByRole('button', { name: 'Analytics' })).toHaveCount(0)
})

test('owned live feeds close on disable and sessions restart on re-enable', async ({ page }) => {
  await installBackend(page)
  await openWorkspaceSettings(page)
  const sessionsToggle = page.getByRole('switch', { name: 'Sessions' })
  await sessionsToggle.click()
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { __closedStreams?: string[] }).__closedStreams?.filter((url) =>
            url.includes('view=sessions'),
          ).length ?? 0,
      ),
    )
    .toBeGreaterThan(0)
  await sessionsToggle.click()
  await expect(sessionsToggle).toBeChecked()
})
