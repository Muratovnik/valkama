import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import { planningWorkItemEntity } from '@/shared/api/platformPlanningRefs.ts'
import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { installBackend } from './backend.ts'
import { blockedWorkItem, projectScope, workItem, workItemRef } from './planningFixtures.ts'
import { test } from './test.ts'

const CARD = serializePlatformRoute({
  module_id: 'planning',
  scope: projectScope,
  entity: planningWorkItemEntity(workItemRef),
})
const OTHER_CARD = serializePlatformRoute({
  module_id: 'planning',
  scope: projectScope,
  entity: planningWorkItemEntity({ ...workItemRef, reference: blockedWorkItem.reference }),
})
const BOARD = serializePlatformRoute({ module_id: 'planning', scope: projectScope })

/** Paragraphs enough to scroll the facts out of the card. */
const LONG_READ = Array.from({ length: 40 }, (_, index) => `Paragraph ${index + 1}.`).join(
  String.fromCodePoint(10, 10),
)

const reader = (drawer: Locator) => drawer.locator('.drawer-frame-body')
const ringedControls = (page: Page) => page.locator('.drawer :is(button, a[href]):focus-visible')
const ringed = (control: Locator) => control.evaluate((node) => node.matches(':focus-visible'))

/** A page that hears routes from outside as the desktop app hands them over, from no input. */
async function canBeHandedRoutes(page: Page) {
  await page.addInitScript(() => {
    const heard: ((route: string) => void)[] = []
    Object.assign(window, {
      handOver: (route: string) => {
        for (const listener of heard) listener(route)
      },
      valkamaDesktop: { onOpenRoute: (listener: (route: string) => void) => heard.push(listener) },
    })
  })
}

const handOver = (page: Page, route: string) =>
  page.evaluate((to) => (window as unknown as { handOver(to: string): void }).handOver(to), route)

async function cardBeingRead(page: Page) {
  const drawer = page.locator('.drawer')
  await expect(drawer.locator('.card-facts')).toBeVisible()
  await expect(drawer).toHaveCSS('transform', 'none')
  return drawer
}

for (const width of [1440, 390]) {
  test(`a card opened by its address rings nothing, and Tab starts at its first control, at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 })
    await installBackend(page)
    await page.goto(CARD)
    const drawer = await cardBeingRead(page)

    // Nobody pressed anything yet, so nothing answers a press: focus is on what the card
    // is read with, inside a dialog a screen reader names, and no control wears a ring.
    await expect(reader(drawer)).toBeFocused()
    await expect(drawer).toHaveRole('dialog')
    await expect(drawer).toHaveAccessibleName(workItem.title)
    await expect(reader(drawer)).toHaveCSS('outline-style', 'none')
    await expect(ringedControls(page)).toHaveCount(0)

    const close = drawer.locator('.drawer-frame-close')
    await page.keyboard.press('Tab')
    await expect(close).toBeFocused()
    expect(await ringed(close)).toBe(true)
  })
}

test('Shift+Tab from a card opened by its address stays in it, at its last control', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await installBackend(page)
  await page.goto(CARD)
  const drawer = await cardBeingRead(page)
  await expect(reader(drawer)).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  const inside = await page.evaluate(() => {
    const focused = document.activeElement
    return focused?.closest('.drawer') !== null && !focused?.matches('.drawer, .drawer-frame-body')
  })
  expect(inside).toBe(true)
})

test('Escape closes a card opened by its address', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await installBackend(page)
  await page.goto(CARD)
  const drawer = await cardBeingRead(page)
  await expect(reader(drawer)).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(drawer).toHaveCount(0)
})

test('a card opened from the keyboard shows where focus is', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await installBackend(page)
  await page.goto(BOARD)
  const opener = page.locator('.work-item-column[data-state="dev"] .tile-open').first()
  await opener.focus()
  await page.keyboard.press('Enter')
  const drawer = await cardBeingRead(page)
  const close = drawer.locator('.drawer-frame-close')
  await expect(close).toBeFocused()
  expect(await ringed(close)).toBe(true)
})

test('a card opened with the pointer has focus on its first control and no ring', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await installBackend(page)
  await page.goto(BOARD)
  await page.locator('.work-item-column[data-state="dev"] .tile-open').first().click()
  const drawer = await cardBeingRead(page)
  const close = drawer.locator('.drawer-frame-close')
  await expect(close).toBeFocused()
  expect(await ringed(close)).toBe(false)
})

test('a reload forgets the input before it: the card it opens rings nothing', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await installBackend(page)
  await page.goto(CARD)
  const before = await cardBeingRead(page)
  await page.keyboard.press('Tab')
  await expect(before.locator('.drawer-frame-close')).toBeFocused()
  await page.reload()
  const drawer = await cardBeingRead(page)
  await expect(reader(drawer)).toBeFocused()
  await expect(ringedControls(page)).toHaveCount(0)
})

test('a route handed over to a card nobody has touched moves focus nowhere and rings nothing', async ({
  page,
}) => {
  await canBeHandedRoutes(page)
  await page.setViewportSize({ width: 1440, height: 900 })
  await installBackend(page)
  await page.goto(CARD)
  const drawer = await cardBeingRead(page)
  await expect(reader(drawer)).toBeFocused()
  await handOver(page, OTHER_CARD)
  await expect(drawer.locator('.head-reference')).toHaveText(blockedWorkItem.reference)
  await expect(reader(drawer)).toBeFocused()
  await expect(ringedControls(page)).toHaveCount(0)
  await page.keyboard.press('Tab')
  await expect(drawer.locator('.drawer-frame-close')).toBeFocused()
})

test('a route handed over to a card read from the keyboard shows where focus went', async ({
  page,
}) => {
  await canBeHandedRoutes(page)
  await page.setViewportSize({ width: 1440, height: 900 })
  await installBackend(page)
  await page.goto(CARD)
  const drawer = await cardBeingRead(page)
  await page.keyboard.press('Tab')
  await expect(drawer.locator('.drawer-frame-close')).toBeFocused()
  await handOver(page, OTHER_CARD)
  await expect(drawer.locator('.head-reference')).toHaveText(blockedWorkItem.reference)
  const close = drawer.locator('.drawer-frame-close')
  await expect(close).toBeFocused()
  expect(await ringed(close)).toBe(true)
})

/**
 * A card whose holder is whatever the last write left. Each write stays out until the test
 * lets it answer, so that what is looked at while it is out is looked at then. On a timer
 * it answered first on a slow machine, and the press meant to land during it landed on the
 * action the answer brought instead. `claims` hears them as they are sent.
 */
async function cardWithHeldClaims(page: Page, holder: string) {
  await page.setViewportSize({ width: 1440, height: 844 })
  await installBackend(page, { longRead: true })
  const held = { by: holder }
  const claims: unknown[] = []
  const record = () => ({
    ...workItem,
    claim: null,
    claim_ref: held.by,
    description: LONG_READ,
    links: [],
  })
  await page.route('**/api/modules/planning/work-item?*', (route) =>
    route.fulfill({
      json: {
        interface_version: 'valkama-planning-work-item',
        scope: projectScope,
        work_item_ref: workItemRef,
        state: {
          interface_version: 'valkama-ui-state',
          status: 'ready',
          payload: { work_item: record() },
        },
      },
    }),
  )
  const out: (() => void)[] = []
  await page.route('**/api/planning/work-item/claim', async (route) => {
    const body = route.request().postDataJSON() as { release?: boolean }
    claims.push(body)
    await new Promise<void>((done) => out.push(done))
    held.by = body.release === true ? '' : 'user'
    await route.fulfill({ json: record() })
  })
  /** Lets the one write that is out answer. */
  const answer = async () => {
    await expect.poll(() => out.length).toBe(1)
    out.shift()?.()
  }
  await page.goto(CARD)
  return { answer, claims, drawer: await cardBeingRead(page) }
}

/** Whether focus was in the card on each frame `act` took. */
async function framesOfFocus(page: Page, act: () => Promise<unknown>) {
  const sampler = await page.evaluateHandle(() => {
    const frames: boolean[] = []
    let running = true
    const sample = () => {
      if (!running) return
      frames.push(document.activeElement?.closest('.drawer') !== null)
      requestAnimationFrame(sample)
    }
    requestAnimationFrame(sample)
    return {
      stop: () => {
        running = false
        return frames
      },
    }
  })
  await act()
  return sampler.evaluate((running) => running.stop())
}

for (const where of ['.card-action', '.drawer-frame-action']) {
  test(`a takeover confirmed from ${where} keeps focus in the card, through the write and after`, async ({
    page,
  }) => {
    const { answer, claims, drawer } = await cardWithHeldClaims(page, 'codex')
    const body = drawer.locator('.drawer-frame-body')
    await body.evaluate(
      (node, far) => node.scrollTo({ top: far }),
      where === '.card-action' ? 0 : 900,
    )
    const action = drawer.locator(where).getByRole('button')
    await expect(action).toBeVisible()
    await action.click()
    const strip = drawer.locator('.confirm-strip')
    await expect(strip.locator('.confirm-cancel')).toBeFocused()

    // Cancelled, focus goes back to what asked.
    await strip.locator('.confirm-cancel').click()
    await expect(action).toBeFocused()

    await action.click()
    const frames = await framesOfFocus(page, async () => {
      await strip.locator('.confirm-go').click()
      await expect(strip).toHaveCount(0)
      await expect(action).toBeFocused()
      await expect(action).toHaveAttribute('aria-disabled', 'true')
      // A press during the write is not another write and not another question.
      await page.keyboard.press('Enter')
      await expect(strip).toHaveCount(0)
      await answer()
      await expect(action).toHaveText('Release')
    })
    expect(frames.filter((inCard) => !inCard)).toEqual([])
    await expect(action).toBeFocused()
    await expect(action).not.toHaveAttribute('aria-disabled')
    expect(claims).toHaveLength(1)
  })
}

test('taking and releasing keep focus on the action, whatever it comes to offer', async ({
  page,
}) => {
  const { answer, claims, drawer } = await cardWithHeldClaims(page, '')
  const action = drawer.locator('.card-action').getByRole('button')
  await expect(action).toHaveText('Claim')
  await action.focus()
  const frames = await framesOfFocus(page, async () => {
    await page.keyboard.press('Enter')
    await expect(action).toHaveAttribute('aria-disabled', 'true')
    await answer()
    await expect(action).toHaveText('Release')
    await expect(action).not.toHaveAttribute('aria-disabled')
    await page.keyboard.press('Enter')
    await expect(action).toHaveAttribute('aria-disabled', 'true')
    await answer()
    await expect(action).toHaveText('Claim')
  })
  expect(frames.filter((inCard) => !inCard)).toEqual([])
  await expect(action).toBeFocused()
  expect(claims).toHaveLength(2)
})

const placeOf = (body: Locator) => body.evaluate((node) => node.scrollTop)
const bottomOf = (body: Locator) => body.evaluate((node) => node.scrollHeight - node.clientHeight)

/** Every key that reads, one after another, each moving the scroller the way it says. */
async function readWithTheKeys(page: Page, body: Locator) {
  await page.keyboard.press('PageDown')
  await expect.poll(() => placeOf(body)).toBeGreaterThan(100)
  await page.keyboard.press('End')
  const bottom = await bottomOf(body)
  await expect.poll(() => placeOf(body)).toBeGreaterThanOrEqual(bottom - 1)
  await page.keyboard.press('PageUp')
  await expect.poll(() => placeOf(body)).toBeLessThan(bottom - 100)
  await page.keyboard.press('Home')
  await expect.poll(() => placeOf(body)).toBe(0)
  await page.keyboard.press('ArrowDown')
  await expect.poll(() => placeOf(body)).toBeGreaterThan(0)
  await page.keyboard.press('ArrowUp')
  await expect.poll(() => placeOf(body)).toBe(0)
}

for (const width of [1440, 390]) {
  test(`a card opened by its address reads from the keyboard at once, with no ring, at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 700 })
    await installBackend(page, { longRead: true })
    await page.goto(CARD)
    const drawer = await cardBeingRead(page)
    const body = drawer.locator('.drawer-frame-body')
    await readWithTheKeys(page, body)
    await expect(drawer.locator('.drawer-frame-close:focus-visible')).toHaveCount(0)
    await expect(body).toHaveCSS('outline-style', 'none')
    await expect(drawer).toHaveRole('dialog')
    await expect(drawer).toHaveAccessibleName(workItem.title)
  })
}

test('a card opened with the pointer reads from the keyboard too, from its bar', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 700 })
  await installBackend(page, { longRead: true })
  await page.goto(BOARD)
  await page.locator('.work-item-column[data-state="dev"] .tile-open').first().click()
  const drawer = await cardBeingRead(page)
  await expect(drawer.locator('.drawer-frame-close')).toBeFocused()
  await readWithTheKeys(page, drawer.locator('.drawer-frame-body'))
})

test('retrying a failed read keeps focus in the card while it waits, and whatever the answer', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 844 })
  await installBackend(page, { longRead: true })
  await page.goto(BOARD)
  const answer = { failing: true }
  await page.route('**/api/modules/planning/work-item?*', async (route) => {
    await new Promise((done) => setTimeout(done, 300))
    if (answer.failing)
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: '{"error":"boom"}',
      })
    else await route.fallback()
  })
  await page.locator('.work-item-column[data-state="dev"] .tile-open').first().click()
  const drawer = page.locator('.drawer')
  const retry = drawer.locator('.platform-state-retry')
  await expect(retry).toBeVisible()
  await expect(drawer).toHaveCSS('transform', 'none')

  // Refused again: it waited, it failed, and focus never left.
  await retry.focus()
  const refused = await framesOfFocus(page, async () => {
    await page.keyboard.press('Enter')
    await expect(retry).toHaveCount(0)
    await expect(retry).toBeVisible()
  })
  expect(refused.filter((inCard) => !inCard)).toHaveLength(0)
  await page.keyboard.press('Tab')
  expect(await page.evaluate(() => document.activeElement?.closest('.drawer') !== null)).toBe(true)

  // Answered: the head arrives around it, and the next Tab goes on inside the card.
  answer.failing = false
  await retry.focus()
  const answered = await framesOfFocus(page, async () => {
    await page.keyboard.press('Enter')
    await expect(drawer.locator('.card-facts')).toBeVisible()
  })
  expect(answered.filter((inCard) => !inCard)).toHaveLength(0)
  await page.keyboard.press('Tab')
  expect(await page.evaluate(() => document.activeElement?.closest('.drawer') !== null)).toBe(true)
})
