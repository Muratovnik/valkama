/**
 * Back after «Show on graph» is the card on its Relations, the chain in view, because the
 * address names the card's own chain. The card's section is not in the address, and the
 * card came back on Overview, a tab away from the chain it had just been read in. A card
 * the address opens any other way, a member under the chain's graph included, opens as ever.
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { planningWorkItemEntity } from '@/shared/api/platformPlanningRefs.ts'
import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { installBackend } from './backend.ts'
import { serve, showRelations, smallChain } from './chainFixtures.ts'
import { projectScope, workItemRef } from './planningFixtures.ts'
import { test } from './test.ts'

/** The card's tab that is shown now. */
const shownTab = (page: Page) =>
  page.locator('.drawer .inspector-tabs').getByRole('tab', { selected: true })

/** A card the address opens, with the module state it names beside it. */
const cardRoute = (reference: string, state?: Record<string, string>) =>
  serializePlatformRoute({
    module_id: 'planning',
    scope: projectScope,
    entity: planningWorkItemEntity({ ...workItemRef, reference }),
    ...(state ? { state } : {}),
  })

test('Back after Show on graph opens the card on its Relations, the chain in view', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await installBackend(page)
  const { chain, items, edges } = smallChain()
  await serve(page, chain, items, edges)
  await page.goto(cardRoute(workItemRef.reference))
  await expect(shownTab(page)).toHaveText('Overview')
  await showRelations(page)
  await page.locator('.drawer section.chain').getByRole('button', { name: 'Show on graph' }).click()
  await expect(page.locator('.drawer')).toHaveCount(0)
  await expect(page.locator('.graph-chip')).toHaveText('Chain MAIN-264 · 17')

  await page.goBack()
  await expect(shownTab(page)).toHaveText('Relations')
  const shown = page.locator('.drawer section.chain')
  await expect(shown).toBeVisible()
  await expect(shown).toBeInViewport()
})

test('a card the address opens any other way opens on Overview', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await installBackend(page)
  const { chain, items, edges } = smallChain()
  await serve(page, chain, items, edges)
  // Another card under that chain's graph is not the chain's root.
  await page.goto(cardRoute('MAIN-265', { view: 'graph', chain: 'MAIN-264', chain_scope: 'chain' }))
  await expect(page.locator('.drawer')).toBeVisible()
  await expect(shownTab(page)).toHaveText('Overview')
  // The root itself, with no chain in the address.
  await page.goto(cardRoute(workItemRef.reference, { view: 'graph' }))
  await expect(page.locator('.drawer')).toBeVisible()
  await expect(shownTab(page)).toHaveText('Overview')
})
