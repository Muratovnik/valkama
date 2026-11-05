/**
 * Far out, the ground of an open frame is its epic's target. From a distance a header is a
 * few pixels and the frame round it is what the eye and the hand find, so a press there
 * opens the epic as the header's own button does; a drag from there still moves the field.
 * The cards stay on top, a frame inside a frame answers for itself, nothing new takes Tab,
 * and nearer in the ground is field again.
 *
 * Served the broad synthetic space, whose frame inside a frame is drawn by something real.
 */
import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import {
  broadModel,
  camera,
  fitWhole,
  openBroadField,
  settledCamera,
  settledZoom,
  zoomNow,
} from './graphFieldCamera.ts'
import { test } from './test.ts'

const referenceOf = (id: string) => {
  const found = broadModel.work_items.find((item) => item.work_item_id === id)
  if (!found) throw new Error(`the broad space holds no ${id}`)
  return found.reference
}

/** The reference of the card the address has open, if any. */
function openedReference(page: Page): string | null {
  const entity = new URL(page.url()).searchParams.get('entity')
  if (!entity) return null
  const route = JSON.parse(Buffer.from(entity, 'base64url').toString()) as {
    kind?: string
    resource_id?: string
  }
  return route.kind === 'work-item' && route.resource_id
    ? (JSON.parse(Buffer.from(route.resource_id, 'base64url').toString()) as { reference: string })
        .reference
    : null
}

/** A point of this frame where nothing but the frame itself takes the pointer, if one exists. */
function groundPoint(frame: Locator) {
  return frame.evaluate((element) => {
    const box = element.getBoundingClientRect()
    const flow = document.querySelector('.graph-flow')?.getBoundingClientRect() as DOMRect
    for (let y = Math.max(box.top, flow.top) + 1; y < Math.min(box.bottom, flow.bottom); y += 1)
      for (let x = Math.max(box.left, flow.left) + 1; x < Math.min(box.right, flow.right); x += 1)
        if (document.elementFromPoint(x, y) === element) return { x, y }
    return null
  })
}

/**
 * Where a finger aims at this frame's ground: the point of it standing clearest of the cards
 * and the frame's edge, and how far the nearest card is from it.
 */
function clearGround(frame: Locator) {
  return frame.evaluate((element) => {
    const box = element.getBoundingClientRect()
    const flow = document.querySelector('.graph-flow')?.getBoundingClientRect() as DOMRect
    const cards = [...document.querySelectorAll('.flow-node-card')].map((card) =>
      card.getBoundingClientRect(),
    )
    const cardFrom = (x: number, y: number) =>
      Math.min(
        ...cards.map((card) =>
          Math.hypot(
            Math.max(card.left - x, 0, x - card.right),
            Math.max(card.top - y, 0, y - card.bottom),
          ),
        ),
      )
    let best: { card: number; clear: number; x: number; y: number } | null = null
    for (let y = Math.max(box.top, flow.top) + 1; y < Math.min(box.bottom, flow.bottom); y += 1)
      for (let x = Math.max(box.left, flow.left) + 1; x < Math.min(box.right, flow.right); x += 1) {
        if (document.elementFromPoint(x, y) !== element) continue
        const card = cardFrom(x, y)
        const clear = Math.min(card, x - box.left, box.right - x, y - box.top, box.bottom - y)
        if (!best || clear > best.clear) best = { card, clear, x, y }
      }
    return best
  })
}

/** Far out on the whole field, with the frame inside a frame open round its work. */
async function farField(page: Page, width = 1500) {
  await openBroadField(page, width)
  await fitWhole(page)
  await expect(page.locator('.graph-frame.far').first()).toBeVisible()
  expect(await settledZoom(page)).toBeLessThan(0.25)
}

/**
 * Nearer in with the wheel over this frame, which stays under it, until the camera stands at
 * `zoom`. At the whole field a frame's air can be under a pixel, too thin to press by test.
 */
async function nearerOn(page: Page, frame: Locator, zoom: number) {
  for (let turn = 0; turn < 30 && (await zoomNow(page)) < zoom; turn += 1) {
    const box = await frame.boundingBox()
    if (!box) throw new Error('the frame is not drawn')
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    const was = await zoomNow(page)
    await page.mouse.wheel(0, -60)
    await expect.poll(() => zoomNow(page)).toBeGreaterThan(was)
  }
  await settledCamera(page)
}

const openGround = (page: Page) => page.locator('.graph-frame.far:not(.folded):not(.nested)')

/** An open frame with an epic whose ground stands in sight, and where. */
async function groundInSight(frames: Locator) {
  for (const candidate of await frames.all()) {
    if ((await candidate.locator('button.graph-frame-open').count()) === 0) continue
    const id = (await candidate.getAttribute('data-frame')) ?? ''
    const frame = candidate.page().locator(`.graph-frame[data-frame="${id}"]`)
    const point = await groundPoint(frame)
    if (point) return { frame, id, point }
  }
  throw new Error('no open frame shows its ground')
}

test('a press on an open frame’s ground far out opens its epic', async ({ page }) => {
  await farField(page)
  const { frame, id, point } = await groundInSight(openGround(page))
  await page.mouse.move(point.x, point.y)
  expect(await frame.evaluate((element) => getComputedStyle(element).cursor)).toBe('pointer')
  await page.mouse.down()
  await page.mouse.up()
  await expect.poll(() => openedReference(page)).toBe(referenceOf(id))
})

test('a press on a frame inside a frame opens that frame’s epic, and its parent’s ground its parent’s', async ({
  page,
}) => {
  await farField(page)
  const inner = page.locator('.graph-frame.far.nested:not(.folded)').first()
  await nearerOn(page, inner, 0.15)
  expect(await zoomNow(page)).toBeLessThan(0.25)
  const nested = await groundInSight(page.locator('.graph-frame.far.nested:not(.folded)'))
  const parentId = await nested.frame.evaluate((element) => {
    const inner = element.getBoundingClientRect()
    const held = [...document.querySelectorAll<HTMLElement>('.graph-frame:not(.nested)')].find(
      (other) => {
        const outer = other.getBoundingClientRect()
        return (
          outer.left <= inner.left &&
          outer.top <= inner.top &&
          outer.right >= inner.right &&
          outer.bottom >= inner.bottom
        )
      },
    )
    return held?.dataset.frame ?? ''
  })
  expect(parentId).not.toBe('')
  expect(parentId).not.toBe(nested.id)
  expect(
    await page.evaluate(({ x, y }) => {
      const hit = document.elementFromPoint(x, y)
      return hit instanceof HTMLElement ? hit.dataset.frame : null
    }, nested.point),
  ).toBe(nested.id)
  await page.mouse.click(nested.point.x, nested.point.y)
  await expect.poll(() => openedReference(page)).toBe(referenceOf(nested.id))

  await page.goBack()
  await expect.poll(() => openedReference(page)).toBe(null)
  await settledCamera(page)
  const parent = page.locator(`.graph-frame[data-frame="${parentId}"]`)
  // The card is still on its way out over the field for a moment.
  await expect.poll(() => groundPoint(parent)).not.toBeNull()
  const point = await groundPoint(parent)
  await page.mouse.click(point?.x ?? 0, point?.y ?? 0)
  await expect.poll(() => openedReference(page)).toBe(referenceOf(parentId))
})

test('a card on the ground is pressed as before', async ({ page }) => {
  await farField(page)
  const { frame } = await groundInSight(openGround(page))
  const box = await frame.boundingBox()
  const spot = await page.evaluate((frameBox) => {
    if (!frameBox) return null
    const cards = [...document.querySelectorAll<HTMLElement>('.flow-node-card')]
    for (const card of cards) {
      const drawn = card.getBoundingClientRect()
      const x = drawn.left + drawn.width / 2
      const y = drawn.top + drawn.height / 2
      if (x < frameBox.x || x > frameBox.x + frameBox.width) continue
      if (y < frameBox.y || y > frameBox.y + frameBox.height) continue
      if (document.elementFromPoint(x, y)?.closest('.flow-node-card') !== card) continue
      return { x, y, id: card.dataset.walkTarget ?? '' }
    }
    return null
  }, box)
  expect(spot).not.toBeNull()
  await page.mouse.click(spot?.x ?? 0, spot?.y ?? 0)
  await expect.poll(() => openedReference(page)).toBe(referenceOf(spot?.id ?? ''))
})

test('a press that slips a pixel or two is still a press', async ({ page }) => {
  await farField(page)
  const { id, point } = await groundInSight(openGround(page))
  await page.mouse.move(point.x, point.y)
  await page.mouse.down()
  await page.mouse.move(point.x + 2, point.y + 1)
  await page.mouse.up()
  await expect.poll(() => openedReference(page)).toBe(referenceOf(id))
})

test('a drag from the ground moves the field and opens nothing', async ({ page }) => {
  await farField(page)
  const { frame, point } = await groundInSight(openGround(page))
  const before = await camera(page)
  await page.mouse.move(point.x, point.y)
  await page.mouse.down()
  await page.mouse.move(point.x + 30, point.y + 24, { steps: 6 })
  // The hand is dragging now, and the pointer says so over the frame it left from too.
  expect(await frame.evaluate((element) => getComputedStyle(element).cursor)).toBe('grabbing')
  await page.mouse.up()
  const after = await settledCamera(page)
  expect(Math.abs(after.x - before.x - 30)).toBeLessThanOrEqual(1)
  expect(Math.abs(after.y - before.y - 24)).toBeLessThanOrEqual(1)
  await settledCamera(page)
  expect(openedReference(page)).toBeNull()
})

test('the work under no epic has nothing to open, and its ground stays field', async ({ page }) => {
  await openBroadField(page, 1500)
  await fitWhole(page)
  await expect(page.locator('.graph-frame.far').first()).toBeVisible()
  const none = page.locator('.graph-frame[data-frame="none"]')
  await expect(none).not.toHaveClass(/ground-opens/u)
  expect(await none.evaluate((element) => getComputedStyle(element).cursor)).toBe('grab')
})

test('nearer in the ground is field again: the pointer grabs, and a press opens nothing', async ({
  page,
}) => {
  await farField(page)
  const { frame } = await groundInSight(openGround(page))
  await nearerOn(page, frame, 0.25)
  await expect(frame).not.toHaveClass(/far/u)
  expect(await frame.evaluate((element) => getComputedStyle(element).cursor)).toBe('grab')
  const point = await groundPoint(frame)
  expect(point).not.toBeNull()
  await page.mouse.click(point?.x ?? 0, point?.y ?? 0)
  await settledCamera(page)
  expect(openedReference(page)).toBeNull()
})

test('the keyboard’s stops are the same: the ground takes no Tab and no walk', async ({ page }) => {
  await farField(page)
  const ground = page.locator('.graph-frame.far:not(.folded)').first()
  await expect(ground).not.toHaveAttribute('tabindex')
  await expect(ground).not.toHaveAttribute('data-walk-target')
  await expect(ground).not.toHaveAttribute('role')
  const first = page.locator('[data-walk-target][tabindex="0"]').first()
  await first.focus()
  for (let step = 0; step < 6; step += 1) {
    await page.keyboard.press('ArrowDown')
    const stop = await page.evaluate(() =>
      document.activeElement instanceof HTMLElement
        ? (document.activeElement.dataset.walkTarget ?? null)
        : null,
    )
    expect(stop).not.toBeNull()
  }
})

/**
 * A fingertip's radius: a touch about 32 pixels across. The browser moves a tap to the target it
 * judges the finger meant within its reach, and a far-out frame's cards stand closer than that.
 */
const FINGER = 16

/** A tap of a fingertip's size, which `page.touchscreen` cannot give. */
async function fingerTap(page: Page, point: { x: number; y: number }) {
  const session = await page.context().newCDPSession(page)
  const touch = { x: point.x, y: point.y, radiusX: FINGER, radiusY: FINGER, force: 1 }
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [touch] })
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await session.detach()
}

test.describe('under a finger', () => {
  test.use({ hasTouch: true })

  test('a tap on the ground opens the epic at a phone’s width, with a card in the finger’s reach', async ({
    page,
  }) => {
    await farField(page, 390)
    const { frame, id } = await groundInSight(openGround(page))
    const point = await clearGround(frame)
    expect(point).not.toBeNull()
    // Far out the cards stand a few pixels apart, so the finger covers one wherever it lands.
    expect(point?.card).toBeLessThan(FINGER)
    await fingerTap(page, { x: point?.x ?? 0, y: point?.y ?? 0 })
    await expect.poll(() => openedReference(page)).toBe(referenceOf(id))
  })

  test('a tap centred on a card on the ground opens that card', async ({ page }) => {
    await farField(page, 390)
    const { frame } = await groundInSight(openGround(page))
    const spot = await frame.evaluate((element) => {
      const box = element.getBoundingClientRect()
      for (const card of document.querySelectorAll<HTMLElement>('.flow-node-card')) {
        const drawn = card.getBoundingClientRect()
        const x = drawn.left + drawn.width / 2
        const y = drawn.top + drawn.height / 2
        if (x < box.left || x > box.right || y < box.top || y > box.bottom) continue
        if (document.elementFromPoint(x, y)?.closest('.flow-node-card') !== card) continue
        return { x, y, id: card.dataset.walkTarget ?? '' }
      }
      return null
    })
    expect(spot).not.toBeNull()
    await fingerTap(page, { x: spot?.x ?? 0, y: spot?.y ?? 0 })
    await expect.poll(() => openedReference(page)).toBe(referenceOf(spot?.id ?? ''))
  })
})
