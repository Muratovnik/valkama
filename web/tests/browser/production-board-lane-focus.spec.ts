/**
 * The keyboard moving along a lane heading held at the top of the board leaves the board where it
 * is: Tab from the heading's toggle onto its card action, and Shift+Tab back. The board keeps a
 * tile it brings into view clear of a heading held there; a heading's own buttons stand inside
 * that room, and the board once scrolled back to the lane's start to clear them of themselves.
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

for (const locale of ['en-US', 'ru-RU'])
  test.describe(locale, () => {
    test.use({ locale })

    test('the keyboard on a held lane heading’s buttons leaves the board where it is', async ({
      page,
    }) => {
      await page.setViewportSize({ width: 1280, height: 900 })
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await installBackend(page)
      await serve(page)
      await serveWide(page)
      await openBoard(page)
      await page.evaluate(() => document.fonts.ready)
      await page.mouse.move(0, 0)
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
