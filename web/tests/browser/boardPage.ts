/**
 * The board's browser-spec harness: a server for one space that the board reads and writes,
 * the board's route, and the reads and drags the board specs share.
 */
import { expect } from '@playwright/test'
import type { Locator, Page, TestInfo } from '@playwright/test'

import { planningSpaceEntity } from '@/shared/api/platformPlanningRefs.ts'
import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { chainResponse } from '../fixtures/chain.ts'
import { BACKLOG, boardSpace, chainOf, DEV, DONE, insertAt } from './boardFixtures.ts'
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
export async function serve(page: Page, refuse: { message: string | null } = { message: null }) {
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
export function routeState(page: Page): Record<string, unknown> {
  const encoded = new URL(page.url()).searchParams.get('state')
  return encoded === null
    ? {}
    : (JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as Record<string, unknown>)
}

export function shot(info: TestInfo, name: string) {
  return { path: info.outputPath(name), animations: 'disabled' as const }
}

export const lane = (page: Page, title: string) =>
  page.getByRole('region', { name: title, exact: true })
export const cell = (where: Locator, state: string) => where.locator(`ul[data-state="${state}"]`)
export const tiles = (where: Locator) =>
  where
    .locator('li[data-reference]')
    .evaluateAll((nodes) => nodes.map((node) => (node as HTMLElement).dataset.reference))

export async function openBoard(page: Page, state: Record<string, string> = { group: 'epic' }) {
  await page.goto(boardRoute(state))
  await expect(page.locator('.work-item-board')).toBeVisible()
  await expect(page.locator('.work-item-board [data-reference]').first()).toBeVisible()
}

/** The middle of something on screen, where a hand picks it up. */
export async function centre(what: Locator) {
  const box = await what.boundingBox()
  if (!box) throw new Error('nothing to pick up on screen')
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

/** The same space as a list, once its rows are drawn. */
export async function openList(page: Page) {
  await page.goto(boardRoute({ view: 'list' }))
  await expect(page.locator('.work-item-list tbody tr').first()).toBeVisible()
}

export interface Drag {
  from: Locator
  to: Locator
  where: 'bottom' | 'top'
  /**
   * Come in from the side at the drop's height rather than on a slant. A slant
   * into another column first crosses the target's upper tiles, and the tile
   * goes in above the one it crossed, which moves the place the drop was
   * measured for; a hand corrects for that, a straight line does not.
   */
  level?: boolean
  /** Where the screenshot of the held tile goes, when one is wanted. */
  midway?: TestInfo
}

/** Drag `from` by the pointer to the top or bottom edge of `to`, a tile or a stack, as a hand does. */
export async function drag(page: Page, { from, level, midway, to, where }: Drag) {
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
  if (level) await page.mouse.move(start.x + start.width / 2 + 8, y, { steps: 8 })
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
