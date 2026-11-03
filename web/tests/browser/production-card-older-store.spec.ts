import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { planningWorkItemEntity } from '@/shared/api/platformPlanningRefs.ts'
import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { installBackend } from './backend.ts'
import { projectScope, workItemRef } from './planningFixtures.ts'
import { test } from './test.ts'

const CARD = serializePlatformRoute({
  module_id: 'planning',
  scope: projectScope,
  entity: planningWorkItemEntity(workItemRef),
})

/** The answer the server gives for a card in an attached store another build wrote. */
async function openRefusedCard(page: Page, locale: 'en' | 'ru') {
  await page.addInitScript((chosen) => localStorage.setItem('valkama-locale', chosen), locale)
  await page.setViewportSize({ width: 1440, height: 900 })
  await installBackend(page)
  await page.route('**/api/modules/planning/work-item?*', (route) =>
    route.fulfill({
      status: 409,
      contentType: 'application/json',
      body: JSON.stringify({
        interface_version: 'valkama-ui-state',
        status: 'unavailable',
        reason: 'store_schema_mismatch',
      }),
    }),
  )
  await page.goto(CARD)
  return page.locator('.drawer')
}

for (const [locale, sentence, generic] of [
  ['en', /written by another version of Valkama/u, /did not complete|Could not load/u],
  ['ru', /записала другая версия Valkama/u, /не завершил|Не удалось загрузить/u],
] as const) {
  test(`a card in a store another build wrote says so in ${locale}, with nothing to retry`, async ({
    page,
  }) => {
    const drawer = await openRefusedCard(page, locale)
    await expect(drawer.getByText(sentence)).toBeVisible()
    await expect(drawer.getByText(generic)).toHaveCount(0)
    await expect(drawer.getByText('store_schema_mismatch')).toHaveCount(0)
    await expect(drawer.getByRole('button', { name: /^(Retry|Повторить)$/u })).toHaveCount(0)
  })
}
