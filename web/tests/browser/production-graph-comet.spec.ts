/**
 * The comet as the built app draws it, on lines of different lengths: one length and one
 * speed on all of them, whatever each line measures, entering at the line's start and
 * leaving into its arrow with nothing to jump over when the pass begins again.
 *
 * Served the broad synthetic space with every open item being worked on, so most lines
 * carry a comet.
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import type { LiveWork } from '@/shared/api/liveWorkModel.ts'

import { broadSpace } from '../fixtures/graphSpaces.ts'
import { installBackend } from './backend.ts'
import { graphRoute } from './chainFixtures.ts'
import { planningReadFor } from './planningReadFixture.ts'
import { test } from './test.ts'

/** The space with its open items being worked on, or as many as `working` that have lines. */
async function serveWorking(page: Page, working = Number.POSITIVE_INFINITY) {
  const { model } = broadSpace()
  const linked = new Set(model.links.flatMap((link) => [link.from, link.to]))
  const open = model.work_items
    .filter(
      (item) => !item.state.is_terminal && (working === Infinity || linked.has(item.work_item_id)),
    )
    .slice(0, working)
  const live: Record<string, LiveWork> = Object.fromEntries(
    open.map((item) => [item.work_item_id, { state: 'working' }]),
  )
  await installBackend(page)
  await page.route('**/api/planning?*', async (route) => {
    const response = planningReadFor(new URL(route.request().url()).searchParams)
    if (response.status === 200 && 'work_items' in response.body) {
      const body = response.body as unknown as Record<string, unknown>
      body.workflow = model.workflow
      body.work_items = model.work_items
      body.links = model.links
      body.live_work = live
    }
    await route.fulfill({
      status: response.status,
      contentType: 'application/json',
      body: JSON.stringify(response.body),
    })
  })
}

/** Each comet's line and what the browser computed for the comet on it. */
const comets = (page: Page) =>
  page.locator('.vue-flow__edge:has(.graph-comet)').evaluateAll((edges) =>
    edges.map((edge) => {
      const comet = edge.querySelector<SVGPathElement>('.graph-comet')
      const line = edge.querySelector<SVGPathElement>('.vue-flow__edge-path')
      if (!comet || !line) throw new Error('a line with a comet draws both')
      const style = getComputedStyle(comet)
      const [dash, gap] = style.strokeDasharray.split(',').map((value) => Number.parseFloat(value))
      return {
        length: line.getTotalLength(),
        dash,
        gap,
        seconds: Number.parseFloat(style.animationDuration),
        measuredOnItsOwnScale: comet.hasAttribute('pathLength'),
      }
    }),
  )

async function opened(page: Page) {
  await page.setViewportSize({ width: 1500, height: 900 })
  await page.goto(graphRoute({}))
  await expect(page.locator('.graph-canvas.settled')).toBeVisible()
  await expect(page.locator('.graph-comet').first()).toBeAttached()
}

test('a comet has one length and one speed on lines of different lengths', async ({ page }) => {
  await serveWorking(page)
  await opened(page)
  const runs = await comets(page)
  const lengths = runs.map((run) => run.length)
  expect(Math.max(...lengths)).toBeGreaterThan(2 * Math.min(...lengths))
  expect(runs.filter((run) => run.measuredOnItsOwnScale)).toEqual([])
  expect(new Set(runs.map((run) => run.dash)).size).toBe(1)
  const speeds = runs.map((run) => (run.dash + run.gap) / run.seconds)
  expect(Math.max(...speeds) - Math.min(...speeds)).toBeLessThan(1)
})

/** The camera's zoom, and how wide the browser draws a comet's stroke on screen. */
const onScreen = (page: Page) =>
  page.evaluate(() => {
    const view = document.querySelector<HTMLElement>('.vue-flow__transformationpane')
    const zoom = Number(/scale\(([\d.]+)\)/u.exec(view?.style.transform ?? '')?.[1])
    const comet = document.querySelector('.graph-comet')
    if (!comet) throw new Error('a comet is drawn')
    return { zoom, width: Number.parseFloat(getComputedStyle(comet).strokeWidth) * zoom }
  })

test('zoomed out, a comet shrinks along its line with the field and stays visible', async ({
  page,
}) => {
  await serveWorking(page)
  await opened(page)
  const [before] = await comets(page)
  const near = await onScreen(page)
  expect(near.width / near.zoom).toBeCloseTo(2.4, 1)
  await page.mouse.move(750, 500)
  await page.keyboard.down('Control')
  for (let step = 0; step < 12; step += 1) await page.mouse.wheel(0, 240)
  await page.keyboard.up('Control')
  await expect
    .poll(async () => {
      const { zoom } = await onScreen(page)
      return zoom
    })
    .toBeLessThan(near.zoom / 4)
  const [after] = await comets(page)
  expect(after.dash).toBe(before.dash)
  expect(after.seconds).toBe(before.seconds)
  const far = await onScreen(page)
  expect(far.width).toBeCloseTo(1.5, 1)
})

test('a card with work on it pulses and its lines run; one with no lines pulses alone', async ({
  page,
}) => {
  await serveWorking(page)
  await opened(page)
  const cards = page.locator('.flow-node-card').filter({
    has: page.locator('.graph-live[data-live="working"]'),
  })
  await expect(cards.first()).toContainText('working')
  const dots = await cards
    .first()
    .locator('.work-dots i')
    .first()
    .evaluate((dot) => dot.getAnimations().length)
  expect(dots).toBeGreaterThan(0)
  const kinds = await page
    .locator('.vue-flow__edge:has(.graph-comet)')
    .evaluateAll((edges) => edges.map((edge) => edge.classList.contains('blocks')))
  expect(new Set(kinds)).toEqual(new Set([true, false]))
})

test('a comet enters at the start, leaves into the arrow, and begins again unseen', async ({
  page,
}) => {
  await serveWorking(page)
  await opened(page)
  const ends = await page.locator('.vue-flow__edge:has(.graph-comet)').evaluateAll((edges) =>
    edges.map((edge) => {
      const comet = edge.querySelector<SVGPathElement>('.graph-comet')
      const line = edge.querySelector<SVGPathElement>('.vue-flow__edge-path')
      if (!comet || !line) throw new Error('a line with a comet draws both')
      const [animation] = comet.getAnimations()
      animation.pause()
      const offsetAt = (progress: number) => {
        animation.currentTime = progress * Number(animation.effect?.getTiming().duration)
        return Number.parseFloat(getComputedStyle(comet).strokeDashoffset)
      }
      const [dash, gap] = getComputedStyle(comet)
        .strokeDasharray.split(',')
        .map((value) => Number.parseFloat(value))
      return {
        length: line.getTotalLength(),
        dash,
        gap,
        first: offsetAt(0),
        last: offsetAt(0.9999),
      }
    }),
  )
  expect(ends.length).toBeGreaterThan(1)
  for (const { length, dash, gap, first, last } of ends) {
    // With the pass begun, the comet's head stands at the line's start.
    expect(dash - first).toBeCloseTo(0, 1)
    // With it over, the comet's tail has reached the arrow, or the next comet's head has
    // come to where this one's stood: the last moment and the first draw the same.
    expect(first - last).toBeCloseTo(dash + gap, 0)
    expect(Math.min(length, gap)).toBeCloseTo(gap, 0)
  }
})

test('only a line with a comet is measured, and only until its path changes', async ({ page }) => {
  await page.addInitScript(() => {
    // oxlint-disable-next-line typescript/unbound-method -- called below on its own element
    const measure = SVGGeometryElement.prototype.getTotalLength
    const counted = window as unknown as { measured: number }
    counted.measured = 0
    SVGGeometryElement.prototype.getTotalLength = function count(this: SVGGeometryElement) {
      counted.measured += 1
      return measure.call(this)
    }
  })
  await serveWorking(page, 1)
  await opened(page)
  const measured = () => page.evaluate(() => (window as unknown as { measured: number }).measured)
  const settled = await measured()
  const drawn = await page.locator('.graph-comet').count()
  const lines = await page.locator('.vue-flow__edge').count()
  expect(drawn).toBeLessThan(lines)
  expect(settled).toBeGreaterThan(0)
  expect(settled).toBeLessThanOrEqual(2 * drawn)
  // A second of frames, with the comet running through them.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        let frames = 60
        const next = () => {
          frames -= 1
          if (frames > 0) requestAnimationFrame(next)
          else resolve()
        }
        requestAnimationFrame(next)
      }),
  )
  expect(await measured()).toBe(settled)
})

/** How far apart a line's comets stand: one to a line, and no further than eight seconds. */
const period = ({ dash, length }: { dash: number; length: number }) => Math.min(length + dash, 1280)

test('a comet takes the new length of a line the layout moves', async ({ page }) => {
  await serveWorking(page)
  await opened(page)
  const before = await comets(page)
  for (const run of before) expect(run.dash + run.gap).toBeCloseTo(period(run), 0)
  const lengths = (runs: typeof before) => runs.map((run) => Math.round(run.length)).join(' ')
  await page.locator('.graph-frame-fold').first().focus()
  await page.keyboard.press('Enter')
  await expect.poll(async () => lengths(await comets(page))).not.toBe(lengths(before))
  await expect
    .poll(async () => {
      const runs = await comets(page)
      return runs.filter((run) => Math.abs(run.dash + run.gap - period(run)) > 0.5).length
    })
    .toBe(0)
})
