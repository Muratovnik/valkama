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
import { serveSpace, stillFrames } from './longSpace.ts'
export { CHAIN, CROWDED, DEEP, LARGEST, treeSpace, WIDEST } from './served/listTree.ts'

/** The list at 1440×900, grouped by goal, once its rows are drawn and still. */
export async function openTree(page: Page, rows: object[]) {
  await page.setViewportSize({ width: 1440, height: 900 })
  await installBackend(page)
  await serveSpace(page, rows)
  // Newest first: the served trees place their goals by when they were updated.
  await page.goto(boardRoute({ view: 'list', group: 'goal', sort: 'updated', desc: true }))
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

/**
 * How long the list scrolls, how many rows it shows (said where it draws a
 * window, its head's row not counted) and the height of its shortest drawn row.
 */
export const scrollOf = (page: Page) =>
  listOf(page).evaluate((element) => {
    const said = element.querySelector('.list-table')?.getAttribute('aria-rowcount')
    const rows = element.querySelectorAll('tbody tr.list-row:not(.list-row-held)')
    const heights = [...rows].map((row) => Math.round(row.getBoundingClientRect().height))
    return { length: element.scrollHeight, row: Math.min(...heights), shown: Number(said) - 1 }
  })

/**
 * The long tasks, in milliseconds, of End from the list's first row, and of five
 * Page Downs from there once Home has come back. The Tab stop is the first row
 * in a tree and the first reference in a flat list, so focus starts on it.
 */
export async function keyTasks(page: Page) {
  const focused = page.locator('.work-item-list tbody tr.list-row:focus-within')
  const rowAt = async () => (await focused.getAttribute('aria-rowindex')) ?? ''
  await watchLongTasks(page)
  await page.locator('.work-item-list tbody [tabindex="0"]').first().focus()
  await stillFrames(page)
  await longTasks(page)

  const last = await tableOf(page).getAttribute('aria-rowcount')
  await page.keyboard.press('End')
  await expect(focused).toHaveAttribute('aria-rowindex', last ?? '')
  await stillFrames(page)
  const end = await longTasks(page)

  await page.keyboard.press('Home')
  await expect(focused).toHaveAttribute('aria-rowindex', '2')
  await stillFrames(page)
  await longTasks(page)
  for (let step = 0; step < 5; step += 1) {
    const from = await rowAt()
    await page.keyboard.press('PageDown')
    await expect(focused).not.toHaveAttribute('aria-rowindex', from)
  }
  await stillFrames(page)
  const pageDown = await longTasks(page)
  return { end, pageDown }
}

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
