import assert from 'node:assert/strict'

import { test } from 'vitest'

import {
  ISOLATED_ROWS,
  MARGIN,
  NODE_HEIGHT,
} from '@/widgets/work-item-graph/utils/graphGeometry.ts'
import {
  doneCount,
  edgeKey,
  flowEdge,
  frontier,
  GRAPH_EDGE_MARKER_SIZE,
  GRAPH_EDGE_TYPE,
  graphFitViewOptions,
  layout,
  neighborhood,
  workNodes,
} from '@/widgets/work-item-graph/utils/graphLayout.ts'
import type { GraphSource } from '@/widgets/work-item-graph/utils/graphLayout.ts'

import type { PlanningEdge, WorkItemBrief } from '@/shared/api/planningModel.ts'

/**
 * A stable identity per number, so the cases below can keep naming items 1, 2,
 * 3 while the layout keys on the identity the store actually hands out.
 */
function identity(id: number): string {
  return `00000000-0000-4000-8000-${String(id).padStart(12, '0')}`
}

const STATES = {
  todo: {
    state_id: identity(900),
    key: 'todo',
    name: 'Todo',
    category: 'queued',
    is_terminal: false,
  },
  done: {
    state_id: identity(901),
    key: 'done',
    name: 'Done',
    category: 'completed',
    is_terminal: true,
  },
} as const

function node(id: number, overrides: Partial<WorkItemBrief> = {}): WorkItemBrief {
  return {
    work_item_id: identity(id),
    planning_space_id: identity(800),
    reference: `TST-${id}`,
    // The number inside the space, which is what the layout breaks ties on.
    number: id,
    title: `item ${id}`,
    kind: 'task',
    state: STATES.todo,
    priority: 'medium',
    claim_ref: '',
    parent_id: null,
    container: false,
    depth: 0,
    ready: true,
    labels: [],
    source: '',
    checklist: [],
    revision: 0,
    created_at: '2026-08-21T12:00:00Z',
    updated_at: '2026-08-21T12:00:00Z',
    comment_count: 0,
    ...overrides,
  }
}

/** The number behind one identity, so an edge assertion can list 1, 2, 3. */
function numberFor(id: string): number {
  return Number(id.slice(-12))
}

/** The number a fixture item was built with, read back from its reference. */
function numberOf(item: { reference: string }): number {
  return Number(item.reference.split('-')[1])
}

/** An edge between two items named by number, as the cases below read best. */
function edge(from: number, to: number, kind: PlanningEdge['kind'] = 'blocks'): PlanningEdge {
  return { from: identity(from), to: identity(to), kind }
}

/** Nodes by id, failing by name when the layout left out one a test asks for. */
function placedById(placed: ReturnType<typeof layout>) {
  const nodes = new Map(placed.nodes.map((item) => [item.work_item_id, item]))
  return (id: number) => {
    const node = nodes.get(identity(id))
    assert.ok(node, `the layout placed no node ${id}`)
    return node
  }
}

test('graph nodes reserve three readable text rows without collisions', () => {
  assert.ok(NODE_HEIGHT >= 88)
})

test('blockers stand left of what they block and preserve dependency direction', () => {
  const payload: GraphSource = {
    nodes: [node(1), node(2, { ready: false }), node(3, { ready: false })],
    edges: [edge(1, 2, 'blocks'), edge(2, 3, 'blocks')],
  }
  const placed = layout(payload)
  const byId = placedById(placed)
  assert.equal(placed.ranks, 3)
  assert.ok(byId(1).x < byId(2).x)
  assert.ok(byId(2).x < byId(3).x)
  assert.deepEqual(
    placed.edges.map(({ from, to }) => [numberFor(from), numberFor(to)]),
    [
      [1, 2],
      [2, 3],
    ],
  )
})

test('discovered_from joins the ranking: a discovery may not stand left of its origin', () => {
  const payload: GraphSource = {
    nodes: [node(1), node(2)],
    edges: [edge(1, 2, 'discovered-from')],
  }
  const placed = layout(payload)
  const byId = placedById(placed)
  assert.ok(byId(1).x < byId(2).x, 'the weak edge still ranks its target right')
  assert.deepEqual(placed.edges[0], edge(1, 2, 'discovered-from'))
})

test('a cycle keeps both arrows pointed at their original targets', () => {
  const payload: GraphSource = {
    nodes: [node(1, { ready: false }), node(2, { ready: false })],
    edges: [edge(1, 2, 'blocks'), edge(2, 1, 'discovered-from')],
  }
  const placed = layout(payload)
  const byId = placedById(placed)
  assert.deepEqual(
    placed.edges.map(({ from, to }) => [numberFor(from), numberFor(to)]),
    [
      [1, 2],
      [2, 1],
    ],
  )
  assert.ok(byId(1).x < byId(2).x)
})

test('edges have no routed geometry or parallel-port contract', () => {
  const payload: GraphSource = {
    nodes: [node(1), node(2, { ready: false }), node(3, { ready: false })],
    edges: [edge(1, 2, 'blocks'), edge(2, 3, 'blocks'), edge(1, 3, 'blocks')],
  }
  const placed = layout(payload)
  for (const edge of placed.edges) {
    assert.deepEqual(Object.keys(edge).sort(), ['from', 'kind', 'to'])
    assert.equal('points' in edge, false)
    assert.equal('reversed' in edge, false)
    assert.equal('parallel' in edge, false)
  }
})

test('ordering pulls a chain onto one row instead of leaving it crossed', () => {
  const payload: GraphSource = {
    nodes: [node(1), node(2), node(21, { ready: false }), node(22, { ready: false })],
    edges: [edge(1, 22, 'blocks'), edge(2, 21, 'blocks')],
  }
  const placed = layout(payload)
  const byId = placedById(placed)
  assert.equal(byId(22).y, byId(1).y, 'a single successor aligns with its blocker')
  assert.equal(byId(21).y, byId(2).y)
  assert.deepEqual(
    placed.edges.map(({ from, to }) => [numberFor(from), numberFor(to)]),
    [
      [1, 22],
      [2, 21],
    ],
  )
})

test('independent chains stack vertically instead of tearing holes into each other', () => {
  const placed = layout({
    nodes: [node(1), node(2, { ready: false }), node(3), node(4, { ready: false })],
    edges: [edge(1, 2, 'blocks'), edge(3, 4, 'blocks')],
  })
  const byId = placedById(placed)
  assert.equal(byId(1).y, MARGIN, 'the first component opens at the margin')
  assert.equal(byId(3).x, byId(1).x, 'each component restarts at rank zero')
  assert.ok(byId(3).y >= byId(1).y + 56, 'the second component sits below the first')
  assert.ok(byId(3).y < byId(1).y + 3 * 72, 'stacked tightly, no drifting gap')
})

test('the wired block is pinned to the top margin, never adrift below the first screen', () => {
  // A wide fan-in drags every median downward; without the final
  // normalization the whole field starts below the fold.
  const sources = Array.from({ length: 5 }, (_, index) => node(index + 1))
  const sink = node(9, { ready: false })
  const placed = layout({
    nodes: [...sources, sink],
    edges: sources.map((source) => edge(Number(source.reference.split('-')[1]), 9, 'blocks')),
  })
  const top = Math.min(...placed.nodes.map((item) => item.y))
  assert.equal(top, MARGIN, 'the highest wired row sits exactly at the margin')
})

test('cards without visible dependencies are inventory below the chains, never fake ranks', () => {
  const many = Array.from({ length: ISOLATED_ROWS + 3 }, (_, index) => node(index + 10))
  const payload: GraphSource = {
    nodes: [node(1), node(2, { ready: false }), ...many],
    edges: [edge(1, 2, 'blocks')],
  }
  const placed = layout(payload)
  const byId = placedById(placed)
  assert.equal(placed.ranks, 2, 'only the wired pair forms ranks')
  assert.equal(placed.isolatedCount, many.length)
  assert.ok(placed.isolatedTop > byId(1).y, 'the grid starts below the chains')
  for (const item of many) {
    const grid = byId(numberOf(item))
    assert.equal(grid.isolated, true)
    assert.ok(grid.y >= placed.isolatedTop)
  }
  const columns = new Set(many.map((item) => byId(numberOf(item)).x))
  assert.equal(columns.size, 2, 'the grid wraps past ISOLATED_ROWS rows')
})

test('epics are grouping, not geometry: no epic nodes and no parent curves', () => {
  const payload: GraphSource = {
    nodes: [
      node(10, { container: true, ready: false }),
      node(1, { parent_id: identity(10) }),
      node(2, { parent_id: identity(10), ready: false }),
    ],
    edges: [edge(10, 1, 'parent'), edge(10, 2, 'parent'), edge(1, 2, 'blocks')],
  }
  const placed = layout(payload)
  assert.deepEqual(placed.nodes.map((item) => numberOf(item)).sort(), [1, 2])
  assert.deepEqual(
    placed.edges.map((item) => item.kind),
    ['blocks'],
  )
})

test('done cards are archaeology: hidden by default, restored on demand', () => {
  const payload: GraphSource = {
    nodes: [node(1, { state: STATES.done, ready: false }), node(2)],
    edges: [edge(1, 2, 'blocks')],
  }
  assert.equal(doneCount(payload), 1)
  assert.deepEqual(
    workNodes(payload, false).map((item) => numberOf(item)),
    [2],
  )

  const open = layout(payload)
  assert.deepEqual(
    open.nodes.map((item) => numberOf(item)),
    [2],
  )
  assert.equal(open.edges.length, 0, 'no wire may point at a hidden card')
  assert.equal(open.nodes[0].isolated, true, 'a card blocked only by finished work stands alone')

  const full = layout(payload, true)
  const byId = placedById(full)
  assert.ok(
    byId(1).x < byId(2).x,
    'with done shown, structure returns: the blocker is left of what it blocked',
  )
  assert.equal(full.edges.length, 1)
})

test('an edge to a card outside this board is dropped, not drawn into nothing', () => {
  const placed = layout({
    nodes: [node(1)],
    edges: [edge(1, 999, 'blocks')],
  })
  assert.equal(placed.edges.length, 0)
  assert.equal(placed.nodes.length, 1)
  assert.equal(placed.nodes[0].isolated, true)
})

test('the unlinked grid keeps siblings of one epic together', () => {
  const payload: GraphSource = {
    nodes: [
      node(1, { parent_id: identity(20) }),
      node(2, { parent_id: identity(30) }),
      node(3, { parent_id: identity(20) }),
      node(4),
    ],
    edges: [],
  }
  const placed = layout(payload)
  const order = [...placed.nodes].sort((a, b) => a.y - b.y).map((item) => numberOf(item))
  assert.deepEqual(order, [1, 3, 2, 4], 'epic 20 together, then epic 30, strays last')
})

test('layout is stable: shuffled input yields identical geometry', () => {
  const payload: GraphSource = {
    nodes: [node(9), node(2, { ready: false }), node(5)],
    edges: [edge(5, 2, 'blocks'), edge(9, 2, 'discovered-from')],
  }
  const first = layout(payload)
  const second = layout({ ...payload, nodes: [...payload.nodes].reverse() })
  assert.deepEqual(
    first.nodes.map((item) => [numberOf(item), item.x, item.y]),
    second.nodes.map((item) => [numberOf(item), item.x, item.y]),
    'a push must not shuffle the picture',
  )
})

test('the graph follows the epic rail: scope trims nodes, counts, and wires', () => {
  const payload: GraphSource = {
    nodes: [
      node(1, { parent_id: identity(20) }),
      node(2, { parent_id: identity(30), ready: false }),
      node(3),
      node(4, { parent_id: identity(20), state: STATES.done, ready: false }),
    ],
    edges: [edge(1, 2, 'blocks')],
  }
  const epic = layout(payload, false, { kind: 'epic', epicId: identity(20) })
  assert.deepEqual(
    epic.nodes.map((item) => numberOf(item)),
    [1],
  )
  assert.equal(epic.edges.length, 0, 'a wire may not point out of the scope')
  assert.equal(doneCount(payload, { kind: 'epic', epicId: identity(20) }), 1)
  const strays = layout(payload, false, { kind: 'none', epicId: null })
  assert.deepEqual(
    strays.nodes.map((item) => numberOf(item)),
    [3],
  )
})

test('parallel dependencies retain independent edge identity for straight rendering', () => {
  const payload: GraphSource = {
    nodes: [node(1), node(2, { ready: false })],
    edges: [edge(1, 2, 'blocks'), edge(1, 2, 'discovered-from')],
  }
  const placed = layout(payload)
  assert.equal(placed.edges.length, 2)
  assert.deepEqual(placed.edges, payload.edges)
})

test('flow edges use border handles, straight geometry, and closed markers', () => {
  const rendered = flowEdge(edge(12, 3, 'blocks'), { markerColor: '#b58b4a' })
  assert.equal(rendered.source, identity(12))
  assert.equal(rendered.target, identity(3))
  assert.equal(rendered.sourceHandle, 'source')
  assert.equal(rendered.targetHandle, 'target')
  assert.equal(rendered.type, GRAPH_EDGE_TYPE)
  assert.equal(rendered.sourcePosition, 'right')
  assert.equal(rendered.targetPosition, 'left')
  assert.deepEqual(rendered.markerEnd, {
    type: 'arrowclosed',
    width: GRAPH_EDGE_MARKER_SIZE,
    height: GRAPH_EDGE_MARKER_SIZE,
    color: '#b58b4a',
  })
})

test('fit options never impose a zoom floor that clips a wide graph', () => {
  const options = graphFitViewOptions()
  assert.equal('minZoom' in options, false)
  assert.equal(options.maxZoom, 1)
  const wide = layout({
    nodes: Array.from({ length: 20 }, (_, index) => node(index + 1, { ready: index === 0 })),
    edges: Array.from({ length: 19 }, (_, index) => edge(index + 1, index + 2, 'blocks')),
  })
  assert.ok(wide.width > 2000)
  assert.ok(wide.height > 0)
})

test('an empty board still yields a drawable canvas', () => {
  const placed = layout({ nodes: [], edges: [] })
  assert.equal(placed.nodes.length, 0)
  assert.ok(placed.width > 0 && placed.height > 0)
  assert.equal(placed.ranks, 0)
  assert.equal(placed.isolatedTop, -1)
})

test('the frontier is exactly what the server marked workable', () => {
  const payload: GraphSource = {
    nodes: [node(1), node(2, { ready: false, claim_ref: 'codex' }), node(3, { ready: false })],
    edges: [],
  }
  assert.deepEqual(
    frontier(payload).map((item) => numberOf(item)),
    [1],
  )
})

test('hover focus keeps a card and its complete transitive lineage', () => {
  const placed = layout({
    nodes: [node(1), node(2, { ready: false }), node(3, { ready: false }), node(4)],
    edges: [edge(1, 2, 'blocks'), edge(2, 3, 'blocks')],
  })
  const focus = neighborhood(placed.edges, identity(2))
  assert.deepEqual(
    [...focus.ids].map((id) => numberFor(id)).sort((left, right) => left - right),
    [1, 2, 3],
    'item 4 recedes',
  )
  assert.equal(focus.edges.size, 2)
  const outer = neighborhood(placed.edges, identity(4))
  assert.deepEqual(
    [...outer.ids].map((id) => numberFor(id)),
    [4],
    'an unconnected item lights only itself',
  )
  assert.equal(outer.edges.size, 0)
  assert.ok(focus.edges.has(edgeKey(edge(1, 2, 'blocks'))))
})

test('focus walks branches and cycles in both directions, leaving unrelated work dimmed', () => {
  const placed = layout({
    nodes: [
      node(1),
      node(2, { ready: false }),
      node(3, { ready: false }),
      node(4, { ready: false }),
      node(5, { ready: false }),
      node(6, { ready: false }),
      node(99),
    ],
    edges: [
      edge(1, 2, 'blocks'),
      edge(2, 3, 'blocks'),
      edge(2, 4, 'discovered-from'),
      edge(5, 2, 'blocks'),
      edge(4, 6, 'blocks'),
      edge(6, 4, 'discovered-from'),
    ],
  })
  const focus = neighborhood(placed.edges, identity(2))
  assert.deepEqual(
    [...focus.ids].map((id) => numberFor(id)).sort((left, right) => left - right),
    [1, 2, 3, 4, 5, 6],
  )
  assert.equal(focus.edges.size, 6, 'every edge in the induced branch/cycle lineage is lit')
  assert.ok(!focus.ids.has(identity(99)), 'an unrelated node stays dimmed')
  assert.ok(!focus.edges.has(edgeKey(edge(99, 2, 'blocks'))))
})
