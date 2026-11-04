/**
 * The camera over a field of frames: it opens on the first header as the
 * field is read, and a frame folded or opened keeps its header where it stood
 * on the screen, at the same zoom.
 */
import assert from 'node:assert/strict'

import ELK from 'elkjs/lib/elk.bundled.js'
import { test } from 'vitest'

import {
  graphAnchor,
  graphCameraMove,
  graphCameraView,
  headerOnScreen,
} from '@/widgets/work-item-graph/utils/graphCamera.ts'
import { layout } from '@/widgets/work-item-graph/utils/graphLayout.ts'
import { foldTarget, readingOrder, walkTargets } from '@/widgets/work-item-graph/utils/graphWalk.ts'

import { broadSpace } from './fixtures/graphSpaces.ts'

const engine = new ELK()
const dimensions = { width: 1200, height: 680 }
const { model, epics } = broadSpace()
const source = { nodes: model.work_items, edges: model.links }
const space = (choices: Record<string, boolean> = {}) =>
  layout(source, engine, false, { kind: 'all', epicId: null, frames: { choices } })

test('a field of frames too large to read opens on its first header at the top-left', async () => {
  const placed = await space()
  const camera = graphCameraView(placed, dimensions)
  assert.ok(camera)
  assert.equal(camera.zoom, 0.75)
  const first = graphAnchor(placed)
  assert.ok(first)
  // The first target as the field is read is a header's fold, not a card.
  assert.equal(first.id, foldTarget(first.frameId))
  assert.ok(Math.abs(first.x * camera.zoom + camera.x - 32) < 0.5)
  assert.ok(Math.abs(first.y * camera.zoom + camera.y - 16) < 0.5)
})

for (const field of [
  { width: 302, height: 640 },
  { width: 1175, height: 600 },
]) {
  test(`a field that begins with finished frames opens with open work in sight at ${field.width}px`, async () => {
    const placed = await space()
    const cards = new Map(placed.nodes.map((node) => [node.work_item_id, node]))
    const frames = new Map(placed.frames.map((frame) => [frame.id, frame]))
    const holdsOpen = (id: string, frameId: string) => {
      const card = cards.get(id)
      const frame = frames.get(frameId)
      return card
        ? !card.state.is_terminal
        : Boolean(frame && frame.progress.total > frame.progress.done)
    }
    const targets = walkTargets(placed).sort(readingOrder)
    // The broad space's field begins with a frame holding nothing open.
    assert.equal(holdsOpen(targets[0].id, targets[0].frameId), false)
    const camera = graphCameraView(placed, field)
    assert.ok(camera)
    const inSight = targets.filter((target) => {
      const x = (target.x + target.width / 2) * camera.zoom + camera.x
      const y = (target.y + target.height / 2) * camera.zoom + camera.y
      return x >= 0 && y >= 0 && x <= field.width && y <= field.height
    })
    assert.ok(
      inSight.some((target) => holdsOpen(target.id, target.frameId)),
      JSON.stringify(inSight.map((target) => target.id)),
    )
  })
}

for (const [what, fold] of [
  ['folding an open frame', true],
  ['opening a folded frame', false],
] as const) {
  test(`${what} keeps its header where it stood on the screen, at the same zoom`, async () => {
    // The lone link's epic starts open, the largest one folded.
    const frameId = fold ? epics[1].work_item_id : epics[0].work_item_id
    const before = await space()
    const after = await space({ [frameId]: fold })
    assert.equal(after.frames.find((frame) => frame.id === frameId)?.folded, fold)
    const camera = { x: -2400, y: -900, zoom: 0.6 }
    const screen = headerOnScreen(before, frameId, camera)
    assert.ok(screen)
    const moved = graphCameraMove('toggled', after, {
      camera,
      dimensions,
      held: { frameId, screen },
    })
    assert.ok(moved)
    assert.equal(moved.zoom, camera.zoom)
    const now = headerOnScreen(after, frameId, moved)
    assert.ok(now)
    assert.ok(
      Math.abs(now.x - screen.x) <= 1 && Math.abs(now.y - screen.y) <= 1,
      JSON.stringify([screen, now]),
    )
  })
}

test('a fold the camera holds nothing for moves nothing', async () => {
  const placed = await space()
  const camera = { x: 0, y: 0, zoom: 1 }
  assert.equal(graphCameraMove('toggled', placed, { camera, dimensions, held: null }), null)
  const gone = { frameId: 'no-such-frame', screen: { x: 10, y: 10 } }
  assert.equal(graphCameraMove('toggled', placed, { camera, dimensions, held: gone }), null)
})

/** One open frame much larger than the field, its one card at its top-left. */
async function vastFrame() {
  const placed = await space()
  const open = placed.frames.find((entry) => !entry.folded && entry.epic)
  assert.ok(open)
  const card = placed.nodes.find((node) => node.frameId === open.id)
  assert.ok(card)
  return {
    ...placed,
    frames: [{ ...open, x: 0, y: 0, width: 4000, height: 4000 }],
    nodes: [{ ...card, x: 16, y: 56 }],
    edges: [],
  }
}

for (const [what, camera] of [
  // The frame's own centre is in sight, yet neither its header nor its card is.
  ['only a frame’s empty ground', { x: dimensions.width / 2 - 2000, y: -1660, zoom: 1 }],
  // The header's fold button stands at the field's right edge, the card past it.
  ['only a frame’s fold button', { x: dimensions.width - 40, y: 100, zoom: 1 }],
] as const) {
  test(`a resize that leaves ${what} in sight brings the drawing back`, async () => {
    const graph = await vastFrame()
    const moved = graphCameraMove('resized', graph, { camera, dimensions })
    assert.ok(moved, 'the camera stayed where nothing is seen')
    assert.equal(moved.zoom, camera.zoom)
    // The card the field starts with is now in sight.
    const [card] = graph.nodes
    const x = (card.x + card.width / 2) * moved.zoom + moved.x
    const y = (card.y + card.height / 2) * moved.zoom + moved.y
    assert.ok(x >= 0 && x <= dimensions.width && y >= 0 && y <= dimensions.height)
  })
}
