import { expect, test } from '@playwright/test'

import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { installBackend } from './backend.ts'
import { globalScope, projectScope } from './planningFixtures.ts'

test('planning operational states use the shared semantic DOM contract', async ({ page }) => {
  await installBackend(page)
  await page.goto(serializePlatformRoute({ module_id: 'planning', scope: globalScope }))

  const binding = page.locator('[data-dimension="project-binding"]')
  await expect(binding).toHaveAttribute('data-state', 'mapped')
  await expect(binding).toContainText('Mapped')

  await page.goto(serializePlatformRoute({ module_id: 'planning', scope: projectScope }))
  await expect(page.locator('[data-dimension="work-item-readiness"]')).toHaveAttribute(
    'data-state',
    'blocked',
  )
})
