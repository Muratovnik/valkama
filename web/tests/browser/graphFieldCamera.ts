/**
 * The built field with the broad synthetic space on it, and what the camera specs read off
 * it: where the camera stands, and which card a press opened.
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { broadSpace } from '../fixtures/graphSpaces.ts'
import { installBackend } from './backend.ts'
import { graphRoute } from './chainFixtures.ts'
import { planningReadFor } from './planningReadFixture.ts'

export const broadModel = broadSpace().model

/** Serve the broad space at this window and open its field, in the open or the whole reading. */
export async function openBroadField(page: Page, width: number, height = 900) {
  await page.setViewportSize({ width, height })
  await installBackend(page)
  await page.route('**/api/planning?*', async (route) => {
    const response = planningReadFor(new URL(route.request().url()).searchParams)
    if (response.status === 200 && 'work_items' in response.body) {
      const body = response.body as unknown as Record<string, unknown>
      body.workflow = broadModel.workflow
      body.work_items = broadModel.work_items
      body.links = broadModel.links
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

export const fitWhole = (page: Page) =>
  page.getByRole('button', { name: 'Fit whole graph', exact: true }).click()

export const zoomOutButton = (page: Page) =>
  page.getByRole('button', { name: 'Zoom out', exact: true })

/** Where the camera stands now, read from the transform Vue Flow writes. */
export async function camera(page: Page) {
  const style = (await page.locator('.vue-flow__transformationpane').getAttribute('style')) ?? ''
  const match = /translate\((?<x>[-\d.e]+)px, *(?<y>[-\d.e]+)px\) scale\((?<zoom>[-\d.e]+)\)/u.exec(
    style,
  )
  if (!match?.groups) throw new Error(`the field's transform reads ${style}`)
  return {
    x: Number(match.groups.x),
    y: Number(match.groups.y),
    zoom: Number(match.groups.zoom),
  }
}

/** The camera once it has stopped moving: the same over two frames. */
export async function settledCamera(page: Page) {
  const read = () => page.locator('.vue-flow__transformationpane').getAttribute('style')
  await expect
    .poll(async () => {
      const first = await read()
      await page.evaluate(
        () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
      )
      return first === (await read())
    })
    .toBe(true)
  return camera(page)
}

export async function zoomNow(page: Page) {
  const { zoom } = await camera(page)
  return zoom
}

export async function settledZoom(page: Page) {
  const { zoom } = await settledCamera(page)
  return zoom
}
