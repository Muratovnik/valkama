/**
 * The table of the task section fits its frame on a desktop, in the real app over the browser
 * double: in Russian and in English, for «Today», whose period before is named with its hours
 * («Ранее, 10 нояб., 00:00–14:30»), and for the week, at 1280, 1440, 1670 and 1920 pixels, the
 * name, the three measures, the period before and the change stand in the frame and nothing in it
 * scrolls sideways. A heading over figures takes a second line only where one line would widen
 * the table past its frame: at 1920 every one is one line.
 *
 * The name gives the figures its room down to its floor, eight of the table's ems, and is cut
 * there, said whole in its hint under the pointer and the keyboard's focus. It is cut only for
 * the figures: every column of figures is as wide as its cells ask and no wider. Where even the
 * floor leaves the figures too little, at a window of 900 pixels, the table scrolls sideways in
 * its frame with the names held at its start. Each run prints what it measured.
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { task, value } from '../fixtures/analytics.ts'
import type { TimedStretch } from '../fixtures/analytics.ts'
import {
  expectNamesInView,
  openReport,
  pageAt,
  record,
  scrolledNames,
  serve,
  shortfalls,
} from './analyticsPage.ts'
import { test } from './test.ts'

const ACCOUNT = value('5b0c7e21-4a3f-4d8e-9c16-2f7a8b9d0e1f')

/** Sixteen tasks of long titles, each with work today; how much each did yesterday varies. */
const TASKS: TimedStretch[] = Array.from({ length: 16 }, (_, index) => {
  const group = {
    work_item: task(index + 1, `Read the planning documents through the board reader ${index + 1}`),
    account: ACCOUNT,
  }
  // Today: from an hour and seventeen minutes down to under a minute; tokens and a price, but
  // for the last four, which a client recorded no tokens for («Нет токенов», «Нет цены»).
  const counted = index < 12
  const today: TimedStretch = {
    at: new Date(2026, 10, 11, 9, index),
    group,
    spend: {
      seconds: counted ? (16 - index) * 290 : 30,
      tokens: counted ? 375_700 - index * 9000 : null,
      cost: counted ? 7.56 + index : null,
    },
  }
  // Yesterday by the same hour: under a minute, one second (a change of thousands of percent),
  // a few minutes, or nothing at all («Nothing before»).
  const seconds = [30, 1, 300, 0][index % 4] ?? 0
  const before: TimedStretch[] = seconds
    ? [{ at: new Date(2026, 10, 10, 9, index), group, spend: { seconds, tokens: 0, cost: 0 } }]
    : []
  return [today, ...before]
}).flat()

const PERIODS = {
  today: pageAt({ by: 'work_item', period: 'today' }),
  week: pageAt({ by: 'work_item' }),
}

/** The least the name's column keeps, in ems of the table's text. */
const FLOOR_EMS = 8

/** Windows of a desktop, where the table fits its frame. */
const DESKTOP = [1280, 1440, 1670, 1920]

/** A window whose frame is narrower than the figures and the name's floor. */
const NARROW = 900

/**
 * How the table stands in its frame: how far it runs past the frame, to the fraction of a pixel,
 * where the change's column ends against the frame's end, the name's column against its floor,
 * how many lines each heading over figures takes, and how much wider each column of figures is
 * than the widest of its cells asks: its words with the cell's padding, or the least the cell
 * holds.
 */
const fit = (page: Page) =>
  page.evaluate((floorEms) => {
    const frame = document.querySelector<HTMLElement>('.spending-table .chart-table-frame')
    const table = frame?.querySelector('table')
    if (!frame || !table) throw new Error('no table')
    const edges = frame.getBoundingClientRect()
    const columns = [...table.querySelectorAll<HTMLElement>('thead th')]
    const name = columns[0]?.getBoundingClientRect().width ?? 0
    const change = columns.at(-1)?.getBoundingClientRect().right ?? Number.POSITIVE_INFINITY
    const headings = columns.slice(1).map((cell) => {
      const words = cell.querySelector('button')
      const line = Number.parseFloat(getComputedStyle(cell).lineHeight)
      const height = words?.getBoundingClientRect().height ?? 0
      return { text: cell.textContent.trim(), lines: Math.round(height / line) }
    })
    const range = document.createRange()
    const asks = (cell: Element) => {
      const style = getComputedStyle(cell)
      range.selectNodeContents(cell)
      const words =
        range.getBoundingClientRect().width +
        Number.parseFloat(style.paddingLeft) +
        Number.parseFloat(style.paddingRight)
      return Math.max(words, Number.parseFloat(style.minInlineSize) || 0)
    }
    const slack = columns.slice(1).map((heading, index) => {
      const cells = table.querySelectorAll(`tr > :nth-child(${index + 2})`)
      const widest = Math.max(...[...cells].map((cell) => asks(cell)))
      return Math.round((heading.getBoundingClientRect().width - widest) * 10) / 10
    })
    const floor = floorEms * Number.parseFloat(getComputedStyle(table).fontSize)
    return {
      frame: frame.clientWidth,
      scroll: frame.scrollWidth - frame.clientWidth,
      past: Math.round((table.getBoundingClientRect().width - edges.width) * 100) / 100,
      changePast: Math.round((change - edges.right) * 100) / 100,
      name: Math.round(name * 10) / 10,
      floor,
      headings,
      slack,
    }
  }, FLOOR_EMS)

/** The table's names, each with how far its words run past its box (above zero: cut). */
const names = (page: Page) => shortfalls(page, '.spending-table tbody .table-name')

for (const locale of ['ru', 'en'] as const)
  test.describe(`in ${locale}`, () => {
    test.use({ locale: locale === 'ru' ? 'ru-RU' : 'en-US' })

    test.beforeEach(async ({ page }) => {
      await page.addInitScript((chosen) => localStorage.setItem('valkama-locale', chosen), locale)
      await serve(page, TASKS)
    })

    for (const [period, address] of Object.entries(PERIODS)) {
      test(`the task table of ${period} fits its frame on a desktop`, async ({ page }, info) => {
        const seen: Record<number, Awaited<ReturnType<typeof fit>>> = {}
        let wide: Awaited<ReturnType<typeof names>> = []
        for (const width of DESKTOP) {
          const analytics = await openReport(page, width, address)
          await expect(analytics.locator('.spending-table thead th')).toHaveCount(6)
          await page.evaluate(() => document.fonts.ready)
          const at = await fit(page)
          seen[width] = at
          const where = `${period} at ${width}px`
          expect.soft(at.scroll, `${where}: the table scrolls past its frame`).toBe(0)
          expect.soft(at.past, `${where}: the table past its frame`).toBeLessThanOrEqual(0.5)
          expect.soft(at.changePast, `${where}: the change past the frame`).toBeLessThanOrEqual(0.5)
          expect
            .soft(at.name, `${where}: the name under its floor`)
            .toBeGreaterThanOrEqual(at.floor - 0.5)
          // The name is cut for the figures alone: none of their columns holds room it leaves.
          for (const [index, room] of at.slack.entries())
            expect
              .soft(room, `${where}: room left in ${at.headings[index]?.text}`)
              .toBeLessThanOrEqual(1)
          // Read at each width; the widest, where every name has room, is the last.
          wide = await names(page)
        }
        await record(info, `task table fit ${locale} ${period}`, seen)
        // At 1920 every name has the room it needs.
        for (const one of wide)
          expect.soft(one.short, `at 1920px: «${one.text}» cut`).toBeLessThanOrEqual(0)
        // Where one line fits, a heading keeps to it.
        for (const heading of seen[1920]?.headings ?? [])
          expect.soft(heading.lines, `${heading.text} at 1920px`).toBe(1)
      })

      test(`the task table of ${period} scrolls with its names held where the floor does not fit`, async ({
        page,
      }, info) => {
        await openReport(page, NARROW, address)
        await page.evaluate(() => document.fonts.ready)
        const at = await fit(page)
        await record(info, `task table narrow ${locale} ${period}`, at)
        expect(at.scroll, 'the floor fits the frame: nothing to scroll').toBeGreaterThan(0)
        expect(at.name, 'the name under its floor').toBeGreaterThanOrEqual(at.floor - 0.5)
        const held = await scrolledNames(page)
        expect(expectNamesInView(held), 'no table scrolled').toBeGreaterThan(0)
      })
    }

    test('a cut name says itself whole in its hint, under the pointer and the focus', async ({
      page,
    }) => {
      const analytics = await openReport(page, 1280, PERIODS.today)
      await page.evaluate(() => document.fonts.ready)
      const [first] = await names(page)
      expect(first?.short, 'the first name is not cut').toBeGreaterThan(0)
      const name = analytics.locator('.spending-table tbody .table-name').first()
      const text = await name.textContent()
      const whole = text?.trim() ?? ''
      const hint = page.getByRole('tooltip')

      await page.mouse.move(0, 0)
      await expect(hint).toBeHidden()
      await name.hover()
      await expect(hint).toBeVisible()
      await expect(hint).toContainText(whole)

      await page.mouse.move(0, 0)
      await expect(hint).toBeHidden()
      // From the last heading of the table, the next stop of the keyboard is the first row's name.
      await analytics.locator('.spending-table thead th button').last().focus()
      await page.keyboard.press('Tab')
      await expect(name.locator('a')).toBeFocused()
      await expect(hint).toBeVisible()
      await expect(hint).toContainText(whole)
    })
  })
