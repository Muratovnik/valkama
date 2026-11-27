/**
 * The camera over a field of frames: it opens on the first header as the
 * field is read, and a frame folded or opened keeps its header where it stood
 * on the screen, at the same zoom.
 */
import assert from 'node:assert/strict'

import type { ElkNode } from 'elkjs/lib/elk-api'
import ELK from 'elkjs/lib/elk.bundled.js'
import { test } from 'vitest'

import {
  graphAnchor,
  graphCameraMove,
  graphCameraView,
  graphWholeView,
  headerOnScreen,
} from '@/widgets/work-item-graph/utils/graphCamera.ts'
import { layout } from '@/widgets/work-item-graph/utils/graphLayout.ts'
import type { GraphLayout, GraphLayoutEngine } from '@/widgets/work-item-graph/utils/graphLayout.ts'
import {
  foldTarget,
  frameTarget,
  readingOrder,
  walkTargets,
} from '@/widgets/work-item-graph/utils/graphWalk.ts'

import { broadSpace } from './fixtures/graphSpaces.ts'

const engine = new ELK()
const dimensions = { width: 1200, height: 680 }
const { model, goals } = broadSpace()
const source = { nodes: model.work_items, edges: model.links }
const space = (choices: Record<string, boolean> = {}) =>
  layout(source, engine, false, { kind: 'all', scopeRootId: null, frames: { choices } })

/**
 * The same space packed without the priority that puts open work first: its
 * small finished frames lead the field. A field begins that way still when the
 * first component holding open work begins with a finished frame linked to it,
 * which the camera and the keyboard must handle all the same.
 */
const unordered: GraphLayoutEngine = {
  layout: (graph: ElkNode) => {
    for (const component of graph.children ?? []) delete component.layoutOptions?.['elk.priority']
    return engine.layout(graph)
  },
}
const finishedFirst = () => layout(source, unordered, false, { kind: 'all', scopeRootId: null })

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
  assert.ok(Math.abs(first.y * camera.zoom + camera.y - 36) < 0.5)
  // In sight at the top-left, it is where the keyboard enters too.
  assert.equal(graphAnchor(placed, {}, { camera, dimensions })?.id, first.id)
})

test('the keyboard enters on a target wholly in sight before one the field’s edge cuts', () => {
  const box = { height: 100, width: 100, frameId: 'F' }
  const cut = { ...box, id: 'cut', x: 0, y: 0 }
  const clear = { ...box, id: 'clear', x: 200, y: 300 }
  const graph = {
    width: 400,
    height: 500,
    edges: [],
    frames: [],
    nodes: [cut, clear].map((target, number) => ({
      ...source.nodes[number],
      ...target,
      work_item_id: target.id,
    })),
  }
  // The first card's centre is in sight, its top is not.
  const camera = { x: 0, y: -40, zoom: 1 }
  const anchor = graphAnchor(graph, {}, { camera, dimensions: { width: 400, height: 500 } })
  assert.equal(anchor?.id, 'clear')
})

test('the keyboard enters where the camera looks: the first target in sight as the field is read', async () => {
  const placed = await finishedFirst()
  const phone = { width: 302, height: 640 }
  const view = graphCameraView(placed, phone)
  assert.ok(view)
  const [first] = walkTargets(placed).sort(readingOrder)
  // The camera stands just past the field's first target, so it is out of sight.
  const camera = { ...view, x: -(first.x + first.width) * view.zoom }
  const centre = (target: { height: number; width: number; x: number; y: number }) => ({
    x: (target.x + target.width / 2) * camera.zoom + camera.x,
    y: (target.y + target.height / 2) * camera.zoom + camera.y,
  })
  const shown = (target: Parameters<typeof centre>[0]) => {
    const { x, y } = centre(target)
    return x >= 0 && y >= 0 && x <= phone.width && y <= phone.height
  }
  assert.equal(shown(first), false)
  const anchor = graphAnchor(placed, {}, { camera, dimensions: phone })
  assert.ok(anchor)
  assert.ok(shown(anchor), anchor.id)
  assert.equal(
    anchor.id,
    walkTargets(placed)
      .sort(readingOrder)
      .find((target) => shown(target))?.id,
  )
  // With nothing in sight it falls back to the field's first target.
  const away = { x: 10_000, y: 10_000, zoom: camera.zoom }
  assert.equal(graphAnchor(placed, {}, { camera: away, dimensions: phone })?.id, first.id)
})

for (const field of [
  { width: 302, height: 640 },
  { width: 1175, height: 600 },
]) {
  test(`a field that begins with finished frames opens with open work in sight at ${field.width}px`, async () => {
    const placed = await finishedFirst()
    const cards = new Map(placed.nodes.map((node) => [node.work_item_id, node]))
    const frames = new Map(placed.frames.map((frame) => [frame.id, frame]))
    const holdsOpen = (id: string, frameId: string) => {
      const card = cards.get(id)
      const frame = frames.get(frameId)
      return card
        ? !card.state?.is_terminal
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

test('a field that begins with finished frames still opens on its beginning when open work is in sight there', async () => {
  const placed = await finishedFirst()
  const camera = graphCameraView(placed, dimensions)
  assert.ok(camera)
  // The finished frame the field begins with stands at the top-left, where it is read.
  const [first] = walkTargets(placed).sort(readingOrder)
  assert.ok(Math.abs(first.x * camera.zoom + camera.x - 32) < 0.5)
  assert.ok(Math.abs(first.y * camera.zoom + camera.y - 36) < 0.5)
})

for (const [what, fold] of [
  ['folding an open frame', true],
  ['opening a folded frame', false],
] as const) {
  test(`${what} keeps its header where it stood on the screen, at the same zoom`, async () => {
    // The lone link's goal starts open, the largest one folded.
    const frameId = fold ? goals[1].work_item_id : goals[0].work_item_id
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

/** The drawing's edges on the screen under a camera: its frames and cards, as they are drawn. */
function drawnOnScreen(graph: GraphLayout, camera: { x: number; y: number; zoom: number }) {
  const boxes = [...graph.frames, ...graph.nodes]
  const at = (value: number, offset: number) => value * camera.zoom + offset
  return {
    left: at(Math.min(...boxes.map((box) => box.x)), camera.x),
    top: at(Math.min(...boxes.map((box) => box.y)), camera.y),
    right: at(Math.max(...boxes.map((box) => box.x + box.width)), camera.x),
    bottom: at(Math.max(...boxes.map((box) => box.y + box.height)), camera.y),
  }
}

test('a fold that leaves the camera past the whole view comes up to it, the drawing whole in the field', async () => {
  const frameId = goals[1].work_item_id
  const before = await space()
  const after = await space({ [frameId]: true })
  const whole = graphWholeView(after, dimensions)
  assert.ok(whole)
  const camera = { x: 300, y: 200, zoom: whole.zoom / 2 }
  const screen = headerOnScreen(before, frameId, camera)
  assert.ok(screen)
  const moved = graphCameraMove('toggled', after, { camera, dimensions, held: { frameId, screen } })
  assert.ok(moved)
  assert.equal(moved.zoom, whole.zoom)
  // Held where it stood, the header would leave the drawing cut at the field's edge.
  const held = headerOnScreen(after, frameId, { ...camera, zoom: whole.zoom })
  assert.ok(held)
  const cut = drawnOnScreen(after, {
    x: camera.x + screen.x - held.x,
    y: camera.y + screen.y - held.y,
    zoom: whole.zoom,
  })
  assert.ok(
    cut.left < 0 || cut.top < 0 || cut.right > dimensions.width || cut.bottom > dimensions.height,
  )
  // The drawing fits at that zoom, so it stands whole in the field.
  const shown = drawnOnScreen(after, moved)
  assert.ok(shown.left >= 0 && shown.right <= dimensions.width, JSON.stringify(shown))
  assert.ok(shown.top >= 0 && shown.bottom <= dimensions.height, JSON.stringify(shown))
})

test('a fold past the whole view keeps its header where it stood when the drawing stands whole there', async () => {
  const frameId = goals[1].work_item_id
  const after = await space({ [frameId]: true })
  const whole = graphWholeView(after, dimensions)
  assert.ok(whole)
  // The header was pressed where the whole view draws it: held there, nothing is cut.
  const screen = headerOnScreen(after, frameId, whole)
  assert.ok(screen)
  const camera = { x: 300, y: 200, zoom: whole.zoom / 2 }
  const moved = graphCameraMove('toggled', after, { camera, dimensions, held: { frameId, screen } })
  assert.ok(moved)
  assert.equal(moved.zoom, whole.zoom)
  const now = headerOnScreen(after, frameId, moved)
  assert.ok(now)
  assert.ok(Math.abs(now.x - screen.x) <= 1 && Math.abs(now.y - screen.y) <= 1)
})

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
  const open = placed.frames.find((entry) => !entry.folded && entry.goal)
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

test('zoomed out to the overview, the keyboard enters on a target the overview draws, never a hidden fold', async () => {
  const placed = await space()
  const camera = { x: 32, y: 16, zoom: 0.3 }
  const anchor = graphAnchor(placed, {}, { camera, dimensions, overview: true })
  assert.ok(anchor)
  assert.doesNotMatch(anchor.id, /:fold$/u)
  assert.ok(walkTargets(placed, { overview: true }).some((target) => target.id === anchor.id))
  // At reading size the same camera enters on the field's first target, a fold.
  const reading = graphAnchor(
    placed,
    {},
    { camera: { ...camera, zoom: 0.75 }, dimensions, overview: false },
  )
  assert.match(reading?.id ?? '', /:fold$/u)
})

test('a branch whose frame is folded over its work is framed and entered on that frame’s header', async () => {
  // The largest goal starts folded: none of its cards is drawn.
  const goalId = goals[0].work_item_id
  const placed = await space()
  const folded = placed.frames.find((frame) => frame.id === goalId)
  assert.ok(folded?.folded)
  assert.equal(placed.nodes.filter((node) => node.frameId === goalId).length, 0)
  const branch = { headId: goalId, ids: new Set<string>(), frameId: goalId }
  assert.equal(graphAnchor(placed, { branch })?.id, frameTarget(goalId))
  const camera = graphCameraView(placed, dimensions, { branch })
  assert.ok(camera)
  const screen = headerOnScreen(placed, goalId, camera)
  assert.ok(screen)
  assert.ok(screen.x >= 0 && screen.x < dimensions.width, JSON.stringify(screen))
  assert.ok(screen.y >= 0 && screen.y < dimensions.height, JSON.stringify(screen))
  // Without the frame the branch has nothing on the field to enter on.
  const bare = { headId: goalId, ids: new Set<string>() }
  assert.notEqual(graphAnchor(placed, { branch: bare })?.id, frameTarget(goalId))
})

test('a branch with a card drawn is entered on its card, and framed from its frame’s header', async () => {
  // The goal the lone link stands in starts open, its cards drawn.
  const goalId = goals[1].work_item_id
  const placed = await space()
  const [card] = placed.nodes.filter((node) => node.frameId === goalId).sort(readingOrder)
  assert.ok(card)
  const branch = { headId: goalId, ids: new Set([card.work_item_id]), frameId: goalId }
  assert.equal(graphAnchor(placed, { branch })?.id, card.work_item_id)
  const camera = graphCameraView(placed, dimensions, { branch })
  assert.ok(camera)
  // The frame begins at the field's start, its header at the top-left and as wide as it reads.
  const frame = placed.frames.find((each) => each.id === goalId)
  assert.ok(frame)
  const shown = {
    left: frame.x * camera.zoom + camera.x,
    top: frame.y * camera.zoom + camera.y,
    right: (frame.x + frame.width) * camera.zoom + camera.x,
  }
  assert.ok(shown.left >= 0 && shown.left < 64, JSON.stringify(shown))
  assert.ok(shown.top >= 0 && shown.top < 64, JSON.stringify(shown))
  assert.ok(shown.right <= dimensions.width, JSON.stringify(shown))
  assert.ok(camera.zoom >= 0.75, String(camera.zoom))
  // Control: a branch of the same card with no frame of its own is framed on the card.
  const loose = graphCameraView(placed, dimensions, {
    branch: { headId: null, ids: new Set([card.work_item_id]) },
  })
  assert.ok(loose)
  assert.notDeepEqual(loose, camera)
})
