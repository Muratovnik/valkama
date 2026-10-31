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
import type { Locator, Page, TestInfo } from '@playwright/test'

import { planningSpaceEntity } from '@/shared/api/platformPlanningRefs.ts'
import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { chainResponse } from '../fixtures/chain.ts'
import { installBackend } from './backend.ts'
import { BACKLOG, boardSpace, chainOf, DEV, DONE, insertAt, LONG_EPIC } from './boardFixtures.ts'
import { expectNoSilentClipping } from './overflow.ts'
import { projectScope, spaceRef, workItem } from './planningFixtures.ts'
import { planningReadFor } from './planningReadFixture.ts'

interface Write {
  body: Record<string, unknown>
  path: string
}

/**
 * A server for one space that answers reads from its list and applies the
 * placements and transitions it is sent, refusing a move while `refuse` is set.
 */
async function serve(page: Page, refuse: { message: string | null } = { message: null }) {
  const space = boardSpace()
  const writes: Write[] = []
  await page.route('**/api/planning?*', async (route) => {
    const response = planningReadFor(new URL(route.request().url()).searchParams)
    if (response.status === 200 && 'work_items' in response.body)
      response.body.work_items = [...response.body.work_items, ...(space as never[])]
    await route.fulfill({
      status: response.status,
      contentType: 'application/json',
      body: JSON.stringify(response.body),
    })
  })
  const move = async (route: Parameters<Parameters<Page['route']>[1]>[0]) => {
    const path = new URL(route.request().url()).pathname
    const body = route.request().postDataJSON() as Record<string, unknown>
    writes.push({ path, body })
    if (refuse.message !== null)
      return route.fulfill({
        status: 409,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'conflict', message: refuse.message } }),
      })
    const at = space.findIndex((item) => item.reference === body.id)
    const [item] = space.splice(at, 1)
    const state = [BACKLOG, DEV, DONE].find((entry) => entry.key === body.state) ?? item.state
    const moved = { ...item, state, revision: item.revision + 1 }
    space.splice(insertAt(space, state, body.rank), 0, moved)
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        ...workItem,
        work_item_id: moved.work_item_id,
        reference: moved.reference,
        number: moved.number,
        title: moved.title,
        state: moved.state,
        parent_id: moved.parent_id,
        revision: moved.revision,
      }),
    })
  }
  await page.route('**/api/planning/work-item/update', move)
  await page.route('**/api/planning/work-item/transition', move)
  await page.route('**/api/planning/work-item/chain?*', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(chainResponse(chainOf(space) as never)),
    }),
  )
  return writes
}

function boardRoute(state: Record<string, string> = {}) {
  return serializePlatformRoute({
    module_id: 'planning',
    scope: projectScope,
    entity: planningSpaceEntity(spaceRef),
    state: { view: 'kanban', ...state },
  })
}

/** What the address's module state says, decoded. */
function routeState(page: Page): Record<string, unknown> {
  const encoded = new URL(page.url()).searchParams.get('state')
  return encoded === null
    ? {}
    : (JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as Record<string, unknown>)
}

function shot(info: TestInfo, name: string) {
  return { path: info.outputPath(name), animations: 'disabled' as const }
}

const lane = (page: Page, title: string) => page.getByRole('region', { name: title, exact: true })
const cell = (where: Locator, state: string) => where.locator(`ul[data-state="${state}"]`)
const tiles = (where: Locator) =>
  where
    .locator('li[data-reference]')
    .evaluateAll((nodes) => nodes.map((node) => (node as HTMLElement).dataset.reference))

async function openBoard(page: Page, state: Record<string, string> = { group: 'epic' }) {
  await page.goto(boardRoute(state))
  await expect(page.locator('.work-item-board')).toBeVisible()
  await expect(page.locator('.work-item-board [data-reference]').first()).toBeVisible()
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
    // The epic is the lane; its children are its tiles, read state by state.
    await expect(tiles(lanes.nth(0))).resolves.toEqual([
      'MAIN-402',
      'MAIN-403',
      'MAIN-404',
      'MAIN-405',
      'MAIN-406',
    ])
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
  await expect(tiles(page.locator('.work-item-board'))).resolves.toHaveLength(5)
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

interface Drag {
  from: Locator
  to: Locator
  where: 'bottom' | 'top'
  /** Where the screenshot of the held tile goes, when one is wanted. */
  midway?: TestInfo
}

/** Drag `from` by the pointer to the top or bottom edge of `to`, a tile or a stack, as a hand does. */
async function drag(page: Page, { from, midway, to, where }: Drag) {
  const start = await from.boundingBox()
  if (!start) throw new Error('a tile to drag is not on screen')
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2)
  await page.mouse.down()
  // Once a drag is under way every cell of the lane stands as tall as the lane,
  // so the target is measured then, as the hand sees it.
  await page.mouse.move(start.x + start.width / 2 + 8, start.y + start.height / 2 + 8, {
    steps: 4,
  })
  const end = await to.boundingBox()
  if (!end) throw new Error('a place to drop on is not on screen')
  const y = where === 'top' ? end.y + 6 : end.y + end.height - 6
  await page.mouse.move(end.x + end.width / 2, y, { steps: 16 })
  await page.mouse.move(end.x + end.width / 2, y + (where === 'top' ? 1 : -1), { steps: 2 })
  if (midway) {
    // The copy under the pointer is a list item outside its list: no marker.
    const copy = page.locator('body > .sortable-fallback')
    await expect(copy).toHaveCSS('list-style-type', 'none')
    await expect(copy).toHaveCSS('opacity', '1')
    await page.screenshot(shot(midway, 'w-board-drag-1440.png'))
  }
  await page.mouse.up()
}

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
  const focused = epic.locator('li[data-reference="MAIN-402"] .work-item-tile')
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
  const tile = (reference: string) => epic.locator(`li[data-reference="${reference}"] > button`)
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
