/**
 * The graph field scoped to a chain, and the whole-space field without the
 * unlinked grid: what is drawn, how closed work reads, and the controls that
 * change either.
 */
import { ref } from 'vue'
import { createI18n } from 'vue-i18n'

import { flushPromises, mount } from '@vue/test-utils'
import ELK from 'elkjs/lib/elk.bundled.js'
import { describe, expect, it, vi } from 'vitest'

import GraphNodeCard from '@/widgets/work-item-graph/components/GraphNodeCard.vue'
import GraphView from '@/widgets/work-item-graph/components/GraphView.vue'

import type { PlanningEdge, WorkItemBrief } from '@/shared/api/planningModel.ts'
import { messages } from '@/shared/i18n/index.ts'

const dimensions = ref({ width: 1200, height: 680 })
const viewport = ref({ x: 0, y: 0, zoom: 1 })

vi.mock('@vue-flow/core', async (original) => ({
  ...(await original<typeof import('@vue-flow/core')>()),
  useVueFlow: () => ({
    fitView: vi.fn().mockResolvedValue(true),
    setViewport: vi.fn().mockResolvedValue(true),
    dimensions,
    viewport,
    minZoom: ref(0.01),
    maxZoom: ref(1.45),
  }),
}))

vi.mock('@/widgets/work-item-graph/utils/graphLayoutEngine.ts', () => ({
  createGraphLayoutEngine: () => {
    const elk = new ELK()
    return { layout: elk.layout.bind(elk), terminateWorker: vi.fn() }
  },
}))

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const OPEN: WorkItemBrief['state'] = {
  state_id: 'todo',
  key: 'todo',
  name: 'Todo',
  category: 'queued',
  is_terminal: false,
}
const DONE: WorkItemBrief['state'] = {
  state_id: 'done',
  key: 'done',
  name: 'Done',
  category: 'completed',
  is_terminal: true,
}

function item(n: number, overrides: Partial<WorkItemBrief> = {}): WorkItemBrief {
  return {
    work_item_id: id(n),
    planning_space_id: 'space-1',
    reference: `MAIN-${n}`,
    number: n,
    title: `item ${n}`,
    kind: 'task',
    priority: 'medium',
    state: OPEN,
    claim_ref: '',
    claim_state: null,
    parent_id: null,
    container: false,
    ready: false,
    labels: [],
    source: '',
    checklist: [],
    revision: 0,
    created_at: '2026-10-22T10:00:00Z',
    updated_at: '2026-10-22T10:00:00Z',
    comment_count: 0,
    ...overrides,
  }
}

// Root 1 (an epic) with children 2 (done) and 3; 4 discovered from 2; 5 and 6
// linked to each other outside the chain; 7 and 8 linked to nothing.
const items = [
  item(1, { kind: 'epic', container: true }),
  item(2, { parent_id: id(1), state: DONE }),
  item(3, { parent_id: id(1) }),
  item(4),
  item(5),
  item(6),
  item(7),
  item(8),
]
const spaceEdges: PlanningEdge[] = [
  { from: id(4), to: id(2), kind: 'discovered-from' },
  { from: id(5), to: id(6), kind: 'blocks' },
]

/** The state a link names for its source: open in review, or finished. */
const known = (open: boolean) => ({
  state_name: open ? 'Review' : 'Done',
  state_category: open ? ('review' as const) : ('completed' as const),
  is_terminal: !open,
  state_unavailable: null,
})

/** Vue Flow, reduced to the cards it would draw. */
const flowStub = {
  name: 'VueFlow',
  props: ['nodes', 'edges'],
  emits: ['init'],
  mounted(this: { $emit: (event: 'init') => void }) {
    this.$emit('init')
  },
  template:
    '<div><div v-for="node in nodes" :key="node.id"><slot name="node-card" :data="node.data" /></div><slot /></div>',
}

function openGraph(props: Record<string, unknown> = {}) {
  return mount(GraphView, {
    props: {
      items,
      edges: spaceEdges,
      epicId: null,
      open: true,
      scopeKind: 'all',
      space: 'space-1',
      version: 1,
      ...props,
    },
    global: {
      plugins: [createI18n({ legacy: false, locale: 'en', messages })],
      stubs: { VueFlow: flowStub, Controls: true, Background: true, Handle: true },
    },
  })
}

async function drawn(graph: ReturnType<typeof openGraph>) {
  await vi.waitFor(() => expect(graph.attributes('aria-busy')).toBe('false'))
  await flushPromises()
  return graph
    .findAllComponents(GraphNodeCard)
    .map((card) => card.props('node').reference)
    .sort((left, right) => left.localeCompare(right))
}

describe('the whole-space graph and its unlinked items', () => {
  it('leaves unlinked items out by default and draws them when the toggle is thrown', async () => {
    const graph = openGraph()
    // 3 is tied to nothing but its epic, and 4 only to closed work hidden here.
    expect(await drawn(graph)).toEqual(['MAIN-5', 'MAIN-6'])
    const toggle = graph.get('[role="switch"]')
    expect(toggle.text()).toBe('Unlinked · 4')
    expect(toggle.attributes('aria-checked')).toBe('false')
    await toggle.trigger('click')
    expect(await drawn(graph)).toEqual(['MAIN-3', 'MAIN-4', 'MAIN-5', 'MAIN-6', 'MAIN-7', 'MAIN-8'])
    expect(graph.get('[role="switch"]').attributes('aria-checked')).toBe('true')
    // The open/all filter still works beside it.
    await graph.get('button[aria-pressed="false"]').trigger('click')
    expect(await drawn(graph)).toContain('MAIN-2')
    // The whole space has no root to mark.
    expect(graph.find('.flow-node-root').exists()).toBe(false)
  })
})

describe('the graph scoped to one chain', () => {
  const chain = { members: [id(2), id(3), id(4)], reference: 'MAIN-1', total: 3 }
  const chainEdges: PlanningEdge[] = [{ from: id(4), to: id(2), kind: 'discovered-from' }]

  it('draws the root and the open members, and the closed ones only when the switch is thrown', async () => {
    const graph = openGraph({ scopeKind: 'chain', epicId: id(1), chain, edges: chainEdges })
    expect(await drawn(graph)).toEqual(['MAIN-1', 'MAIN-3', 'MAIN-4'])
    // One switch, and it is the closed one: a chain has no unlinked toggle and
    // no open/all filter.
    const toggle = graph.get('[role="switch"]')
    expect(graph.findAll('[role="switch"]')).toHaveLength(1)
    expect(toggle.text()).toBe('Closed · 1')
    expect(toggle.attributes('aria-label')).toBe('Draw the closed members of the chain')
    expect(toggle.attributes('aria-checked')).toBe('false')
    expect(graph.find('.graph-filter').exists()).toBe(false)
    // The chip still counts the whole chain.
    expect(graph.get('.graph-chip').text()).toBe('Chain MAIN-1 · 3')

    await toggle.trigger('click')
    expect(await drawn(graph)).toEqual(['MAIN-1', 'MAIN-2', 'MAIN-3', 'MAIN-4'])
    expect(graph.get('[role="switch"]').attributes('aria-checked')).toBe('true')
    const cards = graph.findAllComponents(GraphNodeCard)
    const card = (reference: string) =>
      cards.find((entry) => entry.props('node').reference === reference)
    expect(card('MAIN-2')?.props('recessed')).toBe(true)
    expect(card('MAIN-3')?.props('recessed')).toBe(false)
    expect(card('MAIN-2')?.props('chainGroup')).toBe('done')
    expect(card('MAIN-3')?.props('chainGroup')).toBe('queued')
  })

  it('takes the closed switch from its host, and hands a change back rather than keeping it', async () => {
    const graph = openGraph({
      scopeKind: 'chain',
      epicId: id(1),
      chain,
      edges: chainEdges,
      showClosed: true,
    })
    // An address that says closed draws the closed members from the start.
    expect(await drawn(graph)).toEqual(['MAIN-1', 'MAIN-2', 'MAIN-3', 'MAIN-4'])
    await graph.get('[role="switch"]').trigger('click')
    expect(graph.emitted('update:showClosed')).toEqual([[false]])
    await graph.setProps({ showClosed: false })
    expect(await drawn(graph)).toEqual(['MAIN-1', 'MAIN-3', 'MAIN-4'])
  })

  it('marks the root with a word and in its accessible name, closed or not', async () => {
    const closedRoot = items.map((entry) =>
      entry.reference === 'MAIN-1' ? { ...entry, state: DONE } : entry,
    )
    const graph = openGraph({
      scopeKind: 'chain',
      epicId: id(1),
      chain,
      edges: chainEdges,
      items: closedRoot,
    })
    await drawn(graph)
    const cards = graph.findAllComponents(GraphNodeCard)
    const root = cards.find((entry) => entry.props('node').reference === 'MAIN-1')
    expect(root?.props('root')).toBe(true)
    // Closed, it still stands above the closed work rather than with it.
    expect(root?.props('recessed')).toBe(false)
    expect(root?.get('.flow-node-root').text()).toBe('root')
    expect(root?.get('button').attributes('aria-label')).toBe('MAIN-1 item 1 · Done · chain root')
    const others = cards.filter((entry) => entry.props('node').reference !== 'MAIN-1')
    expect(others.every((entry) => !entry.find('.flow-node-root').exists())).toBe(true)
  })

  it('leaves out the origin chip that would only repeat the root, and keeps any other', async () => {
    // 3 is filed under the root itself; 4 under an epic outside the chain.
    const filed = items.map((entry) =>
      entry.reference === 'MAIN-4' ? { ...entry, parent_id: id(5) } : entry,
    )
    const graph = openGraph({
      scopeKind: 'chain',
      epicId: id(1),
      chain,
      edges: chainEdges,
      items: filed,
    })
    await drawn(graph)
    const cards = graph.findAllComponents(GraphNodeCard)
    const card = (reference: string) =>
      cards.find((entry) => entry.props('node').reference === reference)
    expect(card('MAIN-3')?.props('parentReference')).toBeUndefined()
    expect(card('MAIN-3')?.find('.flow-node-epic').exists()).toBe(false)
    expect(card('MAIN-4')?.get('.flow-node-epic').text()).toBe('MAIN-5')
  })

  it('names the chain in a chip that leads back to the whole space', async () => {
    const graph = openGraph({ scopeKind: 'chain', epicId: id(1), chain, edges: chainEdges })
    await drawn(graph)
    const chip = graph.get('.graph-chip')
    expect(chip.text()).toBe('Chain MAIN-1 · 3')
    expect(chip.attributes('aria-label')).toBe('Leave chain MAIN-1 and show the whole space')
    await chip.trigger('click')
    expect(graph.emitted('exit-chain')).toHaveLength(1)
  })

  it('says what a member waits on outside the chain, and draws no link to work it does not draw', async () => {
    // 3 is blocked by 5, of this space but not of the chain; 4 by an item of
    // another space; the root by a finished item of another space.
    const edges: PlanningEdge[] = [
      ...chainEdges,
      { from: id(5), to: id(3), kind: 'blocks', reference: 'MAIN-5', ...known(true) },
      { from: id(9001), to: id(4), kind: 'blocks', reference: 'OTH-7', ...known(true) },
      { from: id(9002), to: id(1), kind: 'blocks', reference: 'OTH-8', ...known(false) },
    ]
    const graph = openGraph({ scopeKind: 'chain', epicId: id(1), chain, edges, showClosed: true })
    expect(await drawn(graph)).toEqual(['MAIN-1', 'MAIN-2', 'MAIN-3', 'MAIN-4'])
    const cards = graph.findAllComponents(GraphNodeCard)
    const waiting = (reference: string) =>
      cards.find((entry) => entry.props('node').reference === reference)?.props('waitingOn')
    expect([waiting('MAIN-3'), waiting('MAIN-4'), waiting('MAIN-1')]).toEqual([
      'MAIN-5',
      'OTH-7',
      null,
    ])
    // Only the link between two drawn nodes is drawn.
    const flowEdges = graph.findComponent({ name: 'VueFlow' }).props('edges') as {
      source: string
      target: string
    }[]
    expect(flowEdges.map((edge) => [edge.source, edge.target])).toEqual([[id(4), id(2)]])
  })

  it('names in its legend the groups it draws, and keeps the place of the one the switch adds', async () => {
    const graph = openGraph({ scopeKind: 'chain', epicId: id(1), chain, edges: chainEdges })
    await drawn(graph)
    const key = '.graph-canvas .graph-legend-state'
    const named = () => graph.findAll(`${key}:not(.held)`).map((entry) => entry.text())
    const places = () => graph.findAll(key).map((entry) => entry.text())
    // Every open member is in the one queued state, so the key says its name,
    // as the board's column and the card's chain section do.
    expect(named()).toEqual(['Todo'])
    // «Done» is not drawn, so it is not named; its place is kept, unseen, so
    // throwing the switch moves no word of the key.
    expect(places()).toEqual(['Done', 'Todo'])
    expect(graph.get(`${key}.held`).text()).toBe('Done')
    await graph.get('[role="switch"]').trigger('click')
    await drawn(graph)
    expect(named()).toEqual(['Done', 'Todo'])
    expect(places()).toEqual(['Done', 'Todo'])
    // The key lies on the field. The bar's options hold the same key for a
    // narrow workspace only, where the field's corner gives way to the count;
    // which one shows is the container's call (the browser spec at 390).
    expect(graph.find('.graph-canvas .graph-legend').exists()).toBe(true)
    expect(graph.get('.graph-bar .graph-options .graph-legend').text()).toBe(
      graph.get('.graph-canvas .graph-legend').text(),
    )
  })

  it('keeps the group’s own word in its legend where the members span several states', async () => {
    const ready = { ...OPEN, state_id: 'ready', key: 'ready', name: 'Ready' }
    const mixed = items.map((entry) =>
      entry.work_item_id === id(4) ? { ...entry, state: ready } : entry,
    )
    const graph = openGraph({
      scopeKind: 'chain',
      epicId: id(1),
      chain,
      edges: chainEdges,
      items: mixed,
    })
    await drawn(graph)
    const named = graph.findAll('.graph-canvas .graph-legend-state:not(.held)')
    expect(named.map((entry) => entry.text())).toEqual(['To do'])
  })

  it('orders its legend as the card’s map runs a lane: finished, under way with review first, then ahead', async () => {
    const dev = { ...OPEN, state_id: 'dev', key: 'dev', name: 'Dev', category: 'active' }
    const review = {
      ...OPEN,
      state_id: 'review',
      key: 'review',
      name: 'Review',
      category: 'review',
    }
    const staged = items.map((entry) => {
      if (entry.work_item_id === id(3)) return { ...entry, state: dev }
      return entry.work_item_id === id(4) ? { ...entry, state: review } : entry
    })
    const graph = openGraph({
      scopeKind: 'chain',
      epicId: id(1),
      chain,
      edges: chainEdges,
      items: staged,
    })
    await drawn(graph)
    const named = graph.findAll('.graph-canvas .graph-legend-state:not(.held)')
    expect(named.map((entry) => entry.text())).toEqual(['Review', 'Dev', 'To do'])
  })

  it('draws each node as its colour and reference once the field is zoomed out past reading', async () => {
    const graph = openGraph({ scopeKind: 'chain', epicId: id(1), chain, edges: chainEdges })
    await drawn(graph)
    expect(graph.find('.flow-node-overview').exists()).toBe(false)
    viewport.value = { x: 0, y: 0, zoom: 0.3 }
    await flushPromises()
    const cards = graph.findAllComponents(GraphNodeCard)
    expect(cards.every((card) => card.props('overview'))).toBe(true)
    const card = cards.find((entry) => entry.props('node').reference === 'MAIN-3')
    expect(card?.get('.flow-node-overview').text()).toBe('MAIN-3')
    expect(card?.find('.flow-node-title').exists()).toBe(false)
    // Its accessible name still says everything the card does.
    expect(card?.get('button').attributes('aria-label')).toBe('MAIN-3 item 3 · Todo')
    viewport.value = { x: 0, y: 0, zoom: 1 }
    await flushPromises()
    expect(graph.find('.flow-node-overview').exists()).toBe(false)
  })
})
