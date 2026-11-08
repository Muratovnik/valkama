/**
 * A frame's header says what its number of moving work is, at a distance too, as the built
 * app draws it: «2 working», and where a zoomed-out band has no room for the words, the count
 * beside the working dots, «••• 2». It never gives way whole, since then nothing says work is
 * running, and never as dots alone or a number cut. The header keeps its height, and its name
 * and its hover text say the whole phrase.
 *
 * Served the broad synthetic space with half of the work filed under an epic being worked on,
 * three items under no epic as well, and one epic given the longest reference a space can
 * have. Over the work under no epic the fold is the header's one button, so the fold says it.
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { broadSpace } from '../fixtures/graphSpaces.ts'
import { installBackend } from './backend.ts'
import { graphRoute } from './chainFixtures.ts'
import { settledZoom } from './graphFieldCamera.ts'
import { planningReadFor } from './planningReadFixture.ts'
import { test } from './test.ts'

const LONGEST = 'WWWWWWWW-888888888'

async function serve(page: Page, width = 1500, height = 900) {
  const { model } = broadSpace()
  const filed = model.work_items.filter((item) => !item.state.is_terminal && item.parent_id)
  const unfiled = model.work_items.filter(
    (item) => !item.state.is_terminal && !item.parent_id && !item.container && item.kind !== 'epic',
  )
  const working = [...filed.filter((_, index) => index % 2 === 0), ...unfiled.slice(0, 3)]
  const live = Object.fromEntries(working.map((item) => [item.work_item_id, { state: 'working' }]))
  // The epic of the first worked-on item takes the longest reference.
  const renamed = working[0]?.parent_id
  const items = model.work_items.map((item) =>
    item.work_item_id === renamed ? { ...item, reference: LONGEST } : item,
  )
  await installBackend(page)
  await page.route('**/api/planning?*', async (route) => {
    const response = planningReadFor(new URL(route.request().url()).searchParams)
    if (response.status === 200 && 'work_items' in response.body) {
      const body = response.body as unknown as Record<string, unknown>
      body.workflow = model.workflow
      body.work_items = items
      body.links = model.links
      body.live_work = live
    }
    await route.fulfill({
      status: response.status,
      contentType: 'application/json',
      body: JSON.stringify(response.body),
    })
  })
  await page.setViewportSize({ width, height })
  await page.goto(graphRoute({}))
  await expect(page.locator('.graph-canvas.settled')).toBeVisible()
}

/** Wheel the camera out until it stands under `ceiling`. */
async function zoomUnder(page: Page, ceiling: number) {
  const field = await page.locator('.vue-flow').boundingBox()
  if (!field) throw new Error('no field')
  await page.mouse.move(field.x + field.width / 2, field.y + field.height / 2)
  await expect
    .poll(
      async () => {
        if ((await settledZoom(page)) < ceiling) return true
        await page.keyboard.down('Control')
        await page.mouse.wheel(0, 120)
        await page.keyboard.up('Control')
        return false
      },
      { timeout: 30_000 },
    )
    .toBe(true)
  return settledZoom(page)
}

interface Mark {
  /** The dots are in sight. */
  dots: boolean
  /** The frame's id. */
  frame: string
  /** The header's height, in the field's units. */
  header: number
  /** What the pointer is told on the header. */
  hint: string
  /** What a reader hears for the header's button: the epic's, or the fold under no epic. */
  name: string
  /** The words drawn stand over the reference beside them. */
  overReference: boolean
  reference: string
  /** The reference is cut short. */
  referenceCut: boolean
  /** What the mark draws in words, read off the text in sight. */
  shown: string
  /** The words drawn, read by a Range over them, stand whole inside the mark and the header. */
  shownWhole: boolean
}

/** Every frame's mark of moving work, as it is drawn. */
function marks(page: Page): Promise<Mark[]> {
  return page.locator('.graph-frame:has(.graph-frame-working)').evaluateAll((frames) =>
    frames.map((frame) => {
      const box = (selector: string) => frame.querySelector(selector)?.getBoundingClientRect()
      const shown = box('.graph-frame-working')
      const head = frame.querySelector<HTMLElement>('.graph-frame-head')
      const header = head?.getBoundingClientRect()
      // The words in sight: the mark's phrase, never the copy it measures and nobody sees.
      const words = frame.querySelector('.working-phrase:not(.working-whole)')
      const range = document.createRange()
      if (words) range.selectNodeContents(words)
      const drawn = words ? range.getBoundingClientRect() : undefined
      const dots = box('.work-dots')
      const reference = frame.querySelector<HTMLElement>('.graph-frame-reference')
      const named = reference?.getBoundingClientRect()
      const target =
        frame.querySelector<HTMLElement>('.graph-frame-open[data-walk-target]') ??
        frame.querySelector<HTMLElement>('.graph-frame-fold')
      if (!shown || !drawn || !dots || !header) throw new Error('a mark has its words and dots')
      const within = (part: DOMRect, outer: DOMRect = shown) =>
        part.width > 0 &&
        part.left >= outer.left - 0.5 &&
        part.right <= outer.right + 0.5 &&
        part.top >= outer.top - 0.5 &&
        part.bottom <= outer.bottom + 0.5
      const scale = frame.getBoundingClientRect().width / (frame as HTMLElement).offsetWidth
      const crossing =
        named !== undefined &&
        drawn.left < named.right - 0.5 &&
        drawn.right > named.left + 0.5 &&
        drawn.top < named.bottom - 0.5 &&
        drawn.bottom > named.top + 0.5
      return {
        shown: words?.textContent?.replaceAll(/\s+/gu, ' ').trim() ?? '',
        shownWhole: within(drawn) && within(drawn, header),
        dots: within(dots) && within(dots, header),
        overReference: crossing,
        referenceCut: reference !== null && reference.scrollWidth > reference.clientWidth + 1,
        header: header.height / scale,
        frame: (frame as HTMLElement).dataset.frame ?? '',
        hint: target?.dataset.tooltip ?? '',
        name: target?.getAttribute('aria-label') ?? '',
        reference: reference?.textContent?.trim() ?? '',
      }
    }),
  )
}

/**
 * Each frame's header height in the field's units, by its id: as tall as its lines, which
 * it stays at every zoom.
 */
function headerHeights(page: Page) {
  return page
    .locator('.graph-frame')
    .evaluateAll((frames) =>
      Object.fromEntries(
        frames.map((frame) => [
          (frame as HTMLElement).dataset.frame ?? '',
          (frame.querySelector('.graph-frame-head') as HTMLElement).offsetHeight,
        ]),
      ),
    )
}

function expectHonest(seen: Mark[], near: Record<string, number>) {
  expect(seen.length).toBeGreaterThan(2)
  for (const mark of seen) {
    const where = `the mark of ${mark.reference || 'the work under no epic'}`
    // Whole, or its count beside the dots: never gone, never dots or a number cut.
    expect(mark.shown, where).toMatch(/^\d+(?: working)?$/u)
    expect(mark.shownWhole, `${where} says it in sight`).toBe(true)
    expect(mark.dots, `${where} draws its dots in sight`).toBe(true)
    expect(mark.overReference, `${where} stands over the reference`).toBe(false)
    // The reference is cut only for a mark already as short as it goes.
    if (mark.referenceCut) expect(mark.shown, `${where} cut the reference`).toMatch(/^\d+$/u)
    expect(Math.round(mark.header), `${where}: the header's height`).toBe(near[mark.frame])
    const count = /^\d+/u.exec(mark.shown)?.[0] ?? ''
    expect(mark.hint, `${where}: the hover text`).toContain(`${count} working`)
    expect(mark.name, `${where}: the button's name`).toContain(`${count} working`)
  }
}

// A window small enough that the whole field fits only far out, where the band grows more.
for (const { band, ceiling, height, width } of [
  { band: 'overview', ceiling: 0.4, width: 1500, height: 900 },
  { band: 'far', ceiling: 0.22, width: 760, height: 560 },
] as const) {
  test(`zoomed out (${band}) every frame with work moving says so, whole or by its count`, async ({
    page,
  }) => {
    await serve(page, width, height)
    const near = await headerHeights(page)
    const zoom = await zoomUnder(page, ceiling)
    expect(zoom).toBeLessThan(ceiling)
    await expect(page.locator('.graph-frame.overview').first()).toBeAttached()
    const seen = await marks(page)
    expectHonest(seen, near)
    // A frame with room says it whole, and the longest reference leaves its frame the mark.
    expect(seen.filter((mark) => mark.shown.endsWith(' working')).length).toBeGreaterThan(0)
    expect(seen.map((mark) => mark.reference)).toContain(LONGEST)
    expect(
      seen.map((mark) => mark.frame),
      'the work under no epic',
    ).toContain('none')
  })
}

test('close up the mark says its words beside its dots, and names no hover text', async ({
  page,
}) => {
  await serve(page)
  const seen = await marks(page)
  expect(seen.length).toBeGreaterThan(0)
  expect(
    seen.map((mark) => mark.frame),
    'the work under no epic',
  ).toContain('none')
  for (const mark of seen) {
    expect(mark.shown).toMatch(/^\d+ working$/u)
    expect(mark.shownWhole && mark.dots).toBe(true)
    expect(mark.hint).toBe('')
    expect(mark.name).toContain(mark.shown)
  }
})
