/**
 * The face a frame's fold draws under the pointer and the keyboard, read off the pixels it
 * paints: it never lies on another element's words or on the header's edge (the progress
 * bar), in a frame with an epic and in the work under no epic, at the scale the field opens
 * at and zoomed out to the band, at 390px and 1280px. Zoomed out, the band of the work under
 * no epic still answers a press anywhere over it and in the air above it.
 *
 * Served the broad synthetic space.
 */
import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import { openBroadField, settledCamera, zoomOutButton } from './graphFieldCamera.ts'
import { movedSince, picture } from './graphPixels.ts'
import type { Box } from './graphPixels.ts'
import { test } from './test.ts'

/** Two frames, so a change has painted. */
const painted = (page: Page) =>
  page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  )

/**
 * What of a header is someone else's than the fold's: each line of its words, read by a
 * Range over every text the fold does not hold, and the edge's box.
 */
function othersOf(head: Locator) {
  return head.evaluate((element) => {
    const fold = element.querySelector('.graph-frame-fold')
    const words: { box: Box; text: string }[] = []
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node.textContent?.trim() ?? ''
      const parent = node.parentElement
      if (!text || !parent || fold?.contains(node) || parent.closest('.working-whole')) continue
      const range = document.createRange()
      range.selectNodeContents(node)
      for (const rect of range.getClientRects())
        if (rect.width > 0) words.push({ box: rect.toJSON() as Box, text })
    }
    const bar = element.querySelector('.frame-progress')?.getBoundingClientRect()
    const head = element.getBoundingClientRect()
    return {
      words,
      bar: bar ? (bar.toJSON() as Box) : null,
      chevron: (fold?.querySelector('svg')?.getBoundingClientRect().toJSON() ?? null) as Box | null,
      area: {
        left: Math.max(0, head.left - 8),
        right: Math.min(window.innerWidth, head.right + 8),
        top: Math.max(0, head.top - 8),
        bottom: Math.min(window.innerHeight, head.bottom + 8),
      },
    }
  })
}

const inside = ([x, y]: [number, number], box: Box) =>
  x >= box.left && x <= box.right && y >= box.top && y <= box.bottom

/**
 * The fold's face in one state against the header at rest, at the same camera: the state is
 * drawn first and the rest after it, since a fold the keyboard reaches may move the camera.
 */
async function expectFaceOff(page: Page, head: Locator, state: string, enter: () => Promise<void>) {
  await enter()
  await settledCamera(page)
  await painted(page)
  const drawn = await othersOf(head)
  const now = await picture(page, drawn.area)
  await page.mouse.move(0, 0)
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  await painted(page)
  const rest = await picture(page, drawn.area)
  const face = await movedSince(page, drawn.area, [now, rest], false)
  expect(face.length, `${state}: the fold draws a face`).toBeGreaterThan(0)
  expect(
    face.some((point) => inside(point, drawn.chevron as Box)),
    `${state}: the face is the chevron's`,
  ).toBe(true)
  for (const word of drawn.words)
    expect(
      face.filter((point) => inside(point, word.box)),
      `${state}: the face over «${word.text}»`,
    ).toEqual([])
  expect(drawn.bar, `${state}: the header draws its edge`).not.toBeNull()
  expect(
    face.filter((point) => inside(point, drawn.bar as Box)),
    `${state}: the face over the edge`,
  ).toEqual([])
}

/** The fold under the pointer, at its chevron and, where given, at another point. */
async function expectEveryFace(page: Page, head: Locator, where: string, over?: [number, number]) {
  const fold = head.locator('.graph-frame-fold')
  await expectFaceOff(page, head, `${where}, the chevron hovered`, async () => {
    const box = await fold.boundingBox()
    if (!box) throw new Error('no fold')
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  })
  if (over)
    await expectFaceOff(page, head, `${where}, the band hovered`, () => page.mouse.move(...over))
  await expectFaceOff(page, head, `${where}, focused by the keyboard`, async () => {
    await page.keyboard.press('Shift')
    await fold.focus()
    expect(await fold.evaluate((element) => element.matches(':focus-visible'))).toBe(true)
  })
}

/** The heads whose fold and whole header stand inside the field. */
async function headsInSight(page: Page, selector: string) {
  const field = await page.locator('.vue-flow').boundingBox()
  if (!field) throw new Error('no field')
  const heads = page.locator(selector)
  const found: Locator[] = []
  for (let index = 0; index < (await heads.count()); index += 1) {
    const box = await heads.nth(index).boundingBox()
    if (
      box &&
      box.x >= field.x &&
      box.y >= field.y &&
      box.x + box.width <= field.x + field.width &&
      box.y + box.height <= field.y + field.height
    )
      found.push(heads.nth(index))
  }
  return found
}

/** The band of the work under no epic, zoomed out, and its fold: the band's one button. */
const BAND = '.vue-flow .graph-frame-head.overview:has(.graph-frame-fold[data-walk-target])'
const BAND_FOLD = `${BAND} .graph-frame-fold`

/** Drag the field from a point of its empty ground so that `target` stands in its middle. */
async function toMiddle(page: Page, target: Locator) {
  const { from, by } = await target.evaluate((element) => {
    const field = (document.querySelector('.vue-flow') as Element).getBoundingClientRect()
    const box = element.getBoundingClientRect()
    const points: [number, number][] = []
    for (let y = field.bottom - 8; y > field.top; y -= 12)
      for (let x = field.right - 8; x > field.left; x -= 12) points.push([x, y])
    const ground = points.find(([x, y]) =>
      document.elementFromPoint(x, y)?.classList.contains('vue-flow__pane'),
    ) ?? [field.left + 4, field.bottom - 4]
    return {
      from: ground,
      by: [
        field.left + field.width / 2 - (box.left + box.width / 2),
        field.top + field.height / 2 - (box.top + box.height / 2),
      ],
    }
  })
  await page.mouse.move(from[0], from[1])
  await page.mouse.down()
  await page.mouse.move(from[0] + by[0], from[1] + by[1], { steps: 12 })
  await page.mouse.up()
}

/**
 * Zoomed out: no band's words on its edge at rest, and the band of the work under no epic
 * answering a press over its middle, its far corner and the air above it, with its fold's
 * face off its words and its edge.
 */
async function expectBand(page: Page, where: string) {
  for (const each of await headsInSight(page, '.vue-flow .graph-frame-head.overview')) {
    const { bar, words } = await othersOf(each)
    const onBar = words.filter(
      ({ box }) =>
        bar !== null &&
        box.left < bar.right &&
        box.right > bar.left &&
        box.top < bar.bottom &&
        box.bottom > bar.top,
    )
    expect(
      onBar.map(({ text }) => text),
      `${where}: words on the edge at rest`,
    ).toEqual([])
  }
  const [head] = await headsInSight(page, BAND)
  expect(head, `${where}: the band of the work under no epic is in sight`).toBeDefined()
  const band = (await head.boundingBox()) as { height: number; width: number; x: number; y: number }
  const middle: [number, number] = [band.x + band.width / 2, band.y + band.height / 2]
  // The air above at half the 36 field units the reach runs into, at the scale drawn.
  const answers = await head.evaluate(
    (element, [centre, corner]) => {
      const fold = element.querySelector('.graph-frame-fold') as Element
      const box = element.getBoundingClientRect()
      const above: [number, number] = [
        centre[0],
        box.top - (18 * box.height) / (element as HTMLElement).offsetHeight,
      ]
      return [centre, corner, above].map(([x, y]) => fold.contains(document.elementFromPoint(x, y)))
    },
    [middle, [band.x + band.width - 4, band.y + 4]] as const,
  )
  expect(answers, `${where}: the middle, the far corner and the air above`).toEqual([
    true,
    true,
    true,
  ])
  await expectEveryFace(page, head, where, middle)
}

for (const width of [390, 1280]) {
  test(`at ${width}px a fold's face at the opening scale lies on no words and no edge`, async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await openBroadField(page, width)
    await settledCamera(page)
    const heads = await headsInSight(page, '.vue-flow .graph-frame-head:has(.graph-frame-fold)')
    expect(heads.length).toBeGreaterThan(0)
    for (const head of heads.slice(0, 3)) await expectEveryFace(page, head, `at ${width}px`)
  })

  test(`at ${width}px, zoomed out, the fold of the work under no epic lies on none of its band's words and answers over the band, whose words keep off its edge`, async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await openBroadField(page, width)
    await settledCamera(page)
    await expect
      .poll(async () => {
        if ((await page.locator('.graph-frame.overview').count()) > 0) return true
        await zoomOutButton(page).click()
        await settledCamera(page)
        return false
      })
      .toBe(true)
    // The keyboard brings the band into sight, and a drag to the field's middle.
    await page.keyboard.press('Shift')
    await page.locator(BAND_FOLD).focus()
    await settledCamera(page)
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
    await toMiddle(page, page.locator(BAND))
    await settledCamera(page)
    await expectBand(page, `at ${width}px in the overview`)
  })
}
