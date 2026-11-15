/**
 * The Analytics page's browser double and measurements: the work the double holds, how it
 * answers `/api/analytics/usage` by what each read asks and `/api/analytics/quota` with the
 * quota of four made-up accounts, and where the page's parts stand.
 */
import { expect } from '@playwright/test'
import type { Page, TestInfo } from '@playwright/test'

import type { Quota } from '@/shared/api/analyticsApi.ts'
import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { noTask, serveUsage, task, unknownTask, value } from '../fixtures/analytics.ts'
import type { Stretch, TimedStretch } from '../fixtures/analytics.ts'
import { quotaAnswer, quotaAt } from '../fixtures/quota.ts'
import { installBackend } from './backend.ts'
import type { BackendOptions } from './backend.ts'
import { globalScope, projectId, spaceRef, workItem, workItemRef } from './planningFixtures.ts'

export const pageAt = (state: Record<string, string> = {}) =>
  serializePlatformRoute({ module_id: 'analytics', scope: globalScope, state })

/** Wednesday afternoon, so the week holds two whole days and one not over yet. */
export const NOW = new Date(2026, 10, 11, 14, 30)
const on = (day: number) => new Date(2026, 10, day, 10)

/** Two accounts, each an organization's id as the store holds it; the page names it by its start. */
const WORK = value('5b0c7e21-4a3f-4d8e-9c16-2f7a8b9d0e1f')
const NIGHT = value('d4e8a1f0-7c2b-4e5d-8f36-a1b2c3d4e5f6')

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

/**
 * Figures as long as a month of a busy workstation writes them, «21 days 12 h», «594.9M» and
 * «≈ $9,584.68», in the live hour, so every period up to four weeks holds them; and a table whose
 * count is long: a hundred tasks with tokens, forty-five with agent time alone and no tokens or
 * price, and a hundred and thirty-seven that worked only in the week before.
 */
export const LONG_FIGURES: TimedStretch[] = [
  {
    at: new Date(2026, 10, 11, 14, 20),
    group: {
      work_item: task(1, 'Rework the import of very long planning documents'),
      account: WORK,
    },
    spend: { seconds: 21 * 86_400 + 12 * 3600, tokens: 594_900_000, cost: 9584.68 },
  },
  ...Array.from({ length: 99 }, (_, index) => ({
    at: on(9 + (index % 3)),
    group: { work_item: task(index + 2, `Task with tokens ${index + 2}`), account: WORK },
    spend: { seconds: 3600, tokens: 1_000_000, cost: 1.25 },
  })),
  ...Array.from({ length: 45 }, (_, index) => ({
    at: on(10),
    group: {
      work_item: task(index + 101, `Task with agent time alone ${index + 101}`),
      account: WORK,
    },
    spend: { seconds: 1800 },
  })),
  ...Array.from({ length: 137 }, (_, index) => ({
    at: on(3),
    group: {
      work_item: task(index + 146, `Task of the week before ${index + 146}`),
      account: WORK,
    },
    spend: { seconds: 600, tokens: 10_000, cost: 0.1 },
  })),
]

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
 * `backend` is what the rest of the app's double answers, a task's card among it.
 */
export async function serve(
  page: Page,
  answer: Answer = WORLD,
  failWeekBefore = false,
  backend: BackendOptions = {},
) {
  await page.clock.setSystemTime(NOW)
  await installBackend(page, backend)
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
            target: { ...workItemRef, project_id: projectId, writable: true },
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
        coverage: [
          { project_id: projectId, space_ref: spaceRef, status: 'searched', reason: null },
        ],
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
 * Opens the page at `width` and waits for the report: its tiles and its days; the report of the
 * task section unless an address is given. A window too narrow for the rail beside the panel
 * opens on the list of sections unless the address says otherwise, and the section the address
 * names is chosen there, as a reader would.
 */
export async function openReport(page: Page, width: number, address = TASK_REPORT) {
  await page.setViewportSize({ width, height: 1000 })
  await page.goto(address)
  const analytics = page.locator('.analytics-page')
  await analytics.locator('.analytics-rail:visible, .analytics-panel:visible').first().waitFor()
  if (!(await analytics.locator('.analytics-panel').isVisible()))
    await analytics.locator('.analytics-rail [aria-current="page"]').click()
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
    // The charts and the table beside the period before, in the page's order.
    const sections = [...document.querySelectorAll<HTMLElement>('.chart-section, .spending-table')]
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
  const [barStart = null, period = null] = measured.bar
  expect(Math.abs((period ?? Number.NaN) - (barStart ?? 0))).toBeLessThanOrEqual(1)
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
