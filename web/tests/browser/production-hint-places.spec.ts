/**
 * Where a hint stands in the built app: never over its own element, and in a list never over
 * another of its rows. Every element with a hint is pointed at on the rail, a board, the list,
 * the Analytics day chart, its ranked bars and its rail of tiles, an opened card and its
 * checklist, and the settings, at 1440px and 1024px.
 *
 * Where a hint stands follows its kind and the list its element stands in, and no call site
 * names a side (`hintPlacement.ts`). Before that, a name in the rail written without the side
 * stood above its icon over the row before, and a title the rail cut stood at the title's end,
 * over the rows above and under it. A list of rows down (the rail) puts every hint past its edge,
 * so a hint there stands over no part of the list. A chart's mark has its hint at the mark: a
 * period's beside its own stack, the column drawn, over the rest of its period and the periods
 * after it, and a ranked row's beside its bar, over the rest of its row and the rows under it,
 * never over the bar; under its row it stood over the rows after it, and past the ranking's edge
 * far from a short bar.
 * The settings and a card's checklist are lists of wide rows, whose hint stands inside its own
 * row and over no other (`production-hint-row.spec.ts` measures how near).
 */
import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { busyFrame } from '../support/liveFrame.ts'
import { pageAt as analyticsAt, serve as serveAnalytics } from './analyticsPage.ts'
import { installBackend } from './backend.ts'
import { openBoard, serve } from './boardPage.ts'
import { openCard } from './cardHeadPage.ts'
import { openDays } from './dayHintPage.ts'
import { drawAllLined } from './drawnViews.ts'
import { installLiveStreams } from './liveWorkPage.ts'
import { spaceScope } from './planningFixtures.ts'
import { openSteps } from './stepsPage.ts'
import { test } from './test.ts'

interface Placed {
  /** The element pointed at, by its first class and its kind. */
  element: string
  /**
   * The hint stands over the list the element stands in, of rows down; over its row, across; or
   * over another row, in a list of wide rows.
   */
  listCovered: boolean
  /** The hint stands over its own element. */
  ownCovered: boolean
}

/**
 * The list a screen's elements stand in, named by the screen rather than read from the page, so
 * this judges any build: a list of rows down, which no hint may stand over, of rows across,
 * where a hint may not stand over its own row, or of wide rows, where it may not stand over
 * another row.
 */
interface List {
  across: boolean
  /** The list of rows down, or the row of a list across, that holds an element. */
  holder: string
  /**
   * In a list across, what its row draws for the element, as a period its stack: the hint stands
   * beside it, over the rest of the row and the element that takes the pointer for it.
   */
  drawn?: string
  /** In a list of wide rows, each of its rows. */
  row?: string
}

const RAIL: List = { across: false, holder: '.app-nav-shell' }
const PERIODS: List = { across: true, holder: '.period-slot', drawn: '.period-stack' }
const RANKING: List = { across: true, holder: '.ranked-row', drawn: '.ranked-bar' }
const STEPS: List = { across: false, holder: '.checklist', row: '.step-row' }
const SETTINGS: List = { across: false, holder: '.settings-general-sheet', row: '.settings-row' }
const RAIL_TILES: List = { across: false, holder: '.analytics-rail-list' }
const LIST_ROWS: List = { across: false, holder: '.list-table' }

/**
 * Where the hint that shows under the pointer at `x, y` stands against the element there. A
 * hint the pointer cannot reach, as one over the point, is no answer.
 */
function placedAt([[x, y], list]: [[number, number], List | null]): Placed | null {
  const hint = document.querySelector('.tooltip-hint')
  const at = document.elementFromPoint(x, y)
  if (!hint || !at || hint.contains(at)) return null
  const area = at.closest('[data-tooltip-area]')
  const anchor = area
    ? area.querySelector<HTMLElement>('[data-tooltip]')
    : at.closest<HTMLElement>('[data-tooltip]')
  if (!anchor) return null
  const shown = hint.getBoundingClientRect()
  // A pixel of the hint's border meeting the box's is no cover.
  const covers = (box: DOMRect) =>
    Math.min(shown.right, box.right) - Math.max(shown.left, box.left) > 1 &&
    Math.min(shown.bottom, box.bottom) - Math.max(shown.top, box.top) > 1
  const holder = list ? anchor.closest(list.holder) : null
  const drawn = list?.drawn ? (holder?.querySelector(list.drawn) ?? null) : null
  const against = drawn ?? holder
  const own = list?.row ? anchor.closest(list.row) : null
  const others = list?.row && holder ? [...holder.querySelectorAll(list.row)] : []
  return {
    element: `${anchor.classList[0] ?? anchor.tagName.toLowerCase()}.${anchor.dataset.tooltipKind ?? ''}`,
    listCovered: list?.row
      ? others.some((row) => row !== own && covers(row.getBoundingClientRect()))
      : against !== null && covers(against.getBoundingClientRect()),
    ownCovered: covers((drawn ?? anchor).getBoundingClientRect()),
  }
}

/** What a hint in `list` stood over that it must not. */
function overWhat(list: List | null) {
  if (list?.row) return 'another row of its list'
  return list?.across ? 'its own mark' : 'the rows of its list'
}

/** Points at every element with a hint inside `where` and lists each hint that covers what it must not. */
async function sweep(page: Page, where: Locator, list: List | null = null) {
  const viewport = page.viewportSize() ?? { width: 0, height: 0 }
  const anchors = where.locator('[data-tooltip]')
  const covered: string[] = []
  const placed: Placed[] = []
  for (let index = 0, count = await anchors.count(); index < count; index += 1) {
    const box = await anchors.nth(index).boundingBox()
    if (!box || box.width < 2 || box.height < 2) continue
    const point: [number, number] = [box.x + box.width / 2, box.y + box.height / 2]
    if (point[0] < 0 || point[1] < 0 || point[0] > viewport.width || point[1] > viewport.height)
      continue
    // From a place with no hint, so the last one is gone and this one comes after the rest.
    await page.mouse.move(viewport.width - 2, viewport.height - 2)
    await page.clock.runFor(1000)
    await page.mouse.move(...point)
    await page.clock.runFor(1000)
    const shown = await page.evaluate(placedAt, [point, list] as [[number, number], List | null])
    if (!shown) continue
    placed.push(shown)
    if (shown.ownCovered) covered.push(`${shown.element}: over its own element`)
    if (shown.listCovered) covered.push(`${shown.element}: over ${overWhat(list)}`)
  }
  return { covered, placed }
}

for (const width of [1440, 1024]) {
  test.describe(`at ${width}px`, () => {
    test.beforeEach(async ({ page }) => {
      await page.addInitScript(() => localStorage.setItem('valkama-locale', 'en'))
      await page.setViewportSize({ width, height: 900 })
      // The hint's delay runs on this clock, so each element is read after it.
      await page.clock.install()
    })

    test('no hint on the rail or a board covers its element, nor a row of the rail', async ({
      page,
    }) => {
      await installBackend(page)
      await serve(page)
      const streams = await installLiveStreams(page)
      await openBoard(page)
      await streams.live(busyFrame())
      await expect.poll(() => streams.open()).toHaveLength(1)
      const fold = page.locator('.nav-fold-toggle').first()
      await fold.click()
      await expect(fold).toHaveAttribute('aria-expanded', 'true')

      const rail = await sweep(page, page.locator('.app-nav-shell'), RAIL)
      // The rail's names, folds, rows and pins: each one's hint stands past the rail.
      expect(rail.placed.length).toBeGreaterThan(4)
      expect(rail.covered).toEqual([])
      const board = await sweep(page, page.locator('main'))
      expect(board.placed.length).toBeGreaterThan(0)
      expect(board.covered).toEqual([])
    })

    test('no hint of the list covers its element, nor a row of the list', async ({ page }) => {
      await installBackend(page)
      await serve(page)
      await openBoard(page)
      await page.getByRole('radio', { name: 'List', exact: true }).click()
      await expect(page.locator('main table')).toBeVisible()
      // A mark's name stood under it, over the row after its own.
      const list = await sweep(page, page.locator('main'), LIST_ROWS)
      expect(list.placed.length).toBeGreaterThan(0)
      expect(list.covered).toEqual([])
    })

    test('no hint of a card’s steps covers its element, nor another step of the checklist', async ({
      page,
    }) => {
      await openSteps(page)
      const steps = page.locator('.drawer .checklist')
      await steps.evaluate((list) => list.scrollIntoView({ block: 'center', inline: 'nearest' }))
      // A step's action named itself under its icon, over the step after it.
      const placed = await sweep(page, steps, STEPS)
      expect(placed.placed.length).toBeGreaterThan(2)
      expect(placed.covered).toEqual([])
    })

    test('no hint of the settings covers its element, nor another row of the settings', async ({
      page,
    }) => {
      await installBackend(page)
      await page.goto(serializePlatformRoute({ module_id: 'settings', scope: spaceScope }))
      const sheet = page.locator('.settings-general-sheet')
      await expect(sheet.locator('.settings-row').first()).toBeVisible()
      // A field's and a switch's detail stood under it, over the row after it.
      const placed = await sweep(page, sheet, SETTINGS)
      expect(placed.placed.length).toBeGreaterThan(2)
      expect(placed.covered).toEqual([])
    })

    test('no hint of the Analytics rail covers its element, nor a tile of the rail', async ({
      page,
    }) => {
      await serveAnalytics(page)
      // Beside the panel at a wide window; the whole screen, a list, at a narrower one.
      await page.goto(analyticsAt())
      const rail = page.locator('.analytics-rail-list')
      await expect(rail.locator('.window-bar').first()).toBeVisible()
      // A tile's bar and its lead said their details under them, over the tile after.
      const placed = await sweep(page, rail, RAIL_TILES)
      expect(placed.placed.length).toBeGreaterThan(2)
      expect(placed.covered).toEqual([])
    })

    test('no hint of the Analytics day chart covers its own stack', async ({ page }) => {
      const days = await openDays(page, width)
      const chart = await sweep(page, days.locator('.period-bars'), PERIODS)
      expect(chart.placed.length).toBeGreaterThan(2)
      expect(chart.covered).toEqual([])
    })

    test('no hint of the Analytics bars covers its own bar', async ({ page }) => {
      await openDays(page, width)
      // Each section drawn as its chart, whichever the width of the panel opened it as.
      await drawAllLined(page)
      const ranking = page.locator('.spending-bars .ranked-grid')
      await expect(ranking.locator('.ranked-line')).not.toHaveCount(0)
      await ranking.evaluate((list) => list.scrollIntoView({ block: 'center', inline: 'nearest' }))
      // Each row's hint stands beside its bar: under its row it stood over the rows after it,
      // and past the ranking's edge far from a short bar.
      const placed = await sweep(page, ranking, RANKING)
      expect(placed.placed.length).toBeGreaterThan(2)
      expect(placed.covered).toEqual([])
    })

    test('no hint in an opened card covers its element', async ({ page }) => {
      await openCard(page, 'en', width, { asking: true, goal: 'MAIN-12', held: true })
      const drawer = await sweep(page, page.locator('.drawer'))
      expect(drawer.placed.length).toBeGreaterThan(2)
      expect(drawer.covered).toEqual([])
    })
  })
}
