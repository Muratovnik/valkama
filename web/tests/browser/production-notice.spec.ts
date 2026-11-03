import { expect } from '@playwright/test'

import { planningWorkItemEntity } from '@/shared/api/platformPlanningRefs.ts'
import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { installBackend } from './backend.ts'
import { projectScope, workItemRef } from './planningFixtures.ts'
import { test } from './test.ts'

/**
 * The shell's notice is where a press inside a card says what it did, so the shell has to
 * keep it reachable: its status region there before anything is said, and nothing around it
 * that would hold it under the overlay it was said from.
 */
test('the shell keeps its status region, and an open card does not cover the notice', async ({
  page,
}) => {
  await installBackend(page)
  await page.goto(
    serializePlatformRoute({
      module_id: 'planning',
      scope: projectScope,
      entity: planningWorkItemEntity(workItemRef),
    }),
  )
  await expect(page.locator('.drawer .card-identity')).toBeVisible()
  await expect(page.locator('.notice')).toHaveCount(0)
  const region = page.locator('#app > [role="status"]')
  await expect(region).toHaveCount(1)
  await expect(region).toHaveText('')

  // A box in a stacking context of its own is ordered with that context, whatever its index.
  const trapping = await region.evaluate((node) => {
    const found: string[] = []
    for (let up = node.parentElement; up && up !== document.body; up = up.parentElement) {
      const style = getComputedStyle(up)
      const positioned = style.position !== 'static' && style.zIndex !== 'auto'
      if (
        positioned ||
        style.transform !== 'none' ||
        style.filter !== 'none' ||
        style.opacity !== '1' ||
        style.isolation === 'isolate' ||
        /paint|layout|strict|content/u.test(style.contain) ||
        style.containerType !== 'normal'
      )
        found.push(up.className)
    }
    return found
  })
  expect(trapping).toEqual([])
})
