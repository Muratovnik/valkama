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

  await page.locator('.work-item-column[data-state="dev"] .work-item-tile').first().click()
  await page
    .locator('.drawer')
    .getByRole('button', { name: /Relations/i })
    .click()
  await expect(page.locator('[data-dimension="relation-state"]')).toHaveAttribute(
    'data-state',
    'resolved',
  )
})

test('degraded relation states keep their exact semantic state and labels', async ({ page }) => {
  await installBackend(page, { relationStates: ['missing', 'ambiguous', 'malformed'] })
  await page.goto(serializePlatformRoute({ module_id: 'planning', scope: projectScope }))
  await page.locator('.work-item-column[data-state="dev"] .work-item-tile').first().click()
  await page
    .locator('.drawer')
    .getByRole('button', { name: /Relations/i })
    .click()

  const states = page.locator('[data-dimension="relation-state"]')
  await expect(states).toHaveCount(3)
  await expect(states).toHaveText(['Missing', 'Ambiguous', 'Malformed'])
  await expect
    .poll(() => states.evaluateAll((elements) => elements.map((element) => element.dataset.state)))
    .toEqual(['missing', 'ambiguous', 'malformed'])
})
