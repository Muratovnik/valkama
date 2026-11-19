/**
 * The Analytics page's browser double and measurements: the work the double holds, how it
 * answers `/api/analytics/usage` by what each read asks and `/api/analytics/quota` with the
 * quota of four made-up accounts, and where the page's parts stand.
 */
import { expect } from '@playwright/test'
import type { Page, TestInfo } from '@playwright/test'

import type { Quota } from '@/shared/api/analyticsApi.ts'
import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { serveUsage } from '../fixtures/analytics.ts'
import type { TimedStretch } from '../fixtures/analytics.ts'
import { quotaAnswer, quotaAt } from '../fixtures/quota.ts'
import { installBackend } from './backend.ts'
import type { BackendOptions } from './backend.ts'
import { globalScope, spaceRef, workItem, workItemRef } from './planningFixtures.ts'
import { NOW, WORLD } from './served/analyticsWorld.ts'
export {
  LONG_FIGURES,
  LONG_TAIL,
  NOW,
  ONE_VALUE,
  ONLY_WEEK_BEFORE,
  SESSIONS,
  UNRECORDED_BETWEEN,
  WORLD,
} from './served/analyticsWorld.ts'

/**
 * A chart legend's keys of its series, by the hooks `ChartLegend` documents: never the key of a
 * mark, such as the hatch's, which no series' key can meet.
 */
export const LEGEND_SERIES = '[data-hint-list="legend"] [data-series]'
/** The names of a legend's keys of its series. */
export const LEGEND_NAMES = `${LEGEND_SERIES} [data-part="name"]`

export const pageAt = (state: Record<string, string> = {}) =>
  serializePlatformRoute({ module_id: 'analytics', scope: globalScope, state })

/** The section of sessions, whose rows `SESSIONS` fills. */
export const SESSION_REPORT = pageAt({ by: 'executor' })

/** What a session's row says in its hint: its client and the start of its id, on a line of its own. */
export const SESSION_PLACE = /^claude · \d{8}$/mu

/** What the double answers: the work it holds, or a read that never answers, or one that fails. */
export type Answer = 'failed' | 'hold' | readonly TimedStretch[]

/** The read of this week's week before: the one asked from a moment rather than a day. */
const weekBefore = (query: URLSearchParams) => query.get('from')?.includes('T') ?? false

/**
 * Answers the page's reads from `answer`; with `failWeekBefore`, the read of the same days of the
 * week before fails while the others answer.
 *
 * The page's clock starts at `NOW` and runs on, as a person's does. A clock held still would stamp
 * a press with the moment its handler was attached, and Vue drops such a press when it reaches a
 * second handler on its way up, as a press on a day's coloured stack does on its way to the day.
 * Nothing here needs the moment held: a run takes seconds of a Wednesday afternoon.
 *
 * `backend` is what the rest of the app's double answers, a task's card among it; the double is
 * returned, so a run can read what the page wrote to it.
 */
export async function serve(
  page: Page,
  answer: Answer = WORLD,
  failWeekBefore = false,
  backend: BackendOptions = {},
) {
  await page.clock.setSystemTime(NOW)
  const installed = await installBackend(page, backend)
  await serveQuota(page, quotaAt(NOW))
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
  return installed
}

/** The app's search finds the task by its reference; each count of a use is kept. */
export async function serveTask(page: Page) {
  await page.route('**/api/modules/planning/search?*', (route) =>
    route.fulfill({
      json: {
        interface_version: 'valkama-planning-search',
        query: workItemRef.reference,
        limit: 50,
        has_more: false,
        items: [
          {
            target: { ...workItemRef, writable: true },
            item: {
              work_item_id: workItem.work_item_id,
              planning_space_id: workItem.planning_space_id,
              reference: 'MAIN-264',
              title: workItem.title,
              state: { name: 'Dev' },
              open: true,
              container_state: null,
              claim_ref: '',
            },
          },
        ],
        coverage: [{ space_ref: spaceRef, status: 'searched', reason: null }],
      },
    }),
  )
  const uses: string[] = []
  await page.route('**/api/analytics/uses', async (route) => {
    uses.push((route.request().postDataJSON() as { kind: string }).kind)
    await route.fulfill({ status: 204 })
  })
  return uses
}

/**
 * Answers the quota read with `quota`, or fails it. A later call stands over an earlier one, so a
 * test that served the page can give the quota another answer.
 */
export async function serveQuota(page: Page, quota: Quota | 'failed') {
  await page.route('**/api/analytics/quota?*', async (route) => {
    if (quota === 'failed') {
      await route.fulfill({ status: 500, contentType: 'application/json', body: '{}' })
      return
    }
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(quotaAnswer(quota)),
    })
  })
}

/**
 * Under this window width the page shows its list of sections or one section, not both. The page
 * decides on its own box, which leaves the panel beside the rail at least 640 pixels or takes
 * turns: in the app's frame a window of 1200 pixels does the first and one of 1024 the second.
 */
export const NARROW_FRAME = 1200

/** The task section's report, which the page showed at its plain address before it opened on its overview. */
export const TASK_REPORT = pageAt({ by: 'work_item' })

/**
 * Opens the page at an address and reaches the panel of the section it names, whatever that
 * panel holds. A window too narrow for the rail beside the panel opens on the list of sections
 * unless the address says otherwise, and the section the address names is chosen there, as a
 * reader would.
 */
export async function openPanel(page: Page, address: string) {
  await page.goto(address)
  const analytics = page.locator('.analytics-page')
  await analytics.locator('.analytics-rail:visible, .analytics-panel:visible').first().waitFor()
  if (!(await analytics.locator('.analytics-panel').isVisible()))
    await analytics.locator('.analytics-rail [aria-current="page"]').click()
  return analytics
}

/**
 * Opens the page at `width` and waits for the report: its tiles and its days; the report of the
 * task section unless an address is given (`openPanel`).
 */
export async function openReport(page: Page, width: number, address = TASK_REPORT) {
  await page.setViewportSize({ width, height: 1000 })
  const analytics = await openPanel(page, address)
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

/**
 * How much room each shown element a selector finds lacks for its words, in pixels: the width
 * of its text laid out whole, measured on a range around it, less its content box. Above zero
 * the words are cut, by a third of a pixel as surely as by thirty: an ellipsis then takes their
 * last characters. `scrollWidth`, rounded to whole pixels, sees none of the first.
 */
export async function shortfalls(page: Page, selector: string) {
  return page.evaluate((chosen) => {
    return [...document.querySelectorAll<HTMLElement>(chosen)]
      .filter((element) => element.checkVisibility())
      .map((element) => {
        const style = getComputedStyle(element)
        const sides = [
          'paddingLeft',
          'paddingRight',
          'borderLeftWidth',
          'borderRightWidth',
        ] as const
        const box =
          element.getBoundingClientRect().width -
          sides.reduce((sum, side) => sum + Number.parseFloat(style[side]), 0)
        const range = document.createRange()
        range.selectNodeContents(element)
        const text = range.getBoundingClientRect().width
        return {
          text: element.textContent.trim(),
          box: Math.round(box * 100) / 100,
          short: Math.round((text - box) * 100) / 100,
        }
      })
  }, selector)
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
 * starts where they do, each within a pixel. Both are drawn where this is asked.
 */
export function expectBesideOrUnder(
  words: Box | null | undefined,
  control: Box | null | undefined,
) {
  expect(words, 'the words drawn').toBeTruthy()
  expect(control, 'the control drawn').toBeTruthy()
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
    /** Where an element's content starts: its box, moved in by its padding at the start. */
    const contentStart = (element: Element | null) => {
      const found = box(element)
      if (!element || !found) return null
      return {
        ...found,
        x: Math.round(found.x + Number.parseFloat(getComputedStyle(element).paddingLeft)),
      }
    }
    const root = document.documentElement
    // The charts, each by the view it says it shows (`ChartSection`), and the table beside the
    // period before, in the page's order.
    const sections = [...document.querySelectorAll<HTMLElement>('[data-shown], .spending-table')]
    return {
      viewport: root.clientWidth,
      pageScroll: root.scrollWidth - root.clientWidth,
      // The panel's content, which every part of the report starts at.
      page: contentStart(document.querySelector('.analytics-panel')),
      // Where each part starts: the tiles' box and the charts' headings, which stand on one
      // edge of the panel.
      edges: [
        '.spending-tiles',
        '.spending-bars h3',
        '.spending-days h3',
        '.spending-table h3',
      ].map((selector) => box(document.querySelector(selector))?.x ?? null),
      // The bar's content and its first control, the period, which starts it.
      bar: [
        contentStart(document.querySelector('.analytics-page-bar'))?.x ?? null,
        box(document.querySelector('.analytics-period'))?.x ?? null,
      ],
      // The tiles: the radios that name a measure (`SpendingTiles`).
      tiles: [...document.querySelectorAll('[role="radio"]:has([data-measure])')].map((tile) =>
        box(tile),
      ),
      sections: sections.map((section) => {
        const frame = section.querySelector<HTMLElement>('[data-region="table-frame"]')
        return {
          shown: section.dataset.shown,
          box: box(section),
          tableScroll: frame ? frame.scrollWidth - frame.clientWidth : null,
          // How wide the table leaves the name of each row, a day or a value, and the em of its
          // words.
          rowNames: [...section.querySelectorAll('th[scope="row"]')].map((name) => ({
            width: Math.round(name.getBoundingClientRect().width),
            em: Number.parseFloat(getComputedStyle(name).fontSize),
          })),
        }
      }),
    }
  })
}

/**
 * The least a chart's table leaves the name of a row, in the ems of its words: eight, a task's
 * reference and the start of its title (`chartTable.css`, `SpendingTable`).
 */
const NAME_EMS = 8

/** The layout every rendered report holds to, at any width and in any language. */
export function expectWhole(measured: Awaited<ReturnType<typeof measure>>) {
  expect(measured.pageScroll).toBe(0)
  // The period's three figures (`SpendingTiles`), and at least one section under them.
  expect(measured.tiles, 'the tiles').toHaveLength(3)
  expect(measured.sections.length, 'the sections').toBeGreaterThan(0)
  for (const tile of measured.tiles) {
    expect(tile?.x).toBeGreaterThanOrEqual(0)
    expect((tile?.x ?? 0) + (tile?.width ?? 0)).toBeLessThanOrEqual(measured.viewport)
  }
  for (const section of measured.sections)
    expect((section.box?.x ?? 0) + (section.box?.width ?? 0)).toBeLessThanOrEqual(measured.viewport)
  for (const edge of measured.edges)
    expect(Math.abs((edge ?? Number.NaN) - (measured.page?.x ?? 0))).toBeLessThanOrEqual(1)
  const [barStart = null, period = null] = measured.bar
  expect(Math.abs((period ?? Number.NaN) - (barStart ?? 0))).toBeLessThanOrEqual(1)
  // A table wider than its frame scrolls in it, and still leaves each row's name its words:
  // a day squeezed to a letter a line is not readable as a table.
  for (const section of measured.sections)
    for (const name of section.rowNames)
      expect(name.width, `a row's name in ${section.shown ?? 'the table'}`).toBeGreaterThanOrEqual(
        Math.floor(NAME_EMS * name.em),
      )
}

/**
 * Each chart table scrolled to its end in its frame: how far it scrolls, and where the first
 * row's name and the heading over the names stand before and after. A name kept in view stands
 * still while the figures pass under it.
 */
export async function scrolledNames(page: Page) {
  return page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('[data-region="table-frame"]')].map((frame) => {
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

/**
 * Every table that scrolls was scrolled, and kept its row names and their heading in place; the
 * tables that scroll are counted for the caller, which holds that count where its width makes one
 * scroll. At least one table was read.
 */
export function expectNamesInView(names: Awaited<ReturnType<typeof scrolledNames>>) {
  expect(names.length, 'the tables read').toBeGreaterThan(0)
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
