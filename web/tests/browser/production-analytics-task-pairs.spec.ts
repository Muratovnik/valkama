/**
 * The task section's names, in the real app, in English and in Russian, from a phone's width to a
 * wide screen: split by «Model», with model names as long as real ones, and not split.
 *
 * Split by «Model», a pair's second part is a model's name, «claude-sonnet-5-5», and not a short
 * word such as an effort: every place that names the pairs — the ranked bars, the small charts,
 * the day chart's legend and the table — keeps the separator and that name whole inside every box
 * that clips them, and gives way in the task's title. At 1440 in English the bars' one-line name
 * column was 123 pixels wide, so the title kept 13 of them, «V.», and the model was cut too,
 * «V. · claude-opus-…» on every row. The pair names' spec splits the model section by effort, whose
 * second parts are a few letters, so it never saw a second part as wide as that column.
 *
 * In one row of the small charts every name stands on one line and takes one box, whatever it
 * does when pressed: a value that only acts as a button, «No task», took a control's 40 pixels,
 * and its name stood 11 pixels under its neighbour's, which opens a card as a link. A name that
 * acts still offers a pointer the 24 pixels WCAG 2.5.8 asks, link and button alike. In one line
 * of the legend the words stand at one height too. Each run prints what it measured.
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import type { UsageGroupValue } from '@/shared/api/analyticsApi.ts'

import { noTask, task, value } from '../fixtures/analytics.ts'
import type { TimedStretch } from '../fixtures/analytics.ts'
import { openReport, pageAt, record, serve } from './analyticsPage.ts'
import { LINED } from './drawnViews.ts'
import { pairNames } from './pairNames.ts'
import { test } from './test.ts'

const HOUR = 3600

/** A stretch of a task's work under a model, `hours` long, on a day of November. */
const stretch = (
  day: number,
  workItem: UsageGroupValue,
  model: string,
  hours: number,
): TimedStretch => ({
  at: new Date(2026, 10, day, 10),
  group: { work_item: workItem, model: value(model) },
  spend: { seconds: hours * HOUR },
})

const TITLES = [
  'ToolSpec: one Unity-free description of every tool the agents call, its arguments, its answers and the errors each returns',
  'Unsorted crashes of the controller under a long session',
  'A summary of the optional observations of a review',
  'Whether the four executors chase one another',
  'The layers of Bridge rules, their order and their owners',
  'The session manifest counts the launches twice',
  'The lab stands without a session come back on their own',
]

/**
 * The week so far: most of it on no task, then seven tasks, each under one model, in hours and
 * minutes, so the figures are as wide as the review's, «5 h 45 min».
 */
const WORLD: TimedStretch[] = [
  stretch(9, noTask, 'claude-opus-5-5', 20.25),
  ...TITLES.map((title, index) =>
    stretch(
      9 + (index % 3),
      task(index + 1, title),
      ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-fable-5-2'][index % 3] ?? '',
      9.75 - index,
    ),
  ),
]

/** Eight pairs, as many as the bars show. */
const PAIRS = WORLD.length

/** Where a pair's name stands on the page, by what the run calls each place. */
const PLACES = {
  bars: '.spending-bars .ranked-label',
  multiples: '.spending-multiples .multiple-name',
  legend: '.spending-days .chart-key-name',
  table: '.spending-table tbody th .table-name',
} as const

/** A phone, a narrow tablet, the page's bands (DESIGN.md), the review's two sizes and wide ones. */
const WIDTHS = [390, 760, 1024, 1107, 1108, 1200, 1280, 1300, 1440, 1600, 1920]

/** What the choice of a chart over its table is called, in each language. */

/**
 * The task section in `locale` at `width`, split by model or not, with its names read. A panel
 * too narrow for the charts opens each as its table, so they are chosen back, as a reader would.
 */
async function openTasks(page: Page, locale: 'en' | 'ru', width: number, split: boolean) {
  await page.addInitScript((chosen) => localStorage.setItem('valkama-locale', chosen), locale)
  await serve(page, WORLD)
  await openReport(
    page,
    width,
    pageAt(split ? { by: 'work_item', across: 'model' } : { by: 'work_item' }),
  )
  await page.setViewportSize({ width, height: 900 })
  const tables = page.getByRole('radio', { name: LINED, checked: false })
  while ((await tables.count()) > 0) await tables.first().click()
  await expect(page.locator(PLACES.bars)).toHaveCount(PAIRS)
  await page.evaluate(() => document.fonts.ready)
  await page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  )
}

/** The folded tail's name, in each language. */
const OTHER = { en: 'Other', ru: 'Остальное' }

/** A model's name as the end of a pair. */
const MODEL_END = / · claude-(?:opus|sonnet|fable)-5-\d$/u

for (const locale of ['en', 'ru'] as const)
  for (const width of WIDTHS)
    test(`in ${locale} at ${width}, a task's pair keeps the model whole wherever it is named`, async ({
      page,
    }, info) => {
      await openTasks(page, locale, width, true)
      const measured = {
        bars: await pairNames(page, PLACES.bars),
        multiples: await pairNames(page, PLACES.multiples),
        legend: await pairNames(page, PLACES.legend),
        table: await pairNames(page, PLACES.table),
      }
      await record(info, `task pairs ${locale} ${width}`, measured)
      for (const [where, all] of Object.entries(measured)) {
        // The legend folds its tail into «Other», which is no pair.
        const found = all.filter((one) => one.words !== OTHER[locale])
        expect(found.length, where).toBeGreaterThan(0)
        for (const one of found) {
          // Every name is a pair whose end is a model's name...
          expect(one.words, where).toMatch(MODEL_END)
          // ...and the separator and the model stand inside every box that clips them.
          expect(one.hidden, `${where}: ${one.words}`).toBe(0)
        }
      }
      // The run holds the case it is for: at every width a bar's name is cut, in its title.
      expect(measured.bars.some((one) => one.cut)).toBe(true)
    })

/**
 * The names a selector finds, grouped into the rows they stand in by the top of the `row` around
 * each: for each name, the top of its words, the height of its content box, and the height a
 * pointer can press where the name acts, its border box.
 */
async function rowsOf(page: Page, name: string, row: string) {
  return page.evaluate(
    ([nameSelector, rowSelector]) => {
      const rows = new Map<
        number,
        { content: number; press: number | null; text: string; words: number }[]
      >()
      for (const element of document.querySelectorAll<HTMLElement>(nameSelector)) {
        const around = element.closest(rowSelector)
        if (!around) continue
        const line = Math.round(around.getBoundingClientRect().top)
        const range = document.createRange()
        range.selectNodeContents(element)
        const box = element.getBoundingClientRect()
        const style = getComputedStyle(element)
        let content = box.height
        for (const side of [
          'paddingTop',
          'paddingBottom',
          'borderTopWidth',
          'borderBottomWidth',
        ] as const)
          content -= Number.parseFloat(style[side])
        const found = rows.get(line) ?? []
        // To the hundredth of a pixel, as the page lays it out.
        const top = range.getBoundingClientRect().top
        found.push({
          content: Math.round(content * 100) / 100,
          press: element.matches('a[href], button') ? Math.round(box.height * 100) / 100 : null,
          text: element.textContent.trim(),
          words: Math.round(top * 100) / 100,
        })
        rows.set(line, found)
      }
      return [...rows.values()]
    },
    [name, row] as const,
  )
}

type Rows = Awaited<ReturnType<typeof rowsOf>>

/** The rows whose names differ in a figure by more than half a pixel, with the names. */
const uneven = (rows: Rows, figure: 'content' | 'words') =>
  rows.filter((one) => {
    const figures = one.map((name) => name[figure])
    return Math.max(...figures) - Math.min(...figures) > 0.5
  })

for (const split of [false, true])
  for (const locale of ['en', 'ru'] as const)
    for (const width of [760, 1280, 1440, 1920])
      test(`in ${locale} at ${width}${split ? ', split by model' : ''}, the small charts' names of one row stand on one line`, async ({
        page,
      }, info) => {
        await openTasks(page, locale, width, split)
        const multiples = await rowsOf(page, '.spending-multiples .multiple-name', '.multiple')
        const legend = await rowsOf(page, '.spending-days .chart-key-name', '.chart-entry')
        await record(info, `names in rows ${locale} ${width} ${split}`, { multiples, legend })
        // The case reported: «No task», a button, shares its row with a task's link.
        expect(multiples.some((one) => one.length > 1)).toBe(true)
        // In each row the names' words stand at one height and their boxes are as tall...
        expect(uneven(multiples, 'words'), 'small charts: words').toEqual([])
        expect(uneven(multiples, 'content'), 'small charts: boxes').toEqual([])
        // ...and a name that acts, a link or a button, offers a pointer 24 pixels (WCAG 2.5.8).
        const presses = multiples.flat().filter((one) => one.press !== null)
        expect(presses.length).toBeGreaterThan(0)
        expect(presses.filter((one) => (one.press ?? 0) < 24)).toEqual([])
        // In each line of the legend too, the words stand at one height.
        expect(uneven(legend, 'words'), 'legend: words').toEqual([])
      })
