/**
 * An epic's header as the built app lays it out: it is one header whether the
 * frame is folded or open, an epic with no tasks says so and offers nothing to
 * open, and the title is the thing a header leaves room for.
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

/** The longest reference the read model takes, on a card. */
const LONG_REFERENCE = 'LONGKEYS-123456789'
/** An ordinary reference, on a card with work live on it. */
const LIVE_REFERENCE = 'MAIN-123'

/** An open epic with two open tasks among finished ones: it starts open. */
const OPEN = 1
/** An open epic nothing was ever filed under. */
const EMPTY = 10
/** An open epic whose every task is finished: «Open» hides them all. */
const FINISHED = 20
/** An open epic with so much open work that it starts folded, and every group in its counts. */
const CROWDED = 40

function underEpic(parent: number, from: number, keys: readonly string[]): WorkItemBrief[] {
  return keys.map((key, index) => item(from + index, key, { parent_id: identity(parent) }))
}

const repeat = (key: string, count: number) => Array.from({ length: count }, () => key)

const SPACE: WorkItemBrief[] = [
  item(OPEN, 'dev', { kind: 'epic', container: true, title: LONG_TITLE }),
  item(2, 'todo', { parent_id: identity(OPEN), reference: LONG_REFERENCE }),
  item(3, 'dev', { parent_id: identity(OPEN), reference: LIVE_REFERENCE }),
  ...underEpic(OPEN, 4, ['done', 'done', 'done']),
  item(EMPTY, 'review', { kind: 'epic', title: LONG_TITLE }),
  item(FINISHED, 'dev', { kind: 'epic', container: true, title: 'Connect the release' }),
  ...underEpic(FINISHED, 21, repeat('done', 7)),
  item(CROWDED, 'dev', { kind: 'epic', container: true, title: LONG_TITLE }),
  ...underEpic(CROWDED, 100, [
    ...repeat('done', 120),
    ...repeat('review', 12),
    ...repeat('dev', 12),
    ...repeat('blocked', 12),
    ...repeat('backlog', 30),
  ]),
  // The work under no epic, past the threshold, so it starts folded with its one button.
  ...Array.from({ length: 25 }, (_, index) => item(400 + index, 'todo')),
]

/** The same space among enough other epics that its whole field is far out. */
const AMONG_MANY: WorkItemBrief[] = [
  ...SPACE,
  ...Array.from({ length: 90 }, (_, index) => item(1000 + index, 'review', { kind: 'epic' })),
]

async function serveSpace(page: Page, items = SPACE) {
  await installBackend(page)
  await page.route('**/api/planning?*', async (route) => {
    const response = planningReadFor(new URL(route.request().url()).searchParams)
    if (response.status === 200 && 'work_items' in response.body) {
      const body = response.body as unknown as Record<string, unknown>
      body.workflow = model.workflow
      body.work_items = items
      body.links = []
      body.live_work = { [identity(3)]: { state: 'working' } }
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
const heightOf = (frame: Locator) =>
  frame.evaluate((element) => (element as HTMLElement).offsetHeight)

async function openField(page: Page, width = 1500, items = SPACE) {
  await page.setViewportSize({ width, height: 900 })
  await serveSpace(page, items)
  await page.goto(graphRoute({}))
  await expect(page.locator('.graph-canvas.settled')).toBeVisible()
  await expect(frameOf(page, OPEN)).toHaveCount(1)
}

/** The parts a header's places are read for. */
const PARTS = [
  '.graph-frame-reference',
  '.graph-frame-title',
  '.graph-frame-counts .graph-frame-count',
  '.frame-progress',
]
/** And the work moving under a frame that has some. */
const LIVE_PARTS = [...PARTS, '.graph-frame-working']

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
  }, LIVE_PARTS)
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
    expectSamePlaces(open, await headerPlaces(frame), LIVE_PARTS)
    await toggleAndSettle(page, OPEN)
    expectSamePlaces(open, await headerPlaces(frame), LIVE_PARTS)
  })

  test(`an epic with no tasks says so, draws no edge and offers nothing to open at ${width}px`, async ({
    page,
  }) => {
    await openField(page, width)
    const frame = frameOf(page, EMPTY)
    await expect(frame.locator('.graph-frame-count')).toHaveText(['Нет задач'])
    await expect(frame.locator('.frame-progress')).toHaveCount(0)
    await expect(foldOf(page, EMPTY)).toHaveCount(0)
    await expect(frame.locator('button.graph-frame-open')).toHaveAccessibleName(
      `Эпик MAIN-${EMPTY} «${LONG_TITLE}» · Нет задач`,
    )
    // As tall as its own lines: its counts and the header's padding, no room for an edge.
    const [height, lines] = await frame.evaluate((element) => {
      const counts = element.querySelector('.graph-frame-counts') as HTMLElement
      const head = element.querySelector('.graph-frame-head') as HTMLElement
      const padding = Number.parseFloat(getComputedStyle(head).paddingBottom)
      return [
        (element as HTMLElement).offsetHeight,
        counts.offsetTop + counts.offsetHeight + padding,
      ]
    })
    expect(height).toBeCloseTo(lines, 0)
  })
}

test('the keyboard walks past the fold an epic with no tasks does not have', async ({ page }) => {
  await openField(page)
  await page.locator(`[data-walk-target="frame:${identity(EMPTY)}"]`).focus()
  await page.keyboard.press('ArrowLeft')
  // Wherever the arrow lands, it is a button the field draws and never this frame's fold.
  const landed = await page.evaluate(
    () => (document.activeElement as HTMLElement | null)?.dataset.walkTarget ?? '',
  )
  expect(landed).not.toBe(`frame:${identity(EMPTY)}:fold`)
  await expect(page.locator('.graph-flow [tabindex="0"]')).toHaveCount(1)
})

test('a stored «open» leaves a frame with nothing to draw looking like any other', async ({
  page,
}) => {
  await openField(page)
  const before = await headerPlaces(frameOf(page, FINISHED))
  const height = await heightOf(frameOf(page, EMPTY))
  // A toggle shows the key the choices are stored under; the rest is what an
  // earlier version, which offered these frames a fold, could have left there.
  await toggleAndSettle(page, OPEN)
  await page.evaluate(
    ([empty, finished]) => {
      const stored = JSON.parse(localStorage.getItem('valkama-graph-frames') ?? '{}') as Record<
        string,
        Record<string, boolean>
      >
      for (const space of Object.values(stored)) {
        space[empty] = false
        space[finished] = false
      }
      localStorage.setItem('valkama-graph-frames', JSON.stringify(stored))
    },
    [identity(EMPTY), identity(FINISHED)],
  )
  await page.reload()
  await expect(page.locator('.graph-canvas.settled')).toBeVisible()
  await expect(frameOf(page, EMPTY)).toHaveClass(/folded/u)
  await expect(frameOf(page, FINISHED)).toHaveClass(/folded/u)
  await expect(foldOf(page, EMPTY)).toHaveCount(0)
  await expect(foldOf(page, FINISHED)).toHaveCount(0)
  expect(await heightOf(frameOf(page, EMPTY))).toBe(height)
  expectSamePlaces(before, await headerPlaces(frameOf(page, FINISHED)), PARTS)
})

test('work the view hides is still counted, and is offered once the view can draw it', async ({
  page,
}) => {
  await openField(page)
  const frame = frameOf(page, FINISHED)
  // «Open» hides all seven finished tasks: the count stays the epic's own, the
  // edge full, and there is nothing to unfold until «All» draws them.
  await expect(frame.locator('.graph-frame-count')).toHaveText(['7 из 7 выполнено'])
  await expect(frame.locator('.frame-progress')).toHaveCount(1)
  await expect(foldOf(page, FINISHED)).toHaveCount(0)
  await page.getByRole('radio', { name: /^Все/u }).click()
  await expect(foldOf(page, FINISHED)).toHaveCount(1)
  await expect(frame.locator('.graph-frame-count')).toHaveText(['7 из 7 выполнено'])
  await foldOf(page, FINISHED).focus()
  await page.keyboard.press('Enter')
  await expect(page.locator(`.flow-node-card[data-walk-target="${identity(21)}"]`)).toHaveCount(1)
})

test('a filter that finds nothing in an epic draws no «no tasks» for it', async ({ page }) => {
  await openField(page)
  await page.getByPlaceholder('Фильтр: номер, название…').fill(LIVE_REFERENCE)
  await expect(page.locator('.graph-flow .flow-node-card')).toHaveCount(1)
  await expect(page.getByText('Нет задач', { exact: true })).toHaveCount(0)
  // The frame the filter found its card in still counts its whole epic.
  await expect(
    frameOf(page, OPEN).locator('.graph-frame-counts .graph-frame-count').first(),
  ).toHaveText('3 из 5 выполнено')
})

test('a header gives its title three lines of the card’s width and keeps the rest in its names', async ({
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
  // This title's eighty letters stand whole, where the row beside the reference
  // and the state used to leave it 80px.
  expect(shape.lines).toBe(3)
  expect(shape.width).toBeGreaterThan(200)
  expect(await title.evaluate((element) => element.scrollHeight <= element.clientHeight)).toBe(true)
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

/**
 * The field among many, as far out as it goes. The camera stops at the whole field, and on
 * its own this space fits too near for the overview.
 */
async function openFarField(page: Page) {
  await openField(page, 1500, AMONG_MANY)
  await page.getByRole('button', { name: 'Весь граф', exact: true }).click()
  await expect(page.locator('.graph-frame.far').first()).toBeVisible()
}

/** Press «Приблизить» until the field is no longer far out. */
async function nearerThanFar(page: Page) {
  const zoomIn = page.getByRole('button', { name: 'Приблизить', exact: true })
  for (let step = 0; step < 16 && (await page.locator('.graph-frame.far').count()) > 0; step += 1)
    await zoomIn.click()
}

/** Where a header's edge starts across, and how far over the header's foot it ends. */
function edgeAtFoot(page: Page, n: number) {
  return frameOf(page, n).evaluate((element) => {
    const box = element.getBoundingClientRect()
    const scale = box.width / (element as HTMLElement).offsetWidth
    const head = (element.querySelector('.graph-frame-head') as HTMLElement).getBoundingClientRect()
    const edge = (element.querySelector('.frame-progress') as HTMLElement).getBoundingClientRect()
    return { x: (edge.x - box.x) / scale, rise: (head.bottom - edge.bottom) / scale }
  })
}

test('zoomed out, a header is its reference and edge, in one place folded and open', async ({
  page,
}) => {
  await openFarField(page)
  // Far out a count takes a reference's place, so the places are read a step nearer.
  await nearerThanFar(page)
  await expect(frameOf(page, OPEN)).toHaveClass(/overview/u)
  await expect(frameOf(page, OPEN)).not.toHaveClass(/folded/u)
  await expect(frameOf(page, CROWDED)).toHaveClass(/folded/u)
  expectSamePlaces(
    await headerPlaces(frameOf(page, OPEN)),
    await headerPlaces(frameOf(page, CROWDED)),
    ['.graph-frame-reference'],
  )
  // Each header is as tall as its own lines, so the edge is read from the header's foot.
  const [open, folded] = await Promise.all([edgeAtFoot(page, OPEN), edgeAtFoot(page, CROWDED)])
  expect(Math.abs(open.x - folded.x), 'the edge across').toBeLessThanOrEqual(1)
  expect(Math.abs(open.rise - folded.rise), 'the edge over the foot').toBeLessThanOrEqual(1)
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
  // An epic with no tasks keeps its reference and draws no empty edge out here too.
  const empty = frameOf(page, EMPTY)
  await expect(empty.locator('.graph-frame-reference')).toBeVisible()
  await expect(empty.locator('.frame-progress')).toHaveCount(0)
})

test('a folded epic says what it hides, counted by the epic and not by a filter', async ({
  page,
}) => {
  await openField(page)
  const frame = frameOf(page, CROWDED)
  await expect(frame.locator('.graph-frame-inside')).toHaveText('66 открытых внутри')
  await expect(foldOf(page, CROWDED)).toHaveAccessibleName(/ · 66 открытых внутри$/u)
  await expect(frame.locator('button.graph-frame-open')).toHaveAccessibleName(
    /· 66 открытых внутри$/u,
  )
  // A filter opens the frame it found work in; folded again, it counts the epic.
  await page.getByPlaceholder('Фильтр: номер, название…').fill('MAIN-225')
  await expect(page.locator('.graph-frame')).toHaveCount(1)
  await toggleAndSettle(page, CROWDED)
  await expect(frame).toHaveClass(/folded/u)
  await expect(frame.locator('.graph-frame-inside')).toHaveText('66 открытых внутри')
})

/** How far up and down a line through the header's left a press reaches its button. */
async function targetOf(frame: Locator, target: string) {
  return frame.evaluate((element, id) => {
    const box = element.getBoundingClientRect()
    const scale = box.width / (element as HTMLElement).offsetWidth
    const x = box.left + 6 * scale
    const header = (element.querySelector('.graph-frame-head') as HTMLElement).offsetHeight
    let height = 0
    for (let y = box.top - 80 * scale; y < box.top + 300 * scale; y += 0.25) {
      const hit = document.elementFromPoint(x, y)
      if (hit?.closest<HTMLElement>('[data-walk-target]')?.dataset.walkTarget === id) height += 0.25
    }
    return { field: height / scale, header, screen: height, scale }
  }, target)
}

test('zoomed far out, a header is a target as tall as it stands with the air round it', async ({
  page,
}) => {
  await openFarField(page)
  const folded = await targetOf(frameOf(page, CROWDED), `frame:${identity(CROWDED)}`)
  const open = await targetOf(frameOf(page, OPEN), `frame:${identity(OPEN)}`)
  // The header as tall as its lines, and of the 36 of air above and below it what no
  // neighbour's target takes, 40 of the 72, in the field's own units.
  expect(folded.field).toBeGreaterThanOrEqual(folded.header + 40)
  expect(open.field).toBeGreaterThanOrEqual(open.header + 40)
  await expect(frameOf(page, CROWDED).locator('.graph-frame-inside')).toHaveText('+66')
  const loose = page.locator('.graph-frame[data-frame="none"]')
  await expect(loose.locator('.graph-frame-inside')).toHaveText('+25')
  const looseTarget = await targetOf(loose, 'frame:none:fold')
  expect(looseTarget.field).toBeGreaterThanOrEqual(looseTarget.header + 40)
  await expect(frameOf(page, CROWDED).locator('button.graph-frame-open')).toHaveAccessibleName(
    /· 66 открытых внутри$/u,
  )
})

test('zoomed out, a card keeps the longest reference inside itself', async ({ page }) => {
  await openFarField(page)
  const card = page.locator(`.flow-node-card[data-walk-target="${identity(2)}"]`)
  const inside = await card.evaluate((element) => {
    const box = element.getBoundingClientRect()
    const reference = element.querySelector('.flow-node-overview-reference')
    const drawn = reference?.getBoundingClientRect()
    return drawn !== undefined && drawn.right <= box.right
  })
  expect(inside).toBe(true)
  await expect(card).toHaveAccessibleName(new RegExp(`^${LONG_REFERENCE} `, 'u'))
  // An ordinary reference stands whole.
  const name = page
    .locator(`.flow-node-card[data-walk-target="${identity(3)}"]`)
    .locator('.flow-node-overview-reference')
  // Within the pixel an integer width rounds off, as the suite's clipping check allows.
  expect(await name.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThan(
    2,
  )
})
