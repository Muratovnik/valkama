/**
 * Losing the server is background state: it is said where the connection is
 * already said, and it never moves the work on screen.
 *
 * A paragraph about paused updates used to be put into the flow above the
 * views when the stream dropped, which pushed the board's columns and the
 * graph's field down by its height for as long as the server was away, and up
 * again when it came back. Its words asked the operator to refresh to
 * reconnect, while the app reconnects by itself.
 */
import { expect, test } from '@playwright/test'

import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { installBackend } from './backend.ts'
import { projectScope } from './planningFixtures.ts'
import { installStreamDouble } from './streamDouble.ts'

const LOST = 'No connection to the local service.'

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
]) {
  for (const view of ['kanban', 'graph'] as const) {
    test(`a lost and regained connection leaves the ${view} where it was at ${viewport.width}px`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport)
      await installBackend(page)
      const stream = await installStreamDouble(page)
      const read = page.waitForResponse((response) => response.url().includes('/api/planning?'))
      await page.goto(
        serializePlatformRoute({ module_id: 'planning', scope: projectScope, state: { view } }),
      )
      const response = await read
      const model = await response.text()
      await stream.deliver(model)
      const rail = page.locator('.nav-refresh')
      await expect(rail).toHaveAttribute('data-tone', 'success')
      const stage = page.locator('.workspace-stage')
      const drawn = page.locator(view === 'kanban' ? '.work-item-column' : '.vue-flow').first()
      await expect(drawn).toBeVisible()
      const place = async () => {
        const [stageBox, drawnBox] = await Promise.all([stage.boundingBox(), drawn.boundingBox()])
        return { stage: stageBox?.y, drawn: drawnBox?.y }
      }
      const before = await place()

      await stream.drop()
      await expect(rail).toHaveAttribute('data-tone', 'warning')
      expect(await place()).toEqual(before)
      // Said where the connection is said, and to assistive technology once.
      await expect(page.getByRole('status').filter({ hasText: LOST })).toHaveCount(1)
      await expect(rail).toHaveAttribute('title', new RegExp(LOST.replaceAll('.', '\\.'), 'u'))

      await stream.deliver(model)
      await expect(rail).toHaveAttribute('data-tone', 'success')
      await expect(page.getByRole('status').filter({ hasText: LOST })).toHaveCount(0)
      expect(await place()).toEqual(before)
    })
  }

  test(`a card read while the server is away names the connection at ${viewport.width}px`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport)
    await installBackend(page)
    await page.goto(serializePlatformRoute({ module_id: 'planning', scope: projectScope }))
    await page.route('**/api/modules/planning/work-item?*', (route) =>
      route.abort('connectionrefused'),
    )
    await page.locator('.work-item-column[data-state="dev"] .work-item-tile').first().click()
    const panel = page.locator('.drawer .platform-state-panel')
    await expect(panel).toContainText(LOST)
    await expect(panel).not.toContainText('The work item could not be loaded.')
    await expect(panel.getByRole('button', { name: 'Retry' })).toBeVisible()
  })
}
