/**
 * The Analytics panel has one scroll, in the real app over the browser double. The oracle is the
 * requirement: inside the panel nothing scrolls up and down on its own — no element there holds
 * more than it shows under an `overflow-y` of `auto` or `scroll` — in the overview, the task
 * section with 44 tasks and the token kinds, at 1280×800, 1440×900, 1670×985 and 1920×1080. The
 * task table stands at its full height in that scroll; with the panel scrolled to the table's
 * middle and to its last rows, its heading row and its total are both inside the panel's visible
 * box and drawn over the rows, a row's name focused there stands clear of both, and «To the table»
 * over the charts brings the table into view with the focus on it. Each run prints what it
 * measured.
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { task, value } from '../fixtures/analytics.ts'
import type { TimedStretch } from '../fixtures/analytics.ts'
import { pageAt, record, serve, TASK_REPORT } from './analyticsPage.ts'
import { test } from './test.ts'

/** Forty-four tasks over the three days of the week so far, each its own share of the time. */
const TASKS: TimedStretch[] = Array.from({ length: 44 }, (_, index) => ({
  at: new Date(2026, 10, 9 + (index % 3), 10),
  group: {
    work_item: task(
      index + 1,
      `Read the planning documents through the board reader, ${index + 1}`,
    ),
    account: value('5b0c7e21-4a3f-4d8e-9c16-2f7a8b9d0e1f'),
  },
  spend: { seconds: (45 - index) * 1800, tokens: (45 - index) * 90_000, cost: 45 - index },
}))

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
      .map((one) => ({
        part: one.className,
        holds: one.scrollHeight,
        shows: one.clientHeight,
      }))
    return { inner, panel: panel.scrollHeight - panel.clientHeight }
  })

/** Waits two frames, so a scroll-driven part has followed the last scroll. */
const settle = (page: Page) =>
  page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  )

/**
 * Scrolls the panel so that the share `at` of the task table's height stands at the middle of
 * the panel's visible box, then says where the heading row, the total and the rows stand.
 */
async function scrollTableTo(page: Page, at: number) {
  await page.evaluate((share) => {
    const panel = document.querySelector<HTMLElement>('.analytics-panel')
    const table = document.querySelector('.spending-table-frame')
    if (!panel || !table) throw new Error('no table')
    const box = table.getBoundingClientRect()
    const top = box.top - panel.getBoundingClientRect().top + panel.scrollTop
    panel.scrollTop = top + box.height * share - panel.clientHeight / 2
  }, at)
  await settle(page)
  return page.evaluate(() => {
    const panel = document.querySelector<HTMLElement>('.analytics-panel')
    const frame = document.querySelector('.spending-table-frame')
    if (!panel || !frame) throw new Error('no table')
    const shown = panel.getBoundingClientRect()
    const visible = { top: shown.top, bottom: shown.top + panel.clientHeight }
    // A cell sticks, not its row group, so the cells say where they stand.
    const seen = (cell: Element | null) => {
      if (!cell) return null
      const { left, right, top, bottom } = cell.getBoundingClientRect()
      const hit = document.elementFromPoint((left + right) / 2, (top + bottom) / 2)
      return {
        top: Math.round(top),
        bottom: Math.round(bottom),
        inside: top >= visible.top - 0.5 && bottom <= visible.bottom + 0.5,
        onTop: hit !== null && cell.contains(hit),
      }
    }
    const rows = [...frame.querySelectorAll('tbody tr')].filter((row) => {
      const box = row.getBoundingClientRect()
      return box.bottom > visible.top && box.top < visible.bottom
    })
    return {
      scrolled: Math.round(panel.scrollTop),
      visible: { top: Math.round(visible.top), bottom: Math.round(visible.bottom) },
      rowsInView: rows.length,
      head: seen(frame.querySelector('thead th:nth-child(2)')),
      total: seen(frame.querySelector('tfoot th')),
    }
  })
}

for (const [width, height] of SIZES)
  test.describe(`at ${width}×${height}`, () => {
    test.beforeEach(async ({ page }) => {
      await serve(page, TASKS)
      await page.setViewportSize({ width, height })
    })

    test('nothing inside the panel scrolls up and down on its own', async ({ page }, info) => {
      const seen: Record<string, unknown> = {}
      for (const section of SECTIONS) {
        await page.goto(section.address)
        await expect(page.locator(section.ready).first()).toBeVisible()
        await page.evaluate(() => document.fonts.ready)
        await settle(page)
        const scrolls = await ownScrolls(page)
        seen[section.name] = scrolls
        expect(scrolls.inner, `${section.name}: parts that scroll on their own`).toEqual([])
      }
      // The task section holds every one of its rows in the panel's one scroll.
      await page.goto(TASK_REPORT)
      await expect(page.locator('.spending-table tbody tr')).toHaveCount(44)
      await record(info, `one scroll ${width}x${height}`, seen)
      // The overview's chart keeps a drawing field of 200 pixels at least.
      await page.goto(pageAt())
      const field = await page.locator('.overview-panel .period-field').boundingBox()
      expect(Math.round(field?.height ?? 0)).toBeGreaterThanOrEqual(200)
    })

    test('the table’s heading row and total stay in view while its rows are', async ({
      page,
    }, info) => {
      await page.goto(TASK_REPORT)
      await expect(page.locator('.spending-table tbody tr').first()).toBeVisible()
      await page.evaluate(() => document.fonts.ready)
      const middle = await scrollTableTo(page, 0.5)
      const end = await scrollTableTo(page, 0.97)
      await record(info, `stuck edges ${width}x${height}`, { middle, end })
      for (const [where, at] of Object.entries({ middle, end })) {
        expect(at.rowsInView, `${where}: rows in view`).toBeGreaterThan(0)
        expect(at.head, `${where}: the heading row`).toMatchObject({ inside: true, onTop: true })
        expect(at.total, `${where}: the total`).toMatchObject({ inside: true, onTop: true })
        expect(
          at.head?.bottom ?? 0,
          `${where}: the heading row over the total`,
        ).toBeLessThanOrEqual(at.total?.top ?? 0)
      }
      // In the middle the heading row stands at the panel's top edge and the total at its bottom.
      expect(Math.abs((middle.head?.top ?? 0) - middle.visible.top)).toBeLessThanOrEqual(1)
      expect(Math.abs((middle.total?.bottom ?? 0) - middle.visible.bottom)).toBeLessThanOrEqual(1)

      // A row's name focused under the total is brought up clear of it, and of the heading row.
      await scrollTableTo(page, 0.2)
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
      await page.getByRole('button', { name: 'To the table' }).click()
      await expect(page.locator('.spending-table')).toBeFocused()
      await settle(page)
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
