/**
 * The pointer moving over the graph: from one card to its neighbour the light
 * passes straight across instead of the whole field coming back up in between,
 * a sweep on the way somewhere lights none of the cards it crosses, leaving for
 * empty ground restores the field soon, and the keyboard's focus lights at once
 * and comes back when the pointer leaves.
 *
 * Every frame is sampled in the page while the pointer moves, because the
 * defect lives between two events: polling after the move would see only where
 * it ended.
 *
 * The small chain's open lineages, by its links: MAIN-1006 with MAIN-1106, and
 * MAIN-1005 with MAIN-1105 and MAIN-1103; every other card stands alone.
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import {
  GRAPH_HOVER_HOLD_MS,
  GRAPH_HOVER_TAKE_MS,
} from '@/widgets/work-item-graph/composables/useGraphHover.ts'

import { installBackend } from './backend.ts'
import { graphRoute, serve, smallChain } from './chainFixtures.ts'
import { test } from './test.ts'

interface Frame {
  /** Cards and lines receded behind a lit lineage. */
  cards: number
  edges: number
  /** The references of the cards not receded. */
  lit: string[]
  /** Milliseconds since sampling began. */
  t: number
}

type Point = { x: number; y: number }

const card = (page: Page, reference: string) =>
  page.locator('.graph-flow .flow-node-card').filter({
    has: page.locator('.flow-node-id').getByText(reference, { exact: true }),
  })

async function centre(page: Page, reference: string): Promise<Point> {
  const box = await card(page, reference).boundingBox()
  if (!box) throw new Error(`${reference} is not drawn`)
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

/** The lit references, sorted. */
async function litNow(page: Page) {
  const lit = page.locator('.graph-flow .flow-node-card:not(.recessed) .flow-node-id')
  const references = await lit.allTextContents()
  return references.sort()
}

/** Start sampling every frame; `frames` stops it and returns what each frame drew. */
async function sample(page: Page) {
  await page.evaluate(() => {
    const frames: Frame[] = []
    const start = performance.now()
    const box = window as unknown as {
      hoverFrames: Frame[]
      hoverSampling: boolean
      hoverStart: number
    }
    box.hoverFrames = frames
    box.hoverSampling = true
    box.hoverStart = start
    const tick = () => {
      if (!box.hoverSampling) return
      frames.push({
        t: performance.now() - start,
        cards: document.querySelectorAll('.graph-flow .flow-node-card.recessed').length,
        edges: document.querySelectorAll('.graph-flow .vue-flow__edge.recessed').length,
        lit: [
          ...document.querySelectorAll('.graph-flow .flow-node-card:not(.recessed) .flow-node-id'),
        ].map((node) => node.textContent ?? ''),
      })
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })
  return {
    /** Milliseconds since sampling began, on the page's clock. */
    now: () =>
      page.evaluate(
        () => performance.now() - (window as unknown as { hoverStart: number }).hoverStart,
      ),
    frames: () =>
      page.evaluate(() => {
        const box = window as unknown as { hoverFrames: Frame[]; hoverSampling: boolean }
        box.hoverSampling = false
        return box.hoverFrames
      }),
  }
}

/**
 * Move the pointer in a straight line, `step` pixels at a time, waiting for the
 * page to draw a frame after each step or, `paced: false`, as fast as it goes.
 * Answers how long the move took.
 */
async function glide(page: Page, [from, to]: [Point, Point], step: number, paced = true) {
  const steps = Math.max(2, Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / step))
  const started = Date.now()
  for (let index = 1; index <= steps; index += 1) {
    const at = index / steps
    await page.mouse.move(from.x + (to.x - from.x) * at, from.y + (to.y - from.y) * at)
    if (paced) {
      await page.evaluate(() => new Promise((done) => requestAnimationFrame(done)))
    }
  }
  return Date.now() - started
}

async function openChain(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 })
  await installBackend(page)
  const { chain, items, edges } = smallChain()
  await serve(page, chain, items, edges)
  await page.goto(graphRoute({ chain: 'MAIN-264', chain_scope: 'chain' }))
  await expect(page.locator('.graph-canvas')).toHaveClass(/settled/u)
  // The pointer starts off the field: a card under it would light its lineage.
  await page.mouse.move(0, 0)
  await expect(page.locator('.graph-flow .flow-node-card.recessed')).toHaveCount(0)
}

/** Rest the pointer on a card until its lineage is lit. */
async function rest(page: Page, reference: string, lineage: string[]) {
  const { x, y } = await centre(page, reference)
  await page.mouse.move(x, y)
  await expect.poll(() => litNow(page)).toEqual(lineage)
}

test('from a card to its neighbour the light passes across without the field flashing up', async ({
  page,
}) => {
  await openChain(page)
  const from = await centre(page, 'MAIN-1006')
  const to = await centre(page, 'MAIN-1105')
  // The two stand one above the other, with ground between them to cross.
  expect(Math.abs(from.x - to.x)).toBeLessThan(2)
  const boxA = await card(page, 'MAIN-1006').boundingBox()
  const boxB = await card(page, 'MAIN-1105').boundingBox()
  expect((boxB?.y ?? 0) - ((boxA?.y ?? 0) + (boxA?.height ?? 0))).toBeGreaterThan(20)
  await rest(page, 'MAIN-1006', ['MAIN-1006', 'MAIN-1106'])

  const clock = await sample(page)
  // An unhurried move: ten pixels a frame, about 600px/s.
  await glide(page, [from, to], 10)
  await expect.poll(() => litNow(page)).toEqual(['MAIN-1005', 'MAIN-1103', 'MAIN-1105'])
  const frames = await clock.frames()
  expect(frames.length).toBeGreaterThan(10)
  // Every frame of the move has something receded: the field never came back up whole.
  const bright = frames.filter((frame) => frame.cards === 0 || frame.edges === 0)
  expect(bright, 'frames with nothing receded').toEqual([])
  // And no frame lit anything but one of the two lineages.
  const lineages = new Set(['MAIN-1006,MAIN-1106', 'MAIN-1005,MAIN-1103,MAIN-1105'])
  expect(frames.filter((frame) => !lineages.has([...frame.lit].sort().join(',')))).toEqual([])
})

test('a quick sweep across the field lights none of the cards it passes over', async ({ page }) => {
  await openChain(page)
  // One column: MAIN-1108 above MAIN-1106 above MAIN-1103.
  const top = await centre(page, 'MAIN-1108')
  const middle = await centre(page, 'MAIN-1106')
  const bottom = await centre(page, 'MAIN-1103')
  expect(Math.abs(top.x - bottom.x)).toBeLessThan(2)
  expect(top.y < middle.y && middle.y < bottom.y).toBe(true)
  await rest(page, 'MAIN-1108', ['MAIN-1108'])

  const clock = await sample(page)
  // Thirty pixels a step as fast as the pointer goes.
  const took = await glide(page, [top, bottom], 30, false)
  await expect.poll(() => litNow(page)).toEqual(['MAIN-1005', 'MAIN-1103', 'MAIN-1105'])
  const frames = await clock.frames()
  // The sweep was quick enough to be one: it crossed the middle card in less than a take.
  const middleBox = await card(page, 'MAIN-1106').boundingBox()
  const crossing = (took * (middleBox?.height ?? 0)) / (bottom.y - top.y)
  expect(crossing).toBeLessThan(GRAPH_HOVER_TAKE_MS)
  // MAIN-1006 is lit only by the middle card's lineage, and never was.
  expect(frames.filter((frame) => frame.lit.includes('MAIN-1006'))).toEqual([])
  expect(frames.filter((frame) => frame.cards === 0)).toEqual([])
})

test('leaving a card for empty ground brings the whole field back soon', async ({ page }) => {
  await openChain(page)
  const from = await centre(page, 'MAIN-1006')
  const flow = await page.locator('.graph-flow').boundingBox()
  const left = await card(page, 'MAIN-1106').boundingBox()
  // Ground left of the leftmost column, level with the card.
  const ground = { x: (left?.x ?? 0) - 60, y: from.y }
  expect(ground.x).toBeGreaterThan((flow?.x ?? 0) + 10)
  expect(
    await page.evaluate(
      ({ x, y }) => document.elementFromPoint(x, y)?.closest('.vue-flow__node') ?? null,
      ground,
    ),
  ).toBeNull()
  await rest(page, 'MAIN-1006', ['MAIN-1006', 'MAIN-1106'])

  const clock = await sample(page)
  await glide(page, [from, ground], 40, false)
  const arrived = await clock.now()
  await expect(page.locator('.graph-flow .flow-node-card.recessed')).toHaveCount(0)
  await expect(page.locator('.graph-flow .vue-flow__edge.recessed')).toHaveCount(0)
  const frames = await clock.frames()
  const restored = frames.find((frame) => frame.cards === 0 && frame.edges === 0)
  // Counted from the pointer reaching the ground, on the page's clock: the hold,
  // and a few frames for the event and the drawing.
  expect((restored?.t ?? Infinity) - arrived).toBeLessThan(GRAPH_HOVER_HOLD_MS + 100)
})

test('the keyboard lights its card at once and its light comes back when the pointer leaves', async ({
  page,
}) => {
  await openChain(page)
  // From the chip, Tab passes the closed switch and lands on the field's stop.
  await page.locator('.graph-chip').focus()
  await page.keyboard.press('Tab')
  await page.keyboard.press('Tab')
  await expect(card(page, 'MAIN-264')).toBeFocused()
  const nextFrame = () =>
    page.evaluate(
      () =>
        new Promise<string[]>((resolve) => {
          requestAnimationFrame(() =>
            resolve(
              [
                ...document.querySelectorAll(
                  '.graph-flow .flow-node-card:not(.recessed) .flow-node-id',
                ),
              ]
                .map((node) => node.textContent ?? '')
                .sort(),
            ),
          )
        }),
    )
  expect(await nextFrame()).toEqual(['MAIN-264'])
  // The arrows walk to the next card, and its lineage is lit on the next frame.
  await page.keyboard.press('ArrowDown')
  const walked = await page.evaluate(
    () => document.activeElement?.querySelector('.flow-node-id')?.textContent ?? '',
  )
  expect(walked).not.toBe('MAIN-264')
  const lit = await nextFrame()
  expect(lit).toContain(walked)
  expect(lit.length).toBeLessThan(10)

  // The pointer takes over while it rests on a card, and the keyboard's light
  // returns when it leaves, with no frame between of the whole field bright.
  await rest(page, 'MAIN-1006', ['MAIN-1006', 'MAIN-1106'])
  const clock = await sample(page)
  await page.mouse.move(0, 0)
  await expect.poll(() => litNow(page)).toEqual(lit)
  const frames = await clock.frames()
  expect(frames.filter((frame) => frame.cards === 0)).toEqual([])
})
