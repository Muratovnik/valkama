/**
 * A cut text says itself whole where it stands, in the built app: its whole words are laid over
 * the cut ones, their first letter on the cut text's first letter, in the same type and ink, and
 * run on to 8px short of the window's edge. A cut name in the rail, a holder in the list, a task's
 * name in the Analytics table and an epic's lane head on the board are each pointed at, at 1440px
 * and 1024px.
 *
 * Before, every one of them stood again in a hint beside its element: above it and centred, or
 * past the rail's edge, so the eye went from the cut words to a second copy of them in other type
 * somewhere else. Laid over its element, the whole text opens under a pointer that stays still
 * without going and coming back, covers no other row of its list on one line, keeps itself up
 * while the pointer is anywhere on it, and lets a press through to what it covers: a rail's row
 * and a task's name open their card, a list's row its card, and a lane's head folds the lane.
 * Each run prints what it measured, how many of the texts wrapped among it.
 */
import { expect } from '@playwright/test'
import type { Locator, Page, TestInfo } from '@playwright/test'

import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { task } from '../fixtures/analytics.ts'
import { busyFrame, liveRow as frameRow } from '../support/liveFrame.ts'
import { openReport, pageAt, record, serve as serveAnalytics, serveTask } from './analyticsPage.ts'
import { installBackend } from './backend.ts'
import { openBoard, openList } from './boardPage.ts'
import { pass, watched, watchHints } from './hintFramesPage.ts'
import { installLiveStreams } from './liveWorkPage.ts'
import { worked } from './overviewPage.ts'
import { globalScope, identity } from './planningFixtures.ts'
import { test } from './test.ts'

const SETTINGS = serializePlatformRoute({ module_id: 'settings', scope: globalScope })
/** Cut by the rail at its narrowest, and whole at its widest. */
const LONG_TITLE = 'An item whose title runs past the rail at its narrowest'
const LONG_HOLDER = 'a-reviewer-whose-name-runs-past-the-column-of-holders'
const LONG_TASK =
  'ToolSpec: one Unity-free description of every tool the agents call, its arguments and errors'
const EPIC_TITLE =
  'Parser rework: one grammar for tables, front matter, footnotes, fenced code, math blocks and the rest a description holds'

/** What the type of a text is drawn in, as the page computes it. */
interface Type {
  color: string
  family: string
  letterSpacing: string
  lineHeight: string
  size: string
  weight: string
}

/** The whole text laid over an element, as measured against the element. */
interface Laid {
  /** Its box, in the window. */
  box: { bottom: number; left: number; right: number; top: number }
  laid: Type
  /** How many lines the whole text takes. */
  lines: number
  /** Other rows of the element's list it stands over. */
  neighbours: number
  /** Where its first letter stands against the element's first letter, in px. */
  offset: { x: number; y: number }
  /** The type of the element's first letter, and of the whole text's. */
  own: Type
  /** What it says, and what the element's hint says. */
  text: string
  words: string
}

/**
 * The element's whole text as it lies over it, measured in the page, with the rows of its list
 * found by `rows`: null where none lies. Both first letters are read the same way, as a range
 * around the first letter a reader sees, never in the copy kept for assistive technology.
 */
const laidOver = (anchor: Locator, rows: string) =>
  anchor.evaluate((element, rowSelector): Laid | null => {
    const letterOf = (root: Element) => {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const text = node as Text
        const inked = text.parentElement
        const at = text.data.search(/\S/u)
        if (!inked || at < 0 || inked.closest('.visually-hidden')) continue
        const range = document.createRange()
        range.setStart(text, at)
        range.setEnd(text, at + 1)
        const box = range.getBoundingClientRect()
        if (box.width === 0 || box.height === 0) continue
        const style = getComputedStyle(inked)
        range.selectNodeContents(text)
        const lines = new Set([...range.getClientRects()].map((line) => Math.round(line.top)))
        return {
          box,
          lines: lines.size,
          type: {
            color: style.color,
            family: style.fontFamily,
            letterSpacing: style.letterSpacing,
            lineHeight: style.lineHeight,
            size: style.fontSize,
            weight: style.fontWeight,
          },
        }
      }
      return null
    }
    const whole = document.querySelector('.whole-text')
    const own = letterOf(element)
    const laid = whole ? letterOf(whole) : null
    if (!whole || !own || !laid) return null
    const box = whole.getBoundingClientRect()
    const covers = (other: DOMRect) =>
      Math.min(box.right, other.right) - Math.max(box.left, other.left) > 1 &&
      Math.min(box.bottom, other.bottom) - Math.max(box.top, other.top) > 1
    const row = element.closest(rowSelector)
    const neighbours = [...document.querySelectorAll(rowSelector)].filter(
      (other) => other !== row && !other.contains(row) && covers(other.getBoundingClientRect()),
    )
    return {
      offset: { x: laid.box.left - own.box.left, y: laid.box.top - own.box.top },
      own: own.type,
      laid: laid.type,
      lines: laid.lines,
      neighbours: neighbours.length,
      box: { bottom: box.bottom, left: box.left, right: box.right, top: box.top },
      text: whole.textContent?.trim() ?? '',
      words: (element as HTMLElement).dataset.tooltip ?? '',
    }
  }, rows)

/** Whether the element, or something in it, holds more text than its box shows across. */
const isCut = (anchor: Locator) =>
  anchor.evaluate((element) =>
    [element, ...element.querySelectorAll('*')].some(
      (box) => box.scrollWidth > box.clientWidth + 0.5,
    ),
  )

/** A point on the element's first letter, in the middle of its line. */
const onFirstLetter = (anchor: Locator) =>
  anchor.evaluate((element) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node as Text
      const at = text.data.search(/\S/u)
      if (at < 0) continue
      const range = document.createRange()
      range.setStart(text, at)
      range.setEnd(text, at + 1)
      const box = range.getBoundingClientRect()
      if (box.width > 0) return { x: box.left + box.width / 2, y: box.top + box.height / 2 }
    }
    throw new Error('no letter shows')
  })

const whole = (page: Page) => page.locator('.whole-text')

/**
 * Points at the cut `anchor` with one move from a corner of the window that shows nothing, after
 * every hint is cold, and waits for its whole text; returns it measured, with how often the count
 * of hints on the window changed meanwhile.
 */
async function pointAt(page: Page, anchor: Locator, rows: string) {
  const viewport = page.viewportSize() ?? { width: 0, height: 0 }
  await page.mouse.move(viewport.width - 2, viewport.height - 2)
  await expect(whole(page)).toHaveCount(0)
  await pass(page, 700)
  expect(await isCut(anchor), 'the element is cut').toBe(true)
  const at = await onFirstLetter(anchor)
  // Once a page: a second watch would note every change twice.
  if (!(await page.evaluate(() => 'hintLog' in window))) await watchHints(page)
  await watched(page)
  await page.mouse.move(at.x, at.y)
  await expect(whole(page)).toBeVisible()
  // Long enough for a loop of closing under the pointer and opening again to show itself.
  await pass(page, 800)
  const { changes } = await watched(page)
  const laid = await laidOver(anchor, rows)
  if (!laid) throw new Error('no whole text lies over the element')
  return { at, changes: changes.map((change) => change.count), laid }
}

/** What every whole text must be against its element, at `width`. */
function expectLaid(laid: Laid, width: number) {
  expect(laid.text).toBe(laid.words.trim())
  expect(Math.abs(laid.offset.x), 'first letters apart across, in px').toBeLessThanOrEqual(1)
  expect(Math.abs(laid.offset.y), 'first letters apart down, in px').toBeLessThanOrEqual(1)
  expect(laid.laid).toEqual(laid.own)
  expect(laid.box.right, 'its right edge, 8px inside the window').toBeLessThanOrEqual(
    width - 8 + 0.5,
  )
  expect(laid.box.left).toBeGreaterThanOrEqual(0)
  if (laid.lines === 1) expect(laid.neighbours, 'other rows it covers on one line').toBe(0)
}

/** One element whose text is cut, the rows of its list, and how it answers a press. */
interface Case {
  anchor: Locator
  name: string
  rows: string
  answered: () => Promise<void>
}

/** Measures the whole text of one element, then presses it and waits for its element's answer. */
async function check(page: Page, info: TestInfo, { anchor, answered, name, rows }: Case) {
  const width = page.viewportSize()?.width ?? 0
  const { at, changes, laid } = await pointAt(page, anchor, rows)
  await record(info, `whole text ${name} ${width}`, { changes, laid })
  // Opened under a still pointer, it changed the count of hints once: it never closed under it.
  expect(changes, 'changes of the count of hints').toEqual([1])
  expectLaid(laid, width)
  // A press where it lies over its element lands on that element.
  await page.mouse.move(at.x + 1, at.y)
  await page.mouse.down()
  await page.mouse.up()
  await answered()
  return laid
}

/** The rail at its narrowest, holding a row whose title it cuts, from the Settings page. */
async function openRail(page: Page, width: number) {
  await page.setViewportSize({ width, height: 800 })
  await installBackend(page)
  const streams = await installLiveStreams(page)
  await page.goto(SETTINGS)
  await expect.poll(() => streams.open()).toHaveLength(1)
  const frame = busyFrame()
  frame.spaces.push({
    key: 'LONG',
    name: 'Long',
    project_id: 'example-project',
    rows: [frameRow('LONG-1', { title: LONG_TITLE, state: 'working' })],
    sessions: [],
  })
  await streams.live(frame)
  const edge = page.getByRole('separator', { name: 'Navigation width' })
  await edge.focus()
  await page.keyboard.press('Home')
  await edge.blur()
  const row = page.locator('.nav-row', { has: page.locator('[aria-label^="LONG-1 "]') })
  // The rail's list scrolls under its modules, which stand over the rows at its foot.
  await row.scrollIntoViewIfNeeded()
  await pass(page, 300)
  await expect(row).toBeVisible()
  return { edge, row, title: row.locator('.nav-row-title') }
}

for (const width of [1440, 1024]) {
  test.describe(`at ${width}px`, () => {
    test.beforeEach(async ({ page }) => {
      await page.addInitScript(() => localStorage.setItem('valkama-locale', 'en'))
    })

    test('a title the rail cuts reads on over the rail, holds while pointed at and opens its row', async ({
      page,
    }, info) => {
      const { row, title } = await openRail(page, width)
      const rows = '.nav-row, .nav-tree-head'
      const { laid } = await pointAt(page, title, rows)
      expectLaid(laid, width)
      // Past the rail, the far end of the text keeps it up, as anywhere on it does.
      const far = { x: laid.box.right - 3, y: (laid.box.top + laid.box.bottom) / 2 }
      const rail = await page
        .locator('.app-nav-shell')
        .evaluate((node) => node.getBoundingClientRect().right)
      expect(far.x).toBeGreaterThan(rail)
      await page.mouse.move(far.x, far.y, { steps: 12 })
      await pass(page, 500)
      await expect(whole(page)).toBeVisible()

      const link = row.locator('a.nav-row-link')
      const href = (await link.getAttribute('href')) ?? ''
      expect(href).not.toBe('')
      await check(page, info, {
        anchor: title,
        answered: async () => {
          await expect
            .poll(() => new URL(page.url()).pathname + new URL(page.url()).search)
            .toBe(href)
        },
        name: 'rail',
        rows,
      })
    })

    test('a width that leaves the title whole takes its whole text away, and one that cuts it brings it back', async ({
      page,
    }) => {
      const { edge, title } = await openRail(page, width)
      await pointAt(page, title, '.nav-row')
      // Widened from the keyboard, the pointer resting where it was: the title stands whole.
      await edge.focus()
      await page.keyboard.press('End')
      await expect(whole(page)).toHaveCount(0)
      expect(await isCut(title)).toBe(false)
      // Narrowed again, with no pointer moving, its whole text comes back after the rest.
      await pass(page, 400)
      await page.keyboard.press('Home')
      await expect(whole(page)).toBeVisible()
    })

    test('a holder the list cuts reads on over its row, and a press opens the row’s card', async ({
      page,
    }, info) => {
      await page.setViewportSize({ width, height: 900 })
      await installBackend(page, {
        space: (model) => {
          const items = model.work_items as Record<string, unknown>[]
          const held = { ...items[0], claim_ref: LONG_HOLDER, claim_state: 'unconfirmed' }
          return { ...model, work_items: [held, ...items.slice(1)] }
        },
      })
      await openList(page)
      // In its column where the list is wide, on the row's line of facts where it is not.
      const holder = page
        .locator(
          `.work-item-list tbody [data-tooltip-kind="clipped"][data-tooltip="${LONG_HOLDER}"]`,
        )
        .first()
      await check(page, info, {
        anchor: holder,
        answered: () => expect(page.locator('.drawer')).toHaveCount(1),
        name: 'list',
        rows: '.work-item-list tbody tr',
      })
    })

    test('a task’s name the Analytics table cuts reads on over its row, and a press opens its card', async ({
      page,
    }, info) => {
      await serveAnalytics(page, [
        worked(9, task(264, LONG_TASK), ['model-a', 'main', 'alpha'], 5),
        worked(10, task(2, 'Write the release notes'), ['model-b', 'subagent', 'beta'], 3),
      ])
      await serveTask(page)
      await openReport(page, width, pageAt({ by: 'work_item' }))
      const name = page.locator('.spending-table tbody th a.chart-press').first()
      await name.scrollIntoViewIfNeeded()
      await pass(page, 300)
      const before = page.url()
      await check(page, info, {
        anchor: name,
        answered: async () => {
          await expect.poll(() => page.url()).not.toBe(before)
          await expect(page.locator('.drawer')).toHaveCount(1)
        },
        name: 'analytics',
        rows: '.spending-table tbody tr',
      })
    })

    test('an epic’s title its lane head cuts reads on over the head, and a press folds the lane', async ({
      page,
    }, info) => {
      await page.setViewportSize({ width, height: 900 })
      await installBackend(page, {
        space: (model) => {
          const items = model.work_items as Record<string, unknown>[]
          const epic = {
            ...items[0],
            work_item_id: identity(12),
            reference: 'MAIN-12',
            number: 12,
            title: EPIC_TITLE,
            kind: 'epic',
            claim_ref: '',
            claim_state: null,
          }
          return { ...model, work_items: [epic, ...items] }
        },
      })
      await openBoard(page)
      const head = page.locator('.lane-head', {
        has: page.locator('.lane-title', { hasText: EPIC_TITLE }),
      })
      const title = head.locator('.lane-title')
      const toggle = head.locator('button[aria-expanded]').first()
      const expanded = await toggle.getAttribute('aria-expanded')
      await check(page, info, {
        anchor: title,
        answered: () => expect(toggle).not.toHaveAttribute('aria-expanded', expanded ?? ''),
        name: 'lane',
        rows: '.lane-head, .work-item-board li[data-reference]',
      })
    })
  })
}
