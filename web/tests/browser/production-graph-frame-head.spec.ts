/**
 * An epic's header as the built app lays it out: it is one header whether the
 * frame is folded or open, and the title is the thing it leaves room for.
 *
 * Served a small space made for it, so that each case below is on the field by
 * its own numbers rather than wherever a large space happens to put one.
 */
import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import type { WorkItemBrief } from '@/shared/api/planningModel.ts'

import { broadSpace } from '../fixtures/graphSpaces.ts'
import { installBackend } from './backend.ts'
import { graphRoute } from './chainFixtures.ts'
import { planningReadFor } from './planningReadFixture.ts'
import { test } from './test.ts'

test.use({ locale: 'ru-RU' })

const { model } = broadSpace()
const identity = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

function stateOf(key: string): WorkItemBrief['state'] {
  const found = model.work_items.find((entry) => entry.state.key === key)
  if (!found) throw new Error(`the broad space has no item in ${key}`)
  return found.state
}

function item(n: number, key: string, overrides: Partial<WorkItemBrief> = {}): WorkItemBrief {
  return {
    ...model.work_items[0],
    work_item_id: identity(n),
    reference: `MAIN-${n}`,
    number: n,
    title: `Item ${n}`,
    kind: 'task',
    container: false,
    parent_id: null,
    state: stateOf(key),
    claim_ref: '',
    claim_state: null,
    ...overrides,
  }
}

const LONG_TITLE =
  'Reconcile the release notes with what the installer actually ships to the desktop'

/** An open epic with two open tasks among finished ones: it starts open. */
const OPEN = 1
/** An open epic nothing was ever filed under. */
const EMPTY = 10
/** An open epic with so much open work that it starts folded, and every group in its counts. */
const CROWDED = 40

function underEpic(parent: number, from: number, keys: readonly string[]): WorkItemBrief[] {
  return keys.map((key, index) => item(from + index, key, { parent_id: identity(parent) }))
}

const repeat = (key: string, count: number) => Array.from({ length: count }, () => key)

const SPACE: WorkItemBrief[] = [
  item(OPEN, 'dev', { kind: 'epic', container: true, title: LONG_TITLE }),
  ...underEpic(OPEN, 2, ['todo', 'dev', 'done', 'done', 'done']),
  item(EMPTY, 'review', { kind: 'epic', title: LONG_TITLE }),
  item(CROWDED, 'dev', { kind: 'epic', container: true, title: LONG_TITLE }),
  ...underEpic(CROWDED, 100, [
    ...repeat('done', 120),
    ...repeat('review', 12),
    ...repeat('dev', 12),
    ...repeat('blocked', 12),
    ...repeat('backlog', 30),
  ]),
]

async function serveSpace(page: Page) {
  await installBackend(page)
  await page.route('**/api/planning?*', async (route) => {
    const response = planningReadFor(new URL(route.request().url()).searchParams)
    if (response.status === 200 && 'work_items' in response.body) {
      const body = response.body as unknown as Record<string, unknown>
      body.workflow = model.workflow
      body.work_items = SPACE
      body.links = []
    }
    await route.fulfill({
      status: response.status,
      contentType: 'application/json',
      body: JSON.stringify(response.body),
    })
  })
}

const frameOf = (page: Page, n: number) => page.locator(`.graph-frame[data-frame="${identity(n)}"]`)
const foldOf = (page: Page, n: number) =>
  page.locator(`[data-walk-target="frame:${identity(n)}:fold"]`)
async function openField(page: Page, width = 1500) {
  await page.setViewportSize({ width, height: 900 })
  await serveSpace(page)
  await page.goto(graphRoute({}))
  await expect(page.locator('.graph-canvas.settled')).toBeVisible()
  await expect(frameOf(page, OPEN)).toHaveCount(1)
}

/** The parts a header's places are read for. */
const PARTS = [
  '.graph-frame-reference',
  '.graph-frame-title',
  '.graph-frame-count',
  '.frame-progress',
]

/** The top left of each part, from the frame's own, in the field's units. */
async function headerPlaces(frame: Locator) {
  return frame.evaluate((element, parts) => {
    const box = element.getBoundingClientRect()
    // The camera scales the field; the frame's own width says by how much.
    const scale = box.width / (element as HTMLElement).offsetWidth
    return Object.fromEntries(
      parts.flatMap((part) => {
        const found = element.querySelector(part)?.getBoundingClientRect()
        return found ? [[part, { x: (found.x - box.x) / scale, y: (found.y - box.y) / scale }]] : []
      }),
    )
  }, PARTS)
}

type Places = Awaited<ReturnType<typeof headerPlaces>>

function expectSamePlaces(left: Places, right: Places, parts: readonly string[]) {
  for (const part of parts) {
    expect(left[part], part).toBeDefined()
    expect(right[part], part).toBeDefined()
    expect(Math.abs(left[part].x - right[part].x), `${part} across`).toBeLessThanOrEqual(1)
    expect(Math.abs(left[part].y - right[part].y), `${part} down`).toBeLessThanOrEqual(1)
  }
}

async function toggleAndSettle(page: Page, n: number) {
  const fold = foldOf(page, n)
  const before = await fold.getAttribute('aria-expanded')
  // By keyboard, which brings a header the camera left off a narrow field into sight.
  await fold.focus()
  await page.keyboard.press('Enter')
  await expect(fold).not.toHaveAttribute('aria-expanded', before ?? '')
  await expect(page.locator('.graph').first()).toHaveAttribute('aria-busy', 'false')
  await expect(page.locator('.graph-canvas.settled')).toBeVisible()
}

for (const width of [1500, 390]) {
  test(`folding an epic moves nothing in its header at ${width}px`, async ({ page }) => {
    await openField(page, width)
    const frame = frameOf(page, OPEN)
    await expect(frame).not.toHaveClass(/folded/u)
    const open = await headerPlaces(frame)
    await toggleAndSettle(page, OPEN)
    await expect(frame).toHaveClass(/folded/u)
    expectSamePlaces(open, await headerPlaces(frame), PARTS)
    await toggleAndSettle(page, OPEN)
    expectSamePlaces(open, await headerPlaces(frame), PARTS)
  })
}

test('a header gives its title two lines of the card’s width and keeps the rest in its names', async ({
  page,
}) => {
  await openField(page)
  const title = frameOf(page, EMPTY).locator('.graph-frame-title')
  const shape = await title.evaluate((element) => {
    const html = element as HTMLElement
    const scale = html.getBoundingClientRect().width / html.offsetWidth
    const line = Number.parseFloat(getComputedStyle(html).lineHeight)
    return {
      lines: Math.round(html.getBoundingClientRect().height / scale / line),
      width: html.offsetWidth,
    }
  })
  expect(shape.lines).toBe(2)
  // Past the 80px the row beside the reference and the state used to leave it.
  expect(shape.width).toBeGreaterThan(200)
  await expect(title).toHaveAttribute('title', LONG_TITLE)
})

test('a header with every group in its counts stays whole and clear of its edge', async ({
  page,
}) => {
  await openField(page)
  const frame = frameOf(page, CROWDED)
  await expect(frame).toHaveClass(/folded/u)
  const shape = await frame.evaluate((element) => {
    const box = (selector: string) =>
      element.querySelector(selector)?.getBoundingClientRect() as DOMRect
    const counts = [...element.querySelectorAll('.graph-frame-count')].map((count) =>
      count.getBoundingClientRect(),
    )
    return {
      frameBottom: element.getBoundingClientRect().bottom,
      frameRight: element.getBoundingClientRect().right,
      titleHeight: box('.graph-frame-title').height,
      titleBottom: box('.graph-frame-title').bottom,
      edgeTop: box('.frame-progress').top,
      edgeBottom: box('.frame-progress').bottom,
      countsTop: Math.min(...counts.map((count) => count.top)),
      countsBottom: Math.max(...counts.map((count) => count.bottom)),
      countsRight: Math.max(...counts.map((count) => count.right)),
    }
  })
  expect(shape.titleHeight).toBeGreaterThan(0)
  expect(shape.titleBottom).toBeLessThanOrEqual(shape.countsTop + 0.5)
  expect(shape.countsBottom).toBeLessThanOrEqual(shape.edgeTop)
  expect(shape.countsRight).toBeLessThanOrEqual(shape.frameRight)
  expect(shape.edgeBottom).toBeLessThanOrEqual(shape.frameBottom)
})

/** Press «Отдалить» until the field draws its overview. */
async function zoomOutToOverview(page: Page) {
  const zoomOut = page.getByRole('button', { name: 'Отдалить', exact: true })
  for (let step = 0; step < 16; step += 1) {
    if ((await page.locator('.graph-frame.overview').count()) > 0) return
    await zoomOut.click()
  }
}

test('zoomed out, a header is its reference and edge, in one place folded and open', async ({
  page,
}) => {
  await openField(page)
  await zoomOutToOverview(page)
  await expect(frameOf(page, OPEN)).toHaveClass(/overview/u)
  await expect(frameOf(page, OPEN)).not.toHaveClass(/folded/u)
  await expect(frameOf(page, CROWDED)).toHaveClass(/folded/u)
  const parts = ['.graph-frame-reference', '.frame-progress']
  expectSamePlaces(
    await headerPlaces(frameOf(page, OPEN)),
    await headerPlaces(frameOf(page, CROWDED)),
    parts,
  )
  const whole = await frameOf(page, CROWDED).evaluate((element) => {
    const box = element.getBoundingClientRect()
    const reference = element.querySelector('.graph-frame-reference')?.getBoundingClientRect()
    const edge = element.querySelector('.frame-progress')?.getBoundingClientRect()
    return (
      reference !== undefined &&
      edge !== undefined &&
      reference.top >= box.top &&
      reference.bottom <= edge.top &&
      reference.left >= box.left &&
      reference.right <= box.right &&
      edge.bottom <= box.bottom
    )
  })
  expect(whole).toBe(true)
})
