import { expect } from '@playwright/test'

import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { installBackend } from './backend.ts'
import { spaceScope } from './planningFixtures.ts'
import { test } from './test.ts'

test('planning operational states use the shared semantic DOM contract', async ({ page }) => {
  await installBackend(page)
  await page.goto(serializePlatformRoute({ module_id: 'planning', scope: spaceScope }))
  // An open blocker is the tile's readiness exception, in the danger tone the state owner gives it.
  const waiting = page.locator('.work-item-tile [data-facet="readiness"]')
  await expect(waiting).toHaveAttribute('data-tone', 'danger')
  await expect(waiting).toContainText('Waiting on')
})
