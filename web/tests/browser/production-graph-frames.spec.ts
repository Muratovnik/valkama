/**
 * The whole space's graph as frames: every epic with open work drawn round it,
 * with its edge of progress, and no open item left out for being linked to its
 * own epic alone.
 *
 * Served the broad synthetic space, whose second epic holds an item whose only
 * link is to that epic: the graph used to leave it out as unlinked.
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { broadSpace } from '../fixtures/graphSpaces.ts'
import { installBackend } from './backend.ts'
import { graphRoute } from './chainFixtures.ts'
import { planningReadFor } from './planningReadFixture.ts'
import { test } from './test.ts'

/** The broad space's item whose only link is to its own epic, and that epic. */
function loneItem() {
  const { lone } = broadSpace()
  if (!lone) throw new Error('the broad space holds a lone item')
  return lone
}

/** The suite's space, holding the broad space's work, workflow and links. */
async function serveBroadSpace(page: Page) {
  const { model } = broadSpace()
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
}

for (const width of [1500, 390]) {
  test(`an item linked only to its epic stands in that epic's frame at ${width}px`, async ({
    page,
  }) => {
    const lone = loneItem()
    await page.setViewportSize({ width, height: 900 })
    await serveBroadSpace(page)
    await page.goto(graphRoute({}))
    await expect(page.locator('.graph-canvas.settled')).toBeVisible()
    // Linked to nothing but its epic, it was left out as unlinked; it is drawn.
    const card = page.locator('.flow-node-card').filter({
      has: page.locator('.flow-node-id').getByText(lone.item.reference, { exact: true }),
    })
    await expect(card).toHaveCount(1, { timeout: 10_000 })
    // And it stands in its epic's frame, which says how far the epic has come.
    const frame = page.locator(`.graph-frame[data-frame="${lone.epic.work_item_id}"]`)
    await expect(frame).toHaveCount(1)
    await expect(frame.locator('.frame-progress')).toHaveCount(1)
    await expect(frame.locator('.graph-frame-count').first()).toHaveText(/^2 of 15 done$/u)
    const [frameBox, cardBox] = await Promise.all([frame.boundingBox(), card.boundingBox()])
    expect(frameBox && cardBox && cardBox.x >= frameBox.x && cardBox.y >= frameBox.y).toBe(true)
  })
}

test('a frame header’s buttons are the field’s Tab stop once the keyboard stands on them', async ({
  page,
}) => {
  const lone = loneItem()
  await page.setViewportSize({ width: 1500, height: 900 })
  await serveBroadSpace(page)
  await page.goto(graphRoute({}))
  await expect(page.locator('.graph-canvas.settled')).toBeVisible()
  const stops = page.locator('.graph-flow [tabindex="0"]')
  const frame = `frame:${lone.epic.work_item_id}`
  const fold = page.locator(`[data-walk-target="${frame}:fold"]`)
  await fold.focus()
  // Focus on the fold button makes it the one stop of the field.
  await expect(fold).toHaveAttribute('tabindex', '0')
  await expect(stops).toHaveCount(1)
  // The arrow across the header reaches the epic's button, which takes the stop.
  await page.keyboard.press('ArrowRight')
  const open = page.locator(`[data-walk-target="${frame}"]`)
  await expect(open).toBeFocused()
  await expect(open).toHaveAttribute('tabindex', '0')
  await expect(stops).toHaveCount(1)
})

/** Where the focused element stands on the screen, and what it stands for. */
async function focused(page: Page) {
  return page.evaluate(() => {
    const element = document.activeElement
    if (!(element instanceof HTMLElement) || !element.closest('.graph-flow')) return null
    const box = element.getBoundingClientRect()
    return { target: element.dataset.walkTarget ?? '', x: box.x, y: box.y }
  })
}

/** Walk left from the focused target to the nearest fold button, and say where it stands. */
async function walkToFold(page: Page) {
  for (let step = 0; step < 40; step += 1) {
    const at = await focused(page)
    if (at?.target.endsWith(':fold')) return at
    await page.keyboard.press('ArrowLeft')
  }
  throw new Error('no fold button to the left of the last target')
}

for (const width of [1500, 390]) {
  test(`Tab reaches a frame header, and folding holds it where it was pressed at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 })
    await serveBroadSpace(page)
    await page.goto(graphRoute({}))
    await expect(page.locator('.graph-canvas.settled')).toBeVisible()
    // From the zoom controls back, Shift+Tab lands on the field's one stop.
    await page.getByRole('button', { name: 'Zoom in', exact: true }).focus()
    await page.keyboard.press('Shift+Tab')
    await expect.poll(() => focused(page).then((at) => at?.target ?? '')).toMatch(/^frame:/u)
    // The frame at the top left keeps its place whatever folds; the last one
    // moves when it does, so its header is the one a fold could lose.
    await page.keyboard.press('End')
    const before = await walkToFold(page)
    expect(before.target).toMatch(/^frame:.+:fold$/u)
    const fold = page.locator(`[data-walk-target="${before.target}"]`)
    const expanded = await fold.getAttribute('aria-expanded')
    await page.keyboard.press('Enter')
    await expect(fold).not.toHaveAttribute('aria-expanded', expanded ?? '')
    await expect(page.locator('.graph-canvas.settled')).toBeVisible()
    // The header stays under the hand: focus kept, and the button where it was.
    await expect(fold).toBeFocused()
    await expect
      .poll(async () => {
        const after = await focused(page)
        return Math.max(Math.abs((after?.x ?? 0) - before.x), Math.abs((after?.y ?? 0) - before.y))
      })
      .toBeLessThan(2)
    await expect(fold).toBeInViewport()
  })
}

test('a header’s counts, wrapped to a second line, stay clear of its edge', async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 900 })
  await serveBroadSpace(page)
  await page.goto(graphRoute({}))
  await expect(page.locator('.graph-canvas.settled')).toBeVisible()
  const gaps = await page.locator('.graph-frame:not(.folded)').evaluateAll((frames) =>
    frames.map((frame) => {
      const texts = [...frame.querySelectorAll('.graph-frame-head .graph-frame-count')]
      const edge = frame.querySelector('.frame-progress')?.getBoundingClientRect()
      const lowest = Math.max(...texts.map((text) => text.getBoundingClientRect().bottom))
      return edge ? edge.top - lowest : Number.NaN
    }),
  )
  // The broad space's narrow open frames wrap their counts under the name.
  expect(gaps.length).toBeGreaterThan(2)
  expect(Math.min(...gaps)).toBeGreaterThanOrEqual(2)
})

/** The broad space's frames and cards that hold open work, by the walk's target ids. */
function openTargets(): Set<string> {
  const { model } = broadSpace()
  const byId = new Map(model.work_items.map((item) => [item.work_item_id, item]))
  const isFrame = (id: string) => {
    const item = byId.get(id)
    return Boolean(item && (item.container || item.kind === 'epic'))
  }
  const open = new Set<string>()
  for (const item of model.work_items) {
    if (item.state.is_terminal || isFrame(item.work_item_id)) continue
    open.add(item.work_item_id)
    for (let at = item.parent_id; at !== null && isFrame(at); at = byId.get(at)?.parent_id ?? null)
      open.add(`frame:${at}`).add(`frame:${at}:fold`)
  }
  // The work under no epic: its frame holds the open loose items.
  open.add('frame:none:fold')
  return open
}

/** The field's targets in reading order: all of them, or those whose centre is in sight. */
async function walkTargets(page: Page, inSight: boolean) {
  return page.locator('.graph-flow').evaluate((flow, sight) => {
    const field = flow.getBoundingClientRect()
    return [...flow.querySelectorAll<HTMLElement>('[data-walk-target]')]
      .map((element) => ({
        id: element.dataset.walkTarget ?? '',
        box: element.getBoundingClientRect(),
      }))
      .filter(({ box }) => {
        const x = box.x + box.width / 2
        const y = box.y + box.height / 2
        return (
          !sight || (x >= field.left && x <= field.right && y >= field.top && y <= field.bottom)
        )
      })
      .sort((left, right) => left.box.y - right.box.y || left.box.x - right.box.x)
      .map(({ id }) => id)
  }, inSight)
}

for (const width of [1500, 390]) {
  test(`the space's graph begins with open work and opens with it in sight at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 })
    await serveBroadSpace(page)
    await page.goto(graphRoute({}))
    await expect(page.locator('.graph-canvas.settled')).toBeVisible()
    const open = openTargets()
    // The broad space's smallest frames are finished epics' folded ones; the
    // field as it is read still begins with open work.
    const [first] = await walkTargets(page, false)
    expect(open.has(first)).toBe(true)
    // And the first screen shows it: an open card, or a frame header holding some.
    await expect
      .poll(async () => {
        const seen = await walkTargets(page, true)
        return seen.filter((id) => open.has(id))
      })
      .not.toEqual([])
  })
}

/** Press Tab until the focus is inside the field, and say where it stands. */
async function tabIntoField(page: Page) {
  for (let step = 0; step < 8; step += 1) {
    const at = await focused(page)
    if (at) return at
    await page.keyboard.press('Tab')
  }
  return focused(page)
}

/** Drag the field by `dx`, `dy` from near its bottom-right corner, where it is empty. */
async function dragField(page: Page, dx: number, dy: number) {
  const flow = await page.locator('.graph-flow').boundingBox()
  const from = {
    x: (flow?.x ?? 0) + (flow?.width ?? 0) - 20,
    y: (flow?.y ?? 0) + (flow?.height ?? 0) - 120,
  }
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 12 })
  await page.mouse.up()
}

test('Tab from the row above the field enters where the operator moved the field, and the camera stays at 390px', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 900 })
  await serveBroadSpace(page)
  await page.goto(graphRoute({}))
  await expect(page.locator('.graph-canvas.settled')).toBeVisible()
  // The operator drags the field to the left, past its first target.
  await dragField(page, -320, -40)
  const [first] = await walkTargets(page, false)
  await expect.poll(() => walkTargets(page, true)).not.toContain(first)
  const pane = page.locator('.vue-flow__transformationpane')
  const camera = await pane.getAttribute('style')
  // From the row's last control, Tab moves into the field.
  await page.locator('.graph [role="radio"][aria-checked="true"]').focus()
  const at = await tabIntoField(page)
  expect(at).not.toBeNull()
  expect(await walkTargets(page, true)).toContain(at?.target)
  await expect(pane).toHaveAttribute('style', camera ?? '')
})

for (const width of [1500, 390]) {
  test(`zoomed out to the overview, Tab from the row above the field enters it on a target it draws at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 })
    await serveBroadSpace(page)
    await page.goto(graphRoute({}))
    await expect(page.locator('.graph-canvas.settled')).toBeVisible()
    const zoomOut = page.getByRole('button', { name: 'Zoom out', exact: true })
    for (let step = 0; step < 3; step += 1) await zoomOut.click()
    // The headers are bands now, their fold buttons hidden.
    await expect(page.locator('.graph-frame.overview').first()).toBeVisible()
    await page.locator('.graph [role="radio"][aria-checked="true"]').focus()
    const at = await tabIntoField(page)
    expect(at).not.toBeNull()
    const shown = await page.evaluate(() => {
      const element = document.activeElement
      return element instanceof HTMLElement ? getComputedStyle(element).visibility : ''
    })
    expect(shown).toBe('visible')
    expect(await walkTargets(page, true)).toContain(at?.target)
  })
}

/** The suite's space holding only open work under no epic, too much of it to start open. */
async function serveLooseSpace(page: Page) {
  const { model } = broadSpace()
  const loose = model.work_items
    .filter((item) => item.parent_id === null && !item.container && item.kind !== 'epic')
    .filter((item) => !item.state.is_terminal)
    .slice(0, 25)
  await installBackend(page)
  await page.route('**/api/planning?*', async (route) => {
    const response = planningReadFor(new URL(route.request().url()).searchParams)
    if (response.status === 200 && 'work_items' in response.body) {
      const body = response.body as unknown as Record<string, unknown>
      body.workflow = model.workflow
      body.work_items = loose
      body.links = []
    }
    await route.fulfill({
      status: response.status,
      contentType: 'application/json',
      body: JSON.stringify(response.body),
    })
  })
}

/** Press «Zoom out» until the field draws its overview. */
async function zoomOutToOverview(page: Page) {
  const zoomOut = page.getByRole('button', { name: 'Zoom out', exact: true })
  for (let step = 0; step < 16; step += 1) {
    if ((await page.locator('.graph-frame.overview').count()) > 0) return
    await zoomOut.click()
  }
}

test('a field of the work under none alone, folded, still takes Tab in the overview at 390px', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 900 })
  await serveLooseSpace(page)
  await page.goto(graphRoute({}))
  await expect(page.locator('.graph-canvas.settled')).toBeVisible()
  await expect(page.locator('.graph-flow .graph-frame')).toHaveCount(1)
  await expect(page.locator('.graph-flow .graph-frame.folded')).toHaveCount(1)
  await zoomOutToOverview(page)
  await expect(page.locator('.graph-frame.overview')).toHaveCount(1)
  await page.locator('.graph [role="radio"][aria-checked="true"]').focus()
  const at = await tabIntoField(page)
  expect(at?.target).toBe('frame:none:fold')
  const shown = await page.evaluate(() => {
    const element = document.activeElement
    return element instanceof HTMLElement ? getComputedStyle(element).visibility : ''
  })
  expect(shown).toBe('visible')
})
