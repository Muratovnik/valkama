/**
 * The Done column in the built application: the most recently closed work
 * first, a drag inside it that reorders nothing and asks the server for
 * nothing, and a tile dropped on it from another column that closes and stands
 * on top.
 *
 * The server is the board suite's double, which keeps the order of work it is
 * told, so the drawn order is the board's reading of the closing times and not
 * the order the read listed.
 */
import { expect } from '@playwright/test'
import type { Locator } from '@playwright/test'

import { installBackend } from './backend.ts'
import { cell, drag, openBoard, serve, shot, tiles } from './boardPage.ts'
import { test } from './test.ts'

/** Where something is on screen; a tile that is not on screen fails the test here. */
async function box(what: Locator) {
  const found = await what.boundingBox()
  if (!found) throw new Error('a Done tile is not on screen')
  return found
}

for (const width of [1440, 390] as const) {
  test(`the Done column stands newest closed first at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 })
    await installBackend(page)
    await serve(page)
    await openBoard(page, {})
    const done = cell(page.locator('.work-item-board'), 'done')
    // Listed oldest place first (406, 420, 421, 422); closed on the 21st, 5th, 3rd and 25th.
    await expect.poll(() => tiles(done)).toEqual(['MAIN-422', 'MAIN-406', 'MAIN-420', 'MAIN-421'])
    await done.scrollIntoViewIfNeeded()
    await page.screenshot(shot(info, `w-board-done-${width}.png`))
  })
}

test('a drag inside Done moves nothing; a drop on it from another column closes on top', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await installBackend(page)
  const writes = await serve(page)
  await openBoard(page, {})
  const board = page.locator('.work-item-board')
  const done = cell(board, 'done')
  const tile = (reference: string) => board.locator(`li[data-reference="${reference}"]`)
  const before = ['MAIN-422', 'MAIN-406', 'MAIN-420', 'MAIN-421']
  await expect.poll(() => tiles(done)).toEqual(before)
  expect(await tile('MAIN-421').locator('.tile-open').getAttribute('aria-keyshortcuts')).toBeNull()

  // While the last tile is held over the first, the column keeps its order:
  // no place opens for it, because there is no place to give it.
  const start = await box(tile('MAIN-421'))
  const over = await box(tile('MAIN-422'))
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2)
  await page.mouse.down()
  await page.mouse.move(start.x + start.width / 2 + 8, start.y + start.height / 2 + 8, {
    steps: 4,
  })
  await page.mouse.move(over.x + over.width / 2, over.y + 6, { steps: 16 })
  expect(await tiles(done)).toEqual(before)
  await page.mouse.up()
  await expect(board).not.toHaveClass(/dragging/u)
  expect(writes).toHaveLength(0)
  await expect.poll(() => tiles(done)).toEqual(before)

  // From the backlog onto the middle of Done: a plain transition, no place.
  await drag(page, { from: tile('MAIN-402'), to: tile('MAIN-420'), where: 'top' })
  await expect.poll(() => writes.length).toBe(1)
  expect(writes[0].path).toBe('/api/planning/work-item/transition')
  expect(writes[0].body).toEqual(expect.objectContaining({ id: 'MAIN-402', state: 'done' }))
  expect(writes[0].body).not.toHaveProperty('rank')
  await expect.poll(() => tiles(done)).toEqual(['MAIN-402', ...before])
})
