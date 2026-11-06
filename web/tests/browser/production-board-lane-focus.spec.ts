/**
 * The keyboard moving along a lane heading held at the top of the board leaves the board where it
 * is: Tab from the heading's toggle onto its card action, and Shift+Tab back. The board keeps a
 * tile it brings into view clear of a heading held there; a heading's own buttons stand inside
 * that room, and the board once scrolled back to the lane's start to clear them of themselves.
 *
 * And the ring around each of the heading's buttons is seen on all four sides: held at the top,
 * the toggle's stood under the row of state names, and the board's edges cut the toggle's left
 * side and the last action's right.
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { installBackend } from './backend.ts'
import { openBoard, serve } from './boardPage.ts'
import { settle } from './laneHeadGeometry.ts'
import { serveWide } from './laneWideFixture.ts'
import { test } from './test.ts'

/** How far down the board is scrolled before each try. */
const SCROLLS = [60, 120, 300, 600]

/**
 * The index of the epic heading held at the top of the board, under the row of state names, with
 * its lane running on well below it; -1 where none is.
 */
const heldHeading = (board: HTMLElement) => {
  const top = board.getBoundingClientRect().top
  return [...board.querySelectorAll('.lane-head')].findIndex((head) => {
    const box = head.getBoundingClientRect()
    // Where a heading is held: its sticky offset below the board's top.
    const names = Number.parseFloat(getComputedStyle(head).top)
    const lane = head.parentElement?.getBoundingClientRect()
    return (
      head.querySelector('.lane-actions') !== null &&
      Math.abs(box.top - top - names) <= 1 &&
      lane !== undefined &&
      lane.top < box.top - 1 &&
      lane.bottom > box.bottom + 100
    )
  })
}

/** What the board does at `width` and each of `SCROLLS` as the keyboard walks a held heading. */
async function walkHeld(page: Page, width: number) {
  await page.setViewportSize({ width, height: 900 })
  const board = page.locator('.work-item-lanes')
  const found: string[] = []
  let tried = 0
  for (const scroll of SCROLLS) {
    await board.evaluate((node: HTMLElement, top: number) => {
      node.scrollLeft = 0
      node.scrollTop = top
    }, scroll)
    await settle(board)
    const index = await board.evaluate(heldHeading)
    if (index < 0) continue
    tried += 1
    const head = page.locator('.lane-head').nth(index)
    const before = await board.evaluate((node: HTMLElement) => node.scrollTop)
    await head.locator('.lane-toggle').evaluate((node: HTMLElement) => {
      node.focus({ preventScroll: true })
    })
    for (const key of ['Tab', 'Shift+Tab']) {
      await page.keyboard.press(key)
      await settle(board)
      const after = await board.evaluate((node: HTMLElement) => node.scrollTop)
      const on = await page.evaluate(() => document.activeElement?.getAttribute('aria-label'))
      if (Math.abs(after - before) > 0.5)
        found.push(`${width}px from ${scroll}px, ${key} onto «${on}»: ${before}px → ${after}px`)
    }
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  }
  return { found, tried }
}

/** The box the focused control's ring is drawn to, outer edge to outer edge. */
interface Ring {
  bottom: number
  label: string | null
  left: number
  right: number
  top: number
}

const focusRing = (): Ring => {
  const control = document.activeElement as HTMLElement
  const box = control.getBoundingClientRect()
  const style = getComputedStyle(control)
  const reach = Number.parseFloat(style.outlineOffset) + Number.parseFloat(style.outlineWidth)
  return {
    bottom: box.bottom + reach,
    label: control.getAttribute('aria-label'),
    left: box.left - reach,
    right: box.right + reach,
    top: box.top - reach,
  }
}

/**
 * The sides of the ring something is drawn over, each read at its middle, half a pixel inside the
 * ring's outer edge. A ring is not something the pointer finds, so a pixel of the control's own is
 * put there for the read: where the pointer finds another element, that element lies over the ring,
 * and where an ancestor cuts the ring, it cuts that pixel too.
 */
const coveredSides = (ring: Ring) => {
  const control = document.activeElement as HTMLElement
  const across = (ring.left + ring.right) / 2
  const down = (ring.top + ring.bottom) / 2
  const points = {
    bottom: [across, ring.bottom - 0.5],
    left: [ring.left + 0.5, down],
    right: [ring.right - 0.5, down],
    top: [across, ring.top + 0.5],
  }
  const covered: string[] = []
  for (const [side, [x, y]] of Object.entries(points)) {
    const pixel = document.createElement('i')
    pixel.style.cssText =
      'position: absolute; inset: 0 auto auto 0; width: 1px; height: 1px; transition-property: none'
    control.append(pixel)
    const at = pixel.getBoundingClientRect()
    pixel.style.translate = `${x - 0.5 - at.left}px ${y - 0.5 - at.top}px`
    const found = document.elementFromPoint(x, y)
    // The control's own reach (`reach.css`) may lie over the pixel; it lies over its ring alike.
    const own = found !== null && control.contains(found)
    pixel.remove()
    if (own) continue
    const what = found?.closest('.lanes-head') ? 'the row of state names' : found?.classList[0]
    covered.push(`${side} under ${what ?? 'nothing'}`)
  }
  return covered
}

/** The sides of the ring an ancestor cuts, as one that draws nothing outside itself. */
const cutSides = (ring: Ring) => {
  const cut: string[] = []
  for (let around = document.activeElement?.parentElement; around; around = around.parentElement) {
    const its = getComputedStyle(around)
    const clips =
      its.overflowX !== 'visible' ||
      its.overflowY !== 'visible' ||
      its.contentVisibility === 'auto' ||
      /paint|strict|content/u.test(its.contain)
    const outer = around.getBoundingClientRect()
    const left = outer.left + around.clientLeft
    const top = outer.top + around.clientTop
    const sides = [
      ring.left < left - 0.25 && 'left',
      ring.top < top - 0.25 && 'top',
      ring.right > left + around.clientWidth + 0.25 && 'right',
      ring.bottom > top + around.clientHeight + 0.25 && 'bottom',
    ].filter(Boolean)
    if (clips && sides.length) cut.push(`${sides.join(', ')} cut by ${around.classList[0]}`)
  }
  return cut
}

/**
 * Each of a heading's buttons the keyboard reaches, from the toggle on, with what hides its ring;
 * with `fold`, the toggle's again once it has folded the lane, when the heading is all the lane draws.
 */
async function ringsOf(page: Page, index: number, where: string, fold: boolean) {
  const board = page.locator('.work-item-lanes')
  const head = page.locator('.lane-head').nth(index)
  await head
    .locator('.lane-action')
    .first()
    .evaluate((node: HTMLElement) => {
      node.focus({ preventScroll: true })
    })
  const found: string[] = []
  const read = async (what: string) => {
    await settle(board)
    const ring = await page.evaluate(focusRing)
    const hidden = [
      ...(await page.evaluate(coveredSides, ring)),
      ...(await page.evaluate(cutSides, ring)),
    ]
    if (hidden.length) found.push(`${where}, ${what} «${ring.label}»: ${hidden.join('; ')}`)
  }
  for (const key of ['Shift+Tab', 'Tab', 'Tab']) {
    await page.keyboard.press(key)
    await read('at rest')
  }
  if (fold) {
    for (const key of ['Shift+Tab', 'Shift+Tab', 'Enter']) await page.keyboard.press(key)
    await read('folded')
    await page.keyboard.press('Enter')
  }
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  return found
}

/** The rings of the first heading at the lane's start, and of each heading `SCROLLS` hold at the top. */
async function ringsAt(page: Page, width: number) {
  await page.setViewportSize({ width, height: 900 })
  const board = page.locator('.work-item-lanes')
  const found: string[] = []
  let held = 0
  for (const scroll of [0, ...SCROLLS]) {
    await board.evaluate((node: HTMLElement, top: number) => {
      node.scrollLeft = 0
      node.scrollTop = top
    }, scroll)
    await settle(board)
    const index = scroll === 0 ? 0 : await board.evaluate(heldHeading)
    if (index < 0) continue
    if (scroll > 0) held += 1
    const where = scroll === 0 ? 'at the lane’s start' : `held from ${scroll}px`
    found.push(...(await ringsOf(page, index, `${width}px ${where}`, scroll === 0)))
  }
  return { found, held }
}

for (const locale of ['en-US', 'ru-RU'])
  test.describe(locale, () => {
    test.use({ locale })

    test.beforeEach(async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 900 })
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await installBackend(page)
      await serve(page)
      await serveWide(page)
      await openBoard(page)
      await page.evaluate(() => document.fonts.ready)
      await page.mouse.move(0, 0)
    })

    test('a lane heading’s buttons show the keyboard’s ring whole, held at the top or not', async ({
      page,
    }) => {
      const found: string[] = []
      for (const width of [320, 390, 760, 1280]) {
        const rings = await ringsAt(page, width)
        // A width where no heading was held at the top would prove nothing.
        expect
          .soft(rings.held, `${width}px: scrolls with a heading held at the top`)
          .toBeGreaterThan(1)
        found.push(...rings.found)
      }
      expect(found).toEqual([])
    })

    test('the keyboard on a held lane heading’s buttons leaves the board where it is', async ({
      page,
    }) => {
      const found: string[] = []
      for (const width of [320, 390, 760, 1280]) {
        const walked = await walkHeld(page, width)
        // A width where no heading was held at the top would prove nothing.
        expect
          .soft(walked.tried, `${width}px: scrolls with a heading held at the top`)
          .toBeGreaterThan(1)
        found.push(...walked.found)
      }
      expect(found).toEqual([])
    })
  })
