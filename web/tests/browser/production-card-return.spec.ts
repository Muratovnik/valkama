import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import { planningWorkItemEntity } from '@/shared/api/platformPlanningRefs.ts'
import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { branchedChain } from '../fixtures/chainMap.ts'
import { asRoot } from '../support/threads.ts'
import { installBackend } from './backend.ts'
import { largeChainHere, serve } from './chainFixtures.ts'
import { now, projectScope, workItem, workItemRef } from './planningFixtures.ts'
import { test } from './test.ts'

const CARD = serializePlatformRoute({
  module_id: 'planning',
  scope: projectScope,
  entity: planningWorkItemEntity(workItemRef),
})

async function pressWhereItStands(page: Page, target: Locator) {
  const box = await target.boundingBox()
  await page.mouse.move(
    (box?.x ?? 0) + (box?.width ?? 0) / 2,
    (box?.y ?? 0) + (box?.height ?? 0) / 2,
  )
  await page.mouse.down()
  await page.mouse.up()
}

const placeOf = (body: Locator) => body.evaluate((node) => node.scrollTop)

async function topOf(locator: Locator) {
  const box = await locator.boundingBox()
  return box?.y ?? 0
}

/** A card read far down its chain, left for a member of it: Back is what is tested. */
async function leftFromDepth(page: Page, comments?: unknown[]) {
  await page.setViewportSize({ width: 1440, height: 900 })
  await installBackend(page, { comments })
  await serve(page, largeChainHere())
  await page.goto(CARD)
  const drawer = page.locator('.drawer')
  const body = drawer.locator('.drawer-frame-body')
  const group = drawer.locator('section.chain-group[aria-label="Backlog"]')
  await expect(drawer).toHaveCSS('transform', 'none')
  await group.locator('.chain-more').click()
  const row = group.locator('.chain-row').nth(20)
  await row.evaluate((node) => node.scrollIntoView({ block: 'center' }))
  const reference = (await row.getAttribute('data-reference')) ?? ''
  const place = await placeOf(body)
  expect(place).toBeGreaterThan(300)
  await row.focus()
  await page.keyboard.press('Enter')
  const back = drawer.locator('.head-back')
  await expect(back).toBeVisible()
  await expect(drawer.locator('.chain-row')).toHaveCount(0)
  return { back, body, drawer, place, reference }
}

/** Hold the chain's next answers back by this long, or for good. */
const holdChain = (page: Page, delay: number | null) =>
  page.route('**/api/planning/work-item/chain?*', async (route) => {
    if (delay === null) return
    await new Promise((done) => setTimeout(done, delay))
    await route.fallback()
  })

/** What was painted of the scroller on each frame the parent card stood, from here on. */
const watchPaint = (page: Page) =>
  page.evaluateHandle(() => {
    const frames: {
      at: number
      guessed: boolean
      left: boolean
      shown: boolean
      top: number
    }[] = []
    const started = performance.now()
    let running = true
    const sample = () => {
      if (!running) return
      const body = document.querySelector('.drawer-frame-body')
      const tabs = document.querySelector('.drawer-frame-tabs')
      frames.push({
        at: performance.now() - started,
        guessed: document.querySelector('.branch-map-canvas.guessed') !== null,
        // The member's card still has its Back; the parent the walk began from has none.
        left: document.querySelector('.head-back') !== null,
        shown: tabs?.checkVisibility({ opacityProperty: true }) === true,
        top: body?.scrollTop ?? 0,
      })
      requestAnimationFrame(sample)
    }
    requestAnimationFrame(sample)
    return {
      stop: () => {
        running = false
        return frames.filter(({ left }) => !left)
      },
    }
  })

test('Back on a slow chain read shows the card soon, and moves once to the place when it answers', async ({
  page,
}) => {
  const { back, body, drawer, place, reference } = await leftFromDepth(page)
  await holdChain(page, 1200)
  const paint = await watchPaint(page)
  await pressWhereItStands(page, back)
  const row = drawer.locator(`.chain-row[data-reference="${reference}"]`)
  await expect(row).toBeFocused()
  expect(Math.abs((await placeOf(body)) - place)).toBeLessThan(2)
  const frames = await paint.evaluate((running) => running.stop())

  const painted = frames.filter(({ shown }) => shown)
  // Blank for about as long as a normal read takes, long before the chain has answered.
  expect(painted[0]?.at ?? Infinity).toBeLessThan(800)
  // As far as it could at first, then the place: one move, and none after.
  expect(new Set(painted.map(({ top }) => Math.round(top))).size).toBeLessThanOrEqual(2)
})

test('Back on a slow chain moves to the place though the browser has moved the card first', async ({
  page,
}) => {
  // A discussion stands below the chain, so the card shown early is tall enough to read in.
  // The chain then arrives above what is on screen and the browser keeps that in view: the
  // scroller moves with nobody at it, and it is no sign of a reader who has moved on.
  const discussion = Array.from({ length: 30 }, (_, index) => ({
    id: index + 1,
    kind: 'comment',
    ...asRoot,
    author: 'codex',
    at: now,
    body: `Remark ${index + 1}.`,
    report: null,
    checklist_item_id: null,
    checklist_item_text: null,
  }))
  const { back, body, drawer, place, reference } = await leftFromDepth(page, discussion)
  await holdChain(page, 1000)
  await pressWhereItStands(page, back)
  await expect(drawer.locator('.drawer-frame-tabs')).toBeVisible()
  await expect.poll(() => placeOf(body)).toBe(place)
  const row = drawer.locator(`.chain-row[data-reference="${reference}"]`)
  await expect(row).toBeFocused()
  expect(Math.abs((await placeOf(body)) - place)).toBeLessThan(2)
})

test('Back when the chain never answers shows the card for good, as far down as it can', async ({
  page,
}) => {
  const { back, body, drawer, place } = await leftFromDepth(page)
  await holdChain(page, null)
  await pressWhereItStands(page, back)
  const tabs = drawer.locator('.drawer-frame-tabs')
  await expect(tabs).toBeVisible()
  await expect
    .poll(() => tabs.evaluate((node) => node.checkVisibility({ opacityProperty: true })))
    .toBe(true)
  const room = await body.evaluate((node) => node.scrollHeight - node.clientHeight)
  await expect.poll(() => placeOf(body)).toBe(Math.min(place, room))
  await expect(drawer.locator('.overview')).toBeVisible()
  await expect(drawer.locator('.drawer-frame-close')).toBeEnabled()
})

test('a reader who has moved on before the chain answers is left where they are', async ({
  page,
}) => {
  const { back, body, drawer } = await leftFromDepth(page)
  await holdChain(page, 1500)
  await pressWhereItStands(page, back)
  const tabs = drawer.locator('.drawer-frame-tabs')
  await expect
    .poll(() => tabs.evaluate((node) => node.checkVisibility({ opacityProperty: true })))
    .toBe(true)
  const box = await body.boundingBox()
  await page.mouse.move((box?.x ?? 0) + 200, (box?.y ?? 0) + 200)
  const landed = await placeOf(body)
  await page.mouse.wheel(0, -40)
  await expect.poll(() => placeOf(body)).toBeLessThan(landed)
  const moved = await placeOf(body)
  // The chain has answered once its rows stand; nothing comes for the reader after that.
  await expect(drawer.locator('.chain-row').first()).toBeVisible({ timeout: 4000 })
  await drawer.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  )
  expect(await placeOf(body)).toBe(moved)
})

test('Back at normal speed lands once, exactly where the card was left', async ({ page }) => {
  await page.setViewportSize({ width: 1680, height: 1000 })
  await installBackend(page)
  await serve(
    page,
    branchedChain(
      { id: workItem.work_item_id, reference: workItemRef.reference, title: workItem.title },
      'MAIN',
    ),
  )
  await page.goto(CARD)
  const drawer = page.locator('.drawer')
  const body = drawer.locator('.drawer-frame-body')
  await expect(drawer.locator('.branch-map-canvas')).toBeVisible()
  await expect(drawer).toHaveCSS('transform', 'none')
  const first = drawer.locator('.chain-row').first()
  await first.evaluate((node) => node.scrollIntoView({ block: 'center' }))
  const reference = (await first.getAttribute('data-reference')) ?? ''
  const place = await placeOf(body)
  const rowAt = await topOf(first)
  expect(place).toBeGreaterThan(100)
  await first.focus()
  await page.keyboard.press('Enter')
  const back = drawer.locator('.head-back')
  await expect(back).toBeVisible()
  await expect(drawer.locator('.chain-row')).toHaveCount(0)

  const paint = await watchPaint(page)
  await pressWhereItStands(page, back)
  const row = drawer.locator(`.chain-row[data-reference="${reference}"]`)
  await expect(row).toBeFocused()
  await drawer.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  )
  const frames = await paint.evaluate((running) => running.stop())
  const tops = new Set(frames.filter(({ shown }) => shown).map(({ top }) => Math.round(top)))
  expect([...tops]).toEqual([Math.round(place)])
  // The map stood at its own width from its first frame: a first layout at a guessed width
  // has another height, and a place restored to that layout lands off by the difference.
  expect(frames.filter(({ guessed }) => guessed)).toHaveLength(0)
  expect(await topOf(row)).toBeCloseTo(rowAt, 0)
})
