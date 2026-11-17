/**
 * The chains the browser suite serves, built into this suite's space: a small
 * one that draws legibly, the card's large one renamed into the space, and the
 * unit fixture's long one filed in it; and `serve`, which answers for them.
 */
import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import { planningWorkItemEntity } from '@/shared/api/platformPlanningRefs.ts'
import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { chainResponse } from '../fixtures/chain.ts'
import { spaceScope, workItemRef } from './planningFixtures.ts'
import { withChain } from './served/chains.ts'
import { spaceAnswer } from './servedAnswers.ts'

/**
 * Answer the chain endpoint with `chain`, and the space's read with this suite's
 * space plus the items and links a chain needs that the space does not hold.
 */
export async function serve(
  page: Page,
  chain: unknown,
  extraItems: unknown[] = [],
  extraLinks: unknown[] = [],
) {
  await page.route('**/api/planning/work-item/chain?*', (route) =>
    route.fulfill({ json: chainResponse(chain as never) }),
  )
  await page.route('**/api/planning?*', (route) =>
    route.fulfill(
      spaceAnswer(new URL(route.request().url()).searchParams, withChain(extraItems, extraLinks)),
    ),
  )
}

/**
 * Open the card's Chain tab from the keys: a press would leave the pointer's modality behind
 * for a check of what keyboard focus draws. The card offers the tab once it knows the item has
 * a chain, which for an item with no children is once its chain has been read.
 */
export async function showChain(page: Page) {
  await page.locator('.drawer').getByRole('tab', { name: 'Chain', exact: true }).focus()
  await page.keyboard.press('Enter')
  await expect(page.locator('.drawer section.chain')).toBeVisible()
}

/** The card of the suite's item on its Chain tab, or on the graph's, and the chain section on it. */
export async function openChainCard(page: Page, view?: 'graph') {
  await page.goto(
    serializePlatformRoute({
      module_id: 'planning',
      scope: spaceScope,
      entity: planningWorkItemEntity(workItemRef),
      ...(view ? { state: { view } } : {}),
    }),
  )
  await showChain(page)
  const section = page.locator('.drawer section.chain')
  await expect(section).toBeVisible()
  return section
}

/** What the address's module state says, decoded. */
export function routeState(page: Page): Record<string, unknown> {
  const encoded = new URL(page.url()).searchParams.get('state')
  return encoded === null
    ? {}
    : (JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as Record<string, unknown>)
}

/** The space's graph, at an address naming `state` beside the graph view. */
export function graphRoute(state: Record<string, string>) {
  return serializePlatformRoute({
    module_id: 'planning',
    scope: spaceScope,
    state: { view: 'graph', ...state },
  })
}

/** Whether the chain's root lies wholly inside the graph's field, as drawn. */
export async function rootFramed(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const root = document.querySelector('.flow-node-card.root')?.getBoundingClientRect()
    const field = document.querySelector('.graph-flow')?.getBoundingClientRect()
    return Boolean(
      root &&
      field &&
      root.left >= field.left &&
      root.right <= field.right &&
      root.top >= field.top &&
      root.bottom <= field.bottom,
    )
  })
}

/** Along the map's raised runs until the tip names a task under way. */
export async function pointAtWorkUnderWay(page: Page, section: Locator, word: Locator) {
  for (const run of await section.locator('.branch-map-run.raised').all()) {
    const box = await run.boundingBox()
    if (!box) continue
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await new Promise((done) => setTimeout(done, 100))
    if (await word.count()) return
  }
}

/** A chain whose every member is under `title`, so whichever the pointer lands on says it. */
export function retitledChain<Value>(chain: Value, title: string): Value {
  return JSON.parse(
    JSON.stringify(chain).replaceAll(/"title":"[^"]*"/gu, `"title":${JSON.stringify(title)}`),
  ) as Value
}

export { largeChainHere, longChainHere, smallChain } from './served/chains.ts'
