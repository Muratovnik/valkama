/**
 * The Analytics page's browser double and measurements: the work the double holds, how it
 * answers `/api/analytics/usage` by what each read asks, and where the page's parts stand.
 */
import { expect } from '@playwright/test'
import type { Page, TestInfo } from '@playwright/test'

import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { noTask, serveUsage, task, unknownTask, value } from '../fixtures/analytics.ts'
import type { Stretch, TimedStretch } from '../fixtures/analytics.ts'
import { installBackend } from './backend.ts'
import { globalScope } from './planningFixtures.ts'

export const pageAt = (state: Record<string, string> = {}) =>
  serializePlatformRoute({ module_id: 'analytics', scope: globalScope, state })

/** Wednesday afternoon, so the week holds two whole days and one not over yet. */
const NOW = new Date(2026, 10, 11, 14, 30)
const on = (day: number) => new Date(2026, 10, day, 10)

const WORK = value('work@example.test')
const NIGHT = value('night@example.test')

/** Twelve tasks with long titles, work on no task and work nobody can place, over three days. */
const STRETCHES: Stretch[] = [
  ...Array.from({ length: 12 }, (_, index) => ({
    day: index % 3,
    group: {
      work_item: task(
        index + 1,
        `Rework the import of very long planning documents into the board, part ${index + 1}`,
      ),
      model: value(index % 2 ? 'model-b' : 'model-a'),
    },
    spend: {
      seconds: (13 - index) * 5400,
      tokens: (13 - index) * 1_250_000,
      cost: index === 11 ? null : (13 - index) * 12.5,
      unpriced: index === 11 ? 40_000 : 0,
    },
  })),
  { day: 1, group: { work_item: noTask }, spend: { seconds: 7200, tokens: 900_000, cost: 8 } },
  { day: 2, group: { work_item: unknownTask }, spend: { seconds: 1800, tokens: 10_000, cost: 1 } },
]

/** Who worked: one account on Monday, both on Tuesday, the other on Wednesday. */
function accountOf(stretch: Stretch, index: number) {
  if (stretch.day === 0) return WORK
  if (stretch.day === 2) return NIGHT
  return index % 2 ? WORK : NIGHT
}

/** The week so far, and the same Monday a week before, which this week is compared with. */
const WORLD: TimedStretch[] = [
  ...STRETCHES.map((stretch, index) => ({
    at: on(9 + stretch.day),
    group: { ...stretch.group, account: accountOf(stretch, index) },
    spend: stretch.spend,
  })),
  {
    at: on(2),
    group: { work_item: task(1, 'One'), account: WORK },
    spend: { seconds: 90_000, tokens: 9e6, cost: 99 },
  },
]

/** One task the whole week: a chart of one value. */
export const ONE_VALUE: TimedStretch[] = [0, 1, 2].map((day) => ({
  at: on(9 + day),
  group: { work_item: task(1, 'The only task'), account: WORK },
  spend: { seconds: 3600 * (day + 1), tokens: 1000, cost: 1 },
}))

/** Twenty-five tasks of an hour each: those past the named ones fold into a large «other». */
export const LONG_TAIL: TimedStretch[] = Array.from({ length: 25 }, (_, index) => ({
  at: on(9 + (index % 3)),
  group: { work_item: task(index + 1, `Task ${index + 1}`), account: WORK },
  spend: { seconds: 3600, tokens: 1000, cost: 1 },
}))

/** Nothing this week, and a day's work on the Monday of the week before: a fall to zero. */
export const ONLY_WEEK_BEFORE: TimedStretch[] = WORLD.filter(
  ({ at }) => at.getTime() < on(9).getTime(),
)

/**
 * One account on Monday, work whose organization nobody recorded alone on Tuesday, and the other
 * account beside more such work on Wednesday: one change of accounts, on Wednesday.
 */
export const UNRECORDED_BETWEEN: TimedStretch[] = [
  { at: on(9), group: { work_item: task(1, 'One'), account: WORK }, spend: { seconds: 3600 } },
  { at: on(10), group: { work_item: task(1, 'One') }, spend: { seconds: 5400 } },
  { at: on(11), group: { work_item: task(2, 'Two'), account: NIGHT }, spend: { seconds: 1800 } },
  { at: on(11), group: { work_item: task(2, 'Two') }, spend: { seconds: 900 } },
]

/** What the double answers: the work it holds, or a read that never answers, or one that fails. */
export type Answer = 'failed' | 'hold' | readonly TimedStretch[]

/** The read of this week's week before: the one asked from a moment rather than a day. */
const weekBefore = (query: URLSearchParams) => query.get('from')?.includes('T') ?? false

/**
 * Answers the page's reads from `answer`; with `failWeekBefore`, the read of the same days of the
 * week before fails while the others answer.
 */
export async function serve(page: Page, answer: Answer = WORLD, failWeekBefore = false) {
  await page.clock.setFixedTime(NOW)
  await installBackend(page)
  await page.route('**/api/analytics/usage?*', async (route) => {
    if (answer === 'hold') return
    const query = new URL(route.request().url()).searchParams
    if (answer === 'failed' || (failWeekBefore && weekBefore(query))) {
      await route.fulfill({ status: 500, contentType: 'application/json', body: '{}' })
      return
    }
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(serveUsage(answer, query)),
    })
  })
}

/** Opens the page at `width` and waits for the report: its tiles and its days. */
export async function openReport(page: Page, width: number, address = pageAt()) {
  await page.setViewportSize({ width, height: 1000 })
  await page.goto(address)
  const analytics = page.locator('.analytics-page')
  await expect(analytics.locator('.tile-figure[data-measure="time"]')).toBeVisible()
  await expect(analytics.locator('.spending-days')).toBeVisible()
  return analytics
}

/** Prints what a run measured and keeps it beside the run's report. */
export async function record(info: TestInfo, name: string, measured: unknown) {
  await info.attach(`${name}.json`, {
    body: JSON.stringify(measured, null, 2),
    contentType: 'application/json',
  })
  console.log(`${name}: ${JSON.stringify(measured)}`)
}

/** Where each element a selector finds stands, rounded to the pixel. */
export async function boxes(page: Page, selector: string) {
  return page.evaluate(
    (chosen) =>
      [...document.querySelectorAll(chosen)].map((element) => {
        const { x, y, width, height } = element.getBoundingClientRect()
        return {
          x: Math.round(x),
          y: Math.round(y),
          width: Math.round(width),
          height: Math.round(height),
        }
      }),
    selector,
  )
}

type Box = Awaited<ReturnType<typeof boxes>>[number]

/**
 * A control that follows words: on their line it shares their middle, and wrapped under them it
 * starts where they do, each within a pixel. Nothing to hold when either is not shown.
 */
export function expectBesideOrUnder(words: Box | undefined, control: Box | undefined) {
  if (!words || !control) return
  const beside = control.y < words.y + words.height
  const off = beside
    ? Math.abs(control.y + control.height / 2 - (words.y + words.height / 2))
    : Math.abs(control.x - words.x)
  expect(
    off,
    beside ? 'off the middle of the words' : 'off the start of the words',
  ).toBeLessThanOrEqual(1)
}

/** How far the page itself scrolls sideways, which it never should. */
export const pageScroll = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)

/** Where the page's parts stand, rounded to the pixel, for the record and the assertions. */
export async function measure(page: Page) {
  return page.evaluate(() => {
    // This body is serialized and evaluated in the page, so a module-scope
    // helper would not be in scope here.
    // eslint-disable-next-line unicorn/consistent-function-scoping -- see above
    const box = (element: Element | null) => {
      if (!element) return null
      const { x, y, width, height } = element.getBoundingClientRect()
      return {
        x: Math.round(x),
        y: Math.round(y),
        width: Math.round(width),
        height: Math.round(height),
      }
    }
    const root = document.documentElement
    // The charts and the table beside the period before, in the page's order.
    const sections = [...document.querySelectorAll<HTMLElement>('.chart-section, .spending-table')]
    return {
      viewport: root.clientWidth,
      pageScroll: root.scrollWidth - root.clientWidth,
      page: box(document.querySelector('.analytics-page')),
      // Where each part starts: the controls, the filters' chevron (its button reaches out by
      // its fill's inset, by design), the tiles' box and the charts' headings, which stand on
      // one edge of the page.
      edges: [
        '.analytics-controls',
        '.disclosure-toggle svg',
        '.spending-tiles',
        '.spending-bars h2',
        '.spending-days h2',
        '.spending-table h2',
      ].map((selector) => box(document.querySelector(selector))?.x ?? null),
      tiles: [...document.querySelectorAll('.spending-tiles .segmented-option')].map((tile) =>
        box(tile),
      ),
      sections: sections.map((section) => {
        const frame = section.querySelector<HTMLElement>('.chart-table-frame')
        return {
          shown: section.dataset.shown,
          box: box(section),
          tableScroll: frame ? frame.scrollWidth - frame.clientWidth : null,
          // How wide the table leaves the name of each row, a day or a value.
          rowNames: [...section.querySelectorAll('th[scope="row"]')].map((name) =>
            Math.round(name.getBoundingClientRect().width),
          ),
        }
      }),
    }
  })
}

/** The layout every rendered report holds to, at any width and in any language. */
export function expectWhole(measured: Awaited<ReturnType<typeof measure>>) {
  expect(measured.pageScroll).toBe(0)
  for (const tile of measured.tiles) {
    expect(tile?.x).toBeGreaterThanOrEqual(0)
    expect((tile?.x ?? 0) + (tile?.width ?? 0)).toBeLessThanOrEqual(measured.viewport)
  }
  for (const section of measured.sections)
    expect((section.box?.x ?? 0) + (section.box?.width ?? 0)).toBeLessThanOrEqual(measured.viewport)
  for (const edge of measured.edges)
    expect(Math.abs((edge ?? Number.NaN) - (measured.page?.x ?? 0))).toBeLessThanOrEqual(1)
  // A table wider than its frame scrolls in it, and still leaves each row's name its words:
  // a day squeezed to a letter a line is not readable as a table.
  for (const section of measured.sections)
    for (const name of section.rowNames) expect(name).toBeGreaterThanOrEqual(80)
}

/**
 * Each chart table scrolled to its end in its frame: how far it scrolls, and where the first
 * row's name and the heading over the names stand before and after. A name kept in view stands
 * still while the figures pass under it.
 */
export async function scrolledNames(page: Page) {
  return page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('.chart-table-frame')].map((frame) => {
      const name = frame.querySelector('tbody th')
      const corner = frame.querySelector('thead th')
      const left = () => ({
        name: Math.round(name?.getBoundingClientRect().left ?? Number.NaN),
        corner: Math.round(corner?.getBoundingClientRect().left ?? Number.NaN),
      })
      const before = left()
      frame.scrollLeft = frame.scrollWidth
      const after = left()
      const scrolled = Math.round(frame.scrollLeft)
      frame.scrollLeft = 0
      return { scroll: frame.scrollWidth - frame.clientWidth, scrolled, before, after }
    }),
  )
}

/** Every table that scrolls was scrolled, and kept its row names and their heading in place. */
export function expectNamesInView(names: Awaited<ReturnType<typeof scrolledNames>>) {
  const scrolling = names.filter((table) => table.scroll > 0)
  for (const table of scrolling) {
    expect(table.scrolled).toBeGreaterThan(0)
    expect(table.after).toEqual(table.before)
  }
  return scrolling.length
}

/** The bars of the ranking: each bar against its track, and the rows' names. */
export async function bars(page: Page) {
  return {
    rows: await page.locator('.spending-bars .ranked-label').allTextContents(),
    bars: await boxes(page, '.spending-bars .ranked-bar'),
    tracks: await boxes(page, '.spending-bars .ranked-track'),
    rest: await page.locator('.spending-bars .ranked-rest .ranked-label').allTextContents(),
    pageScroll: await pageScroll(page),
  }
}

/** Every bar stays inside its track, and the longest is drawn. */
export function expectBarsInTracks(measured: Awaited<ReturnType<typeof bars>>) {
  expect(measured.pageScroll).toBe(0)
  for (const [index, bar] of measured.bars.entries())
    expect(bar.width).toBeLessThanOrEqual(measured.tracks[index]?.width ?? 0)
  expect(Math.max(...measured.bars.map((bar) => bar.width))).toBeGreaterThan(0)
}

/**
 * What Tab stands on in the page, in order, until it leaves it: each control marked first, so
 * the walk names what it reached and what it never did. A group of radios is one stop, its
 * chosen option; the arrows move inside it.
 */
export async function tabWalk(page: Page) {
  const controls = await page.evaluate(() => {
    for (const marked of document.querySelectorAll<HTMLElement>('[data-stop]'))
      delete marked.dataset.stop
    const all = document.querySelectorAll<HTMLElement>(
      '.analytics-page :is(a[href], button, input, select, textarea, summary, [tabindex])',
    )
    const stops = [...all].filter(
      (element) =>
        element.tabIndex >= 0 &&
        !element.matches(':disabled') &&
        // Shown, and not in a closed disclosure, whose content the browser skips.
        element.checkVisibility({ visibilityProperty: true }),
    )
    for (const [index, element] of stops.entries()) element.dataset.stop = String(index)
    return stops.length
  })
  await page.locator('body').focus()
  const reached = new Set<string>()
  for (let press = 0; press < 200 && reached.size < controls; press += 1) {
    await page.keyboard.press('Tab')
    const stop = await page.evaluate(
      () => (document.activeElement as HTMLElement | null)?.dataset.stop ?? null,
    )
    if (stop !== null) reached.add(stop)
  }
  /** The controls Tab never stood on, by what they say, so a failure names them. */
  const missed = await page.evaluate(
    (seen) =>
      [...document.querySelectorAll<HTMLElement>('[data-stop]')]
        .filter((element) => !seen.includes(element.dataset.stop ?? ''))
        .map(
          (element) =>
            `${element.tagName.toLowerCase()}.${element.className} ${element.getAttribute('aria-label') ?? element.textContent?.trim().slice(0, 40) ?? ''}`,
        ),
    [...reached],
  )
  return { controls, reached: reached.size, missed }
}
