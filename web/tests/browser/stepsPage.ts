/** An opened card with a checklist of its own, for the specs that point at its steps. */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { planningWorkItemEntity } from '@/shared/api/platformPlanningRefs.ts'
import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { installBackend } from './backend.ts'
import { projectScope, workItemRef } from './planningFixtures.ts'

/** Steps enough that each but the last has a step under it, one held and one done. */
export const STEP_LIST = [1, 2, 3, 4].map((number) => ({
  id: `123e4567-e89b-42d3-a456-42661417410${number}`,
  text: `Step ${number} of the work, said in a few words`,
  done: number === 2,
  claimed_by: number === 3 ? 'own-b' : '',
  done_by: number === 2 ? 'own-a' : '',
}))

/** An item's card with its checklist, open at the window the page has. */
export async function openSteps(page: Page) {
  await installBackend(page, { card: (read) => ({ ...read, checklist: STEP_LIST }) })
  await page.goto(
    serializePlatformRoute({
      module_id: 'planning',
      scope: projectScope,
      entity: planningWorkItemEntity(workItemRef),
    }),
  )
  const drawer = page.locator('.drawer')
  await expect(drawer.locator('.step-row')).toHaveCount(STEP_LIST.length)
  await expect(drawer).toHaveCSS('transform', 'none')
}
