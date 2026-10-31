import assert from 'node:assert/strict'

import type { ViewportTransform } from '@vue-flow/core'
import ELK from 'elkjs/lib/elk.bundled.js'
import { test } from 'vitest'

import { graphCameraView } from '@/widgets/work-item-graph/utils/graphCamera.ts'
import { NODE_HEIGHT, NODE_WIDTH } from '@/widgets/work-item-graph/utils/graphGeometry.ts'
import { layout } from '@/widgets/work-item-graph/utils/graphLayout.ts'

import { validateWorkItemRecord } from '@/shared/api/planningModel.ts'
import type { PlanningEdge } from '@/shared/api/planningModel.ts'

import { workItem } from './browser/planningFixtures.ts'

const base = validateWorkItemRecord(workItem)
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
) {
  const item = placed.nodes.find((node) => node.work_item_id === nodeId(number))
  assert.ok(item)
  assert.ok(item.x * camera.zoom + camera.x >= 0)
  assert.ok(item.y * camera.zoom + camera.y >= 0)
  assert.ok((item.x + NODE_WIDTH) * camera.zoom + camera.x <= SIZE.width)
  assert.ok((item.y + NODE_HEIGHT) * camera.zoom + camera.y <= SIZE.height)
}

test('a large graph starts with readable ready work and its direct dependency', async () => {
  const placed = await graph(214)
  const camera = graphCameraView(placed, SIZE, new Set([nodeId(1)]))
  assert.ok(camera)
  assert.ok(camera.zoom >= 0.75)
  inCamera(placed, 1, camera)
  inCamera(placed, 2, camera)
  assert.equal(placed.nodes.length, 214)
})
test('selected work and direct neighbours take precedence over the start of a long chain', async () => {
  const placed = await graph(214)
  const camera = graphCameraView(placed, SIZE, new Set([nodeId(1)]), { selectedId: nodeId(110) })
  assert.ok(camera)
  assert.ok(camera.zoom >= 0.75)
  for (const number of [109, 110, 111]) inCamera(placed, number, camera)
})
test('a crowded fanout keeps its selected anchor readable', async () => {
  const placed = await graph(214, true)
  const camera = graphCameraView(placed, SIZE, new Set(), { selectedId: nodeId(1) })
  assert.ok(camera)
  assert.equal(camera.zoom, 1)
  inCamera(placed, 1, camera)
})
test('small graphs fit naturally and missing selections use an existing root', async () => {
  const small = await graph(3)
  const camera = graphCameraView(small, SIZE, new Set())
  assert.ok(camera)
  for (const number of [1, 2, 3]) inCamera(small, number, camera)
  const large = await graph(214)
  const fallback = graphCameraView(large, SIZE, new Set(), { selectedId: 'missing' })
  assert.ok(fallback)
  inCamera(large, 1, fallback)
})
test('a chain starts on its root rather than on the first workable item', async () => {
  const placed = await graph(214)
  const camera = graphCameraView(placed, SIZE, new Set([nodeId(1)]), { rootId: nodeId(150) })
  assert.ok(camera)
  assert.ok(camera.zoom >= 0.75)
  inCamera(placed, 150, camera)
  // The open card still outranks the root, and «Focus work» still asks for work.
  const selected = graphCameraView(placed, SIZE, new Set([nodeId(1)]), {
    rootId: nodeId(150),
    selectedId: nodeId(60),
  })
  assert.ok(selected)
  inCamera(placed, 60, selected)
  const work = graphCameraView(placed, SIZE, new Set([nodeId(1)]), {
    rootId: nodeId(150),
    focusOnly: true,
  })
  assert.ok(work)
  inCamera(placed, 1, work)
})
