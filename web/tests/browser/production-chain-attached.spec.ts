/**
 * A card of an attached store, whose chain the chain read cannot reach: it asks for none,
 * offers no Chain tab where it has no children to say there is one, and where it has
 * children its Chain says where the chain is read.
 */
import { expect } from '@playwright/test'

import { planningWorkItemEntity } from '@/shared/api/platformPlanningRefs.ts'
import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { installBackend } from './backend.ts'
import { shot } from './boardPage.ts'
import { showChain } from './chainFixtures.ts'
import { attachedWorkItemRef, projectScope } from './planningFixtures.ts'
import { test } from './test.ts'

test('an attached store item asks for no chain, and with children says where it is read', async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 390, height: 1000 })
  let children = false
  await installBackend(page, {
    includeAttachedDuplicate: true,
    card: (read) => ({ ...read, container: children }),
  })
  const asked: string[] = []
  page.on('request', (request) => {
    if (request.url().includes('/api/planning/work-item/chain')) asked.push(request.url())
  })
  const attached = serializePlatformRoute({
    module_id: 'planning',
    scope: projectScope,
    entity: planningWorkItemEntity(attachedWorkItemRef),
  })
  // With no children it cannot be known to have a chain, so it has no tab for one.
  await page.goto(attached)
  const tabs = page.locator('.drawer .inspector-tabs')
  await expect(tabs.getByRole('tab', { name: 'Relations', exact: true })).toBeVisible()
  await expect(tabs.getByRole('tab', { name: 'Chain', exact: true })).toHaveCount(0)
  children = true
  await page.reload()
  await showChain(page)
  const section = page.locator('.drawer section.chain')
  await expect(section).toBeVisible()
  await expect(section.locator('.data-empty')).toHaveText(
    'The chain is available only for work items of the primary store.',
  )
  await page.locator('.drawer').screenshot(shot(info, 'chain-attached-390.png'))
  expect(asked).toEqual([])
})
