import assert from 'node:assert/strict'

import ELK from 'elkjs/lib/elk.bundled.js'
import { test } from 'vitest'

import {
  MARGIN,
  NO_EPIC_FRAME,
  NODE_HEIGHT,
  NODE_WIDTH,
} from '@/widgets/work-item-graph/utils/graphGeometry.ts'
import {
  layout as computeLayout,
  doneCount,
  flowEdge,
  frontier,
  GRAPH_EDGE_MARKER_SIZE,
  GRAPH_EDGE_TYPE,
  graphFitViewOptions,
  neighborhood,
  workNodes,
} from '@/widgets/work-item-graph/utils/graphLayout.ts'
import type { GraphLayout, GraphSource } from '@/widgets/work-item-graph/utils/graphLayout.ts'

import type { PlanningEdge, WorkItemBrief } from '@/shared/api/planningModel.ts'

const engine = new ELK()
const layout = (
  source: GraphSource,
  showDone = false,
  scope = { kind: 'all' as const, epicId: null } as Parameters<typeof computeLayout>[3],
) => computeLayout(source, engine, showDone, scope)
/** The work under none drawn open, however much of it there is. */
const UNFOLDED = {
  kind: 'all' as const,
  epicId: null,
  frames: { choices: { [NO_EPIC_FRAME]: false } },
}
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
    claim_state: null,
    parent_id: null,
    container: false,
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
function placedById(placed: GraphLayout) {
  const nodes = new Map(placed.nodes.map((item) => [item.work_item_id, item]))
  return (id: number) => {
    const node = nodes.get(identity(id))
    assert.ok(node, `the layout placed no node ${id}`)
    return node
  }
}

function crossesNode(
  a: { x: number; y: number },
  b: { x: number; y: number },
  node: { x: number; y: number },
) {
  const epsilon = 1e-6
  return Math.abs(a.x - b.x) < epsilon
    ? a.x > node.x + epsilon &&
        a.x < node.x + NODE_WIDTH - epsilon &&
        Math.max(a.y, b.y) > node.y + epsilon &&
        Math.min(a.y, b.y) < node.y + NODE_HEIGHT - epsilon
    : a.y > node.y + epsilon &&
        a.y < node.y + NODE_HEIGHT - epsilon &&
        Math.max(a.x, b.x) > node.x + epsilon &&
        Math.min(a.x, b.x) < node.x + NODE_WIDTH - epsilon
}

function assertClearGeometry(graph: GraphLayout) {
  for (const [index, node] of graph.nodes.entries()) {
    for (const other of graph.nodes.slice(index + 1)) {
      assert.ok(
        node.x + NODE_WIDTH <= other.x ||
          other.x + NODE_WIDTH <= node.x ||
          node.y + NODE_HEIGHT <= other.y ||
          other.y + NODE_HEIGHT <= node.y,
        `${node.reference} overlaps ${other.reference}`,
      )
    }
  }
  for (const edge of graph.edges) {
    assert.ok(edge.points.length >= 2)
    for (let index = 1; index < edge.points.length; index++) {
      const a = edge.points[index - 1]
      const b = edge.points[index]
      assert.ok(
        Math.abs(a.x - b.x) < 1e-6 || Math.abs(a.y - b.y) < 1e-6,
        `every segment is orthogonal: ${JSON.stringify([a, b])}`,
      )
      for (const node of graph.nodes) {
        if (node.work_item_id === edge.source || node.work_item_id === edge.target) continue
        assert.equal(crossesNode(a, b, node), false, `${edge.id} crosses ${node.reference}`)
      }
    }
  }
}

test('blockers and context preserve source/target direction with routed geometry', async () => {
  const placed = await layout({
    nodes: [node(1), node(2), node(3)],
    edges: [edge(1, 2), edge(2, 3, 'discovered-from')],
  })
  const byId = placedById(placed)
  assert.ok(byId(1).x < byId(2).x && byId(2).x < byId(3).x)
  assert.equal(new Set(placed.nodes.map((item) => item.x)).size, 3)
  assert.deepEqual(
    placed.edges.map(({ source, target }) => [numberFor(source), numberFor(target)]),
    [
      [1, 2],
      [2, 3],
    ],
  )
  assertClearGeometry(placed)
})

test('cycles, parallel context and long links route around unrelated cards', async () => {
  const nodes = Array.from({ length: 38 }, (_, index) =>
    node(index + 1, {
      title: 'A long title with multiple words and an_unbroken_identifier'.repeat(3),
    }),
  )
  const edges = [
    ...Array.from({ length: 16 }, (_, index) => edge(index + 1, index + 2)),
    edge(1, 9, 'discovered-from'),
    edge(2, 12),
    edge(9, 1),
    edge(1, 9),
    edge(20, 21),
    edge(22, 23),
    edge(23, 24),
    edge(24, 22, 'relates-to'),
  ]
  const chain = {
    kind: 'chain' as const,
    epicId: null,
    members: nodes.map((item) => item.work_item_id),
  }
  const placed = await layout({ nodes, edges }, false, chain)
  assert.equal(placed.nodes.length, 38)
  assert.equal(placed.edges.length, edges.length)
  assertClearGeometry(placed)
  const parallel = placed.edges.filter(
    (item) => item.source === identity(1) && item.target === identity(9),
  )
  assert.notDeepEqual(parallel[0].points, parallel[1].points)
  for (const edge of placed.edges) {
    const source = placed.nodes.find((node) => node.work_item_id === edge.source)
    const target = placed.nodes.find((node) => node.work_item_id === edge.target)
    assert.ok(source && target)
    assert.equal(edge.points[0].x, source.x + NODE_WIDTH)
    assert.equal(edge.points.at(-1)?.x, target.x)
  }
})

test('large disconnected work and context pack across both axes without dropping any of 1119 cards', async () => {
  const edges = Array.from({ length: 30 }, (_, index) => [
    edge(index * 3 + 1, index * 3 + 2),
    edge(index * 3 + 2, index * 3 + 3, 'discovered-from'),
  ]).flat()
  const placed = await layout(
    {
      nodes: Array.from({ length: 1119 }, (_, index) => node(index + 1)),
      edges,
    },
    false,
    UNFOLDED,
  )
  assert.equal(placed.nodes.length, 1119)
  const linked = new Set(placed.edges.flatMap((item) => [item.source, item.target]))
  assert.equal(placed.nodes.filter((item) => !linked.has(item.work_item_id)).length, 1029)
  assert.equal(placed.edges.length, 60)
  assert.ok(new Set(placed.nodes.map((node) => node.x)).size > 10)
  assert.ok(
    placed.width / placed.height > 0.8 && placed.width / placed.height < 3,
    `${placed.width}x${placed.height}`,
  )
  assertClearGeometry(placed)
}, 20_000)

test('small disconnected chains stay compact with consistent card geometry', async () => {
  const placed = await layout({
    nodes: [node(1), node(2), node(3), node(4)],
    edges: [edge(1, 2), edge(3, 4)],
  })
  assert.ok(placed.width < 4 * NODE_WIDTH + 200)
  assert.ok(placed.height < 4 * NODE_HEIGHT)
  assert.ok(NODE_HEIGHT >= 100)
  assertClearGeometry(placed)
})

test('a container is a frame round its work, and closed work returns only on demand', async () => {
  const payload = {
    nodes: [
      node(10, { container: true }),
      node(1, { parent_id: identity(10) }),
      node(2, { state: STATES.done }),
    ],
    edges: [edge(10, 1, 'parent'), edge(2, 1)],
  }
  assert.equal(doneCount(payload), 1)
  assert.deepEqual(
    workNodes(payload, false).map((item) => numberOf(item)),
    [1],
  )
  const open = await layout(payload)
  assert.deepEqual(
    open.nodes.map((item) => numberOf(item)),
    [1],
  )
  assert.deepEqual(
    open.frames.map((frame) => frame.id),
    [identity(10)],
  )
  assert.equal(open.nodes[0].frameId, identity(10))
  assert.equal(open.edges.length, 0)
  // In «All» the finished item's frame holds no open work, so it is folded and
  // the link from it lands on that frame.
  const full = await layout(payload, true)
  assert.deepEqual(
    full.frames.map((frame) => [frame.id, frame.folded]),
    [
      [identity(10), false],
      [NO_EPIC_FRAME, true],
    ],
  )
  assert.deepEqual(
    full.edges.map((item) => [item.source, item.target]),
    [[NO_EPIC_FRAME, identity(1)]],
  )
  assertClearGeometry(full)
})

test('scope trims cards, counts and edges exactly', async () => {
  const payload = {
    nodes: [
      node(1, { parent_id: identity(20) }),
      node(2, { parent_id: identity(30) }),
      node(3),
      node(4, { parent_id: identity(20), state: STATES.done }),
    ],
    edges: [edge(1, 2), edge(1, 999)],
  }
  const scope = { kind: 'epic' as const, epicId: identity(20) }
  const epic = await layout(payload, false, scope)
  assert.deepEqual(
    epic.nodes.map((item) => numberOf(item)),
    [1],
  )
  assert.equal(epic.edges.length, 0)
  assert.equal(doneCount(payload, scope), 1)
  const strays = await layout(payload, false, { kind: 'none', epicId: null })
  assert.deepEqual(
    strays.nodes.map((item) => numberOf(item)),
    [3],
  )
})

test('shuffled input yields identical geometry and routes', async () => {
  const source = {
    nodes: [node(9), node(2), node(5), node(10)],
    edges: [edge(5, 2), edge(9, 2, 'discovered-from')],
  }
  assert.deepEqual(
    await layout(source),
    await layout({ nodes: [...source.nodes].reverse(), edges: [...source.edges].reverse() }),
  )
})

test('flow descriptors retain exact ELK points and closed arrow markers', async () => {
  const placed = await layout({ nodes: [node(12), node(3)], edges: [edge(12, 3)] })
  const rendered = flowEdge(placed.edges[0], { markerColor: '#b58b4a' })
  assert.equal(rendered.source, identity(12))
  assert.equal(rendered.target, identity(3))
  assert.equal(rendered.type, GRAPH_EDGE_TYPE)
  assert.deepEqual(rendered.data.points, placed.edges[0].points)
  assert.deepEqual(rendered.markerEnd, {
    type: 'arrowclosed',
    width: GRAPH_EDGE_MARKER_SIZE,
    height: GRAPH_EDGE_MARKER_SIZE,
    color: '#b58b4a',
  })
  assert.equal(rendered.sourceHandle, 'source')
  assert.equal(rendered.targetHandle, 'target')
})

test('empty geometry is drawable and whole-graph fit has no clipping zoom floor', async () => {
  const placed = await layout({ nodes: [], edges: [] })
  assert.equal(placed.nodes.length, 0)
  assert.equal(placed.frames.length, 0)
  assert.equal(placed.width, MARGIN * 2)
  assert.equal(placed.height, MARGIN * 2)
  assert.equal('minZoom' in graphFitViewOptions(), false)
  assert.equal(graphFitViewOptions().maxZoom, 1)
})

test('frontier uses the server workable flag and focus retains transitive cycles and branches', async () => {
  const source = {
    nodes: [
      node(1),
      node(2, { ready: false, claim_ref: 'codex' }),
      node(3, { ready: false }),
      node(4),
    ],
    edges: [edge(1, 2), edge(2, 3), edge(3, 2, 'discovered-from')],
  }
  assert.deepEqual(
    frontier(source).map((item) => numberOf(item)),
    [1, 4],
  )
  const placed = await layout(source)
  const focus = neighborhood(placed.edges, identity(2))
  assert.deepEqual(
    [...focus.ids].map((id) => numberFor(id)).sort((a, b) => a - b),
    [1, 2, 3],
  )
  assert.equal(focus.edges.size, 3)
  assert.deepEqual([...neighborhood(placed.edges, identity(4)).ids], [identity(4)])
})
