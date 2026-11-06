/**
 * Where a lane heading's actions stand, and so how many lines it draws, follows from the width the
 * board has, not from the widths it passed through on the way: a board widened to a width and one
 * narrowed to it draw every heading alike. Read once on a walk from the narrowest phone to a wide
 * desktop and once on the walk back, 2px a step, at the board's first states and its middle ones,
 * with a pointer and where only a finger presses; then each width where a heading changes is
 * reached once more from a pixel either side.
 *
 * A heading once kept the place it had: at 440px in English, reached from below, its actions stood
 * alone on a third line and left an empty band at rest; reached from above, they took the counts
 * down with them.
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { installBackend } from './backend.ts'
import { openBoard, serve } from './boardPage.ts'
import { serveWide } from './laneWideFixture.ts'
import { test } from './test.ts'

/** The narrowest and the widest board read, and the step between two readings. */
const [NARROW, WIDE, STEP] = [320, 1440, 2]

/** The parts a heading's rows are told by, each by its class. */
const PARTS = ['lane-toggle', 'lane-state', 'lane-counts', 'lane-elsewhere', 'lane-actions']

/**
 * Every heading as drawn: its place, its height in the 64ths of a pixel layout works in, and the
 * parts on each of its rows, top to bottom; a part whose middle falls inside a row found already
 * stands on it. Runs in the page, and scrolls the board to its first states or its middle ones
 * first.
 */
const drawnHeads = async (board: HTMLElement, [where, names]: [string, string[]]) => {
  const states = board.querySelectorAll<HTMLElement>('.lanes-state')
  board.scrollLeft = where === 'start' ? 0 : (states[2]?.offsetLeft ?? 0)
  const read = () =>
    [...board.querySelectorAll('.lane-head')].map((head) => {
      const parts = [...head.querySelectorAll(names.map((name) => `.${name}`).join(', '))]
        .filter((part) => !part.classList.contains('visually-hidden'))
        .map((part) => ({
          box: part.getBoundingClientRect(),
          name: names.find((name) => part.classList.contains(name)) ?? '',
        }))
        .toSorted((one, two) => one.box.top - two.box.top)
      const rows: { bottom: number; names: string[]; top: number }[] = []
      for (const { box, name } of parts) {
        const middle = (box.top + box.bottom) / 2
        const row = rows.find(({ bottom, top }) => middle >= top - 0.5 && middle <= bottom + 0.5)
        if (row) row.names.push(name)
        else rows.push({ bottom: box.bottom, names: [name], top: box.top })
      }
      const name = head.querySelector('.lane-reference, .lane-title')?.textContent ?? ''
      // Beside the title or tied to the last part, by the heading's class; else at the end.
      const place =
        ['crowded', 'tied'].filter((one) => head.classList.contains(one)).join(' ') || 'end'
      const height = Math.round(head.getBoundingClientRect().height * 64)
      return `${name} ${place} ${height}: ${rows.map((row) => row.names.join(' + ')).join(' / ')}`
    })
  // A new width reaches the board a frame before its headings, which are measured a frame later
  // still: read until three frames running draw the same.
  let drawn = ['']
  for (let same = 0, at = 0; same < 3 && at < 60; at += 1) {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    const now = read()
    same = JSON.stringify(now) === JSON.stringify(drawn) ? same + 1 : 0
    drawn = now
  }
  return drawn
}

/** The board at `width`, read as it is drawn there once it has settled. */
async function readAt(page: Page, width: number, where: string) {
  await page.setViewportSize({ width, height: 900 })
  return page.locator('.work-item-lanes').evaluate(drawnHeads, [where, PARTS] as [string, string[]])
}

/** What differs between two readings of one width, heading by heading. */
const departures = (width: number, how: string, one: string[], two: string[]) =>
  one.flatMap((head, index) =>
    head === two[index] ? [] : [`${width}px ${how}: ${head} | ${two[index] ?? 'none'}`],
  )

async function walk(page: Page, where: string) {
  const widths = Array.from({ length: (WIDE - NARROW) / STEP + 1 }, (_, at) => NARROW + STEP * at)
  const up = new Map<number, string[]>()
  for (const width of widths) up.set(width, await readAt(page, width, where))
  const found: string[] = []
  for (const width of widths.toReversed())
    found.push(
      ...departures(width, 'narrowed to', up.get(width) ?? [], await readAt(page, width, where)),
    )
  // Each width where some heading changes, and the one between, from a pixel below and above.
  const changes = widths.filter(
    (width) =>
      width < WIDE && JSON.stringify(up.get(width)) !== JSON.stringify(up.get(width + STEP)),
  )
  for (const width of changes)
    for (const at of [width, width + 1, width + STEP]) {
      await readAt(page, at - 1, where)
      const below = await readAt(page, at, where)
      await readAt(page, at + 1, where)
      found.push(...departures(at, 'from either side', below, await readAt(page, at, where)))
    }
  return { changes: changes.length, found }
}

for (const locale of ['en-US', 'ru-RU'])
  for (const finger of [false, true])
    test.describe(`${locale}, ${finger ? 'where only a finger presses' : 'with a pointer'}`, () => {
      test.use(finger ? { locale, hasTouch: true, isMobile: true } : { locale })

      test('every lane heading draws the same at a width however the board got there', async ({
        page,
      }) => {
        test.setTimeout(600_000)
        await page.setViewportSize({ width: 1280, height: 900 })
        await page.emulateMedia({ reducedMotion: 'reduce' })
        await installBackend(page)
        await serve(page)
        await serveWide(page)
        await openBoard(page)
        await page.evaluate(() => document.fonts.ready)
        for (const where of ['start', 'middle']) {
          const { changes, found } = await walk(page, where)
          // A walk on which no heading changed would prove nothing about the way it came.
          expect(changes, `${where}: widths where a heading changes`).toBeGreaterThan(5)
          expect(found, `${where}: headings drawn otherwise on the way back`).toEqual([])
        }
      })
    })
