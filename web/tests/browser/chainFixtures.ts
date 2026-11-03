/**
 * The chains the browser suite serves, built into this suite's space: a small
 * one that draws legibly, the card's large one renamed into the space, and the
 * unit fixture's long one filed in it; and `serve`, which answers for them.
 */
import type { Locator, Page } from '@playwright/test'

import { planningSpaceEntity } from '@/shared/api/platformPlanningRefs.ts'
import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { chainResponse, largeEpicChain } from '../fixtures/chain.ts'
import { longChainSpace } from '../fixtures/chainSpace.ts'
import {
  planningReadModel,
  projectScope,
  spaceRef,
  workItem,
  workItemRef,
} from './planningFixtures.ts'
import { planningReadFor } from './planningReadFixture.ts'

const identity = (id: number) => `00000000-0000-4000-8000-${String(id).padStart(12, '0')}`

/** The large chain, renamed into this suite's space and rooted at its item. */
export function largeChainHere() {
  const chain = JSON.parse(
    JSON.stringify(largeEpicChain()).replaceAll('MAIN-384', 'MAIN-264'),
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
export function smallChain() {
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
    members: items.map((item, index) => ({
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
      rank: index + 1,
    })),
    edges,
  }
  return { chain, items, edges }
}

/** A long-chain item's reference here, clear of the numbers the space already uses. */
const reference = (number: number) => `MAIN-${10_000 + number}`

/**
 * The long chain of the unit fixture, as this suite's space carries it: rooted at
 * MAIN-264, its 609 members filed in the space, and the answer the chain endpoint
 * gives for them.
 */
export function longChainHere() {
  const { root, scope, source } = longChainSpace()
  const members = new Set(scope.members)
  const byId = new Map(source.nodes.map((node) => [node.work_item_id, node]))
  // The unit fixture numbers its ids the way this suite's fixtures do, so its
  // ids move to a range of their own, and its root becomes MAIN-264.
  const moved = (value: string) =>
    value === root.work_item_id
      ? workItem.work_item_id
      : value.replace('-4000-8000-', '-4000-9000-')
  const parentId = (parent: string | null) => (parent === null ? null : moved(parent))
  const parentReference = (parent: string | null) => {
    if (parent === null) return null
    if (parent === root.work_item_id) return workItemRef.reference
    const node = byId.get(parent)
    return node ? reference(node.number) : null
  }
  const nodes = source.nodes.filter((node) => members.has(node.work_item_id))
  const items = nodes.map((node) => ({
    ...planningReadModel.work_items[1],
    work_item_id: moved(node.work_item_id),
    reference: reference(node.number),
    number: 10_000 + node.number,
    title: node.title,
    kind: node.kind,
    state: node.state.is_terminal ? DONE : BACKLOG,
    claim_ref: '',
    claim_state: null,
    parent_id: parentId(node.parent_id),
    container: node.container,
    ready: !node.state.is_terminal,
  }))
  const edges = source.edges
    .filter((edge) => members.has(edge.from) && members.has(edge.to))
    .map((edge) => ({
      from: moved(edge.from),
      to: moved(edge.to),
      kind: edge.kind as 'blocks' | 'discovered-from',
    }))
  const closed = items.filter((item) => item.state.is_terminal).length
  const total = items.length
  const chain = {
    ...smallChain().chain,
    total,
    closed,
    open: total - closed,
    ready: items.filter((item) => item.ready).length,
    origins: [],
    series: [{ day: '2026-10-20', created: total, closed, total, closed_total: closed }],
    members: nodes.map((node, index) => ({
      work_item_id: items[index].work_item_id,
      reference: items[index].reference,
      title: node.title,
      state: {
        key: items[index].state.key,
        name: items[index].state.name,
        category: items[index].state.category,
        is_terminal: items[index].state.is_terminal,
      },
      claim_ref: '',
      claim_state: null,
      parent_reference: parentReference(node.parent_id),
      created_at: '2026-10-01T10:00:00Z',
      closed_at: node.state.is_terminal ? '2026-10-20T10:00:00Z' : null,
      ready: items[index].ready,
      rank: index + 1,
    })),
    edges,
  }
  return { chain, items, edges }
}

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
    scope: projectScope,
    entity: planningSpaceEntity(spaceRef),
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
