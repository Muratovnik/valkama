/**
 * A lane heading laid out again when its lane comes back into view, after the board was narrowed
 * while the lane was out of sight. The lane is skipped while it is out of sight (`content-visibility`
 * in `WorkItemLanes`), so the heading is read only once the lane is laid out again.
 *
 * It takes its place without the browser reporting a ResizeObserver loop: read in the turn of the
 * observer that saw the lane laid out again, a new place changed the lane's height, which the
 * browser observes itself, too late to tell of it in that frame. And a tile the keyboard reaches in
 * such a lane stands at the lane's gap under its heading once the headings have taken their places:
 * read a frame later, a place moved the board's content after the board had last cleared the tile
 * of its heading, and the tile stood 16px under it.
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { installBackend } from './backend.ts'
import { openBoard, serve } from './boardPage.ts'
import { serveWide } from './laneWideFixture.ts'
import { test } from './test.ts'

test.use({ locale: 'ru-RU' })

/**
 * The board opened `from` px wide with every lane laid out once and back at its top, then
 * narrowed to 390 with some lanes out of sight, skipped. Collects what the page reports as errors.
 */
async function narrowedWithLanesAway(page: Page, from: number) {
  await page.addInitScript(() => {
    const reports: string[] = []
    Object.assign(window, { reports })
    window.addEventListener('error', ({ message }) => reports.push(`${innerWidth}px: ${message}`))
  })
  await page.setViewportSize({ width: from, height: 420 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await installBackend(page)
  await serve(page)
  await serveWide(page)
  await openBoard(page)
  await page.evaluate(async () => document.fonts.ready)
  const lanes = page.locator('.work-item-lanes')
  const away = await lanes.evaluate(async (board) => {
    // This body runs in the page, so a module-scope helper is out of its reach.
    // eslint-disable-next-line unicorn/consistent-function-scoping -- see above
    const frame = () => new Promise((done) => requestAnimationFrame(done))
    for (const lane of board.querySelectorAll('.board-lane')) {
      lane.scrollIntoView({ block: 'center' })
      await frame()
      await frame()
    }
    board.scrollTop = 0
    await frame()
    await frame()
    return [...board.querySelectorAll('.board-lane > .lane-head')].filter(
      (head) => !head.checkVisibility({ contentVisibilityAuto: true }),
    ).length
  })
  expect(away, 'lanes out of sight, skipped').toBeGreaterThan(0)
  await page.setViewportSize({ width: 390, height: 420 })
  return lanes
}

for (const from of [1280, 760]) {
  test(`narrowed from ${from} to 390 with a lane out of sight, the lane comes into view with no loop reported`, async ({
    page,
  }) => {
    const lanes = await narrowedWithLanesAway(page, from)
    // Each lane out of sight comes into view in turn, the first frames after each read.
    const shown = await lanes.evaluate(async (board) => {
      // This body runs in the page, so a module-scope helper is out of its reach.
      // eslint-disable-next-line unicorn/consistent-function-scoping -- see above
      const frame = () => new Promise((done) => requestAnimationFrame(done))
      for (let at = 0; at < 4; at += 1) await frame()
      const skipped = [...board.querySelectorAll('.board-lane > .lane-head')].filter(
        (head) => !head.checkVisibility({ contentVisibilityAuto: true }),
      )
      for (const head of skipped) {
        head.scrollIntoView({ block: 'center' })
        for (let at = 0; at < 4; at += 1) await frame()
      }
      return skipped.length
    })
    expect(shown, 'lanes brought into view').toBeGreaterThan(0)
    const reports = await page.evaluate(() => (window as { reports?: string[] }).reports)
    expect(reports, 'errors the page reported').toEqual([])
  })

  test(`narrowed from ${from} to 390, a tile the keyboard reaches in a lane out of sight stands at the lane's gap`, async ({
    page,
  }) => {
    const lanes = await narrowedWithLanesAway(page, from)
    await page.keyboard.press('Shift')
    // The first tile of the first open lane out of sight takes focus from the keys, and the
    // board brings it in; read once its frames have passed, then the lane's gap at rest.
    const gaps = await lanes.evaluate(async (board) => {
      // This body runs in the page, so a module-scope helper is out of its reach.
      // eslint-disable-next-line unicorn/consistent-function-scoping -- see above
      const frame = () => new Promise((done) => requestAnimationFrame(done))
      for (let at = 0; at < 4; at += 1) await frame()
      const lane = [...board.querySelectorAll('.board-lane.open')].find(
        (one) =>
          !one
            .querySelector(':scope > .lane-head')
            ?.checkVisibility({ contentVisibilityAuto: true }),
      )
      const head = lane?.querySelector(':scope > .lane-head')
      const opener = lane?.querySelector<HTMLElement>('.work-item-tile .tile-open')
      const tile = opener?.closest('.work-item-tile')
      if (!lane || !head || !opener || !tile) return null
      const gap = () => tile.getBoundingClientRect().top - head.getBoundingClientRect().bottom
      opener.focus()
      for (let at = 0; at < 8; at += 1) await frame()
      const brought = gap()
      // At rest: the lane's top a little under the board's, nothing held.
      board.scrollTop += lane.getBoundingClientRect().top - board.getBoundingClientRect().top - 40
      for (let at = 0; at < 4; at += 1) await frame()
      return { brought, normal: gap() }
    })
    expect(gaps, 'a tile in a lane out of sight').not.toBeNull()
    const { brought, normal } = gaps ?? { brought: Number.NaN, normal: 0 }
    expect(
      Math.abs(brought - normal),
      `${brought.toFixed(1)}px under the heading, the lane's gap ${normal.toFixed(1)}px`,
    ).toBeLessThanOrEqual(0.5)
  })
}
