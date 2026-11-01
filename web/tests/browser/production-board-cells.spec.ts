/**
 * The board's cells in the built application: a tile dropped past what an open cell draws
 * stays in sight, and a closed Done cell is reached by Tab, opened and closed again by
 * Enter, with focus on what it revealed and then back on its toggle.
 *
 * The server is the board's double, which keeps the order it is told.
 */
import { expect, test } from '@playwright/test'

import { installBackend } from './backend.ts'
import { LONG_EPIC } from './boardFixtures.ts'
import { cell, drag, lane, openBoard, serve, tiles } from './boardPage.ts'

test('a tile dropped past what an open cell draws stays in sight', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await installBackend(page)
  const writes = await serve(page)
  await openBoard(page)
  const epic = lane(page, LONG_EPIC)
  // The Backlog cell draws three tiles; a tile dropped below them is the fourth.
  await expect
    .poll(() => tiles(cell(epic, 'backlog')))
    .toEqual(['MAIN-402', 'MAIN-403', 'MAIN-404'])
  // Brought in level with the foot of the cell, below its last drawn tile.
  await drag(page, {
    from: epic.locator('li[data-reference="MAIN-405"]'),
    to: cell(epic, 'backlog'),
    where: 'bottom',
    level: true,
  })
  await expect.poll(() => writes.length).toBe(1)
  expect(writes[0]).toEqual({
    path: '/api/planning/work-item/transition',
    body: expect.objectContaining({ id: 'MAIN-405', state: 'backlog', rank: 'after:MAIN-404' }),
  })
  await expect
    .poll(() => tiles(cell(epic, 'backlog')))
    .toEqual(['MAIN-402', 'MAIN-403', 'MAIN-404', 'MAIN-405'])
  // The cell is open now, so its toggle offers to close it again.
  const toggle = epic.locator('.lane-cell[data-state="backlog"] .lane-more')
  await expect(toggle).toHaveText('Show fewer')
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
})

test('a closed Done cell is reached by Tab, and its button shows the cards it counts', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await installBackend(page)
  await serve(page)
  await openBoard(page)
  const epic = lane(page, LONG_EPIC)
  const more = epic.locator('.lane-cell[data-state="done"] .lane-more')
  await expect(more).toHaveText('Show all · 1')
  await expect(epic.locator('li[data-reference="MAIN-406"]')).toHaveCount(0)
  // Tab from the lane's open tile reaches the button within a few stops.
  await epic.locator('li[data-reference="MAIN-402"] .tile-open').focus()
  await expect(async () => {
    await page.keyboard.press('Tab')
    await expect(more).toBeFocused({ timeout: 200 })
  }).toPass({ intervals: [0], timeout: 5000 })
  await expect(more).toHaveAttribute('aria-expanded', 'false')
  await page.keyboard.press('Enter')
  const revealed = epic.locator('li[data-reference="MAIN-406"] .tile-open')
  await expect(revealed).toBeVisible()
  // Focus goes to the card it revealed, and the toggle now closes the cell.
  await expect(revealed).toBeFocused()
  await expect(more).toHaveText('Show fewer')
  await expect(more).toHaveAttribute('aria-expanded', 'true')
  await page.keyboard.press('ArrowDown')
  await expect(more).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(epic.locator('li[data-reference="MAIN-406"]')).toHaveCount(0)
  await expect(more).toBeFocused()
  await expect(more).toHaveText('Show all · 1')
  // From the toggle the arrows lead back to the cards: no dead end.
  await page.keyboard.press('ArrowLeft')
  await expect(page.locator(':focus')).toHaveAttribute('class', /tile-open/u)
})
