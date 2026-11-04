import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { installBackend } from './backend.ts'
import { projectScope } from './planningFixtures.ts'
import { pressWhereItStands } from './stuckPress.ts'
import { test } from './test.ts'

async function topOf(locator: Locator): Promise<number> {
  const box = await locator.boundingBox()
  return box?.y ?? 0
}

/**
 * Where the sections stood on every frame painted while `act` ran. A place lost and
 * found again inside one frame costs nothing; one lost across a frame is the complaint.
 */
async function framesOfTabs(tabs: Locator, act: () => Promise<void>): Promise<number[]> {
  const sampler = await tabs.evaluateHandle((strip) => {
    const frames: number[] = []
    let running = true
    const sample = () => {
      if (!running) return
      frames.push(Math.round(strip.getBoundingClientRect().y))
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
  // Past a paint, so that a place lost after the press has reached a frame.
  await tabs.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  )
  return sampler.evaluate((running) => running.stop())
}

for (const width of [1440, 390]) {
  test(`the sections stay under the pointer going to each section and back to Overview at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 500 })
    const events = Array.from({ length: 60 }, (_, index) => ({
      action: 'claimed',
      author: `agent-${index}`,
      at: `2026-08-13T08:${String(index).padStart(2, '0')}:00Z`,
      detail: '',
      identity: { agent_id: null, session_id: null, source: null, state: 'unconfirmed' },
    }))
    await installBackend(page, { events, longRead: true })
    await page.goto(serializePlatformRoute({ module_id: 'planning', scope: projectScope }))
    await page.locator('.work-item-column[data-state="dev"] .work-item-tile').first().click()
    const drawer = page.locator('.drawer')
    await expect(drawer.locator('.card-facts')).toBeVisible()
    await expect(drawer).toHaveCSS('transform', 'none')
    const body = drawer.locator('.drawer-frame-body')
    const tabs = drawer.locator('.drawer-frame-tabs')
    const sections = tabs.getByRole('radio')
    const edge = Math.round(await topOf(body))
    const atRest = Math.round(await topOf(tabs))
    const bodyBox = await body.boundingBox()

    await expect(sections).toHaveCount(5)
    for (const shown of [1, 2, 3, 4]) {
      // Read down Overview with the wheel, past where the sections stick.
      await page.mouse.move(
        (bodyBox?.x ?? 0) + (bodyBox?.width ?? 0) / 2,
        (bodyBox?.y ?? 0) + (bodyBox?.height ?? 0) / 2,
      )
      await page.mouse.wheel(0, 700)
      await expect.poll(() => topOf(tabs)).toBeCloseTo(edge, 0)

      // A section tall enough holds them there; a short one lets them down only as far
      // as its own height has to.
      const going = await framesOfTabs(tabs, async () => {
        await pressWhereItStands(page, sections.nth(shown))
        await expect(drawer.locator('.overview')).toBeHidden()
      })
      const room = await body.evaluate((node) => node.scrollHeight - node.clientHeight)
      const held = Math.max(edge, atRest - room)
      expect(going.every((top) => top === edge || top === held)).toBe(true)
      expect(Math.round(await topOf(tabs))).toBe(held)

      // Overview is long, so back there nothing has a reason to move at all.
      const back = await framesOfTabs(tabs, async () => {
        await pressWhereItStands(page, sections.first())
        await expect(drawer.locator('.overview')).toBeVisible()
      })
      expect([...new Set(back)]).toEqual([held])
    }
  })
}

for (const width of [1440, 390]) {
  test(`Shift+Tab from the content into the stuck sections leaves the place alone at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 700 })
    await installBackend(page, { longRead: true })
    await page.goto(serializePlatformRoute({ module_id: 'planning', scope: projectScope }))
    await page.locator('.work-item-column[data-state="dev"] .work-item-tile').first().click()
    const drawer = page.locator('.drawer')
    await expect(drawer.locator('.card-facts')).toBeVisible()
    await expect(drawer).toHaveCSS('transform', 'none')
    const body = drawer.locator('.drawer-frame-body')
    const tabs = drawer.locator('.drawer-frame-tabs')
    const edge = Math.round(await topOf(body))
    const atRest = Math.round(await topOf(tabs))

    // The sections have just stuck, and the content's first control stands right under them.
    const bodyBox = await body.boundingBox()
    await page.mouse.move(
      (bodyBox?.x ?? 0) + (bodyBox?.width ?? 0) / 2,
      (bodyBox?.y ?? 0) + (bodyBox?.height ?? 0) / 2,
    )
    await page.mouse.wheel(0, atRest - edge + 8)
    await expect.poll(() => topOf(tabs)).toBeCloseTo(edge, 0)
    const place = await body.evaluate((node) => node.scrollTop)
    const first = drawer.locator('.drawer-frame-content').locator('button, a[href]').first()
    await first.focus()
    await expect(first).toBeInViewport()
    expect(await body.evaluate((node) => node.scrollTop)).toBe(place)

    // The sections are one Tab stop, on the one shown.
    const frames = await framesOfTabs(tabs, async () => {
      await page.keyboard.press('Shift+Tab')
      await expect(tabs.getByRole('radio', { checked: true })).toBeFocused()
    })
    expect([...new Set(frames)]).toEqual([edge])
    expect(await body.evaluate((node) => node.scrollTop)).toBe(place)
  })
}

test('a refused move answered from another section brings the checklist into view', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 700 })
  await installBackend(page, { longRead: true })
  await page.route('**/api/planning/work-item/transition', (route) =>
    route.fulfill({
      status: 409,
      contentType: 'application/json',
      body: JSON.stringify({
        error: { code: 'workflow_guard', message: '[checklist] MAIN-264 has open steps' },
      }),
    }),
  )
  await page.goto(serializePlatformRoute({ module_id: 'planning', scope: projectScope }))
  await page.locator('.work-item-column[data-state="dev"] .work-item-tile').first().click()
  const drawer = page.locator('.drawer')
  await expect(drawer.locator('.card-facts')).toBeVisible()
  await expect(drawer).toHaveCSS('transform', 'none')
  await drawer
    .locator('.drawer-frame-tabs')
    .getByRole('radio', { name: 'Relations', exact: true })
    .click()
  await drawer.locator('.card-state').first().click()
  await page.locator('[role="option"]').last().click()
  await drawer.getByRole('button', { name: 'Go to the checklist', exact: true }).click()
  await expect(drawer.locator('.overview')).toBeVisible()
  await expect(drawer.getByRole('heading', { name: /^Checklist/u }).first()).toBeInViewport()
})

/** The card from its tile, read down with the wheel until the sections stick. */
async function cardReadDown(page: Page, width: number, height: number) {
  await page.setViewportSize({ width, height })
  await installBackend(page, { longRead: true })
  await page.goto(serializePlatformRoute({ module_id: 'planning', scope: projectScope }))
  await page.locator('.work-item-column[data-state="dev"] .work-item-tile').first().click()
  const drawer = page.locator('.drawer')
  await expect(drawer.locator('.card-facts')).toBeVisible()
  await expect(drawer).toHaveCSS('transform', 'none')
  const body = drawer.locator('.drawer-frame-body')
  const tabs = drawer.locator('.drawer-frame-tabs')
  const edge = Math.round(await topOf(body))
  const atRest = Math.round(await topOf(tabs))
  const box = await body.boundingBox()
  await page.mouse.move(
    (box?.x ?? 0) + (box?.width ?? 0) / 2,
    (box?.y ?? 0) + (box?.height ?? 0) / 2,
  )
  await page.mouse.wheel(0, 1500)
  await expect.poll(() => topOf(tabs)).toBeCloseTo(edge, 0)
  const place = await body.evaluate((node) => node.scrollTop)
  return { atRest, body, drawer, edge, place, sections: tabs.getByRole('radio'), tabs }
}

const placeOf = (body: Locator) => body.evaluate((node) => node.scrollTop)

for (const [width, height] of [
  [1680, 700],
  [390, 700],
]) {
  test(`walking the sections from the keyboard holds the strip, and Tab passes it once, at ${width}px`, async ({
    page,
  }) => {
    const { atRest, body, drawer, edge, place, sections, tabs } = await cardReadDown(
      page,
      width,
      height,
    )
    // Pressing the section already shown changes nothing.
    await pressWhereItStands(page, sections.first())
    await expect(sections.first()).toBeFocused()
    expect(await placeOf(body)).toBe(place)

    // The arrows show each section in turn, from its own top, and the strip ends where a
    // press leaves it: where it stood, or only as far down as a short section has to. On
    // the way it does not drop to where it stands unstuck, which is where a browser
    // scrolls a stuck control it is asked to show. A section that fills in after it is
    // shown may settle the strip over a frame or two, as it does for a press.
    for (const [key, reached] of [
      ['ArrowRight', 1],
      ['ArrowRight', 2],
      ['ArrowRight', 3],
      ['ArrowRight', 4],
      ['ArrowLeft', 3],
      ['ArrowLeft', 2],
      ['ArrowLeft', 1],
      ['ArrowLeft', 0],
    ] as const) {
      const before = Math.round(await topOf(tabs))
      const frames = await framesOfTabs(tabs, async () => {
        await page.keyboard.press(key)
        await expect(sections.nth(reached)).toBeFocused()
        await expect(sections.nth(reached)).toHaveAttribute('aria-checked', 'true')
      })
      const room = await body.evaluate((node) => node.scrollHeight - node.clientHeight)
      const held = Math.max(before, atRest - room)
      const step = `${key} to ${reached}: ${JSON.stringify({ atRest, before, held, frames })}`
      expect(frames.at(-1), step).toBe(held)
      expect(
        frames.every((top) => top < atRest || held === atRest),
        step,
      ).toBe(true)
    }

    // Read down Overview again, then in from the content: one Shift+Tab reaches the section
    // shown, and the place stays. The control is off above the fold, as one is that kept
    // focus while the wheel read on.
    const box = await body.boundingBox()
    await page.mouse.move((box?.x ?? 0) + (box?.width ?? 0) / 2, (box?.y ?? 0) + 40)
    await page.mouse.wheel(0, 1500)
    await expect.poll(() => topOf(tabs)).toBeCloseTo(edge, 0)
    const readTo = await placeOf(body)
    const first = drawer.locator('.drawer-frame-content').locator('button, a[href]').first()
    await first.evaluate((node) => (node as HTMLElement).focus({ preventScroll: true }))
    const coming = await framesOfTabs(tabs, async () => {
      await page.keyboard.press('Shift+Tab')
      await expect(sections.first()).toBeFocused()
      expect(await placeOf(body)).toBe(readTo)
    })
    expect([...new Set(coming)]).toEqual([edge])

    // A Shift+Tab past the sections goes up to the head, which comes back into view for it.
    await page.keyboard.press('Shift+Tab')
    const focusedInHead = drawer.locator('.drawer-frame-lead :focus')
    await expect(focusedInHead).toHaveCount(1)
    await expect(focusedInHead).toBeInViewport()

    // A Tab from the sections is an ordinary Tab: it goes to the content's first control.
    await sections.first().focus()
    await page.keyboard.press('Tab')
    await expect(first).toBeFocused()
    await expect(first).toBeInViewport()
  })
}

test('from the head, a Tab into the stuck sections leaves the place alone', async ({ page }) => {
  const { body, drawer, edge, place, sections } = await cardReadDown(page, 1680, 700)
  // Focus left behind in the head, which the wheel has read past.
  await drawer
    .locator('.drawer-frame-lead')
    .locator('button')
    .last()
    .evaluate((node) => node.focus({ preventScroll: true }))
  await page.keyboard.press('Tab')
  await expect(sections.first()).toBeFocused()
  expect(await placeOf(body)).toBe(place)
  expect(Math.round(await topOf(sections.first()))).toBeLessThanOrEqual(edge + 20)
})

test('sections below the fold of a short window are still brought into view for the keyboard', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 240 })
  await installBackend(page, { longRead: true })
  await page.goto(serializePlatformRoute({ module_id: 'planning', scope: projectScope }))
  await page.locator('.work-item-column[data-state="dev"] .work-item-tile').first().click()
  const drawer = page.locator('.drawer')
  await expect(drawer.locator('.card-facts')).toBeAttached()
  await expect(drawer).toHaveCSS('transform', 'none')
  const sections = drawer.locator('.drawer-frame-tabs').getByRole('radio')
  await drawer
    .locator('.drawer-frame-lead')
    .locator('button')
    .last()
    .evaluate((node) => node.focus({ preventScroll: true }))
  await expect(sections.first()).not.toBeInViewport()
  await page.keyboard.press('Tab')
  await expect(sections.first()).toBeFocused()
  await expect(sections.first()).toBeInViewport()
})
