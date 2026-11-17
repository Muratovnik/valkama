/**
 * The table of the task section fits its frame on a desktop, in the real app over the browser
 * double: in Russian and in English, for «Today», whose period before is named with its hours
 * («Ранее, 10 нояб., 00:00–14:30»), and for the week, at 1280, 1440, 1670 and 1920 pixels, the
 * name, the three measures, the period before and the change stand in the frame and nothing in it
 * scrolls sideways. A heading over figures takes a second line only where one line would widen
 * the table past its frame: at 1920 every one is one line.
 *
 * The name gives the figures its room down to its floor, eight of the table's ems, and is cut
 * there, its whole words laid over it under the pointer and the keyboard's focus. It is cut only for
 * the figures: every column of figures is as wide as its cells ask and no wider. Where even the
 * floor leaves the figures too little, at a window of 900 pixels, the table scrolls sideways in
 * its frame with the names held at its start. Each run prints what it measured.
 *
 * A cost that leaves tokens without a price says how many on a second, quieter line under its
 * amount, the amount on the row's line beside the other figures. Its column is then as wide as
 * the longer of the two lines, not as both side by side; at 1280 the table may still scroll
 * sideways for it, and at 1670 it fits its frame.
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
import { wholeText } from './hintFramesPage.ts'
import { test } from './test.ts'

const ACCOUNT = value('5b0c7e21-4a3f-4d8e-9c16-2f7a8b9d0e1f')

/**
 * Sixteen tasks of long titles, each with work today; how much each did yesterday varies. A task
 * `unpriced` names a count for has a price for only part of its tokens, today and the day before.
 */
const tasks = (unpriced: (index: number) => number = () => 0): TimedStretch[] =>
  Array.from({ length: 16 }, (_, index) => {
    const group = {
      work_item: task(
        index + 1,
        `Read the planning documents through the board reader ${index + 1}`,
      ),
      account: ACCOUNT,
    }
    const left = unpriced(index)
    // Today: from an hour and seventeen minutes down to under a minute; tokens and a price, but
    // for the last four, which a client recorded no tokens for («Нет токенов», «Нет цены»). A
    // task that leaves tokens without a price costs a thousand dollars and more.
    const counted = index < 12
    const price = left ? 1100 : 7.56
    const today: TimedStretch = {
      at: new Date(2026, 10, 11, 9, index),
      group,
      spend: {
        seconds: counted ? (16 - index) * 290 : 30,
        tokens: counted ? 375_700 - index * 9000 : null,
        cost: counted ? price + index : null,
        unpriced: left,
      },
    }
    // Yesterday by the same hour: under a minute, one second (a change of thousands of percent),
    // a few minutes, or nothing at all («Nothing before»).
    const seconds = [30, 1, 300, 0][index % 4] ?? 0
    const spend = left
      ? { seconds, tokens: 50_000, cost: 500, unpriced: left / 2 }
      : { seconds, tokens: 0, cost: 0 }
    const before: TimedStretch[] = seconds
      ? [{ at: new Date(2026, 10, 10, 9, index), group, spend }]
      : []
    return [today, ...before]
  }).flat()

const TASKS = tasks()

/**
 * The same tasks, of which the second, the sixth and the tenth leave 40 000 tokens without a
 * price today: their cost reads «≈ 1 109,00 $, 40 тыс. токенов без цены».
 */
const PARTLY_PRICED = tasks((index) => (index < 12 && index % 4 === 1 ? 40_000 : 0))

const PERIODS = {
  today: pageAt({ by: 'work_item', period: 'today' }),
  week: pageAt({ by: 'work_item' }),
}

/** The same periods under the measure «cost», whose period before and change say the remark too. */
const COST_PERIODS = {
  today: pageAt({ by: 'work_item', period: 'today', measure: 'cost' }),
  week: pageAt({ by: 'work_item', measure: 'cost' }),
}

/** The remark beside a cost that leaves tokens out, as each language ends it. */
const REMARK = {
  en: /, (\d+K tokens? without a price)$/u,
  ru: /, (\d+\s?тыс\.\s?токен\S* без цены)$/u,
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
    const frame = document.querySelector<HTMLElement>('.spending-table [data-region="table-frame"]')
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

/**
 * Every cell of the table's rows and total whose figure ends in the remark `remark` matches, and
 * how the two stand: the line box of the figure and of the remark, read off ranges over their
 * characters wherever the cell keeps them; the figure's bottom against the time's in the same
 * row, which in the same font stands on the same baseline; the remark's ink against the quiet
 * ink and the figure's; the width of the figure's characters and of the remark's, each alone, and
 * of the cell's column. With every row's height and the height a row of one line has, and for
 * each column that holds the remark, the most any other of its cells or its heading asks: its
 * words with the cell's padding, or the least the cell holds.
 */
const remarks = (page: Page, remark: RegExp) =>
  page.evaluate(
    (pattern) => {
      const table = document.querySelector<HTMLElement>('.spending-table table')
      if (!table) throw new Error('no table')
      const said = new RegExp(pattern.source, pattern.flags)
      const quiet = document.createElement('span')
      quiet.style.color = 'var(--color-text-tertiary)'
      table.parentElement?.append(quiet)
      const quietInk = getComputedStyle(quiet).color
      quiet.remove()

      /** A range over the characters from `start` to `end` of the element's text, whatever nodes hold them. */
      function rangeOf(element: Element, start: number, end: number) {
        const range = document.createRange()
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
        let seen = 0
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          const length = node.textContent?.length ?? 0
          if (seen <= start && start <= seen + length) range.setStart(node, start - seen)
          if (seen <= end && end <= seen + length) {
            range.setEnd(node, end - seen)
            break
          }
          seen += length
        }
        return range
      }
      const textOf = (element: Element) => {
        const text = element.textContent ?? ''
        const start = text.length - text.trimStart().length
        return rangeOf(element, start, text.trimEnd().length)
      }
      // This body is serialized and evaluated in the page, so a module-scope helper would not
      // be in scope here.
      /** The last line box of a range: the one its last characters stand on. */
      // eslint-disable-next-line unicorn/consistent-function-scoping -- see above
      const lastBox = (range: Range) =>
        [...range.getClientRects()].at(-1) ?? range.getBoundingClientRect()
      // eslint-disable-next-line unicorn/consistent-function-scoping -- see above
      const firstBox = (range: Range) => range.getClientRects()[0] ?? range.getBoundingClientRect()

      const rows = [...table.querySelectorAll<HTMLElement>('tbody tr, tfoot tr')]
      const cells = rows.flatMap((row, index) =>
        [...row.querySelectorAll<HTMLTableCellElement>('td')].flatMap((cell) => {
          const text = (cell.textContent ?? '').trim()
          const found = said.exec(text)
          if (!found?.[1]) return []
          const start = (cell.textContent ?? '').indexOf(text)
          const figureEnd = start + text.length - found[0].length
          const remarkStart = start + text.length - found[1].length
          const figure = rangeOf(cell, start, figureEnd)
          const words = rangeOf(cell, remarkStart, start + text.length)
          const time = row.querySelector('td')
          const holder = words.startContainer.parentElement ?? cell
          const figureHolder = figure.startContainer.parentElement ?? cell
          const style = getComputedStyle(cell)
          return [
            {
              row: index,
              column: cell.cellIndex,
              text,
              widths: {
                figure: figure.getBoundingClientRect().width,
                remark: words.getBoundingClientRect().width,
                padding:
                  Number.parseFloat(style.paddingLeft) + Number.parseFloat(style.paddingRight),
                column: cell.getBoundingClientRect().width,
              },
              figure: { top: firstBox(figure).top, bottom: lastBox(figure).bottom },
              remark: { top: firstBox(words).top, bottom: lastBox(words).bottom },
              baseline: time ? lastBox(figure).bottom - firstBox(textOf(time)).bottom : null,
              ink: getComputedStyle(holder).color,
              figureInk: getComputedStyle(figureHolder).color,
              shown: holder.checkVisibility({ visibilityProperty: true, opacityProperty: true }),
            },
          ]
        }),
      )
      /** What a cell asks of its column: its words with its padding, or the least it holds. */
      const asks = (element: HTMLElement) => {
        const style = getComputedStyle(element)
        const range = document.createRange()
        range.selectNodeContents(element)
        const words =
          range.getBoundingClientRect().width +
          Number.parseFloat(style.paddingLeft) +
          Number.parseFloat(style.paddingRight)
        return Math.max(words, Number.parseFloat(style.minInlineSize) || 0)
      }
      const remarked = new Set(cells.map((one) => `${one.row}:${one.column}`))
      const others = Object.fromEntries(
        [...new Set(cells.map((one) => one.column))].map((column) => {
          const heading = table.querySelectorAll<HTMLElement>('thead th')[column]
          const rest = rows.flatMap((row, index) => {
            const other = row.children[column]
            return other instanceof HTMLElement && !remarked.has(`${index}:${column}`)
              ? [asks(other)]
              : []
          })
          return [column, Math.max(heading ? asks(heading) : 0, ...rest)]
        }),
      )
      const cell = table.querySelector('tbody td')
      const style = cell ? getComputedStyle(cell) : null
      const oneLine = style
        ? Number.parseFloat(style.lineHeight) +
          Number.parseFloat(style.paddingTop) +
          Number.parseFloat(style.paddingBottom)
        : 0
      return {
        cells,
        others,
        quietInk,
        oneLine,
        heights: rows.map((row) => Math.round(row.getBoundingClientRect().height * 100) / 100),
      }
    },
    { source: remark.source, flags: remark.flags },
  )

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
        expect(wide.length, 'the names read at 1920px').toBeGreaterThan(0)
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
      // Its hint is its words, laid whole over the cut ones.
      const hint = wholeText(page)

      await page.mouse.move(0, 0)
      await expect(hint).toHaveCount(0)
      await name.hover()
      await expect(hint).toBeVisible()
      await expect(hint).toHaveText(whole)

      await page.mouse.move(0, 0)
      await expect(hint).toHaveCount(0)
      // From the last heading of the table, the next stop of the keyboard is the first row's name.
      await analytics.locator('.spending-table thead th button').last().focus()
      await page.keyboard.press('Tab')
      await expect(name.locator('a')).toBeFocused()
      await expect(hint).toBeVisible()
      await expect(hint).toHaveText(whole)
    })
  })

for (const locale of ['ru', 'en'] as const)
  test.describe(`in ${locale}, with costs that leave tokens out`, () => {
    test.use({ locale: locale === 'ru' ? 'ru-RU' : 'en-US' })

    test.beforeEach(async ({ page }) => {
      await page.addInitScript((chosen) => localStorage.setItem('valkama-locale', chosen), locale)
      await serve(page, PARTLY_PRICED)
    })

    // A cost that leaves tokens without a price says how many under its amount, on a second and
    // quieter line of its cell, so its column is as wide as the longer of the two lines rather
    // than both: said on the row's line, «≈ 1 109,00 $, 40 тыс. токенов без цены» was one line
    // of 249 pixels. At 1280 the table may still scroll sideways for the remark; at 1670 it
    // fits its frame.
    for (const [measure, addresses] of Object.entries({ time: PERIODS, cost: COST_PERIODS }))
      for (const [period, address] of Object.entries(addresses)) {
        // Three rows and the total say the remark in the cost; under the cost, «Today»'s period
        // before and change say it as well, while the week before holds no work.
        const saying = measure === 'cost' && period === 'today' ? 12 : 4

        test(`under ${measure}, the task table of ${period} says the remark under its cost`, async ({
          page,
        }, info) => {
          const analytics = await openReport(page, 1280, address)
          await expect(analytics.locator('.spending-table thead th')).toHaveCount(6)
          await page.evaluate(() => document.fonts.ready)
          const stand = await remarks(page, REMARK[locale])

          const rows = new Set(stand.cells.map((cell) => cell.row))
          expect(rows.size, 'the rows that say the remark').toBe(4)
          expect(stand.cells, 'the cells that say the remark').toHaveLength(saying)
          // What a column's cells with the remark ask of it, laid out under each other: the
          // longer of each one's figure and remark, with the cell's padding.
          const longest = new Map<number, number>()
          for (const { column, widths } of stand.cells)
            longest.set(
              column,
              Math.max(
                longest.get(column) ?? 0,
                Math.max(widths.figure, widths.remark) + widths.padding,
              ),
            )
          for (const cell of stand.cells) {
            const where = `«${cell.text}»`
            expect.soft(cell.shown, `${where}: the remark is not shown`).toBe(true)
            expect
              .soft(cell.remark.top, `${where}: the remark beside the figure, not under it`)
              .toBeGreaterThanOrEqual(cell.figure.bottom - 0.5)
            expect
              .soft(
                Math.abs(cell.baseline ?? Number.POSITIVE_INFINITY),
                `${where}: off the row's line`,
              )
              .toBeLessThanOrEqual(0.5)
            expect.soft(cell.ink, `${where}: the remark not in the quiet ink`).toBe(stand.quietInk)
            expect
              .soft(cell.ink, `${where}: the remark in the figure's ink`)
              .not.toBe(cell.figureInk)
            // The column is as wide as the longest line of its cells — the longer of a figure
            // and its remark, or what its other cells and its heading ask — and narrower than
            // this figure and its remark side by side.
            const { figure, remark, padding, column } = cell.widths
            const asked = Math.max(longest.get(cell.column) ?? 0, stand.others[cell.column] ?? 0)
            expect
              .soft(column, `${where}: its column wider than its longest line`)
              .toBeLessThanOrEqual(asked + 1)
            expect
              .soft(column, `${where}: its column as wide as the figure and the remark together`)
              .toBeLessThan(figure + remark + padding - 1)
          }
          // A row without the remark keeps the height of one line; one with it is taller.
          const taller = stand.heights.filter((_, index) => rows.has(index))
          const plain = stand.heights.filter((_, index) => !rows.has(index))
          for (const height of taller)
            expect
              .soft(height, "a row with the remark on its figure's line")
              .toBeGreaterThan(stand.oneLine + 1)
          for (const height of plain)
            expect
              .soft(height, 'a row without the remark not one line high')
              .toBeCloseTo(stand.oneLine, 0)

          // The cell says the figure and the remark as one, as the hint and the bars say them.
          await expect(
            analytics.getByRole('cell', { name: new RegExp(`^≈.+${REMARK[locale].source}`, 'u') }),
          ).toHaveCount(stand.cells.filter((cell) => cell.text.startsWith('≈')).length)

          // With the room of 1670 pixels the table fits its frame, the change inside it.
          await openReport(page, 1670, address)
          await page.evaluate(() => document.fonts.ready)
          const at = await fit(page)
          await record(info, `task table unpriced ${locale} ${measure} ${period}`, { stand, at })
          expect.soft(at.past, 'at 1670px: the table past its frame').toBeLessThanOrEqual(0.5)
          expect.soft(at.scroll, 'at 1670px: the table scrolls past its frame').toBe(0)
          expect
            .soft(at.changePast, 'at 1670px: the change past the frame')
            .toBeLessThanOrEqual(0.5)
        })
      }
  })
