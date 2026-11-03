import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import { planningWorkItemEntity } from '@/shared/api/platformPlanningRefs.ts'
import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { installBackend } from './backend.ts'
import { projectScope, workItemRef } from './planningFixtures.ts'
import { test } from './test.ts'

const CARD = serializePlatformRoute({
  module_id: 'planning',
  scope: projectScope,
  entity: planningWorkItemEntity(workItemRef),
})

async function cardBeingRead(page: Page) {
  const drawer = page.locator('.drawer')
  await expect(drawer.locator('.card-facts')).toBeVisible()
  await expect(drawer).toHaveCSS('transform', 'none')
  return drawer
}

const placeOf = (body: Locator) => body.evaluate((node) => node.scrollTop)
const bottomOf = (body: Locator) => body.evaluate((node) => node.scrollHeight - node.clientHeight)

/**
 * The body's place once it has stopped moving. The keys that read scroll smoothly, so a
 * place read as soon as the body has started is a place on the way, 497 on the way to 69,
 * and passes for a focus that jumped. Counted in frames: a place only changes with a frame,
 * so on a loaded machine two reads a moment apart agree in mid-flight.
 */
const restingPlace = (body: Locator) =>
  body.evaluate(
    (node) =>
      new Promise<number>((done) => {
        let place = node.scrollTop
        let still = 0
        const look = () => {
          still = node.scrollTop === place ? still + 1 : 0
          place = node.scrollTop
          if (still === 10) done(place)
          else requestAnimationFrame(look)
        }
        requestAnimationFrame(look)
      }),
  )

/** Whether focus stands in the card and before its scroller: the stop a Shift+Tab goes back to. */
const focusIsBefore = (body: Locator) =>
  body.evaluate((node) => {
    const inOrder = [...(node.closest('.drawer')?.querySelectorAll('*') ?? [])]
    const focused = document.activeElement
    const at = focused ? inOrder.indexOf(focused) : -1
    return at !== -1 && at < inOrder.indexOf(node)
  })

test('a press on plain text far down leaves Tab and Shift+Tab where they were', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 700 })
  await installBackend(page, { longRead: true })
  await page.goto(CARD)
  const drawer = await cardBeingRead(page)
  const body = drawer.locator('.drawer-frame-body')
  const box = await body.boundingBox()
  await page.mouse.move((box?.x ?? 0) + 200, (box?.y ?? 0) + 300)
  await page.mouse.wheel(0, 400)
  await expect.poll(() => placeOf(body)).toBe(400)
  const text = drawer.getByText('Paragraph 12 of a description').first()
  const line = await text.boundingBox()
  await page.mouse.click((line?.x ?? 0) + 20, (line?.y ?? 0) + 6)
  await page.keyboard.press('PageDown')
  await expect.poll(() => placeOf(body)).toBeGreaterThan(400)
  const read = await restingPlace(body)
  await page.keyboard.press('PageUp')
  await expect.poll(() => placeOf(body)).toBeLessThan(read)
  const place = await restingPlace(body)
  await page.keyboard.press('Shift+Tab')
  await expect.poll(() => focusIsBefore(body)).toBe(true)
  // Nowhere near the end of the card, where the trap's last control is.
  const end = await bottomOf(body)
  expect(await placeOf(body)).toBeLessThan(end - 200)
  expect(await placeOf(body)).toBeLessThanOrEqual(place)
})

/**
 * A press on text gives focus to the scroller, wherever in it the press lands, and the next
 * stops are its neighbours in the document: what stands before it, the body's own after. A
 * press whose focus fell to the surface sent the trap to either end of the card from here.
 */
const TEXT_IN_THE_BODY = [
  { where: 'top', scrollTo: 0, text: (drawer: Locator) => drawer.locator('.drawer-frame-name') },
  {
    where: 'middle',
    scrollTo: 400,
    text: (drawer: Locator) => drawer.getByText('Paragraph 12 of a description').first(),
  },
  {
    where: 'bottom',
    scrollTo: Number.MAX_SAFE_INTEGER,
    text: (drawer: Locator) => drawer.getByText('No comments or reports yet.'),
  },
]

/** Whether focus stands inside the scroller, on what it holds: the stop a Tab goes on to. */
const focusIsInside = (body: Locator) =>
  body.evaluate((node) => {
    const focused = document.activeElement
    return focused !== node && node.contains(focused)
  })

for (const { where, scrollTo, text } of TEXT_IN_THE_BODY) {
  for (const { key, reached } of [
    { key: 'Shift+Tab', reached: focusIsBefore },
    { key: 'Tab', reached: focusIsInside },
  ]) {
    test(`a press on plain text at the ${where} of a card sends ${key} on to its neighbour`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: 1440, height: 700 })
      await installBackend(page, { longRead: true })
      await page.goto(CARD)
      const drawer = await cardBeingRead(page)
      const body = drawer.locator('.drawer-frame-body')
      await body.evaluate((node, top) => node.scrollTo({ top }), scrollTo)
      const line = await text(drawer).boundingBox()
      await page.mouse.click((line?.x ?? 0) + 20, (line?.y ?? 0) + 6)
      await expect(body).toBeFocused()
      await page.keyboard.press(key)
      await expect.poll(() => reached(body)).toBe(true)
    })
  }
}
