/**
 * An epic frame's header as the hand and the keyboard meet it, at the scale the field opens
 * at and in screen pixels, through the transform the page applies.
 *
 * The fold is a square target of 28px under a fine pointer and 44px under a finger or on a
 * phone's width, and reaches none of the epic's words; the epic's button is no smaller than
 * 24px either way. Each control's ring, read off the pixels it draws, encloses its own
 * drawing with air round it and never the other control, folded and open; at rest and under
 * the pointer neither draws one, and the epic's face under the pointer leaves the chevron
 * alone.
 *
 * Served the broad synthetic space, which opens at the least scale a field is read at.
 */
import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import { camera, openBroadField, settledCamera } from './graphFieldCamera.ts'
import { test } from './test.ts'

interface Box {
  bottom: number
  left: number
  right: number
  top: number
}

/**
 * The headers whose fold, with a target of `least` pixels reaching up and back from it, stands
 * inside the field.
 */
async function foldedInSight(page: Page, least: number): Promise<Locator[]> {
  const field = await page.locator('.vue-flow').boundingBox()
  if (!field) throw new Error('no field')
  const heads = page.locator('.vue-flow .graph-frame-head:has(.graph-frame-fold)')
  const found: Locator[] = []
  for (let index = 0; index < (await heads.count()); index += 1) {
    const box = await heads.nth(index).locator('.graph-frame-fold').boundingBox()
    if (
      box &&
      box.x + box.width - least > field.x &&
      box.y + box.height - least > field.y &&
      box.x + 40 < field.x + field.width &&
      box.y + box.height < field.y + field.height
    )
      found.push(heads.nth(index))
  }
  return found
}

/** The square of points round the fold that a press there gives to the fold, by hit test. */
function foldTarget(head: Locator) {
  return head.evaluate((element) => {
    const fold = element.querySelector('.graph-frame-fold') as HTMLElement
    const box = fold.getBoundingClientRect()
    let hits = 0
    const seen = { left: Infinity, right: -Infinity, top: Infinity, bottom: -Infinity }
    for (let y = Math.floor(box.top - 70); y < box.bottom + 10; y += 1)
      for (let x = Math.floor(box.left - 70); x < box.right + 10; x += 1) {
        const hit = document.elementFromPoint(x + 0.5, y + 0.5)
        if (hit === null || !fold.contains(hit)) continue
        hits += 1
        seen.left = Math.min(seen.left, x)
        seen.right = Math.max(seen.right, x + 1)
        seen.top = Math.min(seen.top, y)
        seen.bottom = Math.max(seen.bottom, y + 1)
      }
    const width = seen.right - seen.left
    const height = seen.bottom - seen.top
    // The epic's words: a press on any of them is never the fold's.
    const open = element.querySelector('.graph-frame-open') as HTMLElement
    const words = [
      ...open.querySelectorAll('.graph-frame-reference, .graph-frame-title, .graph-frame-count'),
    ]
    const stolen = words.filter((word) => {
      const range = document.createRange()
      range.selectNodeContents(word)
      const drawn = range.getBoundingClientRect()
      const points = [
        [drawn.left + 1, drawn.top + 1],
        [drawn.left + 1, drawn.bottom - 1],
        [(drawn.left + drawn.right) / 2, (drawn.top + drawn.bottom) / 2],
      ]
      return points.some(([x, y]) => fold.contains(document.elementFromPoint(x, y)))
    })
    const epic = open.getBoundingClientRect()
    return {
      filled: hits / (width * height),
      height,
      width,
      stolen: stolen.map((word) => word.textContent?.trim() ?? ''),
      epic: { width: epic.width, height: epic.height },
    }
  })
}

for (const { least, touch, width } of [
  { width: 1280, touch: false, least: 28 },
  { width: 1280, touch: true, least: 44 },
  { width: 390, touch: false, least: 44 },
]) {
  test.describe(`${touch ? 'under a finger' : 'under a mouse'} at ${width}px`, () => {
    test.use({ hasTouch: touch })

    test(`at ${width}px a fold is a ${least}px square at the opening scale, and the epic's words stay the epic's`, async ({
      page,
    }) => {
      await openBroadField(page, width)
      await settledCamera(page)
      expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(touch)
      const { zoom } = await camera(page)
      // The field opens at a reading scale, never further out than 0.75.
      expect(zoom).toBeGreaterThanOrEqual(0.75)
      const heads = await foldedInSight(page, least)
      expect(heads.length).toBeGreaterThan(0)
      for (const head of heads) {
        const target = await foldTarget(head)
        const where = `a fold at ${zoom}`
        expect(target.width, `${where}: across`).toBeGreaterThanOrEqual(least)
        expect(target.height, `${where}: down`).toBeGreaterThanOrEqual(least)
        // A square, not a ragged patch whose corners happen to span it.
        expect(target.filled, `${where}: filled`).toBeGreaterThan(0.98)
        expect(target.stolen, `${where}: the epic's words`).toEqual([])
        expect(target.epic.width).toBeGreaterThanOrEqual(24)
        expect(target.epic.height).toBeGreaterThanOrEqual(24)
      }
    })
  })
}

/** A picture of `area`, as the page draws it now. */
async function picture(page: Page, area: Box) {
  const shot = await page.screenshot({
    clip: {
      x: area.left,
      y: area.top,
      width: area.right - area.left,
      height: area.bottom - area.top,
    },
  })
  return shot.toString('base64')
}

/**
 * The points of `area`, in page units, that changed since `rest` by more than a raster's
 * shimmer, a step of a few levels on an edge's softened pixels. With `ring`, only those that
 * took the focus ring's colour: read against the same control under the pointer, the ring as
 * drawn, and nothing the header draws blue either way, its edge, its state or its live work.
 */
function movedSince(page: Page, area: Box, pictures: [string, string], ring: boolean) {
  return page.evaluate(
    async ({ pair, box, only }) => {
      const pixels = await Promise.all(
        pair.map(async (source) => {
          const image = new Image()
          image.src = `data:image/png;base64,${source}`
          await image.decode()
          const canvas = document.createElement('canvas')
          canvas.width = image.width
          canvas.height = image.height
          const context = canvas.getContext('2d') as CanvasRenderingContext2D
          context.drawImage(image, 0, 0)
          return {
            data: context.getImageData(0, 0, image.width, image.height).data,
            width: image.width,
            height: image.height,
          }
        }),
      )
      const [after, before] = pixels
      const probe = document.createElement('span')
      probe.style.color = 'var(--color-focus-ring)'
      document.body.append(probe)
      const [r, g, b] = (getComputedStyle(probe).color.match(/\d+/gu) ?? []).map(Number)
      probe.remove()
      const scale = after.width / (box.right - box.left)
      const points: [number, number][] = []
      for (let y = 0; y < after.height; y += 1)
        for (let x = 0; x < after.width; x += 1) {
          const at = (y * after.width + x) * 4
          const hue =
            Math.abs(after.data[at] - r) +
            Math.abs(after.data[at + 1] - g) +
            Math.abs(after.data[at + 2] - b)
          const moved =
            Math.abs(after.data[at] - before.data[at]) +
            Math.abs(after.data[at + 1] - before.data[at + 1]) +
            Math.abs(after.data[at + 2] - before.data[at + 2])
          if ((!only || hue < 90) && moved > 30)
            points.push([box.left + (x + 0.5) / scale, box.top + (y + 0.5) / scale])
        }
      return points
    },
    { pair: pictures, box: area, only: ring },
  )
}

const ringSince = (page: Page, area: Box, now: string, rest: string) =>
  movedSince(page, area, [now, rest], true)

/** Two coordinates on one ray, within the half pixel a picture at two pixels a unit holds. */
const near = (a: number, b: number) => Math.abs(a - b) <= 0.75

/** Whether the ring stands on all four sides of a point: a ray each way meets it. */
function encloses(ring: [number, number][], [x, y]: [number, number]) {
  return {
    up: ring.some(([px, py]) => near(px, x) && py < y),
    down: ring.some(([px, py]) => near(px, x) && py > y),
    left: ring.some(([px, py]) => near(py, y) && px < x),
    right: ring.some(([px, py]) => near(py, y) && px > x),
  }
}

const enclosed = (sides: ReturnType<typeof encloses>) => Object.values(sides).every(Boolean)

/** How near the ring comes to a box: 0 where it lies on it. */
function clearance(ring: [number, number][], box: Box) {
  return Math.min(
    ...ring.map(([x, y]) => {
      const dx = Math.max(box.left - x, 0, x - box.right)
      const dy = Math.max(box.top - y, 0, y - box.bottom)
      return Math.hypot(dx, dy)
    }),
  )
}

/** The chevron as drawn, and each of the epic's words, read by a Range over them. */
function drawings(head: Locator) {
  return head.evaluate((element) => {
    const chevron = element.querySelector(
      '.graph-frame-fold svg path, .graph-frame-fold svg polyline',
    )
    const words = [
      ...element.querySelectorAll(
        '.graph-frame-open .graph-frame-reference, .graph-frame-open .graph-frame-title, .graph-frame-open .graph-frame-count',
      ),
    ].map((word) => {
      const range = document.createRange()
      range.selectNodeContents(word)
      return {
        text: word.textContent?.trim() ?? '',
        box: range.getBoundingClientRect().toJSON() as Box,
      }
    })
    const head = element.getBoundingClientRect()
    return {
      chevron: (chevron as Element).getBoundingClientRect().toJSON() as Box,
      fold: (element.querySelector('.graph-frame-fold') as Element)
        .getBoundingClientRect()
        .toJSON() as Box,
      words,
      area: {
        left: head.left - 12,
        right: head.right + 12,
        top: head.top - 12,
        bottom: head.bottom + 4,
      },
    }
  })
}

const centre = (box: Box): [number, number] => [
  (box.left + box.right) / 2,
  (box.top + box.bottom) / 2,
]

/** What of a ring a control's own style draws now: an outline, or a band behind it. */
const ringStyle = (control: Locator) =>
  control.evaluate((element) => {
    const drawn: string[] = []
    const own = getComputedStyle(element)
    if (own.outlineStyle !== 'none' && Number.parseFloat(own.outlineWidth) > 0)
      drawn.push('outline')
    const probe = document.createElement('span')
    probe.style.color = 'var(--color-focus-ring)'
    document.body.append(probe)
    const ring = getComputedStyle(probe).color
    probe.remove()
    for (const part of ['::before', '::after']) {
      const pseudo = getComputedStyle(element, part)
      if (pseudo.content !== 'none' && pseudo.backgroundColor === ring) drawn.push(part)
    }
    return drawn
  })

/** Two frames, so a change has painted. */
const painted = (page: Page) =>
  page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  )

/**
 * The header's rings and faces in one state: none at rest or under the pointer, where the
 * epic's face leaves the chevron alone, and each control's own, reached by the keyboard.
 */
async function expectRings(page: Page, head: Locator, state: string) {
  const fold = head.locator('.graph-frame-fold')
  const open = head.locator('.graph-frame-open')
  // Under the pointer, no ring, and the epic's face leaves the chevron alone. Each face is
  // what its ring is then read against, so the ring is all that a focus adds.
  await page.mouse.move(0, 0)
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  await painted(page)
  let drawn = await drawings(head)
  const chevronAtRest = await picture(page, drawn.fold)
  await page.mouse.move(...centre(drawn.words[0].box))
  await painted(page)
  expect(await ringStyle(open), `${state}: the epic hovered`).toEqual([])
  expect(
    await movedSince(page, drawn.fold, [await picture(page, drawn.fold), chevronAtRest], false),
    `${state}: the chevron under the epic's face`,
  ).toEqual([])
  const epicFace = await picture(page, drawn.area)
  await page.mouse.move(...centre(drawn.fold))
  await painted(page)
  expect(await ringStyle(fold), `${state}: the fold hovered`).toEqual([])
  const foldFace = await picture(page, drawn.area)
  await page.mouse.move(0, 0)
  await painted(page)

  // The fold, reached by the keyboard.
  await page.keyboard.press('Shift')
  await fold.focus()
  await expect(fold).toBeFocused()
  expect(await fold.evaluate((element) => element.matches(':focus-visible'))).toBe(true)
  await painted(page)
  drawn = await drawings(head)
  let ring = await ringSince(page, drawn.area, await picture(page, drawn.area), foldFace)
  expect(ring.length, `${state}: the fold's ring`).toBeGreaterThan(0)
  expect(
    enclosed(encloses(ring, centre(drawn.chevron))),
    `${state}: the fold rings its chevron`,
  ).toBe(true)
  expect(clearance(ring, drawn.chevron), `${state}: air round the chevron`).toBeGreaterThanOrEqual(
    1,
  )
  for (const word of drawn.words) {
    expect(
      enclosed(encloses(ring, centre(word.box))),
      `${state}: the fold rings «${word.text}»`,
    ).toBe(false)
    expect(
      clearance(ring, word.box),
      `${state}: the fold's ring off «${word.text}»`,
    ).toBeGreaterThanOrEqual(1)
  }

  // The epic's button, reached by the keyboard.
  await page.keyboard.press('ArrowRight')
  await expect(open).toBeFocused()
  expect(await open.evaluate((element) => element.matches(':focus-visible'))).toBe(true)
  await painted(page)
  drawn = await drawings(head)
  ring = await ringSince(page, drawn.area, await picture(page, drawn.area), epicFace)
  expect(ring.length, `${state}: the epic's ring`).toBeGreaterThan(0)
  expect(
    enclosed(encloses(ring, centre(drawn.chevron))),
    `${state}: the epic rings the chevron`,
  ).toBe(false)
  expect(
    clearance(ring, drawn.chevron),
    `${state}: the epic's ring off the chevron`,
  ).toBeGreaterThanOrEqual(1)
  for (const word of drawn.words) {
    expect(
      enclosed(encloses(ring, centre(word.box))),
      `${state}: the epic rings «${word.text}»`,
    ).toBe(true)
    expect(clearance(ring, word.box), `${state}: air round «${word.text}»`).toBeGreaterThanOrEqual(
      1,
    )
  }
}

test.describe('the rings of a header', () => {
  test.use({ deviceScaleFactor: 2 })

  test('each control rings its own drawing and nothing else, folded and open', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await openBroadField(page, 1280)
    await settledCamera(page)
    const [head] = await foldedInSight(page, 28)
    expect(head).toBeDefined()
    const fold = head.locator('.graph-frame-fold')
    await expect(fold).toHaveAttribute('aria-expanded', 'true')
    await expectRings(page, head, 'open')
    await fold.focus()
    await page.keyboard.press('Enter')
    await expect(fold).toHaveAttribute('aria-expanded', 'false')
    await expect(page.locator('.graph-canvas.settled')).toBeVisible()
    await settledCamera(page)
    await expectRings(page, head, 'folded')
  })
})
