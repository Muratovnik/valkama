/**
 * The graph field of a space with one chain in it, mounted as its view is: the items, the
 * chain grown from goal 1 and the same chain grown from task 1, and what reads the field.
 * A spec that mounts it mocks Vue Flow's camera and the layout worker itself.
 */
import { createI18n } from 'vue-i18n'

import { flushPromises, mount } from '@vue/test-utils'
import { expect, vi } from 'vitest'

import GraphNodeCard from '@/widgets/work-item-graph/components/GraphNodeCard.vue'
import GraphView from '@/widgets/work-item-graph/components/GraphView.vue'

import type { PlanningEdge, WorkItemBrief } from '@/shared/api/planningModel.ts'
import { messages } from '@/shared/i18n/index.ts'

export const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
export const OPEN: NonNullable<WorkItemBrief['state']> = {
  state_id: 'ready',
  key: 'ready',
  name: 'Ready',
  category: 'ready',
  is_terminal: false,
}
export const DONE: NonNullable<WorkItemBrief['state']> = {
  state_id: 'done',
  key: 'done',
  name: 'Done',
  category: 'completed',
  is_terminal: true,
}

export function item(n: number, overrides: Partial<WorkItemBrief> = {}): WorkItemBrief {
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
    open: !(overrides.state ?? OPEN).is_terminal,
    container_state: null,
    acceptance: null,
    started_at: null,
    waits_for: [],
    workable: false,
    withheld: ['not_ready'],
    lapsed_claim: null,
    labels: [],
    projects: [],
    source: '',
    checklist: [],
    revision: 0,
    created_at: '2026-10-22T10:00:00Z',
    updated_at: '2026-10-22T10:00:00Z',
    comment_count: 0,
    ...overrides,
  }
}

// Root 1 (a goal) with children 2 (done) and 3; 4 discovered from 2; 5 and 6
// linked to each other outside the chain; 7 and 8 linked to nothing.
export const items = [
  item(1, { kind: 'goal' }),
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
export const known = (open: boolean) => ({
  state_name: open ? 'Review' : 'Done',
  state_category: open ? ('review' as const) : ('completed' as const),
  is_terminal: !open,
  state_unavailable: null,
})

/** Vue Flow, reduced to the cards and frames it would draw, each through the slot of its type. */
const flowStub = {
  name: 'VueFlow',
  props: ['nodes', 'edges'],
  emits: ['init'],
  mounted(this: { $emit: (event: 'init') => void }) {
    this.$emit('init')
  },
  template:
    '<div><div v-for="node in nodes" :key="node.id"><slot :name="`node-${node.type}`" :data="node.data" /></div><slot /></div>',
}

export function openGraph(props: Record<string, unknown> = {}) {
  return mount(GraphView, {
    props: {
      items,
      edges: spaceEdges,
      scopeRootId: null,
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

export async function drawn(graph: ReturnType<typeof openGraph>) {
  await vi.waitFor(() => expect(graph.attributes('aria-busy')).toBeUndefined())
  await flushPromises()
  return graph
    .findAllComponents(GraphNodeCard)
    .map((card) => card.props('node').reference)
    .sort((left, right) => left.localeCompare(right))
}

export const chain = { members: [id(2), id(3), id(4)], reference: 'MAIN-1', total: 3 }

// The same chain grown from task 1, which holds no work: 2 (done) and 3 found on
// the way of 1, and 4 on the way of 2.
export const taskItems = items.map((entry) => {
  if (entry.reference === 'MAIN-1') return { ...entry, kind: 'task' }
  return entry.parent_id === id(1) ? { ...entry, parent_id: null } : entry
})
export const taskEdges: PlanningEdge[] = [
  { from: id(2), to: id(1), kind: 'discovered-from' },
  { from: id(3), to: id(1), kind: 'discovered-from' },
  { from: id(4), to: id(2), kind: 'discovered-from' },
]

/** The field scoped to the chain grown from task 1, which draws no frame. */
export function openTaskChain(props: Record<string, unknown> = {}) {
  return openGraph({
    scopeKind: 'chain',
    scopeRootId: id(1),
    chain,
    items: taskItems,
    edges: taskEdges,
    ...props,
  })
}

/** The lines Vue Flow is given, as source and target, in a stable order. */
export function flowLines(graph: ReturnType<typeof openGraph>) {
  const edges = graph.findComponent({ name: 'VueFlow' }).props('edges') as {
    source: string
    target: string
  }[]
  return edges
    .map((edge) => [edge.source, edge.target])
    .sort((left, right) => left.join(' ').localeCompare(right.join(' ')))
}
