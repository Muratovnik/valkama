/**
 * The Analytics page in the real app at the widths it is used at: the tiles, the bars and the
 * days stand whole, nothing clips its own words, the page never scrolls sideways, a narrow page
 * reads each chart as a table whose row names stay in view while its figures scroll, and Tab
 * reaches every control. The double answers on the route the page really reads,
 * `/api/analytics/usage`, by the period, the filters and the grouping each read asks for.
 *
 * Each state the page has is opened and measured, and the run prints what it measured: the page
 * in Russian, waiting, failed and empty, fallen to zeros, beside a period before not read, with a
 * change of accounts past unrecorded work, a custom period with its two date fields, the filters
 * open with chips, a chart of one value and one with a large «other», each chart beside its table.
 */
import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import { task } from '../fixtures/analytics.ts'
import {
  bars,
  boxes,
  expectBarsInTracks,
  expectNamesInView,
  expectWhole,
  LONG_TAIL,
  measure,
  ONE_VALUE,
  ONLY_WEEK_BEFORE,
  openReport,
  pageAt,
  pageScroll,
  record,
  scrolledNames,
  serve,
  tabWalk,
  UNRECORDED_BETWEEN,
} from './analyticsPage.ts'
import type { Answer } from './analyticsPage.ts'
import { shot } from './boardPage.ts'
import { expectNoSilentClipping } from './overflow.ts'
import { test } from './test.ts'

for (const width of [1440, 1024, 390]) {
  test(`the page stands whole and Tab reaches every control at ${width}px`, async ({
    page,
  }, info) => {
    await serve(page)
    const analytics = await openReport(page, width)
    await expect(analytics.locator('.tile-figure[data-measure="time"]')).toHaveText(
      /^5\sd\s17\sh$/u,
    )

    const narrow = width < 600
    for (const section of await analytics.locator('.chart-section').all())
      await expect(section).toHaveAttribute('data-shown', narrow ? 'table' : 'chart')

    // The day not over yet says so; the change of accounts is marked and said.
    await expect(analytics.locator('.spending-days')).toContainText('so far')
    await expect(analytics.locator('.spending-days')).toContainText(
      'Accounts: work@example.test → work@example.test, night@example.test',
    )

    const measured = await measure(page)
    await record(info, `analytics layout ${width}`, measured)
    expectWhole(measured)
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
    const chosen = pageAt({ measure: 'tokens' })
    await expect.poll(() => page.url().slice(new URL(page.url()).origin.length)).toBe(chosen)
    await expect(analytics.locator('.spending-bars h2')).toHaveText('Tokens by task')
  })
}

test('a phone scrolls the days table under its days, which stay in view', async ({
  page,
}, info) => {
  await serve(page)
  await openReport(page, 390)
  const names = await scrolledNames(page)
  await record(info, 'analytics row names scrolled 390', names)
  // The days table is wider than a phone: it scrolls in its frame, and its days stand still.
  expect(expectNamesInView(names)).toBeGreaterThan(0)
})

test.describe('in Russian', () => {
  test.use({ locale: 'ru-RU' })

  for (const width of [1440, 1024, 390])
    test(`the page stands whole at ${width}px`, async ({ page }, info) => {
      await serve(page)
      const analytics = await openReport(page, width)
      await expect(analytics.locator('.spending-bars h2')).toContainText('по задачам')
      const measured = await measure(page)
      const names = await scrolledNames(page)
      await record(info, `analytics ru layout ${width}`, {
        ...measured,
        tileWords: await analytics.locator('.spending-tiles .segmented-option').allTextContents(),
        names,
      })
      expectWhole(measured)
      expectNamesInView(names)
      await expectNoSilentClipping(page, `analytics ru at ${width}px`, '.analytics-page')
      await page.screenshot(shot(info, `analytics-ru-${width}.png`))
    })
})

/**
 * The report beside what it is missing or what is zero, in each language: this week fallen to
 * zeros from the week before, a week before that could not be read, and a change of accounts
 * past a day of work whose organization nobody recorded.
 */
const READ_STATES: {
  name: string
  answer?: Answer
  failWeekBefore?: boolean
  says: (analytics: Locator, ru: boolean) => Promise<void>
}[] = [
  {
    name: 'fallen to zero',
    answer: ONLY_WEEK_BEFORE,
    says: async (analytics, ru) => {
      const time = analytics.locator('.tile-figure[data-measure="time"]')
      await expect(time).toHaveText(ru ? /^0\sмин$/u : /^0\smin$/u)
      await expect(analytics.locator('.tile-figure[data-measure="tokens"]')).toHaveText('0')
      await expect(analytics.locator('.spending-tiles .tile-change').first()).toContainText('↓ 100')
    },
  },
  {
    name: 'period before not read',
    failWeekBefore: true,
    says: async (analytics, ru) => {
      const unread = analytics.locator('.spending-unread')
      await expect(unread.getByRole('status')).toHaveText(
        ru
          ? 'Предыдущий период не удалось прочитать, поэтому изменение не показано.'
          : 'The period before could not be read, so no change is shown.',
      )
      await expect(unread.getByRole('button')).toHaveText(ru ? 'Повторить' : 'Retry')
    },
  },
  {
    name: 'accounts changed past unrecorded work',
    answer: UNRECORDED_BETWEEN,
    says: async (analytics, ru) => {
      await expect(analytics.locator('.spending-days')).toContainText(
        `${ru ? 'Аккаунты' : 'Accounts'}: work@example.test → night@example.test`,
      )
      const notes = analytics.locator('.spending-days :is(.period-note, td)', {
        hasText: ru ? 'Аккаунты:' : 'Accounts:',
      })
      await expect(notes).toHaveCount(1)
    },
  },
]

for (const ru of [false, true])
  test.describe(`the report beside what is missing${ru ? ', in Russian' : ''}`, () => {
    test.use({ locale: ru ? 'ru-RU' : 'en-US' })
    for (const width of [1440, 1024, 390])
      for (const { name, answer, failWeekBefore, says } of READ_STATES)
        test(`${name} stands whole at ${width}px`, async ({ page }, info) => {
          await serve(page, answer, failWeekBefore)
          const analytics = await openReport(page, width)
          await says(analytics, ru)
          const measured = await measure(page)
          const unread = await boxes(page, '.spending-unread')
          await record(info, `analytics ${ru ? 'ru ' : ''}${name} ${width}`, {
            ...measured,
            unread,
            tileWords: await analytics
              .locator('.spending-tiles .segmented-option')
              .allTextContents(),
          })
          expectWhole(measured)
          for (const box of unread) {
            expect(Math.abs(box.x - (measured.page?.x ?? 0))).toBeLessThanOrEqual(1)
            expect(box.x + box.width).toBeLessThanOrEqual(width)
          }
          await expectNoSilentClipping(
            page,
            `analytics ${ru ? 'ru ' : ''}${name} at ${width}px`,
            '.analytics-page',
          )
          await page.screenshot(
            shot(info, `analytics-${ru ? 'ru-' : ''}${name.replaceAll(' ', '-')}-${width}.png`),
          )
        })
  })

/** What stands for the report while it has none to show: a state's panel, or the empty one. */
const STAND_IN = '.analytics-page :is(.platform-state-panel, .data-empty)'

/** The stand-in and what it says. */
async function standIn(page: Page) {
  const panel = page.locator(STAND_IN)
  await expect(panel).toBeVisible()
  const [box] = await boxes(page, STAND_IN)
  return {
    busy: await panel.getAttribute('aria-busy'),
    role: await panel.getAttribute('role'),
    title: await panel.locator(':is(.platform-state-title, .empty-title)').textContent(),
    actions: await panel.getByRole('button').allTextContents(),
    box,
    pageScroll: await pageScroll(page),
  }
}

/** Each state the report can stand in for, and what its stand-in says and offers. */
const STATES: {
  actions: string[]
  answer: Answer
  busy: string | null
  name: string
  title: string
}[] = [
  { name: 'waiting', answer: 'hold', busy: 'true', title: 'Loading', actions: [] },
  {
    name: 'failed',
    answer: 'failed',
    busy: null,
    title: 'Could not load this view',
    actions: ['Retry'],
  },
  { name: 'empty', answer: [], busy: null, title: 'Nothing was spent in this period', actions: [] },
]

for (const width of [1440, 390])
  for (const { name, answer, busy, title, actions } of STATES)
    test(`the page ${name} stands whole at ${width}px`, async ({ page }, info) => {
      await serve(page, answer)
      await page.setViewportSize({ width, height: 1000 })
      await page.goto(pageAt())
      const shown = await standIn(page)
      await record(info, `analytics ${name} ${width}`, shown)
      expect(shown.title?.trim()).toBe(title)
      expect(shown.busy).toBe(busy)
      expect(shown.actions.map((action) => action.trim())).toEqual(actions)
      expect(shown.pageScroll).toBe(0)
      expect((shown.box?.x ?? 0) + (shown.box?.width ?? 0)).toBeLessThanOrEqual(width)
      await expectNoSilentClipping(page, `analytics ${name} at ${width}px`, '.analytics-page')
      await page.screenshot(shot(info, `analytics-${name}-${width}.png`))
    })

test('a custom period shows its two date fields whole at 390px', async ({ page }, info) => {
  await serve(page)
  await openReport(page, 390, pageAt({ period: 'custom', from: '2026-11-02', to: '2026-11-11' }))
  const fields = page.locator('.analytics-controls input[type="date"]')
  await expect(fields).toHaveCount(2)
  await expect(fields.first()).toHaveValue('2026-11-02')
  const measured = {
    controls: await boxes(page, '.analytics-controls > *'),
    dateInputs: await boxes(page, '.analytics-controls input[type="date"]'),
    pageScroll: await pageScroll(page),
    days: await page.locator('.spending-days tbody tr').count(),
  }
  await record(info, 'analytics custom period 390', measured)
  expect(measured.pageScroll).toBe(0)
  for (const field of measured.dateInputs) {
    expect(field.x).toBeGreaterThanOrEqual(0)
    expect(field.x + field.width).toBeLessThanOrEqual(390)
    // A date field leaves its date and its picker room.
    expect(field.width).toBeGreaterThanOrEqual(140)
  }
  expect(measured.days).toBe(10)
  await expectNoSilentClipping(page, 'analytics custom period at 390px', '.analytics-page')
  await page.locator('.analytics-controls').screenshot(shot(info, 'analytics-custom-390.png'))
})

for (const width of [1440, 390])
  test(`the filters open with chips stand whole at ${width}px`, async ({ page }, info) => {
    await serve(page)
    const filters = { model: ['model-a'], work_item: [task(1, '').id, task(2, '').id] }
    const analytics = await openReport(page, width, pageAt({ filters: JSON.stringify(filters) }))
    await analytics.locator('.disclosure-toggle').click()
    const chips = analytics.locator('.combo-chip')
    await expect(chips).toHaveCount(3)
    await expect(chips.filter({ hasText: 'MAIN-1' })).toHaveCount(1)
    const measured = {
      fields: await boxes(page, '[data-dimension]'),
      chips: await boxes(page, '.combo-chip'),
      chipWords: await chips.allTextContents(),
      clear: await boxes(page, '.analytics-filter-clear'),
      pageScroll: await pageScroll(page),
    }
    await record(info, `analytics filters open ${width}`, measured)
    expect(measured.pageScroll).toBe(0)
    for (const chip of measured.chips) expect(chip.x + chip.width).toBeLessThanOrEqual(width)
    await expectNoSilentClipping(page, `analytics filters at ${width}px`, '.analytics-page')
    await page.screenshot(shot(info, `analytics-filters-${width}.png`))
  })

for (const width of [1440, 390]) {
  test(`a chart of one value stands whole at ${width}px`, async ({ page }, info) => {
    await serve(page, ONE_VALUE)
    const analytics = await openReport(page, width)
    await analytics.locator('.spending-bars').getByRole('radio', { name: 'Chart' }).click()
    await expect(analytics.locator('.spending-bars .ranked-bar')).toHaveCount(1)
    const measured = await bars(page)
    await record(info, `analytics one value ${width}`, measured)
    expect(measured.rows.join(' ')).toContain('The only task')
    expectBarsInTracks(measured)
    await expectNoSilentClipping(page, `analytics one value at ${width}px`, '.analytics-page')
    await analytics.locator('.spending-bars').screenshot(shot(info, `analytics-one-${width}.png`))
  })

  test(`a chart with a large other stands whole at ${width}px`, async ({ page }, info) => {
    await serve(page, LONG_TAIL)
    const analytics = await openReport(page, width)
    await analytics.locator('.spending-bars').getByRole('radio', { name: 'Chart' }).click()
    await expect(analytics.locator('.spending-bars .ranked-rest')).toBeVisible()
    const measured = await bars(page)
    await record(info, `analytics large other ${width}`, measured)
    expect(measured.rest).toEqual([expect.stringMatching(/^Other, \d+ more$/u)])
    expectBarsInTracks(measured)
    await expectNoSilentClipping(page, `analytics large other at ${width}px`, '.analytics-page')
    await analytics.locator('.spending-bars').screenshot(shot(info, `analytics-other-${width}.png`))
  })
}

for (const width of [1440, 1024])
  test(`each chart beside its table at ${width}px`, async ({ page }, info) => {
    await serve(page)
    const analytics = await openReport(page, width)
    const chart = await measure(page)
    const charted = await bars(page)
    for (const section of await analytics.locator('.chart-section').all()) {
      await section.getByRole('radio', { name: 'Table' }).click()
      await expect(section).toHaveAttribute('data-shown', 'table')
    }
    const table = await measure(page)
    const names = await scrolledNames(page)
    await record(info, `analytics chart against table ${width}`, {
      chart: chart.sections.map((section) => section.box),
      table: table.sections.map(({ box, tableScroll }) => ({ box, tableScroll })),
      names,
    })
    expectWhole(table)
    expectNamesInView(names)
    // The table holds what its chart holds: a row for each bar and for each day.
    await expect(analytics.locator('.spending-bars tbody tr')).toHaveCount(charted.rows.length)
    await expect(analytics.locator('.spending-days tbody tr')).toHaveCount(3)
    await expectNoSilentClipping(page, `analytics tables at ${width}px`, '.analytics-page')
    await page.screenshot(shot(info, `analytics-tables-${width}.png`))
  })
