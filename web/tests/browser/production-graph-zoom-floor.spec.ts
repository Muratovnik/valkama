/**
 * The camera stops where the whole field is in sight. Past it a header is a pixel or two
 * and the map a smudge, so every way out — the button, the wheel, a pinch — stops at the
 * zoom «Fit whole graph» gives, for the field drawn now in the window it is in now; and the
 * fit itself is never held up by the limit it sets. On a phone-wide field that zoom goes no
 * further out than a card's smallest text reads, measured here against the type ramp's
 * reading floor; at 1280 the fit is the whole field as before.
 *
 * Served the broad synthetic space. A pinch reaches the field as a wheel with Control held.
 */
import { expect } from '@playwright/test'
import type { Page, TestInfo } from '@playwright/test'

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

/**
 * The smallest text a card draws on the screen now, and the floor of the type ramp
 * (`--font-size-meta`, DESIGN.md: «12px is the floor»). Every element in a card with words of
 * its own counts, at its computed size times the camera's zoom.
 */
async function cardText(page: Page, zoom: number) {
  return page
    .locator('.flow-node-card')
    .first()
    .evaluate((card, scale) => {
      const sizes = [card, ...card.querySelectorAll('*')]
        .filter((element) =>
          [...element.childNodes].some(
            (node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim(),
          ),
        )
        .filter((element) => element.getBoundingClientRect().width > 1)
        .map((element) => Number.parseFloat(getComputedStyle(element).fontSize) * scale)
      const floor = Number.parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue('--font-size-meta'),
      )
      return { smallest: Math.min(...sizes), floor }
    }, zoom)
}

/** Where every drawn node — a card or a frame — stands on the screen. */
const nodeBoxes = (page: Page) =>
  page.locator('.vue-flow__node').evaluateAll((elements) =>
    elements.map((element) => {
      const { left, top, right, bottom } = element.getBoundingClientRect()
      return { left, top, right, bottom }
    }),
  )

/** Where the field itself stands on the screen. */
const fieldBox = (page: Page) =>
  page.locator('.graph-flow').evaluate((element) => {
    const { left, top, right, bottom } = element.getBoundingClientRect()
    return { left, top, right, bottom }
  })

async function shoot(page: Page, info: TestInfo, name: string) {
  await page.screenshot({ path: info.outputPath(`${name}.png`) })
}

test('at 390px the camera stops where a card’s smallest text reads, and «Fit whole graph» says why', async ({
  page,
}, info) => {
  await openBroadField(page, 390)
  const whole = await wholeZoom(page)
  await shoot(page, info, 'graph-390-zoom-floor')
  const { smallest, floor } = await cardText(page, whole)
  expect(smallest).toBeGreaterThanOrEqual(floor - 0.01)
  // The floor binds: the broad space fits only further out, so its smallest text is at the floor.
  expect(smallest).toBeLessThan(floor + 0.5)
  await expect(zoomOutButton(page)).toBeDisabled()
  const fit = page.getByRole('button', { name: 'Fit whole graph', exact: true })
  await expect(fit).toBeEnabled()
  await expect(fit).toHaveAccessibleDescription(/stops where its cards still read/u)
  await fit.focus()
  await shoot(page, info, 'graph-390-zoom-floor-fit-hint')

  // The fit shows the drawing from its beginning: nothing drawn lies above or left of the
  // field, and the rest is a pan away to the right and below.
  const field = await fieldBox(page)
  const nodes = await nodeBoxes(page)
  for (const node of nodes) {
    expect(node.left).toBeGreaterThanOrEqual(field.left)
    expect(node.top).toBeGreaterThanOrEqual(field.top)
  }
  expect(Math.max(...nodes.map((node) => node.right))).toBeGreaterThan(field.right)
  // A card and the 16px the keyboard keeps clear on each side fit the field at the floor, so a
  // step onto a card in sight leaves the camera where the operator put it.
  const card = await page.locator('.flow-node-card').first().boundingBox()
  expect((card?.width ?? Infinity) + 32).toBeLessThanOrEqual(field.right - field.left)

  for (const control of [false, true]) {
    await wheelOut(page, control)
    expect(await settledZoom(page)).toBe(whole)
  }
  await page.getByRole('button', { name: ZOOM_IN, exact: true }).click()
  await expect.poll(async () => await zoomNow(page)).toBeGreaterThan(whole)
  await zoomOutToTheLimit(page)
  await expect.poll(async () => await zoomNow(page)).toBe(whole)
  await expect(zoomOutButton(page)).toBeDisabled()
})

test('at 1280px the fit is the whole field, as before: further out than a phone’s floor, every card in sight', async ({
  page,
}, info) => {
  await openBroadField(page, 1280)
  const whole = await wholeZoom(page)
  await shoot(page, info, 'graph-1280-zoom-whole')
  const { smallest, floor } = await cardText(page, whole)
  expect(smallest).toBeLessThan(floor)
  const fit = page.getByRole('button', { name: 'Fit whole graph', exact: true })
  await expect(fit).not.toHaveAttribute('aria-describedby', /./u)
  const field = await fieldBox(page)
  for (const node of await nodeBoxes(page)) {
    expect(node.left).toBeGreaterThanOrEqual(field.left - 0.5)
    expect(node.right).toBeLessThanOrEqual(field.right + 0.5)
    expect(node.top).toBeGreaterThanOrEqual(field.top - 0.5)
    expect(node.bottom).toBeLessThanOrEqual(field.bottom + 0.5)
  }
})

for (const width of [1500]) {
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
