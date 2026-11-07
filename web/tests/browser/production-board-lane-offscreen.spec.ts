/**
 * A lane heading laid out again when its lane comes back into view, after the board was narrowed
 * while the lane was out of sight, takes its place without the browser reporting a ResizeObserver
 * loop. The lane is skipped while it is out of sight (`content-visibility` in `WorkItemLanes`), so
 * the heading is read only once the lane is laid out again; read in the turn of the observer that
 * saw that, a new place changed the lane's height, which the browser observes itself, too late to
 * tell of it in that frame.
 */
import { expect } from '@playwright/test'

import { installBackend } from './backend.ts'
import { openBoard, serve } from './boardPage.ts'
import { serveWide } from './laneWideFixture.ts'
import { test } from './test.ts'

test.use({ locale: 'ru-RU' })

for (const from of [1280, 760])
  test(`narrowed from ${from} to 390 with a lane out of sight, the lane comes into view with no loop reported`, async ({
    page,
  }) => {
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
    // Every lane is laid out once, at the wide board, and the board goes back to its top.
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
