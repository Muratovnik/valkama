import { expect, test } from '@playwright/test'

import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { installBackend } from './backend.ts'
import { globalScope, projectScope } from './planningFixtures.ts'

test('planning operational states use the shared semantic DOM contract', async ({ page }) => {
  await installBackend(page, { includeUnboundPlanningProject: true })
  await page.goto(serializePlatformRoute({ module_id: 'planning', scope: globalScope }))

  // A mapped project says nothing about its binding; one that is not says so.
  const binding = page.locator('[data-dimension="project-binding"]')
  await expect(binding).toHaveCount(1)
  await expect(binding).toHaveAttribute('data-state', 'unbound')
  await expect(binding).toContainText('Unbound')

  await page.goto(serializePlatformRoute({ module_id: 'planning', scope: projectScope }))
  // An open blocker is the tile's readiness exception, in the danger tone the state owner gives it.
  const waiting = page.locator('.work-item-tile [data-facet="readiness"]')
  await expect(waiting).toHaveAttribute('data-tone', 'danger')
  await expect(waiting).toContainText('Waiting on')
})
