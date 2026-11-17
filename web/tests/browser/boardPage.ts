/**
 * The board's browser-spec harness: a server for one space that the board reads and writes,
 * the board's route, and the reads and drags the board specs share.
 */
import { expect } from '@playwright/test'
import type { Locator, Page, TestInfo } from '@playwright/test'

import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

export { serve } from './boardBackend.ts'
import { spaceScope } from './planningFixtures.ts'

export function boardRoute(state: Record<string, string> = {}) {
  return serializePlatformRoute({
    module_id: 'planning',
    scope: spaceScope,
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

export async function openBoard(page: Page, state: Record<string, string> = { group: 'goal' }) {
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
  /**
   * The tile is carried where it takes no place: another lane, which cannot take it,
   * or its own stack, where nothing places a tile by hand.
   */
  refused?: boolean
}

/** Whether the held tile stands in the stack the drag is taking it to, which is never its own. */
function heldAt(target: Element, { home, reference }: { reference: string | null; home?: string }) {
  const stack = target.closest('ul')
  const held = stack?.querySelector(`:scope > li[data-reference="${reference}"]`)
  return Boolean(stack && held && stack.dataset.state !== home)
}

/** Drag `from` by the pointer to the top or bottom edge of `to`, a tile or a stack, as a hand does. */
export async function drag(page: Page, { from, level, midway, refused, to, where }: Drag) {
  const start = await from.boundingBox()
  if (!start) throw new Error('a tile to drag is not on screen')
  const reference = await from.getAttribute('data-reference')
  const home = await from.evaluate((node) => node.closest('ul')?.dataset.state)
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
  // The board reads where the pointer is on its own beat, every 50ms, rather than at
  // each move. A release between readings still lands in the stack under the pointer
  // (production-board-release holds that), but its place among that stack's tiles is
  // the last one read. The held tile stands in that stack once it is read, which is
  // what a hand sees before letting go.
  if (!refused) await expect.poll(() => to.evaluate(heldAt, { home, reference })).toBe(true)
  if (midway) {
    // The copy under the pointer is a list item outside its list: no marker.
    const copy = page.locator('body > .sortable-fallback')
    await expect(copy).toHaveCSS('list-style-type', 'none')
    await expect(copy).toHaveCSS('opacity', '1')
    await page.screenshot(shot(midway, 'w-board-drag-1440.png'))
  }
  await page.mouse.up()
}
