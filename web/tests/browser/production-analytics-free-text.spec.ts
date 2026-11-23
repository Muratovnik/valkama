/**
 * A breakdown named by free text, tasks and sessions by their titles, in the real app over the
 * browser double, with names as long as a busy week writes them: a title of 200 characters, one
 * of 143, the median's 81, and sessions of 67, over figures as long as a month's (`LONG_FIGURES`).
 * The oracle is the owner's rule and the list's contract: a list only, with no ring and no small
 * charts beside it, at the whole width of the charts; each name on lines of its own, two at most,
 * its reference whole on its first line; the bar and the value under it, every value ending at one
 * edge, and each figure followed by its share of the whole; the rest and the work on no task apart
 * under a rule, each with its bar; no strip of the whole over the rows, which read as one more row,
 * while a tile of the rail, whose rows draw nothing, keeps its strip (DESIGN.md, Charts). A name in
 * the day chart's legend takes one line and keeps its
 * reference. The control is the breakdown by account, named by identifiers: its ring, with its
 * legend under it in a narrow column, and its small charts beside it.
 *
 * Each run prints what it measured and keeps a picture of the charts at each width.
 */
import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import { noTask, task, value } from '../fixtures/analytics.ts'
import type { TimedStretch } from '../fixtures/analytics.ts'
import { LONG_FIGURES, openReport, pageAt, record, serve } from './analyticsPage.ts'
import { shot } from './boardPage.ts'
import { test } from './test.ts'

/** Words a long title is made of, repeated to its length; the titles are made up. */
const WORDS =
  'Перенести разбор длинных документов планирования в службу доски и проверить каждый шаг миграции '

const titled = (length: number, number: number) =>
  `${String(number)} ${WORDS.repeat(4)}`.slice(0, length).trimEnd()

/** The lengths of the first titles: the longest, the 90th percentile, then the median's. */
const LENGTHS = [200, 143, 81, 81, 81, 81, 81, 81, 81, 81, 81, 81]

/** Sessions titled as people title them, 67 characters each, the longest measured. */
const session = (index: number) => ({
  ...value(`session-${String(index)}`),
  title: `Valkama: проектирование системы агентов и её окружения, часть ${String(index)}`.slice(
    0,
    67,
  ),
})

/**
 * `LONG_FIGURES` with its first twelve tasks retitled long, each stretch on one of fourteen
 * sessions, and the largest share of the week on no task: a list folds the tasks past ten.
 */
const LONG_NAMES: TimedStretch[] = [
  ...LONG_FIGURES.map((stretch, index) => {
    const length = LENGTHS[index]
    const work = stretch.group.work_item
    return {
      ...stretch,
      group: {
        ...stretch.group,
        executor: session(index % 14),
        work_item:
          length && work ? task(index + 1, titled(length, index + 1)) : stretch.group.work_item,
      },
    }
  }),
  {
    at: new Date(2026, 10, 11, 14, 10),
    group: { work_item: noTask, executor: session(0) },
    spend: { seconds: 40 * 86_400, tokens: 1e9, cost: 12_000 },
  },
]

const charts = (page: Page) => page.locator('.analytics-panel .dimension-charts')
const list = (page: Page) => page.locator('.analytics-panel .spending-bars')
const days = (page: Page) => page.locator('.analytics-panel .spending-days')

/** A chart a narrow page opened on its table, turned to its first drawing as a reader turns it. */
async function drawn(where: Locator) {
  if ((await where.getAttribute('data-shown')) !== 'table') return
  await where.locator('.level-head [role="radio"]').first().click()
  await expect(where).not.toHaveAttribute('data-shown', 'table')
}

/**
 * Where the list's parts stand: its width beside the charts', how many lines each name takes and
 * whether the reference it starts with stands whole on its first line inside the name's box, the
 * right edge of every value and its words, any row reaching into the next, any strip of the whole,
 * and the rows apart with their bars under their rule.
 */
function listLayout(where: Locator) {
  return where.evaluate((section) => {
    // This body is serialized and evaluated in the page, so a module-scope helper would not be in
    // scope here.
    // eslint-disable-next-line unicorn/consistent-function-scoping -- see above
    const box = (element: Element | null) => element?.getBoundingClientRect() ?? new DOMRect()
    const charts = section.closest('.dimension-charts')
    const style = charts ? getComputedStyle(charts) : null
    const inner =
      box(charts).width -
      Number.parseFloat(style?.paddingLeft ?? '0') -
      Number.parseFloat(style?.paddingRight ?? '0')
    const rows = [...section.querySelectorAll('.ranked-row')].map((row) => {
      const label = row.querySelector('.ranked-label')
      const lineHeight = Number.parseFloat(getComputedStyle(label ?? row).lineHeight)
      const text = label?.textContent ?? ''
      const reference = /^MAIN-\d+/u.exec(text)?.[0] ?? ''
      // The first text the name prints, past the empty ones its template leaves.
      const walker = document.createTreeWalker(label ?? row, NodeFilter.SHOW_TEXT)
      let node = walker.nextNode()
      while (node && !node.textContent?.trim()) node = walker.nextNode()
      let referenceWhole = reference === ''
      if (node && reference) {
        const range = document.createRange()
        range.setStart(node, 0)
        range.setEnd(node, reference.length)
        const rects = [...range.getClientRects()]
        const name = box(label)
        referenceWhole =
          rects.length === 1 &&
          (rects[0]?.right ?? Infinity) <= name.right + 0.5 &&
          (rects[0]?.top ?? -1) >= name.top - 0.5 &&
          (rects[0]?.bottom ?? Infinity) <= name.top + lineHeight + 1
      }
      const name = box(label)
      const track = box(row.querySelector('.ranked-track'))
      const value = box(row.querySelector('.ranked-value'))
      return {
        name: text.slice(0, 24),
        lines: Math.round(name.height / lineHeight),
        cut: Boolean(label && label.scrollHeight > label.clientHeight + 1),
        referenceWhole,
        nameAbove: name.bottom <= Math.min(track.top, value.top) + 0.5,
        valueEnd: Math.round(value.right * 10) / 10,
        figure: row.querySelector('.ranked-value')?.textContent ?? '',
        valueAfterTrack: value.left >= track.right - 0.5,
        bar: row.querySelector('.ranked-bar') !== null,
        apart: row.closest('.ranked-rest') !== null,
        top: box(row).top,
        bottom: box(row).bottom,
      }
    })
    const rest = section.querySelector('.ranked-rest')
    return {
      listWidth: Math.round(box(section).width),
      chartsWidth: Math.round(inner),
      multiples: section.closest('.dimension-charts')?.querySelectorAll('.small-multiples').length,
      ring: section.querySelectorAll('.donut-chart').length,
      strips: section.querySelectorAll('.mini-share-bar').length,
      rule: rest ? getComputedStyle(rest).borderTopWidth : null,
      rows,
      overlaps: rows.slice(1).filter((row, index) => row.top < (rows[index]?.bottom ?? 0) - 0.5)
        .length,
    }
  })
}

/** Each entry of the day chart's legend: its lines, whether its name is cut, and its reference. */
function legendLayout(page: Page) {
  return page.locator('.analytics-panel .spending-days .chart-legend').evaluate((legend) => {
    // eslint-disable-next-line unicorn/consistent-function-scoping -- serialized into the page
    const box = (element: Element | null) => element?.getBoundingClientRect() ?? new DOMRect()
    const bounds = box(legend)
    const chart = box(legend.closest('.spending-days'))
    return {
      height: Math.round(bounds.height),
      within: bounds.left >= chart.left - 0.5 && bounds.right <= chart.right + 0.5,
      entries: [...legend.querySelectorAll('[data-series] [data-part="name"]')].map((name) => {
        const lineHeight = Number.parseFloat(getComputedStyle(name).lineHeight)
        const text = name.textContent ?? ''
        const reference = /^MAIN-\d+/u.exec(text)?.[0] ?? ''
        const walker = document.createTreeWalker(name, NodeFilter.SHOW_TEXT)
        let node = walker.nextNode()
        while (node && !node.textContent?.trim()) node = walker.nextNode()
        let referenceWhole = reference === ''
        if (node && reference) {
          const range = document.createRange()
          range.setStart(node, 0)
          range.setEnd(node, reference.length)
          referenceWhole = range.getBoundingClientRect().right <= box(name).right + 0.5
        }
        return {
          lines: Math.round(box(name).height / lineHeight),
          cut: name.scrollWidth > name.clientWidth,
          referenceWhole,
          inside: box(name).right <= bounds.right + 0.5,
        }
      }),
    }
  })
}

function expectList(measured: Awaited<ReturnType<typeof listLayout>>) {
  expect(measured.ring).toBe(0)
  expect(measured.multiples).toBe(0)
  // The whole width of the charts, the list's own air at its sides aside.
  expect(measured.listWidth).toBeGreaterThanOrEqual(measured.chartsWidth - 1)
  expect(measured.overlaps).toBe(0)
  const ends = new Set(measured.rows.map((row) => row.valueEnd))
  expect(Math.max(...ends) - Math.min(...ends)).toBeLessThanOrEqual(1)
  for (const row of measured.rows) {
    expect(row.lines, row.name).toBeLessThanOrEqual(2)
    expect(row.referenceWhole, row.name).toBe(true)
    expect(row.nameAbove, row.name).toBe(true)
    expect(row.valueAfterTrack, row.name).toBe(true)
    expect(row.bar, row.name).toBe(true)
    // The figure, then the row's share of the whole in whole percents.
    expect(row.figure, row.name).toMatch(/\S \u{B7} [<>]?\d+\s?%$/u)
  }
  expect(measured.rule).toBe('1px')
  expect(measured.strips).toBe(0)
}

for (const lang of ['en', 'ru'] as const)
  test.describe(`a list of free text, ${lang}`, () => {
    test.use({ locale: lang === 'ru' ? 'ru-RU' : 'en-US' })

    for (const width of [1440, 1024, 390])
      test(`lists the tasks whole and alone at ${String(width)}px`, async ({ page }, info) => {
        await serve(page, LONG_NAMES)
        await openReport(page, width, pageAt({ by: 'work_item' }))
        const section = list(page)
        await drawn(section)
        await drawn(days(page))
        await expect(section.locator('.ranked-bars.ranked-free')).toBeVisible()
        const measured = await listLayout(section)
        expectList(measured)
        // The first ten tasks ranked, then the rest folded and the work on no task, apart.
        expect(measured.rows.filter((row) => !row.apart)).toHaveLength(10)
        expect(measured.rows.filter((row) => row.apart)).toHaveLength(2)
        // A name cut is cut on its second line, not before; the narrow column cuts the longest.
        const cut = measured.rows.filter((row) => row.cut)
        expect(cut.map((row) => row.lines)).toEqual(cut.map(() => 2))
        expect(width > 390 || cut.length > 0).toBe(true)
        const legend = await legendLayout(page)
        expect(legend.within).toBe(true)
        // The longest title is longer than the legend is wide at every width, so it is cut.
        expect(legend.entries.some((entry) => entry.cut)).toBe(true)
        for (const entry of legend.entries) {
          expect(entry.lines).toBe(1)
          expect(entry.referenceWhole).toBe(true)
          expect(entry.inside).toBe(true)
        }
        await record(info, `tasks ${lang} ${String(width)}`, {
          ...measured,
          rows: measured.rows.map(({ name, lines, cut }) => ({ name, lines, cut })),
          legend,
        })
        await charts(page).screenshot(shot(info, `tasks-${lang}-${String(width)}.png`))
      })

    test('lists the sessions alone too, and keeps the ring and small charts by account', async ({
      page,
    }, info) => {
      await serve(page, LONG_NAMES)
      await openReport(page, 1440, pageAt({ by: 'executor' }))
      const sessions = await listLayout(list(page))
      expectList(sessions)
      // The control for the strip: a tile of the rail, whose rows print a name and a share and
      // draw nothing, keeps its strip of the whole.
      await expect(page.locator('.analytics-rail .mini-share-bar').first()).toBeVisible()
      await charts(page).screenshot(shot(info, `sessions-${lang}-1440.png`))

      // The control: named by identifiers, the accounts keep their ring and their small charts.
      await openReport(page, 1440, pageAt({ by: 'account' }))
      await expect(list(page).locator('.donut-chart')).toBeVisible()
      await expect(charts(page).locator('.small-multiples')).toBeVisible()
      const accounts = await listLayout(list(page))
      expect(accounts.listWidth).toBeLessThan(accounts.chartsWidth * 0.6)
      await record(info, `sessions ${lang}`, {
        listWidth: sessions.listWidth,
        chartsWidth: sessions.chartsWidth,
        lines: sessions.rows.map((row) => row.lines),
        accountsWidth: accounts.listWidth,
      })
    })
  })

test('puts the ring’s legend under the ring in a narrow column', async ({ page }, info) => {
  await serve(page, LONG_NAMES)
  await openReport(page, 390, pageAt({ by: 'account' }))
  await drawn(list(page))
  const chart = list(page).locator('.donut-chart')
  await expect(chart).toBeVisible()
  const placed = await chart.evaluate((figure) => {
    const ring = figure.querySelector('.donut-ring')?.getBoundingClientRect()
    const legend = figure.querySelector('.chart-legend')?.getBoundingClientRect()
    return {
      column: Math.round(figure.getBoundingClientRect().width),
      ringBottom: ring?.bottom ?? 0,
      legendTop: legend?.top ?? 0,
      legendRight: legend?.right ?? 0,
      columnRight: figure.getBoundingClientRect().right,
    }
  })
  expect(placed.legendTop).toBeGreaterThanOrEqual(placed.ringBottom - 0.5)
  expect(placed.legendRight).toBeLessThanOrEqual(placed.columnRight + 0.5)
  await record(info, 'ring at 390', placed)
  await chart.screenshot(shot(info, 'ring-390.png'))
})

/** Each row of the section's own table: whether its name carries a detail, and its height. */
const tableRows = (page: Page) =>
  page.locator('.section-table-frame tbody tr').evaluateAll((all) =>
    all.map((row) => ({
      detail: Boolean(row.querySelector('.chart-detail')),
      height: row.getBoundingClientRect().height,
    })),
  )

// A row of the section's own table is one line (DESIGN.md, Charts), a session's with its detail
// after its name as well. In the detail's own line height, its rows stood 1.3px taller than the
// rows of a table whose names carry none, the accounts' here.
for (const width of [1440, 390])
  test(`the sessions' table keeps every row one line high at ${width} px`, async ({
    page,
  }, info) => {
    await serve(page, LONG_NAMES)
    await openReport(page, width, pageAt({ by: 'executor' }))
    await expect(page.locator('.section-table-frame tbody tr').first()).toBeVisible()
    const sessions = await tableRows(page)
    await openReport(page, width, pageAt({ by: 'account' }))
    await expect(page.locator('.section-table-frame tbody tr').first()).toBeVisible()
    const accounts = await tableRows(page)
    await record(info, `table rows ${String(width)}`, { sessions, accounts })
    expect(
      sessions.filter(({ detail }) => detail).length,
      'sessions with a detail',
    ).toBeGreaterThan(0)
    expect(
      accounts.filter(({ detail }) => detail),
      'accounts with a detail',
    ).toEqual([])
    const all = [...sessions, ...accounts].map(({ height }) => height)
    expect(Math.max(...all) - Math.min(...all), 'one height for every row').toBeLessThan(0.5)
  })
