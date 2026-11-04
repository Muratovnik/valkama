/**
 * The keyboard's place survives a zoom. Zoomed out past reading a header's fold
 * button is hidden, and focus on it used to drop to the page: the arrows did
 * nothing and the next Tab started over. Focus goes to the epic's button of the
 * same header instead, and the camera stays where the zoom put it.
 *
 * Served the broad synthetic space; the zoom is the wheel's or the «Zoom out»
 * button's, pressed without taking focus as a pointer user's would not.
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { broadSpace } from '../fixtures/graphSpaces.ts'
import { installBackend } from './backend.ts'
import { graphRoute } from './chainFixtures.ts'
import { planningReadFor } from './planningReadFixture.ts'
import { test } from './test.ts'

async function openBroadSpace(page: Page, width: number) {
  const { model } = broadSpace()
  await page.setViewportSize({ width, height: 900 })
  await installBackend(page)
  await page.route('**/api/planning?*', async (route) => {
    const response = planningReadFor(new URL(route.request().url()).searchParams)
    if (response.status === 200 && 'work_items' in response.body) {
      const body = response.body as unknown as Record<string, unknown>
      body.workflow = model.workflow
      body.work_items = model.work_items
      body.links = model.links
    }
    await route.fulfill({
      status: response.status,
      contentType: 'application/json',
      body: JSON.stringify(response.body),
    })
  })
  await page.goto(graphRoute({}))
  await expect(page.locator('.graph-canvas.settled')).toBeVisible()
}

type Zoom = 'button' | 'wheel'

const pane = (page: Page) => page.locator('.vue-flow__transformationpane')

/** One step out, by the wheel over the field's middle or by «Zoom out» without its focus. */
async function stepOut(page: Page, how: Zoom) {
  const before = (await pane(page).getAttribute('style')) ?? ''
  const flow = await page.locator('.graph-flow').boundingBox()
  const middle = { x: (flow?.x ?? 0) + (flow?.width ?? 0) / 2, y: (flow?.y ?? 0) + 200 }
  const steps: Record<Zoom, () => Promise<void>> = {
    wheel: async () => {
      await page.mouse.move(middle.x, middle.y)
      await page.mouse.wheel(0, 240)
    },
    button: () =>
      page.getByRole('button', { name: 'Zoom out', exact: true }).dispatchEvent('click'),
  }
  await steps[how]()
  await expect(pane(page)).not.toHaveAttribute('style', before)
}

/** The camera once it has stopped moving: the same over two frames. */
async function settledCamera(page: Page) {
  const read = () => pane(page).getAttribute('style')
  await expect
    .poll(async () => {
      const first = await read()
      await page.evaluate(
        () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
      )
      return first === (await read())
    })
    .toBe(true)
  return read()
}

/** Zoom out the same number of steps every run, past reading, and say where the camera ended. */
async function zoomOutPastReading(page: Page, how: Zoom) {
  for (let step = 0; step < 6; step += 1) await stepOut(page, how)
  await expect(page.locator('.graph-frame.overview').first()).toBeVisible()
  return settledCamera(page)
}

for (const width of [1500, 390])
  for (const how of ['wheel', 'button'] as const)
    test(`focus on a header's fold moves to its epic's button when a ${how} zoom hides the fold at ${width}px`, async ({
      page,
    }) => {
      const fold = page.locator('.graph-frame:not(.folded) [data-walk-target$=":fold"]').first()
      // Where the zoom alone puts the camera: the fold was focused, which may
      // bring it into sight, and focus left the field before the zoom.
      await openBroadSpace(page, width)
      await fold.focus()
      await page.locator('.graph [role="radio"][aria-checked="true"]').focus()
      const alone = await zoomOutPastReading(page, how)

      await openBroadSpace(page, width)
      const target = (await fold.getAttribute('data-walk-target')) ?? ''
      await fold.focus()
      const camera = await zoomOutPastReading(page, how)
      const epic = target.replace(/:fold$/u, '')
      const focused = () =>
        page.evaluate(() =>
          document.activeElement instanceof HTMLElement
            ? (document.activeElement.dataset.walkTarget ?? document.activeElement.tagName)
            : '',
        )
      await expect.poll(focused).toBe(epic)
      // The camera is where the zoom alone put it.
      expect(camera).toBe(alone)
      await expect(pane(page)).toHaveAttribute('style', alone ?? '')
      // And the arrows still walk the field.
      await page.keyboard.press('ArrowDown')
      await expect.poll(focused).not.toBe(epic)
      expect(
        await page.evaluate(() => Boolean(document.activeElement?.closest('.graph-flow'))),
      ).toBe(true)
    })
