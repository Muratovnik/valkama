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

vi.mock('@vue-flow/core', async (original) => ({
  ...(await original<typeof import('@vue-flow/core')>()),
  useVueFlow: () => ({
    fitView: vi.fn().mockResolvedValue(true),
    setViewport: vi.fn().mockResolvedValue(true),
    dimensions,
  }),
}))

vi.mock('@/widgets/work-item-graph/utils/graphLayoutEngine.ts', () => ({
  createGraphLayoutEngine: () => {
    const elk = new ELK()
    return { layout: elk.layout.bind(elk), terminateWorker: vi.fn() }
  },
}))

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const OPEN = { state_id: 'todo', key: 'todo', name: 'Todo', category: 'queued', is_terminal: false }
const DONE = {
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
    reference: `VAL-${n}`,
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
  } as WorkItemBrief
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
    expect(await drawn(graph)).toEqual(['VAL-5', 'VAL-6'])
    const toggle = graph.get('[role="switch"]')
    expect(toggle.text()).toBe('Unlinked · 4')
    expect(toggle.attributes('aria-checked')).toBe('false')
    await toggle.trigger('click')
    expect(await drawn(graph)).toEqual(['VAL-3', 'VAL-4', 'VAL-5', 'VAL-6', 'VAL-7', 'VAL-8'])
    expect(graph.get('[role="switch"]').attributes('aria-checked')).toBe('true')
    // The open/all filter still works beside it.
    await graph.get('button[aria-pressed="false"]').trigger('click')
    expect(await drawn(graph)).toContain('VAL-2')
    // The whole space has no root to mark.
    expect(graph.find('.flow-node-root').exists()).toBe(false)
  })
})

describe('the graph scoped to one chain', () => {
  const chain = { members: [id(2), id(3), id(4)], reference: 'VAL-1', total: 3 }
  const chainEdges: PlanningEdge[] = [{ from: id(4), to: id(2), kind: 'discovered-from' }]

  it('draws the root and the open members, and the closed ones only when the switch is thrown', async () => {
    const graph = openGraph({ scopeKind: 'chain', epicId: id(1), chain, edges: chainEdges })
    expect(await drawn(graph)).toEqual(['VAL-1', 'VAL-3', 'VAL-4'])
    // One switch, and it is the closed one: a chain has no unlinked toggle and
    // no open/all filter.
    const toggle = graph.get('[role="switch"]')
    expect(graph.findAll('[role="switch"]')).toHaveLength(1)
    expect(toggle.text()).toBe('Closed · 1')
    expect(toggle.attributes('aria-label')).toBe('Draw the closed members of the chain')
    expect(toggle.attributes('aria-checked')).toBe('false')
    expect(graph.find('.graph-filter').exists()).toBe(false)
    // The chip still counts the whole chain.
    expect(graph.get('.graph-chip').text()).toBe('Chain VAL-1 · 3')

    await toggle.trigger('click')
    expect(await drawn(graph)).toEqual(['VAL-1', 'VAL-2', 'VAL-3', 'VAL-4'])
    expect(graph.get('[role="switch"]').attributes('aria-checked')).toBe('true')
    const cards = graph.findAllComponents(GraphNodeCard)
    const card = (reference: string) =>
      cards.find((entry) => entry.props('node').reference === reference)
    expect(card('VAL-2')?.props('recessed')).toBe(true)
    expect(card('VAL-3')?.props('recessed')).toBe(false)
    expect(card('VAL-2')?.props('chainGroup')).toBe('done')
    expect(card('VAL-3')?.props('chainGroup')).toBe('queued')
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
    expect(await drawn(graph)).toEqual(['VAL-1', 'VAL-2', 'VAL-3', 'VAL-4'])
    await graph.get('[role="switch"]').trigger('click')
    expect(graph.emitted('update:showClosed')).toEqual([[false]])
    await graph.setProps({ showClosed: false })
    expect(await drawn(graph)).toEqual(['VAL-1', 'VAL-3', 'VAL-4'])
  })

  it('marks the root with a word and in its accessible name, closed or not', async () => {
    const closedRoot = items.map((entry) =>
      entry.reference === 'VAL-1' ? { ...entry, state: DONE } : entry,
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
    const root = cards.find((entry) => entry.props('node').reference === 'VAL-1')
    expect(root?.props('root')).toBe(true)
    // Closed, it still stands above the closed work rather than with it.
    expect(root?.props('recessed')).toBe(false)
    expect(root?.get('.flow-node-root').text()).toBe('root')
    expect(root?.get('button').attributes('aria-label')).toBe('VAL-1 item 1 · Done · chain root')
    const others = cards.filter((entry) => entry.props('node').reference !== 'VAL-1')
    expect(others.every((entry) => !entry.find('.flow-node-root').exists())).toBe(true)
  })

  it('leaves out the origin chip that would only repeat the root, and keeps any other', async () => {
    // 3 is filed under the root itself; 4 under an epic outside the chain.
    const filed = items.map((entry) =>
      entry.reference === 'VAL-4' ? { ...entry, parent_id: id(5) } : entry,
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
    expect(card('VAL-3')?.props('parentReference')).toBeUndefined()
    expect(card('VAL-3')?.find('.flow-node-epic').exists()).toBe(false)
    expect(card('VAL-4')?.get('.flow-node-epic').text()).toBe('VAL-5')
  })

  it('names the chain in a chip that leads back to the whole space', async () => {
    const graph = openGraph({ scopeKind: 'chain', epicId: id(1), chain, edges: chainEdges })
    await drawn(graph)
    const chip = graph.get('.graph-chip')
    expect(chip.text()).toBe('Chain VAL-1 · 3')
    expect(chip.attributes('aria-label')).toBe('Leave chain VAL-1 and show the whole space')
    await chip.trigger('click')
    expect(graph.emitted('exit-chain')).toHaveLength(1)
  })

  it('names in its legend the groups it draws, and no group it leaves out', async () => {
    const graph = openGraph({ scopeKind: 'chain', epicId: id(1), chain, edges: chainEdges })
    await drawn(graph)
    const legend = () => graph.get('.graph-legend').text()
    expect(legend()).toContain('To do')
    expect(legend()).not.toContain('Done')
    expect(legend()).not.toContain('In progress')
    await graph.get('[role="switch"]').trigger('click')
    await drawn(graph)
    expect(legend()).toContain('Done')
  })
})
