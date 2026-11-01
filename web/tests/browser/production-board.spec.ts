/**
 * The board read by epic in the built application: lanes with their counts, a
 * lane folded because nothing in it is open and one unfolded by hand, one
 * epic's chain on the board, and a column reordered by a drag and from the
 * keyboard.
 *
 * The server here is a double that keeps the order it is told, so what the
 * board draws after a move is what the next read of the space answers, not what
 * the board drew before it asked. Each test saves what it looked at under its
 * own output folder.
 */
import { expect, test } from '@playwright/test'
import type { Locator } from '@playwright/test'

import { installBackend } from './backend.ts'
import { LONG_EPIC } from './boardFixtures.ts'
import { cell, centre, drag, lane, openBoard, routeState, serve, shot, tiles } from './boardPage.ts'
import { expectNoSilentClipping } from './overflow.ts'

/** The sum of an rgb(a) colour's first three channels: a lighter fill has the larger sum. */
function brightness(color: string): number {
  return (color.match(/\d+(\.\d+)?/g) ?? [])
    .slice(0, 3)
    .map(Number)
    .reduce((sum, value) => sum + value, 0)
}

for (const [width, oneRow] of [
  [1440, true],
  [1024, true],
  [390, false],
] as const) {
  test(`the board reads by epic at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 900 })
    await installBackend(page)
    await serve(page)
    await openBoard(page)
    const lanes = page.locator('.board-lane')
    await expect(lanes).toHaveCount(4)
    await expect(lanes.locator('.lane-reference')).toHaveText(['MAIN-401', 'MAIN-410', 'MAIN-420'])
    await expect(lanes.nth(3)).toHaveAttribute('aria-label', 'No epic')
    await expect(lanes.locator('.lane-counts')).toHaveText([
      '4 open · 1 closed',
      '0 open · 0 closed',
      '0 open · 2 closed',
      '3 open · 0 closed',
    ])
    // Nothing open folds a lane until the reader says otherwise.
    const expanded = await lanes
      .locator('.lane-toggle')
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('aria-expanded')))
    expect(expanded).toEqual(['true', 'false', 'false', 'true'])
    // The epic is the lane; its open children are its tiles. Its finished child
    // is counted in the Done cell and drawn only on request.
    await expect(tiles(lanes.nth(0))).resolves.toEqual([
      'MAIN-402',
      'MAIN-403',
      'MAIN-404',
      'MAIN-405',
    ])
    await expect(lanes.nth(0).locator('.lane-cell[data-state="done"] .lane-more')).toHaveText(
      'Show all · 1',
    )
    await expect(page.locator('.work-item-board [data-reference="MAIN-401"]')).toHaveCount(0)

    // Unfolded by hand, the empty epic says so instead of drawing three blank cells.
    await lanes.nth(1).locator('.lane-toggle').click()
    await expect(lanes.nth(1).locator('.lane-quiet')).toHaveText('Nothing in this epic yet.')
    await expectNoSilentClipping(page, `board by epic at ${width}px`)
    const pageOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(pageOverflow, 'the page itself never scrolls sideways').toBeLessThanOrEqual(0)
    // Where the board has room, a long title gives way and the lane's actions
    // stay on its heading's row; on a phone they take a row of their own.
    const head = lanes.nth(0)
    const rows = await Promise.all(
      ['.lane-toggle', '.lane-actions'].map(async (part) => {
        const box = await head.locator(part).boundingBox()
        return Math.round((box?.y ?? 0) + (box?.height ?? 0) / 2)
      }),
    )
    expect(Math.abs(rows[0] - rows[1]) <= 2, `heading on one row at ${width}px`).toBe(oneRow)
    // A labelled lane action reads as a control: a fill at rest, and a hover that is
    // one step lighter than the fill, not the same fill.
    const laneAction = head.locator('.lane-actions button').first()
    const restFill = await laneAction.evaluate(
      (element) => getComputedStyle(element).backgroundColor,
    )
    await laneAction.hover()
    const hoverFill = await laneAction.evaluate(
      (element) => getComputedStyle(element).backgroundColor,
    )
    expect(restFill, `lane action has a fill at rest at ${width}px`).not.toBe('rgba(0, 0, 0, 0)')
    expect(
      brightness(hoverFill),
      `lane action hover is lighter than rest at ${width}px`,
    ).toBeGreaterThan(brightness(restFill))
    await page.screenshot(shot(info, `w-board-lanes-${width}.png`))
  })
}

test('a lane stays folded or unfolded the way it was left, across a reload', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await installBackend(page)
  await serve(page)
  await openBoard(page)
  const open = lane(page, LONG_EPIC).locator('.lane-toggle')
  const closed = lane(page, 'The first board').locator('.lane-toggle')
  await open.click()
  await closed.click()
  await expect(open).toHaveAttribute('aria-expanded', 'false')
  await expect(closed).toHaveAttribute('aria-expanded', 'true')
  // Its finished work is counted in the Done cell, drawn on request.
  await lane(page, 'The first board').locator('.lane-more').click()
  await expect(page.locator('[data-reference="MAIN-421"]')).toBeVisible()
  await page.reload()
  await expect(open).toHaveAttribute('aria-expanded', 'false')
  await expect(closed).toHaveAttribute('aria-expanded', 'true')
  await expect(page.locator('[data-reference="MAIN-402"]')).toHaveCount(0)
  // Without grouping, every tile is on the board whatever its lane was left as.
  await page.getByRole('switch', { name: 'Group the board by epic' }).click()
  await expect.poll(() => routeState(page)).toEqual({ view: 'kanban' })
  await expect(page.locator('[data-reference="MAIN-402"]')).toBeVisible()
})

test('a lane shows its epic’s chain on the board, in every view, and the chip leaves it', async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await installBackend(page)
  await serve(page)
  await openBoard(page)
  await page.getByRole('button', { name: 'Show the chain of MAIN-401 on the board' }).click()
  await expect
    .poll(() => routeState(page))
    .toEqual({ view: 'kanban', group: 'epic', chain: 'MAIN-401', chain_scope: 'chain' })
  const chip = page.locator('.workspace-chip')
  await expect(chip).toHaveText('Chain MAIN-401 · 6')
  await expect(page.locator('.board-lane')).toHaveCount(1)
  // The finished member is counted in the Done cell, not drawn.
  await expect(tiles(page.locator('.work-item-board'))).resolves.toHaveLength(4)
  await expect(page.locator('.lane-cell[data-state="done"] .lane-more')).toHaveText('Show all · 1')
  await page.screenshot(shot(info, 'w-board-chain-1440.png'))

  // Ungrouped, the root is a tile like its members; the chain stays.
  await page.getByRole('switch', { name: 'Group the board by epic' }).click()
  await expect
    .poll(() => routeState(page))
    .toEqual({ view: 'kanban', chain: 'MAIN-401', chain_scope: 'chain' })
  await expect(tiles(page.locator('.work-item-board'))).resolves.toHaveLength(6)
  await page.getByRole('button', { name: 'List', exact: true }).click()
  await expect(page.locator('tbody tr')).toHaveCount(6)
  await expect(chip).toHaveText('Chain MAIN-401 · 6')
  await chip.click()
  await expect.poll(() => routeState(page)).toEqual({ view: 'list' })
  await expect(page.locator('tbody tr')).toHaveCount(13)
})

test('a drag reorders a column and moves a tile across columns inside its lane', async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await installBackend(page)
  const writes = await serve(page)
  await openBoard(page)
  const epic = lane(page, LONG_EPIC)
  const tile = (reference: string) => epic.locator(`li[data-reference="${reference}"]`)

  await drag(page, { from: tile('MAIN-404'), to: tile('MAIN-402'), where: 'top', midway: info })
  await expect.poll(() => writes.length).toBe(1)
  expect(writes[0]).toEqual({
    path: '/api/planning/work-item/update',
    body: expect.objectContaining({
      id: 'MAIN-404',
      rank: 'before:MAIN-402',
      expected_revision: 1,
    }),
  })
  await expect
    .poll(() => tiles(cell(epic, 'backlog')))
    .toEqual(['MAIN-404', 'MAIN-402', 'MAIN-403'])

  // Into another column, dropped on the ground below its last tile.
  await drag(page, { from: tile('MAIN-403'), to: cell(epic, 'dev'), where: 'bottom' })
  await expect.poll(() => writes.length).toBe(2)
  expect(writes[1]).toEqual({
    path: '/api/planning/work-item/transition',
    body: expect.objectContaining({
      id: 'MAIN-403',
      state: 'dev',
      rank: 'after:MAIN-405',
      expected_revision: 1,
    }),
  })
  await expect.poll(() => tiles(cell(epic, 'dev'))).toEqual(['MAIN-405', 'MAIN-403'])
  await expect.poll(() => tiles(cell(epic, 'backlog'))).toEqual(['MAIN-404', 'MAIN-402'])
  // A tile never crosses into another lane: the lanes do not share a list.
  const loose = page.locator('li[data-reference="MAIN-430"]')
  await drag(page, { from: tile('MAIN-402'), to: loose, where: 'top' })
  await expect(page.locator('.work-item-board')).not.toHaveClass(/dragging/u)
  expect(writes).toHaveLength(2)
  await expect.poll(() => tiles(cell(epic, 'backlog'))).toEqual(['MAIN-404', 'MAIN-402'])
})

test('a refused drop leaves the tile where it was and says why', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await installBackend(page)
  const refuse = { message: 'MAIN-402 is at revision 2, not 1' as string | null }
  const writes = await serve(page, refuse)
  await openBoard(page)
  const epic = lane(page, LONG_EPIC)
  await drag(page, {
    from: epic.locator('li[data-reference="MAIN-402"]'),
    to: epic.locator('li[data-reference="MAIN-405"]'),
    where: 'bottom',
  })
  await expect.poll(() => writes.length).toBe(1)
  await expect(page.locator('.notice')).toContainText('MAIN-402 is at revision 2, not 1')
  await expect.poll(() => tiles(cell(epic, 'dev'))).toEqual(['MAIN-405'])
  await expect
    .poll(() => tiles(cell(epic, 'backlog')))
    .toEqual(['MAIN-402', 'MAIN-403', 'MAIN-404'])
})

test('Alt+Arrow moves a focused tile one place and the move is announced', async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await installBackend(page)
  const writes = await serve(page)
  await openBoard(page)
  const epic = lane(page, LONG_EPIC)
  const live = page.locator('.work-item-board [role="status"]')
  const focused = epic.locator('li[data-reference="MAIN-402"] .tile-open')
  await expect(focused).toHaveAttribute('aria-keyshortcuts', 'Alt+ArrowUp Alt+ArrowDown')
  await focused.focus()
  await page.keyboard.press('Alt+ArrowDown')
  await expect(live).toHaveText('MAIN-402 moved: 2 of 3 in Backlog')
  await expect.poll(() => writes.length).toBe(1)
  expect(writes[0].body).toEqual(
    expect.objectContaining({ id: 'MAIN-402', rank: 'after:MAIN-403', expected_revision: 1 }),
  )
  await expect
    .poll(() => tiles(cell(epic, 'backlog')))
    .toEqual(['MAIN-403', 'MAIN-402', 'MAIN-404'])
  // Focus follows the tile it moved, so a second press moves it again.
  await expect(focused).toBeFocused()
  await page.screenshot(shot(info, 'w-board-keyboard-1440.png'))
  await page.keyboard.press('Alt+ArrowDown')
  await expect(live).toHaveText('MAIN-402 moved: 3 of 3 in Backlog')
  await expect
    .poll(() => tiles(cell(epic, 'backlog')))
    .toEqual(['MAIN-403', 'MAIN-404', 'MAIN-402'])
  await expect(focused).toBeFocused()
  await page.keyboard.press('Alt+ArrowDown')
  await expect(live).toHaveText('MAIN-402 is already last')
  expect(writes).toHaveLength(2)
})

/** The ground a cell draws, as the page paints it. */
const ground = (where: Locator) =>
  where.evaluate((element) => getComputedStyle(element).backgroundColor)
const clear = 'rgba(0, 0, 0, 0)'

test('an empty cell draws no ground at rest, and its lane’s cells do while a tile can land', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await installBackend(page)
  await serve(page)
  await openBoard(page)
  const epic = lane(page, LONG_EPIC)
  const loose = lane(page, 'No epic')
  await loose.scrollIntoViewIfNeeded()
  const empty = loose.locator('.lane-cell.empty').first()
  await expect(empty).toBeVisible()
  expect(await ground(empty)).toBe(clear)
  // A cell with tiles keeps its ground: the tiles lie on it.
  expect(await ground(epic.locator('.lane-cell[data-state="backlog"]'))).not.toBe(clear)
  const lanes = page.locator('.work-item-lanes')
  /** Pick a tile up and hold it just off where it was, then check, then put it back. */
  const holding = async (tile: Locator, check: () => Promise<void>) => {
    await tile.scrollIntoViewIfNeeded()
    const from = await centre(tile)
    await page.mouse.move(from.x, from.y)
    await page.mouse.down()
    await page.mouse.move(from.x + 12, from.y + 12, { steps: 4 })
    await expect(lanes).toHaveClass(/dragging/u)
    await check()
    await page.mouse.move(from.x, from.y, { steps: 4 })
    await page.mouse.up()
    await expect(lanes).not.toHaveClass(/dragging/u)
  }
  // A tile of another lane cannot land here, so the empty cell stays clear.
  await holding(epic.locator('li[data-reference="MAIN-402"]'), async () => {
    expect(await ground(empty)).toBe(clear)
  })
  // A tile of its own lane can, so the cell draws its ground for as long as it is held.
  await holding(loose.locator('li[data-reference="MAIN-430"]'), async () => {
    await expect.poll(() => ground(empty)).not.toBe(clear)
  })
  await expect.poll(() => ground(empty)).toBe(clear)
})

test('a lane is as tall as its tiles: an empty cell stays a low ground', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await installBackend(page)
  await serve(page)
  await openBoard(page)
  const loose = lane(page, 'No epic')
  // A lane out of sight skips its layout, so it is measured in view.
  await loose.scrollIntoViewIfNeeded()
  const height = async (state: string) => {
    const box = await loose.locator(`.lane-cell[data-state="${state}"]`).boundingBox()
    return box?.height ?? 0
  }
  const full = await height('backlog')
  const empty = await height('done')
  expect(empty, 'an empty cell is a drop-sized ground').toBeLessThanOrEqual(48)
  expect(full, 'the cell with a tile is a tile tall').toBeGreaterThan(empty * 2)
})

test('arrows walk the tiles, and a tile moved from the keyboard is brought into view', async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 1024, height: 640 })
  await installBackend(page)
  await serve(page)
  await openBoard(page)
  const epic = lane(page, LONG_EPIC)
  const tile = (reference: string) => epic.locator(`li[data-reference="${reference}"] .tile-open`)
  // One Tab stop per cell; a bare arrow moves focus and nothing else.
  await expect(cell(epic, 'backlog').locator('button[tabindex="0"]')).toHaveCount(1)
  await tile('MAIN-402').focus()
  await page.keyboard.press('ArrowDown')
  await expect(tile('MAIN-403')).toBeFocused()
  await expect(tile('MAIN-403')).toHaveAttribute('tabindex', '0')
  await expect(tile('MAIN-402')).toHaveAttribute('tabindex', '-1')
  await page.keyboard.press('ArrowRight')
  await expect(tile('MAIN-405')).toBeFocused()
  await page.keyboard.press('ArrowLeft')
  await page.keyboard.press('Home')
  await expect(tile('MAIN-402')).toBeFocused()

  // Moved to the end of its cell, the tile stays focused and in sight.
  const scroller = page.locator('.work-item-lanes')
  await page.keyboard.press('Alt+ArrowDown')
  await expect
    .poll(() => tiles(cell(epic, 'backlog')))
    .toEqual(['MAIN-403', 'MAIN-402', 'MAIN-404'])
  await page.keyboard.press('Alt+ArrowDown')
  await expect
    .poll(() => tiles(cell(epic, 'backlog')))
    .toEqual(['MAIN-403', 'MAIN-404', 'MAIN-402'])
  await expect(tile('MAIN-402')).toBeFocused()
  await expect
    .poll(async () => {
      const [box, port] = await Promise.all([
        tile('MAIN-402').boundingBox(),
        scroller.boundingBox(),
      ])
      if (!box || !port) return 'not drawn'
      return box.y >= port.y && box.y + box.height <= port.y + port.height
        ? 'in view'
        : 'out of view'
    })
    .toBe('in view')
  await page.screenshot(shot(info, 'w-board-keyboard-1024.png'))
})

test('a lane names the work it holds out of sight and keeps its heading while it is in view', async ({
  page,
}, info) => {
  // One column wide: the long epic's Backlog is in view, its Dev tile is not.
  await page.setViewportSize({ width: 390, height: 700 })
  await installBackend(page)
  await serve(page)
  await openBoard(page)
  const epic = lane(page, LONG_EPIC)
  const note = epic.locator('.lane-elsewhere')
  await expect(note).toHaveText(['To the right: 1 in Dev →'])
  // Finished work is counted in the heading already, so it is not named while
  // anything of the lane is in view.
  await expect(note).not.toContainText('Done')

  const scroller = page.locator('.work-item-lanes')
  const dev = epic.locator('.lane-cell[data-state="dev"]')
  await scroller.evaluate(
    (element, left) => element.scrollTo({ left }),
    await dev.evaluate((cell) => (cell as HTMLElement).offsetLeft),
  )
  await expect(note).toHaveText(['← To the left: 3 in Backlog'])

  // Scrolled down past the heading while the lane's cells are still in view,
  // the heading stays, held under the row of state names.
  await scroller.evaluate((element) => element.scrollTo({ left: 0 }))
  const backlog = epic.locator('.lane-cell[data-state="backlog"]')
  await backlog.evaluate((cell) => {
    const lanes = cell.closest('.work-item-lanes') as HTMLElement
    lanes.scrollTop += cell.getBoundingClientRect().top - lanes.getBoundingClientRect().top + 60
  })
  const [head, states, body] = await Promise.all([
    epic.locator('.lane-head').boundingBox(),
    page.locator('.lanes-head').boundingBox(),
    backlog.boundingBox(),
  ])
  expect(body && states && body.y + body.height > states.y + states.height).toBe(true)
  expect(Math.round(head?.y ?? 0)).toBe(Math.round((states?.y ?? 0) + (states?.height ?? 0)))
  await page.screenshot(shot(info, 'w-board-lane-elsewhere-390.png'))
})
