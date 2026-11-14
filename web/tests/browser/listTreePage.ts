/**
 * The list grouped by goal, on a space as large as a long-lived one, and what
 * its specs read of it: the rows the table holds, where the columns stand, the
 * row focus is on and the long tasks the page ran.
 *
 * The space has as many cards as a space kept for a year: some two hundred
 * goals, three in four cards done, the largest goal holding 69, one with more
 * than twenty open (folded by the rule, the row widest in every column deep
 * under it) and many with nothing open (folded too), beside a goal five levels
 * deep, three rows at each level. The five-level goal
 * and the largest one were changed last, so the list's order puts them first.
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { installBackend } from './backend.ts'
import { boardRoute } from './boardPage.ts'
import { brief, identity, serveSpace, stateOf, stillFrames } from './longSpace.ts'

/** The workflow's terminal state, which `stateOf` never names. */
const DONE = {
  key: 'done',
  name: 'Done',
  category: 'completed',
  is_terminal: true,
  state_id: identity(905),
} as const

const OLD = '2026-01-01T00:00:00Z'

interface Card {
  closed: boolean
  container?: boolean
  parent?: number
  updated?: string
}

function card(number: number, { closed, container = false, parent, updated = OLD }: Card) {
  return brief(number, closed ? DONE : stateOf(number), {
    container,
    kind: container ? 'epic' : 'task',
    parent_id: parent === undefined ? null : identity(parent),
    updated_at: updated,
  })
}

/** The four stages, one under another, between the crowded goal and the widest row. */
export const CHAIN = ['MAIN-250', 'MAIN-251', 'MAIN-252', 'MAIN-253'] as const
/** The row widest in every column, at the deepest indent, under the crowded goal. */
export const WIDEST = 'MAIN-254'

/**
 * The goal with more than twenty open. Its last five, all done, stand one under
 * another: four stages, which the rule folds as it folds the goal, and under them
 * the row widest in every column — the longest reference at the deepest indent, a
 * holder with a long name, twelve steps and a date of another year.
 */
function crowdedGoal() {
  const [head, ...kids] = goal(200, 54, 30)
  const chained = kids.map((kid) => {
    if (kid.number < 250) return kid
    const parent = kid.number === 250 ? 200 : kid.number - 1
    if (kid.number < 254) return card(kid.number, { closed: true, container: true, parent })
    return {
      ...card(kid.number, { closed: true, parent }),
      checklist: Array.from({ length: 12 }, (_, at) => ({
        id: identity(4000 + at),
        text: 'Step',
        done: false,
        claimed_by: '',
        done_by: '',
      })),
      claim_ref: 'a holder with a long name',
      priority: 'urgent',
      updated_at: '2020-08-28T20:08:00Z',
    }
  })
  return [head, ...chained]
}

/** A container and its children, `open` of them still open. */
function goal(number: number, children: number, open: number, updated = OLD) {
  const kids = Array.from({ length: children }, (_, at) =>
    card(number + 1 + at, { closed: at >= open, parent: number, updated }),
  )
  return [card(number, { closed: open === 0, container: true, updated }), ...kids]
}

/** The goal five levels deep: each level's first row holds the next three. */
export const DEEP = ['MAIN-1', 'MAIN-2', 'MAIN-5', 'MAIN-8', 'MAIN-11'] as const
export const LARGEST = 'MAIN-100'
/** The goal with more than twenty open, which the rule folds. */
export const CROWDED = 'MAIN-200'

export function treeSpace() {
  const now = new Date().toISOString()
  const deep = [card(1, { closed: false, container: true, updated: now })]
  for (const [level, first] of [2, 5, 8, 11].entries())
    for (let at = 0; at < 3; at += 1)
      deep.push(
        card(first + at, {
          closed: false,
          // Every level's first row but the last level's holds the next level.
          container: at === 0 && level < 3,
          parent: level === 0 ? 1 : first - 3,
          updated: now,
        }),
      )
  const earlier = new Date(Date.now() - 60_000).toISOString()
  const goals = [...goal(100, 69, 15, earlier), ...crowdedGoal(), ...goal(300, 36, 10)]
  // 193 goals of five: 135 with nothing open, the rest with two open.
  for (let at = 0; at < 193; at += 1) goals.push(...goal(1000 + at * 6, 5, at < 135 ? 0 : 2))
  // The rest of the 1665 cards stand alone, seven in ten done.
  const alone = Array.from({ length: 1665 - deep.length - goals.length }, (_, at) =>
    card(3000 + at, { closed: at % 10 < 7 }),
  )
  return [...deep, ...goals, ...alone]
}

/** The list at 1440×900, grouped by goal, once its rows are drawn and still. */
export async function openTree(page: Page, rows: object[]) {
  await page.setViewportSize({ width: 1440, height: 900 })
  await installBackend(page)
  await serveSpace(page, rows)
  await page.goto(boardRoute({ view: 'list', group: 'goal' }))
  await expect(page.locator('.work-item-list tbody tr.list-row').first()).toBeVisible()
  await stillFrames(page)
}

export const listOf = (page: Page) => page.locator('.work-item-list')
export const tableOf = (page: Page) => page.locator('.work-item-list .list-table')
/** The rows the table holds; the gaps that keep the rest's height are not rows. */
export const drawnOf = (page: Page) => page.locator('.work-item-list tbody tr.list-row')
/** The row of `reference` where it is drawn in its place, not collapsed for its widths. */
export const rowOf = (page: Page, reference: string) =>
  page.locator(
    `.work-item-list tbody tr.list-row:not(.list-row-held)[data-reference="${reference}"]`,
  )
export const focusedOf = (page: Page) => page.locator('.work-item-list tbody tr.list-row:focus')

/** Where each column of the head starts and how wide it is. */
export const columnsOf = (page: Page) =>
  listOf(page).evaluate((element) =>
    [...element.querySelectorAll('thead th')].map((cell) => {
      const { left, width } = cell.getBoundingClientRect()
      return [Math.round(left), Math.round(width)]
    }),
  )

/** Scroll the list to a share of its length. */
export const scrollTo = (page: Page, share: number) =>
  listOf(page).evaluate((element, at) => {
    element.scrollTop = (element.scrollHeight - element.clientHeight) * at
  }, share)

/** Scroll the list down until it draws the row of `reference`, and bring that row into view. */
export async function reach(page: Page, reference: string) {
  const row = rowOf(page, reference)
  for (let step = 0; step <= 100 && (await row.count()) === 0; step += 1) {
    await scrollTo(page, step / 100)
    await stillFrames(page)
  }
  await row.scrollIntoViewIfNeeded()
}

/** Keep every long task the page runs from here on. */
export const watchLongTasks = (page: Page) =>
  page.evaluate(() => {
    const seen: number[] = []
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) seen.push(entry.duration)
    }).observe({ type: 'longtask', buffered: false })
    Object.assign(window, { longTasksSeen: seen })
  })

/** The long tasks seen since `watchLongTasks`, in milliseconds, and forget them. */
export const longTasks = (page: Page) =>
  page.evaluate(() => {
    const seen = (window as unknown as { longTasksSeen: number[] }).longTasksSeen
    return seen.splice(0).map((ms) => Math.round(ms))
  })

interface TreeNode {
  expanded: boolean | null
  level: number | null
  name: string
}

interface AxProperty {
  name: string
  value: { value?: unknown }
}

interface AxNode {
  ignored?: boolean
  name?: { value?: string }
  properties?: AxProperty[]
  role?: { value?: string }
}

/**
 * What a reader is told of the grid and its rows: their role, level and state.
 * Chromium's protocol does not report a row's place among its siblings.
 */
export async function readerTree(page: Page) {
  const session = await page.context().newCDPSession(page)
  const { nodes } = (await session.send('Accessibility.getFullAXTree')) as { nodes: AxNode[] }
  await session.detach()
  const property = (node: AxNode, name: string) =>
    node.properties?.find((each) => each.name === name)?.value.value
  const grid = nodes.filter((node) => node.role?.value === 'treegrid' && !node.ignored)
  const rows = nodes
    .filter((node) => node.role?.value === 'row' && !node.ignored)
    .map((node): TreeNode => ({
      expanded: (property(node, 'expanded') as boolean | undefined) ?? null,
      level: (property(node, 'level') as number | undefined) ?? null,
      name: node.name?.value ?? '',
    }))
  return { grids: grid.length, rows }
}
