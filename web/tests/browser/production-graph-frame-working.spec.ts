/**
 * A frame's header says what its number of moving work is, in words, at a distance too, as
 * the built app draws it: «2 working» and never three dots and a number with nothing to say
 * what they count. Short of room the mark gives way whole, the header keeps its height, and
 * its name and its hover text still say it.
 *
 * Served the broad synthetic space with half of the work filed under an epic being worked on,
 * and one epic given the longest reference a space can have.
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
/** The height of a frame's header, in the field's units, at every zoom. */
const FRAME_HEADER = 160

async function serve(page: Page, width = 1500, height = 900) {
  const { model } = broadSpace()
  const filed = model.work_items.filter((item) => !item.state.is_terminal && item.parent_id)
  const working = filed.filter((_, index) => index % 2 === 0)
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
  /** The header's height, in the field's units. */
  header: number
  /** What the pointer is told on the header. */
  hint: string
  /** The phrase stands over the reference beside it. */
  overReference: boolean
  /** The phrase the mark holds, whether or not it is in sight. */
  phrase: string
  /** Some of the phrase, and not all of it, is in sight. */
  phrasePart: boolean
  /** Every part of the phrase stands inside what the mark shows. */
  phraseWhole: boolean
  reference: string
}

/** Every frame's mark of moving work, as it is drawn. */
function marks(page: Page): Promise<Mark[]> {
  return page.locator('.graph-frame:has(.graph-frame-working)').evaluateAll((frames) =>
    frames.map((frame) => {
      const box = (selector: string) => frame.querySelector(selector)?.getBoundingClientRect()
      const shown = box('.graph-frame-working')
      // What the mark says: its phrase, or all of its text where it has no phrase of its own.
      const words =
        frame.querySelector('.working-phrase') ?? frame.querySelector('.graph-frame-working')
      const phrase = words?.getBoundingClientRect()
      const dots = box('.work-dots')
      const reference = box('.graph-frame-reference')
      if (!shown || !phrase || !dots) throw new Error('a mark has its phrase and its dots')
      const inside = (part: DOMRect) =>
        part.left >= shown.left - 0.5 &&
        part.right <= shown.right + 0.5 &&
        part.top >= shown.top - 0.5 &&
        part.bottom <= shown.bottom + 0.5
      const outside = (part: DOMRect) =>
        part.right <= shown.left + 0.5 ||
        part.left >= shown.right - 0.5 ||
        part.bottom <= shown.top + 0.5 ||
        part.top >= shown.bottom - 0.5
      const head = frame.querySelector<HTMLElement>('.graph-frame-head')
      const scale = frame.getBoundingClientRect().width / (frame as HTMLElement).offsetWidth
      const crossing =
        reference !== undefined &&
        inside(phrase) &&
        phrase.left < reference.right - 0.5 &&
        phrase.right > reference.left + 0.5 &&
        phrase.top < reference.bottom - 0.5 &&
        phrase.bottom > reference.top + 0.5
      return {
        phrase: words?.textContent?.replaceAll(/\s+/gu, ' ').trim() ?? '',
        phraseWhole: inside(phrase),
        phrasePart: !inside(phrase) && !outside(phrase),
        dots: !outside(dots),
        overReference: crossing,
        header: (head?.getBoundingClientRect().height ?? 0) / scale,
        hint: frame.querySelector('.graph-frame-open')?.getAttribute('title') ?? '',
        reference: frame.querySelector('.graph-frame-reference')?.textContent?.trim() ?? '',
      }
    }),
  )
}

function expectHonest(seen: Mark[]) {
  expect(seen.length).toBeGreaterThan(2)
  for (const mark of seen) {
    const where = `the mark of ${mark.reference || 'the work under no epic'}`
    expect(mark.phrase, where).toMatch(/^\d+ working$/u)
    expect(mark.phrasePart, `${where} is cut`).toBe(false)
    // Dots say nothing without the words beside them.
    expect(mark.dots && !mark.phraseWhole, `${where} shows its dots alone`).toBe(false)
    expect(mark.overReference, `${where} stands over the reference`).toBe(false)
    expect(Math.round(mark.header), `${where}: the header's height`).toBe(FRAME_HEADER)
    expect(mark.hint, `${where}: the hover text`).toContain(mark.phrase)
  }
}

// A window small enough that the whole field fits only far out, where the band grows more.
for (const { band, ceiling, height, longest, width } of [
  { band: 'overview', ceiling: 0.4, width: 1500, height: 900, longest: true },
  // Far out the band has no second row, so the longest reference leaves no room.
  { band: 'far', ceiling: 0.22, width: 760, height: 560, longest: false },
] as const) {
  test(`zoomed out (${band}) a frame says what its number counts, or gives way whole`, async ({
    page,
  }) => {
    await serve(page, width, height)
    const zoom = await zoomUnder(page, ceiling)
    expect(zoom).toBeLessThan(ceiling)
    await expect(page.locator('.graph-frame.overview').first()).toBeAttached()
    const seen = await marks(page)
    expectHonest(seen)
    // A frame with room says it whole, the longest reference's among them where its band
    // has a second row to give.
    expect(seen.filter((mark) => mark.phraseWhole).length).toBeGreaterThan(0)
    expect(seen.find((mark) => mark.reference === LONGEST)?.phraseWhole).toBe(longest)
  })
}

test('close up the mark says its words beside its dots, and names no hover text', async ({
  page,
}) => {
  await serve(page)
  const seen = await marks(page)
  expect(seen.length).toBeGreaterThan(0)
  for (const mark of seen) {
    expect(mark.phrase).toMatch(/^\d+ working$/u)
    expect(mark.phraseWhole && mark.dots).toBe(true)
    expect(mark.hint).toBe('')
  }
})
