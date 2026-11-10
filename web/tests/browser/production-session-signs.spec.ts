/**
 * A session's state as one sign on the board and the graph, measured in the built app: a tile
 * draws it after its executor's client glyph, at that glyph's size and on its middle, and a graph
 * node draws it before its word, one box for every state and on the word's middle; the graph's key
 * names each sign a node shows with the node's own glyph at the node's own size. The side panel
 * draws the same signs (`production-live-work-signs.spec.ts`).
 */
import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import {
  expectOnTheMiddle,
  MIDDLE_ROOM,
  openView,
  prepare,
  signBoxes,
  signOffsets,
  withExecutors,
} from './signMeasures.ts'
import { test } from './test.ts'

/** The tiles whose executor's session draws a sign: at work, held, waiting and asking. */
const executorTiles = (page: Page) =>
  page.locator('.work-item-tile').filter({
    has: page.locator('.tile-reference').getByText(/^MAIN-49[0125]$/u),
  })

/** The graph's nodes that draw live work, once the field has settled. */
async function liveNodes(page: Page) {
  await expect(page.locator('.graph-canvas.settled')).toBeVisible()
  const nodes = page.locator('.flow-node-card').filter({ has: page.locator('.graph-live') })
  await expect(nodes).toHaveCount(5)
  return nodes
}

/** Each sign in `scope` as a reader sees it: which it is, its strokes and the size it is drawn at. */
const drawnSigns = (scope: Locator, selector: string) =>
  scope.locator(selector).evaluateAll((signs) =>
    signs.map((sign) => ({
      sign: [...sign.classList].find((name) => name.startsWith('session-sign-')) ?? '',
      strokes: sign.innerHTML.replaceAll(/\sdata-v-[\da-f]+=""/gu, ''),
      size: [sign.getAttribute('width'), sign.getAttribute('height')],
    })),
  )

const EVERY_SIGN = [
  'session-sign-working',
  'session-sign-asks',
  'session-sign-waiting',
  'session-sign-held',
  'session-sign-quiet',
]

for (const width of [1280, 390]) {
  test(`a tile's session sign is its client glyph's size and stands on its middle, at ${width}px`, async ({
    page,
  }) => {
    await prepare(page, 'en', width)
    await openView(page, 'kanban', withExecutors)
    const executors = executorTiles(page)
    await expect(executors).toHaveCount(4)
    const boxes = await signBoxes(
      executors,
      '.tile-facts .facet-session',
      '.tile-facts [data-facet="holder"] .facet-glyph',
    )
    console.info(`tile sign boxes at ${width}px`, JSON.stringify(boxes))
    expect(boxes.map((box) => box.sign).toSorted()).toEqual(
      EVERY_SIGN.filter((sign) => sign !== 'session-sign-quiet').toSorted(),
    )
    for (const box of boxes) {
      // In the row's pixels, which a fractional width can put a hundredth off whole.
      for (const side of [box.width, box.height, ...(box.glyph ?? [])])
        expect(side, box.sign).toBeCloseTo(14, 1)
      expect(Math.abs(box.offFromGlyph ?? 99), box.sign).toBeLessThanOrEqual(MIDDLE_ROOM)
    }
  })

  test(`a graph node draws its session's sign in one box for every state, on its word's middle, at ${width}px`, async ({
    page,
  }) => {
    await prepare(page, 'en', width)
    await openView(page, 'graph', withExecutors)
    const nodes = await liveNodes(page)
    const boxes = await signBoxes(nodes, '.graph-live .session-sign', '.graph-live-word')
    console.info(`graph sign boxes at ${width}px`, JSON.stringify(boxes))
    expect(boxes.map((box) => box.sign).toSorted()).toEqual(EVERY_SIGN.toSorted())
    // Only the working sign turns; every other stands still.
    expect(boxes.filter((box) => box.turns).map((box) => box.sign)).toEqual([
      'session-sign-working',
    ])
    for (const box of boxes) {
      expect(box.width, box.sign).toBeCloseTo(14, 1)
      expect(box.height, box.sign).toBeCloseTo(14, 1)
    }
    const offsets = await signOffsets(nodes, [['.graph-live .session-sign', '.graph-live-word']])
    console.info(`graph sign middles at ${width}px`, JSON.stringify(offsets))
    expectOnTheMiddle(offsets, 5)
  })
}

test("the graph's key names each sign a node shows, with the node's own glyph at its size", async ({
  page,
}) => {
  await prepare(page, 'en', 1280)
  await openView(page, 'graph', withExecutors)
  const nodes = await liveNodes(page)
  const key = page.locator('.graph-legend-on-field')
  await expect(key).toBeVisible()
  const keyed = await drawnSigns(key, '.graph-legend-sign .session-sign')
  const onNodes = await drawnSigns(nodes, '.graph-live .session-sign')
  expect(keyed.map((sign) => sign.sign)).toEqual(EVERY_SIGN)
  for (const sign of keyed)
    expect(
      onNodes.find((node) => node.sign === sign.sign),
      sign.sign,
    ).toEqual(sign)
  const sizes = await key
    .locator('.graph-legend-sign .session-sign')
    .evaluateAll((signs) =>
      signs.map((sign) => [
        sign.getBoundingClientRect().width,
        sign.getBoundingClientRect().height,
      ]),
    )
  console.info('graph key sign boxes', JSON.stringify(sizes))
  for (const size of sizes) expect(size).toEqual([14, 14])
  await expect(key.locator('.graph-legend-sign')).toHaveText([
    'a session working on it',
    'asking a person in the middle of a turn',
    'waiting, its turn over',
    'held by a session, not worked on now',
    'silent for over a day',
  ])
})
