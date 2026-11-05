/**
 * The camera stops where the whole field is in sight. Past it a header is a pixel or two
 * and the map a smudge, so every way out — the button, the wheel, a pinch — stops at the
 * zoom «Fit whole graph» gives, for the field drawn now in the window it is in now; and the
 * fit itself is never held up by the limit it sets.
 *
 * Served the broad synthetic space. A pinch reaches the field as a wheel with Control held.
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import {
  fitWhole,
  openBroadField,
  settledZoom,
  zoomNow,
  zoomOutButton,
} from './graphFieldCamera.ts'
import { test } from './test.ts'

const ZOOM_IN = 'Zoom in'

async function wheelOut(page: Page, control: boolean) {
  const flow = await page.locator('.graph-flow').boundingBox()
  await page.mouse.move((flow?.x ?? 0) + (flow?.width ?? 0) / 2, (flow?.y ?? 0) + 120)
  if (control) await page.keyboard.down('Control')
  for (let turn = 0; turn < 6; turn += 1) await page.mouse.wheel(0, 240)
  if (control) await page.keyboard.up('Control')
}

/** The whole field's zoom now, by the operation itself. */
async function wholeZoom(page: Page) {
  await fitWhole(page)
  return await settledZoom(page)
}

/** Press «Zoom out» until it turns off. */
async function zoomOutToTheLimit(page: Page) {
  for (let step = 0; step < 3 && (await zoomOutButton(page).isEnabled()); step += 1)
    await zoomOutButton(page).click()
}

/** Press a frame's fold from near enough: the overview hides it. */
async function pressFold(page: Page, id: string) {
  const zoomIn = page.getByRole('button', { name: ZOOM_IN, exact: true })
  const overview = page.locator('.graph-frame.overview')
  for (let step = 0; step < 30 && (await overview.count()) > 0; step += 1) await zoomIn.click()
  await page.evaluate((target) => {
    document.querySelector<HTMLElement>(`[data-walk-target="frame:${target}:fold"]`)?.click()
  }, id)
}

const showAll = (page: Page) =>
  page.locator('.graph [role="radio"]', { hasText: 'All' }).first().click()
const showOpen = (page: Page) =>
  page.locator('.graph [role="radio"]', { hasText: 'Open' }).first().click()

for (const width of [1500, 390]) {
  test(`at ${width}px no way out goes past the whole field, and the button says so`, async ({
    page,
  }) => {
    await openBroadField(page, width)
    const whole = await wholeZoom(page)
    await expect(zoomOutButton(page)).toBeDisabled()

    for (const control of [false, true]) {
      await wheelOut(page, control)
      expect(await settledZoom(page)).toBe(whole)
    }

    // A step in, and the way back out stops on the same zoom, with the button off again.
    await page.getByRole('button', { name: ZOOM_IN, exact: true }).click()
    await expect.poll(async () => await zoomNow(page)).toBeGreaterThan(whole)
    await expect(zoomOutButton(page)).toBeEnabled()
    await zoomOutToTheLimit(page)
    await expect.poll(async () => await zoomNow(page)).toBe(whole)
    await expect(zoomOutButton(page)).toBeDisabled()
  })
}

test('the limit follows the filter: a field that grew fits further out, and one that shrank brings the camera up', async ({
  page,
}) => {
  await openBroadField(page, 1500)
  await showOpen(page)
  await expect(page.locator('.graph-canvas.settled')).toBeVisible()
  const open = await wholeZoom(page)

  // The field grows with the limit still at the smaller field's zoom: the fit must not stop there.
  await showAll(page)
  await expect(zoomOutButton(page)).toBeEnabled()
  await expect.poll(() => wholeZoom(page)).toBeLessThan(open)
  await expect(zoomOutButton(page)).toBeDisabled()

  await showOpen(page)
  await expect.poll(async () => await settledZoom(page)).toBe(open)
  await expect(zoomOutButton(page)).toBeDisabled()
})

test('the limit follows a fold: it moves with the drawing, and comes back when the fold does', async ({
  page,
}) => {
  await openBroadField(page, 1500)
  const before = await wholeZoom(page)
  const folded = page.locator('.graph-frame.folded.holding').first()
  const id = (await folded.getAttribute('data-frame')) ?? ''
  const frame = page.locator(`.graph-frame[data-frame="${id}"]`)
  await pressFold(page, id)
  await expect(frame).not.toHaveClass(/folded/u)
  await expect(page.locator('.graph')).not.toHaveAttribute('aria-busy', 'true')
  // The layout rewraps round an opened frame, so the field can fit nearer as well as further.
  await expect.poll(() => wholeZoom(page)).not.toBe(before)
  await expect(zoomOutButton(page)).toBeDisabled()

  await pressFold(page, id)
  await expect(frame).toHaveClass(/folded/u)
  await expect(page.locator('.graph')).not.toHaveAttribute('aria-busy', 'true')
  await expect.poll(() => wholeZoom(page)).toBe(before)
  await expect(zoomOutButton(page)).toBeDisabled()
})

test('the limit follows the window, and a camera past it comes up as the window grows', async ({
  page,
}) => {
  await openBroadField(page, 1500)
  const whole = await wholeZoom(page)
  await page.setViewportSize({ width: 1100, height: 700 })
  await expect(zoomOutButton(page)).toBeEnabled()
  const smaller = await wholeZoom(page)
  expect(smaller).toBeLessThan(whole)
  await page.setViewportSize({ width: 1500, height: 900 })
  await expect.poll(async () => await settledZoom(page)).toBe(whole)
  await expect(zoomOutButton(page)).toBeDisabled()
})

test('a camera held past the limit comes up to it when the field is shown again', async ({
  page,
}) => {
  await openBroadField(page, 1100)
  await wholeZoom(page)
  await page.getByRole('radio', { name: 'Kanban', exact: true }).click()
  await expect(page.locator('.graph-canvas')).toHaveCount(0)
  // The window grows while the field is away, so the camera it held is now too far out.
  await page.setViewportSize({ width: 1500, height: 900 })
  await page.getByRole('radio', { name: 'Graph', exact: true }).click()
  await expect(page.locator('.graph-canvas.settled')).toBeVisible()
  const shown = await settledZoom(page)
  expect(shown).toBe(await wholeZoom(page))
})
