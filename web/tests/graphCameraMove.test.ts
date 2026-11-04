import assert from 'node:assert/strict'

import ELK from 'elkjs/lib/elk.bundled.js'
import { test } from 'vitest'

import { graphCameraMove, graphCameraView } from '@/widgets/work-item-graph/utils/graphCamera.ts'
import { NODE_HEIGHT, NODE_WIDTH } from '@/widgets/work-item-graph/utils/graphGeometry.ts'
import { layout } from '@/widgets/work-item-graph/utils/graphLayout.ts'

import { validateWorkItemRecord } from '@/shared/api/planningModel.ts'
import type { PlanningEdge } from '@/shared/api/planningModel.ts'

import { workItem } from './browser/planningFixtures.ts'

/**
 * Where the camera goes, by cause. The camera is the operator's: the field
 * places it when a scope opens, never on a refresh, and after a narrowing or a
 * resize only when nothing drawn is left in sight — across, at the same zoom.
 */
// A graph node is a brief, and a brief always carries its comment count.
const base = { ...validateWorkItemRecord(workItem), comment_count: 0 }
const engine = new ELK()
const dimensions = { width: 1200, height: 680 }

/**
 * These cases measure the camera over cards, so they lay the cards out flat, as
 * a chain is drawn; the whole space stands in frames, and the camera over
 * frames has cases of its own.
 */
const flat = (nodes: readonly { work_item_id: string }[]) => ({
  kind: 'chain' as const,
  epicId: null,
  members: nodes.map((node) => node.work_item_id),
})

function chain(count: number) {
  const nodes = Array.from({ length: count }, (_, index) => ({
    ...base,
    work_item_id: `work-${index + 1}`,
    reference: `TEST-${index + 1}`,
    number: index + 1,
    parent_id: null,
    container: false,
    ready: index === 0,
    state: { ...base.state, is_terminal: false },
  }))
  const edges: PlanningEdge[] = nodes.slice(1).map((node, index) => ({
    from: `work-${index + 1}`,
    to: node.work_item_id,
    kind: 'blocks',
  }))
  return layout({ nodes, edges }, engine, false, flat(nodes))
}

/** The screen point of a node's centre at a camera. */
function onScreen(node: { x: number; y: number }, camera: { x: number; y: number; zoom: number }) {
  return {
    x: (node.x + NODE_WIDTH / 2) * camera.zoom + camera.x,
    y: (node.y + NODE_HEIGHT / 2) * camera.zoom + camera.y,
  }
}

/** A camera the operator panned and zoomed to, standing on the first node. */
function standingOn(node: { x: number; y: number }, zoom = 0.6) {
  return {
    x: dimensions.width / 2 - (node.x + NODE_WIDTH / 2) * zoom,
    y: dimensions.height / 2 - (node.y + NODE_HEIGHT / 2) * zoom,
    zoom,
  }
}

test('a scope that opens is placed by the opening frame', async () => {
  const placed = await chain(3)
  const camera = { x: -5000, y: -5000, zoom: 0.3 }
  assert.deepEqual(
    graphCameraMove('open', placed, { camera, dimensions }),
    graphCameraView(placed, dimensions),
  )
})

test('a refresh leaves the camera where it is, even with nothing in sight', async () => {
  const placed = await chain(3)
  const away = { x: -50_000, y: -50_000, zoom: 0.4 }
  assert.equal(graphCameraMove('refresh', placed, { camera: away, dimensions }), null)
})

test('a narrowing or a resize leaves the camera alone while any drawn node is in sight', async () => {
  const placed = await chain(40)
  const [first] = placed.nodes
  assert.ok(first)
  const camera = standingOn(first)
  assert.equal(graphCameraMove('narrowed', placed, { camera, dimensions }), null)
  assert.equal(graphCameraMove('resized', placed, { camera, dimensions }), null)
})

test('a narrowing with nothing left in sight pans onto the drawing at the same zoom', async () => {
  const placed = await chain(3)
  const away = { x: -50_000, y: -50_000, zoom: 0.6 }
  const moved = graphCameraMove('narrowed', placed, { camera: away, dimensions })
  assert.ok(moved)
  assert.equal(moved.zoom, 0.6)
  // Three nodes fit at this zoom, so all of them are brought into sight, centred.
  for (const node of placed.nodes) {
    const point = onScreen(node, moved)
    assert.ok(point.x > 0 && point.x < dimensions.width, `${node.work_item_id} across`)
    assert.ok(point.y > 0 && point.y < dimensions.height, `${node.work_item_id} down`)
  }
})

test('a drawing too large for the zoom is panned onto its first node as it is read, not zoomed', async () => {
  const placed = await chain(120)
  const away = { x: 90_000, y: 90_000, zoom: 1 }
  const moved = graphCameraMove('resized', placed, { camera: away, dimensions })
  assert.ok(moved)
  assert.equal(moved.zoom, 1)
  const first = [...placed.nodes].sort((left, right) => left.y - right.y || left.x - right.x)[0]
  assert.ok(first)
  assert.deepEqual(onScreen(first, moved), { x: dimensions.width / 2, y: dimensions.height / 2 })
})

test('an empty drawing or a field with no size moves nothing', async () => {
  const placed = await chain(3)
  const camera = { x: 0, y: 0, zoom: 1 }
  assert.equal(graphCameraMove('open', { ...placed, nodes: [] }, { camera, dimensions }), null)
  assert.equal(
    graphCameraMove('narrowed', placed, { camera, dimensions: { width: 0, height: 0 } }),
    null,
  )
})
