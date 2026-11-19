import assert from 'node:assert/strict'

import ELK from 'elkjs/lib/elk.bundled.js'
import { test } from 'vitest'

import {
  graphCameraMove,
  graphCameraView,
  graphWholeView,
} from '@/widgets/work-item-graph/utils/graphCamera.ts'
import { NODE_HEIGHT, NODE_WIDTH } from '@/widgets/work-item-graph/utils/graphGeometry.ts'
import { GRAPH_ZOOM_MIN, layout } from '@/widgets/work-item-graph/utils/graphLayout.ts'
import { readingZoom } from '@/widgets/work-item-graph/utils/graphZoomFloor.ts'

import { validateWorkItemRecord } from '@/shared/api/planningModel.ts'
import type { PlanningEdge } from '@/shared/api/planningModel.ts'

import { workItem } from './browser/planningFixtures.ts'
import { stateOf } from './fixtures/workItem.ts'

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
  scopeRootId: null,
  members: nodes.map((node) => node.work_item_id),
})

function chain(count: number) {
  const nodes = Array.from({ length: count }, (_, index) => ({
    ...base,
    work_item_id: `work-${index + 1}`,
    reference: `TEST-${index + 1}`,
    number: index + 1,
    parent_id: null,
    open: true,
    container_state: null,
    acceptance: null,
    started_at: null,
    waits_for: [],
    workable: index === 0,
    withheld: index === 0 ? [] : base.withheld,
    state: { ...stateOf(base), is_terminal: false },
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
  const away = { x: -50_000, y: -50_000, zoom: 1.2 }
  const moved = graphCameraMove('narrowed', placed, { camera: away, dimensions })
  assert.ok(moved)
  assert.equal(moved.zoom, 1.2)
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

/** The zoom at which a drawing's extent fills the field, inside the air a framing leaves. */
function fillingZoom(
  placed: Awaited<ReturnType<typeof chain>>,
  field: { height: number; width: number },
) {
  const boxes = [...placed.frames, ...placed.nodes]
  const left = Math.min(...boxes.map((box) => box.x))
  const top = Math.min(...boxes.map((box) => box.y))
  const right = Math.max(...boxes.map((box) => box.x + box.width))
  const bottom = Math.max(...boxes.map((box) => box.y + box.height))
  return Math.min(1, (field.width - 64) / (right - left), (field.height - 32) / (bottom - top))
}

test('the whole view is worked out from the drawing and the field, and nothing else', async () => {
  const small = await chain(12)
  const large = await chain(60)
  for (const placed of [small, large]) {
    const whole = graphWholeView(placed, dimensions)
    assert.ok(whole)
    assert.ok(Math.abs(whole.zoom - fillingZoom(placed, dimensions)) < 1e-9)
  }
  const fieldOfSmall = graphWholeView(small, dimensions)?.zoom ?? 0
  const fieldOfLarge = graphWholeView(large, dimensions)?.zoom ?? 0
  assert.ok(fieldOfLarge < fieldOfSmall, 'a field that grew fits further out')
  const wider = { width: 2400, height: 1360 }
  assert.ok((graphWholeView(large, wider)?.zoom ?? 0) > fieldOfLarge, 'a larger window fits closer')
  assert.equal(graphWholeView(large, { width: 0, height: 0 }), null)
})

for (const cause of ['narrowed', 'resized'] as const)
  test(`a camera a ${cause} field leaves past its whole view comes back to it`, async () => {
    const placed = await chain(40)
    const whole = graphWholeView(placed, dimensions)
    assert.ok(whole)
    const past = { x: 40, y: 40, zoom: whole.zoom / 2 }
    assert.deepEqual(graphCameraMove(cause, placed, { camera: past, dimensions }), whole)
    // At the whole view's own zoom it is not past it, and stays where it stands.
    const at = { ...whole, x: whole.x + 8 }
    assert.equal(graphCameraMove(cause, placed, { camera: at, dimensions }), null)
  })

test('a refresh never moves the camera, even one left past the whole view', async () => {
  const placed = await chain(40)
  const whole = graphWholeView(placed, dimensions)
  assert.ok(whole)
  const past = { x: 40, y: 40, zoom: whole.zoom / 2 }
  assert.equal(graphCameraMove('refresh', placed, { camera: past, dimensions }), null)
})

/**
 * A phone-wide field goes no further out than its cards read. The floor is the reading floor
 * over a card's smallest text: text drawn at `size` stands at `size × zoom` on the screen.
 */
test('the floor is the zoom at which the smallest text stands at the reading floor', () => {
  for (const [size, floor] of [
    [13, 13],
    [14, 13],
    [12, 13],
  ] as const)
    assert.equal(size * readingZoom(size, floor), floor)
  assert.equal(readingZoom(0, 13), GRAPH_ZOOM_MIN, 'a size not read sets no floor')
  assert.equal(readingZoom(13, Number.NaN), GRAPH_ZOOM_MIN, 'a floor not read sets none')
})

const phone = { width: 300, height: 700, floor: 12 / 13 }

test('on a phone-wide field the whole view stops at the floor, from the drawing’s beginning', async () => {
  const placed = await chain(40)
  assert.ok(fillingZoom(placed, phone) < phone.floor, 'the drawing fits only further out')
  const whole = graphWholeView(placed, phone)
  assert.ok(whole)
  assert.equal(whole.zoom, phone.floor)
  // Its first node as it is read stands at the top-left, inside the air a framing leaves.
  const first = [...placed.nodes].sort((left, right) => left.y - right.y || left.x - right.x)[0]
  assert.ok(first)
  assert.equal(first.x * whole.zoom + whole.x, 32)
  assert.equal(first.y * whole.zoom + whole.y, 36)
  // A camera further out comes up to it, as one past any whole view does.
  const past = { x: 0, y: 0, zoom: 0.4 }
  assert.deepEqual(graphCameraMove('resized', placed, { camera: past, dimensions: phone }), whole)
  // The field opens no further out either, on its beginning and on a chosen card.
  assert.ok((graphCameraView(placed, phone)?.zoom ?? 0) >= phone.floor)
  const selectedId = placed.nodes[20]?.work_item_id
  assert.ok((graphCameraView(placed, phone, { selectedId })?.zoom ?? 0) >= phone.floor)
})

test('a drawing that fits at the floor, and any wide field, keep the whole fit', async () => {
  // One card and the air round it at the floor: 264 × 12/13 + 64 pixels.
  const room = { ...phone, width: 340 }
  const small = await chain(1)
  assert.ok(fillingZoom(small, room) >= room.floor, 'it fits at the floor')
  const wide = { width: room.width, height: room.height }
  assert.deepEqual(graphWholeView(small, room), graphWholeView(small, wide))
  const large = await chain(40)
  assert.ok(
    Math.abs((graphWholeView(large, dimensions)?.zoom ?? 0) - fillingZoom(large, dimensions)) <
      1e-9,
  )
})
