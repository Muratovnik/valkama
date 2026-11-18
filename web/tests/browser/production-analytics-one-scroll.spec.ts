/**
 * The Analytics panel has one scroll and the task table one more, in the real app over the browser
 * double. The oracle is the requirement: inside the panel only the task table's frame scrolls up
 * and down on its own — no other element there holds more than it shows under an `overflow-y` of
 * `auto` or `scroll` — in the overview, the task section with 44 tasks and the token kinds, at
 * 1280×800, 1440×900, 1670×985 and 1920×1080. The table's frame is held in height, so the table
 * and its heading line stand in the window together, and it scrolls inside itself. Scrolled, the
 * table or the panel round it, frame by frame, its heading row stands at the frame's top edge and
 * its total at its bottom edge, both drawn over the rows, with no frame between scrolls where
 * either has moved off its edge; a row's name focused there stands clear of both, and «To the
 * table» over the charts brings the table into view with the focus on it. The heading row and the
 * total hold to the edges as well when the table is drawn anew after the section opened: a split
 * chosen, a split section reloaded and a split taken away. Each run prints what it measured.
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { pageAt, record, serve, TASK_REPORT } from './analyticsPage.ts'
import { TASKS } from './served/analyticsOneScroll.ts'
import { test } from './test.ts'
const SIZES = [
  [1280, 800],
  [1440, 900],
  [1670, 985],
  [1920, 1080],
] as const

/** The sections the panel is measured in, by their address and a part that says it is drawn. */
const SECTIONS = [
  { name: 'overview', address: pageAt(), ready: '.overview-panel .period-field' },
  { name: 'task', address: TASK_REPORT, ready: '.spending-table tbody tr' },
  { name: 'token kinds', address: pageAt({ by: 'token_kind' }), ready: '.kinds-table tbody tr' },
] as const

/** Every element inside the panel that scrolls up and down on its own, and the panel's own scroll. */
const ownScrolls = (page: Page) =>
  page.evaluate(() => {
    const panel = document.querySelector<HTMLElement>('.analytics-panel')
    if (!panel) throw new Error('no panel')
    const inner = [...panel.querySelectorAll<HTMLElement>('*')]
      .filter(
        (one) =>
          ['auto', 'scroll'].includes(getComputedStyle(one).overflowY) &&
          one.scrollHeight > one.clientHeight,
      )
      .map((one) => (one.matches('.spending-table-frame') ? 'spending-table-frame' : one.className))
    return { inner, panel: panel.scrollHeight - panel.clientHeight }
  })

/** Waits two frames, so whatever follows a scroll has followed the last one. */
const settle = (page: Page) =>
  page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  )

/** Brings the table into view through «To the table», as a reader does, and waits for it. */
async function toTable(page: Page) {
  await page.getByRole('button', { name: 'To the table' }).click()
  await expect(page.locator('.spending-table')).toBeFocused()
  await settle(page)
}

/**
 * Scrolls the table's frame, and then the panel round it, a step a frame, and after every step,
 * both before the frame is drawn and once it is, says how far the heading row's top stands from
 * the frame's top edge and the total's bottom from its bottom edge, the frame's scroll bars left
 * out, and whether each is drawn over the rows where the panel shows it. Returns the samples and
 * the scrolls they covered.
 */
function scrollSamples(page: Page) {
  return page.evaluate(async () => {
    const panel = document.querySelector<HTMLElement>('.analytics-panel')
    const frame = document.querySelector<HTMLElement>('.spending-table-frame')
    if (!panel || !frame) throw new Error('no table')
    const head = frame.querySelector('thead th:nth-child(2)')
    const total = frame.querySelector('tfoot th')
    if (!head || !total) throw new Error('no heading row or total')
    // Drawn over the rows, where the panel shows the cell; one the panel scrolled away is not hit.
    const onTop = (cell: Element) => {
      const { left, right, top, bottom } = cell.getBoundingClientRect()
      const shown = panel.getBoundingClientRect()
      if (top < shown.top || bottom > shown.top + panel.clientHeight) return true
      const hit = document.elementFromPoint((left + right) / 2, (top + bottom) / 2)
      return hit !== null && cell.contains(hit)
    }
    const samples: { by: string; head: number; onTop: boolean; total: number }[] = []
    const sample = (by: string) => {
      const box = frame.getBoundingClientRect()
      const top = box.top + frame.clientTop
      const bottom = top + frame.clientHeight
      samples.push({
        by,
        head: Math.round((head.getBoundingClientRect().top - top) * 10) / 10,
        total: Math.round((bottom - total.getBoundingClientRect().bottom) * 10) / 10,
        onTop: onTop(head) && onTop(total),
      })
    }
    const end = frame.scrollHeight - frame.clientHeight
    const steps = 12
    for (let step = 1; step <= steps; step += 1) {
      frame.scrollTop = (end * step) / steps
      sample('table')
      await new Promise((done) => requestAnimationFrame(done))
      sample('table')
    }
    // The table halfway, and the panel scrolled round it, up and back down a step a frame.
    frame.scrollTop = end / 2
    const at = panel.scrollTop
    for (const shift of [-40, -80, -120, -80, -40, 0]) {
      panel.scrollTop = at + shift
      sample('panel')
      await new Promise((done) => requestAnimationFrame(done))
      sample('panel')
    }
    return { samples, tableEnd: end, panelAt: at }
  })
}

/**
 * Holds that the table's frame scrolls inside itself and that at every sample of a scroll of it
 * and of the panel round it (`scrollSamples`), its heading row and total stand at its edges and
 * are drawn over the rows; `path` names how the table was reached. Each miss is reported and the
 * run goes on. Returns what it measured.
 */
async function expectEdges(page: Page, path: string) {
  const measured = await scrollSamples(page)
  expect.soft(measured.tableEnd, `${path}: the frame scrolls inside itself`).toBeGreaterThan(0)
  const off = measured.samples.filter(
    (one) => Math.abs(one.head) > 0.5 || Math.abs(one.total) > 0.5 || !one.onTop,
  )
  expect.soft(off, `${path}: samples with the heading row or total off its edge`).toEqual([])
  const worst = (side: 'head' | 'total') =>
    Math.max(...measured.samples.map((one) => Math.abs(one[side])))
  return {
    tableEnd: measured.tableEnd,
    panelAt: measured.panelAt,
    samples: measured.samples.length,
    worst: { head: worst('head'), total: worst('total') },
  }
}

/** Chooses the second dimension the task section is split by, through «Split by» in its heading. */
async function splitBy(page: Page, name: string) {
  await page.locator('.dimension-section > .level-head .dimension-split .choice-trigger').click()
  await page.getByRole('option', { name, exact: true }).click()
}

/**
 * The table is drawn anew after its section opened whenever a split is chosen or taken away, and
 * on a reload of a split section it comes only once the read by both dimensions lands: on each of
 * those paths its heading row and total keep to its frame's edges as on the first opening.
 */
test('the heading row and total keep to the edges on every path to the table', async ({
  page,
}, info) => {
  await serve(page, TASKS)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(TASK_REPORT)
  const rows = page.locator('.spending-table tbody tr')
  await expect(rows).toHaveCount(44)
  await page.evaluate(() => document.fonts.ready)
  const seen: Record<string, unknown> = {}

  // The organization a pair names after its task, by the start of its id, says the split has
  // landed.
  const paired = rows.first().getByText('5b0c7e21', { exact: false })
  await splitBy(page, 'Organization')
  await expect(paired).toBeVisible()
  await toTable(page)
  seen.split = await expectEdges(page, 'split chosen')

  await page.reload()
  await expect(paired).toBeVisible()
  await expect(rows).toHaveCount(44)
  await page.evaluate(() => document.fonts.ready)
  await toTable(page)
  seen.reloaded = await expectEdges(page, 'split section reloaded')

  await splitBy(page, 'None')
  await expect(paired).toHaveCount(0)
  await expect(rows).toHaveCount(44)
  await toTable(page)
  seen.unsplit = await expectEdges(page, 'split taken away')
  await record(info, 'table edges on every path', seen)
})

for (const [width, height] of SIZES)
  test.describe(`at ${width}×${height}`, () => {
    test.beforeEach(async ({ page }) => {
      await serve(page, TASKS)
      await page.setViewportSize({ width, height })
    })

    test('only the task table scrolls up and down inside the panel', async ({ page }, info) => {
      const seen: Record<string, unknown> = {}
      for (const section of SECTIONS) {
        await page.goto(section.address)
        await expect(page.locator(section.ready).first()).toBeVisible()
        await page.evaluate(() => document.fonts.ready)
        await settle(page)
        const scrolls = await ownScrolls(page)
        seen[section.name] = scrolls
        expect(scrolls.inner, `${section.name}: parts that scroll on their own`).toEqual(
          section.name === 'task' ? ['spending-table-frame'] : [],
        )
      }
      await record(info, `scrolls ${width}x${height}`, seen)
      // The overview's chart keeps a drawing field of 200 pixels at least.
      await page.goto(pageAt())
      const field = await page.locator('.overview-panel .period-field').boundingBox()
      expect(Math.round(field?.height ?? 0)).toBeGreaterThanOrEqual(200)
    })

    test('the table and its heading line stand in the window together', async ({ page }, info) => {
      await page.goto(TASK_REPORT)
      await expect(page.locator('.spending-table tbody tr')).toHaveCount(44)
      await page.evaluate(() => document.fonts.ready)
      await toTable(page)
      const placed = await page.evaluate(() => {
        const panel = document.querySelector<HTMLElement>('.analytics-panel')
        const table = document.querySelector('.spending-table')
        const frame = document.querySelector<HTMLElement>('.spending-table-frame')
        if (!panel || !table || !frame) throw new Error('no table')
        const shown = panel.getBoundingClientRect()
        const box = table.getBoundingClientRect()
        return {
          panel: { top: Math.round(shown.top), bottom: Math.round(shown.top + panel.clientHeight) },
          table: { top: Math.round(box.top), bottom: Math.round(box.bottom) },
          frame: { holds: frame.scrollHeight, shows: frame.clientHeight },
        }
      })
      await record(info, `table in the window ${width}x${height}`, placed)
      expect(placed.frame.holds, 'a frame that holds every row').toBeGreaterThan(placed.frame.shows)
      expect(placed.table.top).toBeGreaterThanOrEqual(placed.panel.top)
      expect(placed.table.bottom).toBeLessThanOrEqual(placed.panel.bottom)
    })

    test('the heading row and total stay at the frame’s edges while it and the panel scroll', async ({
      page,
    }, info) => {
      await page.goto(TASK_REPORT)
      await expect(page.locator('.spending-table tbody tr').first()).toBeVisible()
      await page.evaluate(() => document.fonts.ready)
      await toTable(page)
      await record(info, `table edges ${width}x${height}`, await expectEdges(page, 'opened'))

      // A row's name focused under the total is brought up clear of it, and of the heading row.
      await page.locator('.spending-table-frame').evaluate((frame) => {
        frame.scrollTop = 0
      })
      const name = page.locator('.spending-table tbody tr').nth(30).locator('.chart-press')
      await name.focus()
      await settle(page)
      const clear = await name.evaluate((one) => {
        const box = one.getBoundingClientRect()
        const head = document.querySelector('.spending-table thead th')?.getBoundingClientRect()
        const foot = document.querySelector('.spending-table tfoot th')?.getBoundingClientRect()
        return {
          belowHead: head !== undefined && box.top >= head.bottom - 0.5,
          aboveTotal: foot !== undefined && box.bottom <= foot.top + 0.5,
        }
      })
      expect(clear).toEqual({ belowHead: true, aboveTotal: true })
    })

    test('«To the table» brings the table into view with the focus on it', async ({ page }) => {
      await page.goto(TASK_REPORT)
      await expect(page.locator('.spending-table tbody tr').first()).toBeVisible()
      await toTable(page)
      const placed = await page.evaluate(() => {
        const panel = document.querySelector<HTMLElement>('.analytics-panel')
        const table = document.querySelector('.spending-table')?.getBoundingClientRect()
        if (!panel || !table) throw new Error('no table')
        const top = panel.getBoundingClientRect().top
        return { scrolled: panel.scrollTop, offset: Math.round(table.top - top) }
      })
      expect(placed.scrolled).toBeGreaterThan(0)
      // The table's own heading stands at the top of what the panel shows.
      expect(placed.offset).toBeGreaterThanOrEqual(0)
      expect(placed.offset).toBeLessThanOrEqual(24)
    })
  })
