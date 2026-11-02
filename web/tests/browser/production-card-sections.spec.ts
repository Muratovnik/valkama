import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { installBackend } from './backend.ts'
import { projectScope } from './planningFixtures.ts'
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

/**
 * A press where the pointer is. `locator.click` scrolls its target into view first,
 * and a stuck element's own place is above the fold: it moved the scroller by itself
 * before it pressed, which a reader's hand never does.
 */
async function pressWhereItStands(page: Page, target: Locator) {
  // The strip scrolls inside itself where one row cannot hold it, as a thumb would.
  await target.evaluate((node) => {
    node.scrollIntoView({
      block: 'nearest',
      inline: 'nearest',
      container: 'nearest',
    } as ScrollIntoViewOptions)
  })
  const box = await target.boundingBox()
  await page.mouse.move(
    (box?.x ?? 0) + (box?.width ?? 0) / 2,
    (box?.y ?? 0) + (box?.height ?? 0) / 2,
  )
  await page.mouse.down()
  await page.mouse.up()
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
    const sections = tabs.getByRole('button')
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

    const frames = await framesOfTabs(tabs, async () => {
      await page.keyboard.press('Shift+Tab')
      await expect(tabs.getByRole('button').last()).toBeFocused()
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
    .getByRole('button', { name: 'Relations', exact: true })
    .click()
  await drawer.locator('.card-state').first().click()
  await page.locator('[role="option"]').last().click()
  await drawer.getByRole('button', { name: 'Go to the checklist', exact: true }).click()
  await expect(drawer.locator('.overview')).toBeVisible()
  await expect(drawer.getByRole('heading', { name: /^Checklist/u }).first()).toBeInViewport()
})
