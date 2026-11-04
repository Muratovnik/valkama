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
import { foldTarget } from '@/widgets/work-item-graph/utils/graphWalk.ts'

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
