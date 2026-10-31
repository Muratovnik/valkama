/**
 * A chain read end to end in the built application: the card's section for an
 * epic shaped like VAL-384, and the graph scoped to a chain and back.
 *
 * Each test saves what it looked at under its own output folder, so a reader can
 * see the composed result and not only that the assertions held.
 */
import { expect, test } from '@playwright/test'
import type { Page, TestInfo } from '@playwright/test'

import { planningWorkItemEntity } from '@/shared/api/platformPlanningRefs.ts'
import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { chainResponse, largeEpicChain } from '../fixtures/chain.ts'
import { installBackend } from './backend.ts'
import { planningReadModel, projectScope, workItem, workItemRef } from './planningFixtures.ts'
import { planningReadFor } from './planningReadFixture.ts'

const identity = (id: number) => `00000000-0000-4000-8000-${String(id).padStart(12, '0')}`

/** The large chain, renamed into this suite's space and rooted at its item. */
function largeChainHere() {
  const chain = JSON.parse(
    JSON.stringify(largeEpicChain()).replaceAll('VAL-384', 'MAIN-264').replaceAll('VAL-', 'MAIN-'),
  ) as ReturnType<typeof largeEpicChain>
  return { ...chain, root: { ...chain.root, work_item_id: workItem.work_item_id } }
}

const [BACKLOG, DEV, DONE] = planningReadModel.workflow.states.map(
  ({ position: _position, ...state }) => state,
)

/**
 * A chain small enough to draw legibly: six children of MAIN-264, four of them
 * closed, and ten items discovered from them, filed under no epic.
 */
function smallChain() {
  const brief = (number: number, state: typeof DEV, parent: string | null) => ({
    ...planningReadModel.work_items[1],
    work_item_id: identity(number),
    reference: `MAIN-${number}`,
    number,
    title: `Chain step ${number}`,
    state,
    claim_ref: state === DEV ? 'codex' : '',
    claim_state: state === DEV ? ('unconfirmed' as const) : null,
    parent_id: parent,
    ready: state === BACKLOG,
  })
  const children = [DONE, DONE, DONE, DONE, DEV, BACKLOG].map((state, index) =>
    brief(1001 + index, state, workItem.work_item_id),
  )
  const found = [DONE, DONE, DEV, DEV, BACKLOG, BACKLOG, BACKLOG, BACKLOG, DONE, BACKLOG].map(
    (state, index) => brief(1101 + index, state, null),
  )
  const items = [...children, ...found]
  const edges = [
    ...found.map((item, index) => ({
      from: item.work_item_id,
      to: children[index % children.length].work_item_id,
      kind: 'discovered-from' as const,
    })),
    { from: found[2].work_item_id, to: found[4].work_item_id, kind: 'blocks' as const },
  ]
  const closed = items.filter((item) => item.state.is_terminal).length
  const chain = {
    root: {
      work_item_id: workItem.work_item_id,
      reference: workItemRef.reference,
      title: workItem.title,
      kind: 'epic' as const,
      container: true,
      has_children: true,
    },
    scope: 'chain' as const,
    total: items.length,
    closed,
    open: items.length - closed,
    ready: items.filter((item) => item.ready).length,
    by_category: {},
    origins: [
      { parent_reference: workItemRef.reference, parent_title: null, count: 6, open: 2 },
      { parent_reference: null, parent_title: null, count: 10, open: 7 },
    ],
    series: [
      { day: '2026-10-01', created: 6, closed: 0, total: 6, closed_total: 0 },
      { day: '2026-10-20', created: 10, closed: 7, total: 16, closed_total: 7 },
    ],
    recent: { days: 7, created: 10, closed: 7, trend: 'growing' as const },
    members: items.map((item) => ({
      work_item_id: item.work_item_id,
      reference: item.reference,
      title: item.title,
      state: {
        key: item.state.key,
        name: item.state.name,
        category: item.state.category,
        is_terminal: item.state.is_terminal,
      },
      claim_ref: item.claim_ref,
      claim_state: item.claim_state,
      parent_reference: item.parent_id ? workItemRef.reference : null,
      created_at: '2026-10-01T10:00:00Z',
      closed_at: item.state.is_terminal ? '2026-10-20T10:00:00Z' : null,
      ready: item.ready,
    })),
    edges,
  }
  return { chain, items, edges }
}

async function serve(
  page: Page,
  chain: unknown,
  extraItems: unknown[] = [],
  extraLinks: unknown[] = [],
) {
  await page.route('**/api/planning/work-item/chain?*', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(chainResponse(chain as never)),
    }),
  )
  await page.route('**/api/planning?*', async (route) => {
    const response = planningReadFor(new URL(route.request().url()).searchParams)
    if (response.status === 200 && 'work_items' in response.body) {
      response.body.work_items = [...response.body.work_items, ...(extraItems as never[])]
      response.body.links = [...response.body.links, ...(extraLinks as never[])]
    }
    await route.fulfill({
      status: response.status,
      contentType: 'application/json',
      body: JSON.stringify(response.body),
    })
  })
}

async function openCard(page: Page, view?: 'graph') {
  await page.goto(
    serializePlatformRoute({
      module_id: 'planning',
      scope: projectScope,
      entity: planningWorkItemEntity(workItemRef),
      ...(view ? { state: { view } } : {}),
    }),
  )
  const section = page.locator('.drawer section.chain')
  await expect(section).toBeVisible()
  return section
}

function shot(info: TestInfo, name: string) {
  return { path: info.outputPath(name), animations: 'disabled' as const }
}

for (const width of [1440, 390]) {
  test(`the card reads a VAL-384-shaped chain at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 1000 })
    await installBackend(page)
    await serve(page, largeChainHere())
    const section = await openCard(page)
    await expect(section.locator('.chain-headline')).toHaveText('616 in all · 483 closed')
    await expect(section.locator('.chain-breakdown')).toHaveText(
      '133 open: development 11 · code review 1 · todo 14 · backlog 107 · workable: 115',
    )
    await expect(section.locator('.chain-trend')).toContainText('scope is growing')
    await expect(section.getByRole('img')).toHaveAttribute('aria-label', /616 now/u)
    await section.screenshot(shot(info, `chain-card-${width}.png`))
    await section.getByRole('button', { name: 'Show all · 107' }).click()
    await section.getByRole('button', { name: 'Done · 483' }).click()
    await expect(section.locator('.chain-row.is-done')).toHaveCount(8)
    const done = section.locator('.chain-row.is-done').first()
    await done.scrollIntoViewIfNeeded()
    await page.locator('.drawer').screenshot(shot(info, `chain-card-expanded-${width}.png`))
  })
}

test('Show on graph scopes the graph to the chain, and its chip leads back', async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await installBackend(page)
  const { chain, items, edges } = smallChain()
  await serve(page, chain, items, edges)
  const section = await openCard(page)
  await section.getByRole('button', { name: 'Show on graph' }).click()
  const chip = page.locator('.graph-chip')
  await expect(chip).toHaveText('Chain MAIN-264 · 16')
  // Every member and the root, closed work included.
  await expect(page.locator('.flow-node-card')).toHaveCount(17)
  await expect(page.locator('.graph-canvas')).toHaveClass(/settled/u)
  await page.keyboard.press('Escape')
  await expect(page.locator('.drawer')).toHaveCount(0)
  await expect(page.locator('.flow-node-card.recessed')).toHaveCount(7)
  await page.locator('.graph').screenshot(shot(info, 'chain-graph.png'))

  await chip.click()
  await expect(chip).toHaveCount(0)
  // The whole space again: its items, with the unlinked ones left out.
  await expect(page.getByRole('switch', { name: 'Draw items with no links' })).toBeVisible()
  await expect(page.locator('.graph')).toHaveAttribute('aria-busy', 'false')
  await expect(page.locator('.graph-canvas')).toHaveClass(/settled/u)
  await page.locator('.graph').screenshot(shot(info, 'space-graph-linked-only.png'))
})
