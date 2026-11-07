/**
 * The graph's field is as tall as the row its canvas leaves it, at every window that has the
 * room: there it stops at the camera's strip, whose buttons stay in sight and take a press at
 * their middles. A floor of its own had kept the field 360px tall in a shorter row, so it ran
 * over the strip, and a press on «Fit whole graph» landed on a card.
 *
 * A window too short for that row — a phone held on its side — keeps the field at its floor,
 * one row of cards at reading size (`--graph-field-floor`), and the graph's section scrolls
 * instead: without the floor the field there was 0px tall and the strip was cut. The floor
 * stays a finger's target shorter than the section's view, so wherever the section stands a
 * band beside the field shows at least 20px to scroll by: a floor as tall as the view left
 * a scroll position where the field filled it and a finger could only move the camera. A
 * finger dragged on the field moves the camera and not the section; dragged on the bar, it
 * scrolls the section. The
 * section scrolls up and down only, and its scrollport keeps a ring's room past its drawn
 * edges: flush with them, the «Graph options» button's reach scrolled it 2px sideways and
 * its ring was cut, where both had stood whole over the workspace's gutter.
 *
 * Served the broad synthetic space.
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { frames } from './frames.ts'
import { camera, openBroadField, settledCamera } from './graphFieldCamera.ts'
import { test } from './test.ts'

/** The field, its neighbours and the camera's buttons as they stand now. */
const measure = (page: Page) =>
  page.evaluate(() => {
    const box = (selector: string) =>
      (document.querySelector(selector) as Element).getBoundingClientRect()
    const section = document.querySelector('.graph') as Element
    const canvas = box('.graph-canvas')
    const key = box('.graph-legend-place')
    const field = box('.graph-flow')
    const strip = box('.graph-controls')
    const view = section.getBoundingClientRect()
    const buttons = [...document.querySelectorAll('.graph-controls button')].map((button) => {
      const { left, right, top, bottom } = button.getBoundingClientRect()
      const hit = document.elementFromPoint((left + right) / 2, (top + bottom) / 2)
      return {
        name: button.textContent?.trim() ?? '',
        taken: hit !== null && button.contains(hit),
        hit: hit?.className.toString() ?? 'none',
        inSight: top >= view.top && bottom <= Math.min(view.bottom, window.innerHeight),
      }
    })
    const stage = box('.workspace-stage')
    const bar = box('.graph-bar')
    const sideways = getComputedStyle(section).overflowX !== 'visible'
    return {
      // The floor the field publishes (`GRAPH_FIELD_FLOOR`), one row of cards at reading size.
      floor: Number.parseFloat(
        getComputedStyle(document.querySelector('.graph-flow') as Element).getPropertyValue(
          '--graph-field-floor',
        ),
      ),
      // The view the section scrolls, and a finger's target (`--size-control-target`).
      room: section.clientHeight,
      target: Number.parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue('--size-control-target'),
      ),
      section: {
        top: view.top,
        bottom: view.bottom,
        scrolls: section.scrollHeight > section.clientHeight,
        scrollsSideways: sideways && section.scrollWidth > section.clientWidth,
      },
      // Where the bar's words and controls start and end, against the stage they stood on.
      edges: { left: bar.left - stage.left, right: bar.right - stage.right },
      canvas: { top: canvas.top, bottom: canvas.bottom },
      key: { bottom: key.bottom },
      field: { top: field.top, bottom: field.bottom, height: field.height },
      // The strip's row starts at its margin, above its border.
      strip: {
        row:
          strip.top -
          Number.parseFloat(
            getComputedStyle(document.querySelector('.graph-controls') as Element).marginTop,
          ),
        top: strip.top,
        bottom: strip.bottom,
      },
      buttons,
    }
  })

type Drawn = Awaited<ReturnType<typeof measure>>

/**
 * Each control of the bar with its keyboard ring drawn, and whether the section cuts that
 * ring: a section that clips cuts what stands past its scrollport.
 */
async function barRings(page: Page) {
  await page.keyboard.press('Tab')
  return page.evaluate(() => {
    const section = document.querySelector('.graph') as Element
    const clips = getComputedStyle(section).overflowX !== 'visible'
    const port = section.getBoundingClientRect()
    return [...document.querySelectorAll<HTMLElement>('.graph-bar button')]
      .filter((control) => control.getBoundingClientRect().width > 0)
      .map((control) => {
        control.focus()
        const style = getComputedStyle(control)
        // How far the ring's outer edge stands past the control's: none for an inset ring.
        const past = Math.max(
          0,
          Number.parseFloat(style.outlineWidth) + Number.parseFloat(style.outlineOffset),
        )
        const { left, right, top } = control.getBoundingClientRect()
        return {
          name: control.getAttribute('aria-label') ?? control.textContent?.trim() ?? '',
          ring: control.matches(':focus-visible') && style.outlineStyle !== 'none',
          uncut:
            !clips ||
            (left - past >= port.left - 0.5 &&
              right + past <= port.right + 0.5 &&
              top - past >= port.top - 0.5),
        }
      })
  })
}

async function expectBarKept(page: Page, drawn: Drawn) {
  expect(drawn.section.scrollsSideways, 'the section does not scroll sideways').toBe(false)
  expect(drawn.edges.left, "the bar starts at the stage's edge").toBeCloseTo(0, 0)
  expect(drawn.edges.right, "the bar ends at the stage's edge").toBeCloseTo(0, 0)
  const rings = await barRings(page)
  expect(rings.length, 'the bar has controls').toBeGreaterThan(0)
  for (const control of rings)
    expect(control, `«${control.name}»'s ring drawn whole`).toMatchObject({
      ring: true,
      uncut: true,
    })
}

function expectButtonsTaken(drawn: Drawn) {
  expect(drawn.buttons, 'the three camera buttons').toHaveLength(3)
  for (const button of drawn.buttons)
    expect(button, `«${button.name}» in sight and pressed at its middle`).toMatchObject({
      taken: true,
      inSight: true,
    })
}

function expectFieldBetweenStrips(drawn: Drawn) {
  expect(drawn.field.top, 'the field starts under the key').toBeCloseTo(drawn.key.bottom, 0)
  expect(drawn.field.bottom, "the field stops at the strip's row").toBeCloseTo(drawn.strip.row, 0)
  expect(drawn.strip.bottom, 'the strip inside the canvas').toBeLessThanOrEqual(
    drawn.canvas.bottom + 0.5,
  )
}

for (const [width, height] of [
  [1280, 600],
  [1600, 500],
  [390, 600],
  [1280, 900],
  [1280, 800],
  [390, 844],
] as const) {
  test(`at ${width}x${height} the field fills its row and the camera's buttons take a press`, async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await openBroadField(page, width, height)
    await settledCamera(page)
    const drawn = await measure(page)
    expectButtonsTaken(drawn)
    // The field runs from the key's row to the strip, no further: the row is its size.
    expectFieldBetweenStrips(drawn)
    expect(drawn.field.height, 'the field keeps room to draw').toBeGreaterThan(drawn.floor)
    // A window with the room scrolls nothing: the canvas ends where the section does.
    expect(drawn.section.scrolls, 'the section does not scroll').toBe(false)
    expect(drawn.canvas.bottom, 'the canvas ends at the section').toBeCloseTo(
      drawn.section.bottom,
      0,
    )
    await expectBarKept(page, drawn)
  })
}

/** The floor a short section leaves the field: a finger's target short of its view. */
const floorIn = (drawn: Drawn) => Math.max(0, Math.min(drawn.floor, drawn.room - drawn.target))

for (const [width, height] of [
  [844, 340],
  [844, 300],
  [667, 300],
] as const) {
  test(`at ${width}x${height} the field keeps the floor its section leaves and the section scrolls to the camera's strip`, async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await openBroadField(page, width, height)
    await settledCamera(page)
    const opened = await measure(page)
    expect(opened.field.height, 'the field at the floor the section leaves').toBeCloseTo(
      floorIn(opened),
      0,
    )
    expect(floorIn(opened), 'a floor to draw on').toBeGreaterThan(0)
    expectFieldBetweenStrips(opened)
    expect(opened.section.scrolls, 'the section scrolls').toBe(true)
    await expectBarKept(page, opened)

    await page.locator('.graph').evaluate((section) => {
      section.scrollTop = section.scrollHeight
    })
    await frames(page.locator(':root'))
    await page.mouse.move(0, 0)
    const end = await measure(page)
    expect(end.strip.top, 'the strip whole under the section top').toBeGreaterThanOrEqual(
      end.section.top - 0.5,
    )
    expect(end.strip.bottom, 'the strip whole above the section end').toBeLessThanOrEqual(
      end.section.bottom + 0.5,
    )
    expectButtonsTaken(end)
    expectFieldBetweenStrips(end)
    expect(end.field.height, 'the field at that floor once scrolled').toBeCloseTo(floorIn(end), 0)
  })
}

/** A finger's drag, moved in ten steps, which `page.touchscreen` cannot give. */
async function drag(page: Page, x: number, y: number, dy: number) {
  const session = await page.context().newCDPSession(page)
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] })
  for (let step = 1; step <= 10; step += 1)
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x, y: y + (dy * step) / 10 }],
    })
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await session.detach()
}

const sectionScroll = (page: Page) =>
  page.locator('.graph').evaluate((section) => section.scrollTop)

/** Where the section stands once a fling has run out: the same over two frames. */
async function settledScroll(page: Page) {
  await expect
    .poll(async () => {
      const first = await sectionScroll(page)
      await frames(page.locator(':root'))
      return first === (await sectionScroll(page))
    })
    .toBe(true)
  return sectionScroll(page)
}

/**
 * The section scrolled to `top`, and the larger of the bands in sight above and below the
 * field: how tall it shows, a point on it, and the drag that scrolls the section from there.
 */
async function bandAt(page: Page, top: number) {
  await page.locator('.graph').evaluate((section, to) => {
    section.scrollTop = to
  }, top)
  await frames(page.locator(':root'))
  return page.locator('.graph').evaluate((section) => {
    const view = section.getBoundingClientRect()
    const bottom = view.top + section.clientHeight
    const field = (section.querySelector('.graph-flow') as Element).getBoundingClientRect()
    const above = Math.max(0, Math.min(field.top, bottom) - view.top)
    const below = Math.max(0, bottom - Math.max(field.bottom, view.top))
    const upper = above >= below
    const x = view.left + view.width * 0.75
    const y = upper ? view.top + above / 2 : bottom - below / 2
    const atEnd = section.scrollTop >= section.scrollHeight - section.clientHeight - 1
    return {
      at: section.scrollTop,
      size: Math.max(above, below),
      x,
      y,
      onField: Boolean(document.elementFromPoint(x, y)?.closest('.graph-flow')),
      // A finger moved up scrolls the section on, down scrolls it back from its end.
      dy: atEnd ? 30 : -30,
    }
  })
}

async function drawnBox(page: Page, selector: string) {
  const box = await page.locator(selector).boundingBox()
  if (!box) throw new Error(`${selector} is not drawn`)
  return box
}

test.describe('under a finger', () => {
  test.use({ hasTouch: true, isMobile: true })

  test('at 844x340 a drag on the bar scrolls the section, one on the field moves the camera', async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await openBroadField(page, 844, 340)
    await settledCamera(page)

    const bar = await drawnBox(page, '.graph-bar')
    await drag(page, bar.x + bar.width - 16, bar.y + bar.height - 8, -80)
    await expect.poll(() => sectionScroll(page), 'the bar scrolled the section').toBeGreaterThan(0)
    const scrolled = await settledScroll(page)

    const section = await drawnBox(page, '.graph')
    const field = await drawnBox(page, '.graph-flow')
    const before = await settledCamera(page)
    const x = field.x + field.width / 2
    const y = Math.max(field.y, section.y) + 16
    expect(
      await page.evaluate(
        ([px, py]) => Boolean(document.elementFromPoint(px, py)?.closest('.graph-flow')),
        [x, y],
      ),
      'the drag starts on the field',
    ).toBe(true)
    await drag(page, x, y, 50)
    await expect
      .poll(async () => {
        const { y: now } = await camera(page)
        return now - before.y
      }, 'the camera followed the finger')
      .toBeGreaterThan(40)
    expect(await settledScroll(page), 'the section stayed where it was').toBe(scrolled)
  })

  for (const [width, height] of [
    [844, 340],
    [844, 300],
    [667, 300],
  ] as const)
    test(`at ${width}x${height} a band beside the field stays in sight to scroll by, wherever the section stands`, async ({
      page,
    }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await openBroadField(page, width, height)
      await settledCamera(page)
      const end = await page
        .locator('.graph')
        .evaluate((section) => section.scrollHeight - section.clientHeight)
      expect(end, 'the section scrolls').toBeGreaterThan(0)
      for (let top = 0; top < end + 10; top += 10) {
        const band = await bandAt(page, Math.min(top, end))
        expect(
          band.size,
          `at ${band.at}px a band beside the field in sight`,
        ).toBeGreaterThanOrEqual(20)
        expect(band.onField, `at ${band.at}px the band is not the field`).toBe(false)
        await drag(page, band.x, band.y, band.dy)
        await expect
          .poll(() => sectionScroll(page), `at ${band.at}px a drag on the band scrolls the section`)
          .not.toBe(band.at)
        await settledScroll(page)
      }
    })
})
