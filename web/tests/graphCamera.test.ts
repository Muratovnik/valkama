import assert from 'node:assert/strict'

import type { ViewportTransform } from '@vue-flow/core'
import ELK from 'elkjs/lib/elk.bundled.js'
import { test } from 'vitest'

import { graphAnchor, graphCameraView } from '@/widgets/work-item-graph/utils/graphCamera.ts'
import { NODE_HEIGHT, NODE_WIDTH } from '@/widgets/work-item-graph/utils/graphGeometry.ts'
import { layout } from '@/widgets/work-item-graph/utils/graphLayout.ts'

import { validateWorkItemRecord } from '@/shared/api/planningModel.ts'
import type { PlanningEdge } from '@/shared/api/planningModel.ts'

import { workItem } from './browser/planningFixtures.ts'

// A graph node is a brief, and a brief always carries its comment count.
const base = { ...validateWorkItemRecord(workItem), comment_count: 0 }
const engine = new ELK()
const SIZE = { width: 1200, height: 680 }
const nodeId = (number: number) => `work-${number}`
function graph(count: number, fanout = false) {
  const nodes = Array.from({ length: count }, (_, index) => ({
    ...base,
    work_item_id: nodeId(index + 1),
    reference: `TEST-${index + 1}`,
    number: index + 1,
    parent_id: null,
    container: false,
    ready: index === 0,
    state: { ...base.state, is_terminal: false },
  }))
  const edges: PlanningEdge[] = Array.from({ length: count - 1 }, (_, index) => ({
    from: nodeId(fanout ? 1 : index + 1),
    to: nodeId(index + 2),
    kind: 'blocks',
  }))
  return layout({ nodes, edges }, engine)
}
function inCamera(
  placed: Awaited<ReturnType<typeof graph>>,
  number: number,
  camera: ViewportTransform,
  size = SIZE,
) {
  const item = placed.nodes.find((node) => node.work_item_id === nodeId(number))
  assert.ok(item)
  assert.ok(item.x * camera.zoom + camera.x >= 0)
  assert.ok(item.y * camera.zoom + camera.y >= 0)
  assert.ok((item.x + NODE_WIDTH) * camera.zoom + camera.x <= size.width)
  assert.ok((item.y + NODE_HEIGHT) * camera.zoom + camera.y <= size.height)
}

/** Whether a framing keeps the drawing on the field: no edge left empty past it while it runs off the other. */
function onDrawing(
  placed: Awaited<ReturnType<typeof graph>>,
  camera: ViewportTransform,
  size = SIZE,
) {
  const xs = placed.nodes.map((node) => node.x)
  const ys = placed.nodes.map((node) => node.y)
  const axes = [
    {
      start: Math.min(...xs),
      end: Math.max(...xs) + NODE_WIDTH,
      at: camera.x,
      size: size.width,
      gap: 32,
    },
    {
      start: Math.min(...ys),
      end: Math.max(...ys) + NODE_HEIGHT,
      at: camera.y,
      size: size.height,
      gap: 16,
    },
  ]
  for (const axis of axes) {
    const first = axis.start * camera.zoom + axis.at
    const last = axis.end * camera.zoom + axis.at
    if (last - first <= axis.size - 2 * axis.gap)
      assert.ok(Math.abs(first - axis.gap) < 0.5, 'starts at the start')
    else assert.ok(first <= axis.gap + 0.5 && last >= axis.size - axis.gap - 0.5, 'fills the field')
  }
}

test('a large graph with nothing asked for opens on its first node at the top-left, at reading size', async () => {
  const placed = await graph(214)
  const camera = graphCameraView(placed, SIZE)
  assert.ok(camera)
  assert.equal(camera.zoom, 0.75)
  inCamera(placed, 1, camera)
  inCamera(placed, 2, camera)
  onDrawing(placed, camera)
  assert.equal(placed.nodes.length, 214)
})

test('a narrowed field of unlinked work opens on its first node, with no empty ground beside it', async () => {
  // Fifteen items with no link between them, as a queue and a search narrowed
  // the space to: the layout packs them into a grid.
  const nodes = Array.from({ length: 15 }, (_, index) => ({
    ...base,
    work_item_id: nodeId(index + 1),
    reference: `TEST-${index + 1}`,
    number: index + 1,
    parent_id: null,
    container: false,
    ready: true,
    state: { ...base.state, is_terminal: false },
  }))
  const placed = await layout({ nodes, edges: [] }, engine)
  // Where the grid reads whole, it is framed whole.
  const whole = graphCameraView(placed, SIZE)
  assert.ok(whole)
  for (const node of placed.nodes) inCamera(placed, node.number, whole)
  // In a field as short as a wide window's, it does not: it opens on its first
  // node at the top-left, at reading size, the drawing filling the field.
  const field = { width: 1100, height: 560 }
  const camera = graphCameraView(placed, field)
  assert.ok(camera)
  assert.equal(camera.zoom, 0.75)
  const first = [...placed.nodes].sort((left, right) => left.y - right.y || left.x - right.x)[0]
  assert.ok(Math.abs(first.x * camera.zoom + camera.x - 32) < 0.5)
  assert.ok(Math.abs(first.y * camera.zoom + camera.y - 16) < 0.5)
  onDrawing(placed, camera, field)
  assert.equal(graphAnchor(placed)?.work_item_id, first.work_item_id)
})

test("a framing on an anchor near the drawing's edge is moved onto the drawing, the anchor kept", async () => {
  const placed = await graph(214)
  // The second of a long row: centred, its framing would leave the field's
  // left empty while the row runs off the right.
  const camera = graphCameraView(placed, SIZE, { rootId: nodeId(2) })
  assert.ok(camera)
  inCamera(placed, 2, camera)
  onDrawing(placed, camera)
})
test('selected work and direct neighbours take precedence over the start of a long chain', async () => {
  const placed = await graph(214)
  const camera = graphCameraView(placed, SIZE, { selectedId: nodeId(110) })
  assert.ok(camera)
  assert.ok(camera.zoom >= 0.75)
  for (const number of [109, 110, 111]) inCamera(placed, number, camera)
})
test('a crowded fanout keeps its selected anchor readable', async () => {
  const placed = await graph(214, true)
  const camera = graphCameraView(placed, SIZE, { selectedId: nodeId(1) })
  assert.ok(camera)
  assert.equal(camera.zoom, 1)
  inCamera(placed, 1, camera)
})
test('small graphs fit naturally and missing selections use an existing root', async () => {
  const small = await graph(3)
  const camera = graphCameraView(small, SIZE)
  assert.ok(camera)
  for (const number of [1, 2, 3]) inCamera(small, number, camera)
  const large = await graph(214)
  const fallback = graphCameraView(large, SIZE, { selectedId: 'missing' })
  assert.ok(fallback)
  inCamera(large, 1, fallback)
})
test('a chain starts on its root rather than on the first workable item', async () => {
  const placed = await graph(214)
  const camera = graphCameraView(placed, SIZE, { rootId: nodeId(150) })
  assert.ok(camera)
  assert.ok(camera.zoom >= 0.75)
  inCamera(placed, 150, camera)
  // The open card still outranks the root.
  const selected = graphCameraView(placed, SIZE, {
    rootId: nodeId(150),
    selectedId: nodeId(60),
  })
  assert.ok(selected)
  inCamera(placed, 60, selected)
})
/** The first of `numbers` as the field is read: top to bottom, then left to right. */
function firstRead(placed: Awaited<ReturnType<typeof graph>>, numbers: number[]) {
  const ids = new Set(numbers.map((number) => nodeId(number)))
  return placed.nodes
    .filter((node) => ids.has(node.work_item_id))
    .sort((left, right) => left.y - right.y || left.x - right.x)[0]
}

test('a branch the card chose is framed whole when it reads, its epic lit but not framed', async () => {
  const placed = await graph(214)
  const work = [40, 41, 42]
  // The epic heading the branch, drawn far from its work.
  const branch = {
    headId: nodeId(200),
    ids: new Set([...work, 200].map((number) => nodeId(number))),
  }
  const camera = graphCameraView(placed, SIZE, {
    branch,
    rootId: nodeId(150),
    selectedId: nodeId(60),
  })
  assert.ok(camera)
  assert.ok(camera.zoom >= 0.75)
  // Every node of the branch's work, rather than the root or the open card with its links.
  for (const number of work) inCamera(placed, number, camera)
  // The keyboard enters on the branch's first work as the field is read.
  assert.equal(
    graphAnchor(placed, { branch, rootId: nodeId(150) })?.work_item_id,
    firstRead(placed, work).work_item_id,
  )
  // A branch with nothing drawn but its epic is framed on the epic.
  const alone = { headId: nodeId(200), ids: new Set([nodeId(200)]) }
  const epic = graphCameraView(placed, SIZE, { branch: alone })
  assert.ok(epic)
  inCamera(placed, 200, epic)
})

test('a branch too long to read at once opens on its beginning at reading size', async () => {
  const placed = await graph(214)
  const work = Array.from({ length: 120 }, (_, index) => index + 50)
  const branch = { headId: null, ids: new Set(work.map((number) => nodeId(number))) }
  const camera = graphCameraView(placed, SIZE, { branch })
  assert.ok(camera)
  assert.equal(camera.zoom, 0.75)
  const first = firstRead(placed, work)
  inCamera(placed, first.number, camera)
  assert.equal(graphAnchor(placed, { branch })?.work_item_id, first.work_item_id)
})
