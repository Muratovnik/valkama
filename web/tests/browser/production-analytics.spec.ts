/**
 * The Analytics page in the real app at the widths it is used at: the tiles, the bars and the
 * days stand whole, nothing clips its own words, the page never scrolls sideways, a narrow page
 * reads each chart as a table, and Tab reaches every control. The double answers on the route the
 * page really reads, `/api/analytics/usage`, by what each read is grouped by.
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { noTask, task, unknownTask, usageAnswer, value } from '../fixtures/analytics.ts'
import type { Stretch } from '../fixtures/analytics.ts'
import { installBackend } from './backend.ts'
import { shot } from './boardPage.ts'
import { expectNoSilentClipping } from './overflow.ts'
import { globalScope } from './planningFixtures.ts'
import { test } from './test.ts'

const PAGE = serializePlatformRoute({ module_id: 'analytics', scope: globalScope })

const MONDAY = new Date(2026, 10, 9)
/** Wednesday afternoon, so the week holds two whole days and one not over yet. */
const NOW = new Date(2026, 10, 11, 14, 30)

/** Twelve tasks with long titles, work on no task and work nobody can place, over three days. */
const STRETCHES: Stretch[] = [
  ...Array.from({ length: 12 }, (_, index) => ({
    day: index % 3,
    group: {
      work_item: task(
        index + 1,
        `Rework the import of very long planning documents into the board, part ${index + 1}`,
      ),
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

const BEFORE: Stretch[] = [
  {
    day: 0,
    group: { work_item: task(1, 'One') },
    spend: { seconds: 90_000, tokens: 9e6, cost: 99 },
  },
]

/** Who worked: one account on Monday, two from Tuesday. */
const ACCOUNTS: Stretch[] = [
  { day: 0, group: { account: value('work@example.test') }, spend: { seconds: 3600 } },
  { day: 1, group: { account: value('work@example.test') }, spend: { seconds: 3600 } },
  { day: 1, group: { account: value('night@example.test') }, spend: { seconds: 3600 } },
  { day: 2, group: { account: value('night@example.test') }, spend: { seconds: 3600 } },
]

async function serve(page: Page) {
  await page.clock.setFixedTime(NOW)
  await installBackend(page)
  await page.route('**/api/analytics/usage?*', (route) => {
    const query = new URL(route.request().url()).searchParams
    const byAccount = query.get('group_by') === 'account'
    const answer = usageAnswer({
      first: MONDAY,
      days: 3,
      end: NOW,
      groupBy: byAccount ? ['account'] : ['work_item'],
      stretches: byAccount ? ACCOUNTS : STRETCHES,
      before: query.get('compare') === 'true' ? BEFORE : null,
    })
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify(answer) })
  })
}

/** Where the page's parts stand, rounded to the pixel, for the record and the assertions. */
async function measure(page: Page) {
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
    const sections = [...document.querySelectorAll<HTMLElement>('.chart-section')]
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

/**
 * What Tab stands on in the page, in order, until it leaves it: each control marked first, so
 * the walk names what it reached and what it never did. A group of radios is one stop, its
 * chosen option; the arrows move inside it.
 */
async function tabWalk(page: Page) {
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

for (const width of [1440, 1024, 390]) {
  test(`the page stands whole and Tab reaches every control at ${width}px`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height: 1000 })
    await serve(page)
    await page.goto(PAGE)
    const analytics = page.locator('.analytics-page')
    await expect(analytics.locator('.tile-figure[data-measure="time"]')).toHaveText(
      /^5\sd\s17\sh$/u,
    )
    await expect(analytics.locator('.spending-days')).toBeVisible()

    const narrow = width < 600
    for (const section of await analytics.locator('.chart-section').all())
      await expect(section).toHaveAttribute('data-shown', narrow ? 'table' : 'chart')

    // The day not over yet says so; the change of accounts is marked and said.
    await expect(analytics.locator('.spending-days')).toContainText('so far')
    await expect(analytics.locator('.spending-days')).toContainText(
      'Accounts: work@example.test → work@example.test, night@example.test',
    )

    const measured = await measure(page)
    await info.attach(`analytics-layout-${width}.json`, {
      body: JSON.stringify(measured, null, 2),
      contentType: 'application/json',
    })
    console.log(`analytics layout ${width}: ${JSON.stringify(measured)}`)
    expect(measured.pageScroll).toBe(0)
    for (const tile of measured.tiles) {
      expect(tile?.x).toBeGreaterThanOrEqual(0)
      expect((tile?.x ?? 0) + (tile?.width ?? 0)).toBeLessThanOrEqual(measured.viewport)
    }
    for (const section of measured.sections)
      expect((section.box?.x ?? 0) + (section.box?.width ?? 0)).toBeLessThanOrEqual(
        measured.viewport,
      )
    for (const edge of measured.edges)
      expect(Math.abs((edge ?? Number.NaN) - (measured.page?.x ?? 0))).toBeLessThanOrEqual(1)
    // A table wider than its frame scrolls in it, and still leaves each row's name its words:
    // a day squeezed to a letter a line is not readable as a table.
    for (const section of measured.sections)
      for (const name of section.rowNames) expect(name).toBeGreaterThanOrEqual(80)
    await expectNoSilentClipping(page, `analytics at ${width}px`, '.analytics-page')
    await page.screenshot(shot(info, `analytics-${width}.png`))
    await analytics.locator('.spending-bars').screenshot(shot(info, `analytics-bars-${width}.png`))
    await analytics.locator('.spending-days').screenshot(shot(info, `analytics-days-${width}.png`))

    // Every control, the filters' own once their disclosure is open.
    const closed = await tabWalk(page)
    expect(closed.missed).toEqual([])
    await analytics.locator('.disclosure-toggle').focus()
    await page.keyboard.press('Enter')
    await expect(analytics.locator('[data-dimension]').first()).toBeVisible()
    const open = await tabWalk(page)
    expect(open.controls).toBeGreaterThan(closed.controls)
    expect(open.missed).toEqual([])
    console.log(`analytics keyboard ${width}: ${JSON.stringify({ closed, open })}`)

    // The arrows move inside a group of radios: the tiles choose the measure from the keys.
    await analytics.locator('.spending-tiles .segmented-option.active').focus()
    await page.keyboard.press('ArrowRight')
    await expect(analytics.locator('.spending-tiles .segmented-option.active')).toBeFocused()
    const chosen = serializePlatformRoute({
      module_id: 'analytics',
      scope: globalScope,
      state: { measure: 'tokens' },
    })
    await expect.poll(() => page.url().slice(new URL(page.url()).origin.length)).toBe(chosen)
    await expect(analytics.locator('.spending-bars h2')).toHaveText('Tokens by task')
  })
}
