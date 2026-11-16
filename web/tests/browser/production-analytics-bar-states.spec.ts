/**
 * The bar's states, measured at the widths the bar takes each of its forms in: a phone (360 and 390px),
 * the two rows of a narrow bar (760 and 1024px), the band where a span of days takes the bar to two
 * rows (1280px), and one line (1440 and 1920px), in Russian, whose words are the longest.
 *
 * A refresh that failed is said in its words at every width, beside the reader's own span of days
 * too, inside the bar's line and the window, and its retry is reached there at every width: where
 * the line has no room for the retry's own word, the words are the retry. Pressed with reads
 * answering, the retry takes the failure away. A failed read leaves no live mark in the bar, neither
 * when the page has nothing to show nor beside the figures a failed refresh kept, and the mark is
 * back once a read answers. A failure said moves nothing: the bar keeps its height, the panel its
 * top, and every control of the bar its place. A span of days chosen keeps the bar's height and the
 * panel's top wherever the bar is of one height for every period: on a phone, in the two rows of a
 * narrow bar, and on a line wide enough for the span; between 50rem and about 1360px the line
 * beside a span is two rows where a preset's is one, which `DESIGN.md` chose over one height. On a
 * phone the chosen period stands in view in its row, opened, chosen or beside a failure.
 *
 * The bar and the panel end on one right edge whether the panel scrolls or not.
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { task } from '../fixtures/analytics.ts'
import type { TimedStretch } from '../fixtures/analytics.ts'
import { pageAt, record } from './analyticsPage.ts'
import { at, NOW, serveLive } from './liveDouble.ts'
import { test } from './test.ts'

/** Two days of work this week, and some in the live hour. */
const DAYS: TimedStretch[] = [
  { at: at(13, 50), group: { work_item: task(1, 'One') }, spend: { seconds: 600 } },
  { at: new Date(2026, 10, 9, 10), group: { work_item: task(1, 'One') }, spend: { seconds: 3600 } },
  {
    at: new Date(2026, 10, 10, 10),
    group: { work_item: task(2, 'Two') },
    spend: { seconds: 3600 },
  },
]

/** A preset, a live period, and the reader's own span of days. */
const PERIODS = {
  week: {},
  today: { period: 'today' },
  days: { period: 'custom', from: '2026-11-09', to: '2026-11-11' },
} as const

const frames = (page: Page) =>
  page.evaluate(
    () =>
      new Promise((done) =>
        requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(done))),
      ),
  )

/**
 * The page over the double, the newest record 9 s old, with every usage read refused while
 * `fail` says so.
 */
async function serveFailing(page: Page, width: number) {
  await page.clock.install({ time: NOW })
  const double = await serveLive(page, DAYS)
  double.lastEventAt = new Date(NOW.getTime() - 9000)
  let failing = false
  // Registered last, so it is asked first: while failing, every read is refused.
  await page.route('**/api/analytics/usage?*', (route) =>
    failing
      ? route.fulfill({ status: 500, contentType: 'application/json', body: '{}' })
      : route.fallback(),
  )
  await page.setViewportSize({ width, height: 900 })
  return (now: boolean) => {
    failing = now
  }
}

/** Opens a period with its answer on show and lets the bar settle. */
async function open(page: Page, state: Record<string, string>) {
  await page.goto(pageAt(state))
  await expect(page.locator('.analytics-bar-fresh time')).toBeVisible()
  await page.evaluate(() => document.fonts.ready)
  await frames(page)
}

/** Presses the read again while reads are refused, and waits for the bar to say so. */
async function failRefresh(page: Page) {
  await page.locator('.analytics-refresh').click()
  await expect(page.locator('.refresh-failed')).toBeVisible()
  await frames(page)
}

/**
 * Where the bar's controls stand, its height, the top of what is under it, and the failure's
 * words: how wide they are drawn, and whether they are hidden from sight.
 */
const barState = (page: Page) =>
  page.evaluate(() => {
    const box = (selector: string) => {
      const found = document.querySelector(selector)?.getBoundingClientRect()
      return found ? { left: found.left, top: found.top, right: found.right } : null
    }
    const words = document.querySelector('.refresh-failed-words')
    let said = 0
    if (words) {
      const hidden =
        getComputedStyle(words).clipPath !== 'none' || words.closest('.visually-hidden') !== null
      said = hidden ? 0 : words.getBoundingClientRect().width
    }
    const mark = document.querySelector('.analytics-bar-fresh-mark')
    return {
      window: document.documentElement.clientWidth,
      bar: document.querySelector('.analytics-bar')?.getBoundingClientRect().height ?? 0,
      body: document.querySelector('.analytics-body')?.getBoundingClientRect().top ?? 0,
      line: box('.analytics-bar-line'),
      controls: {
        periods: box('.analytics-period'),
        own: box('.analytics-bar-own'),
        add: box('.analytics-filter-add'),
        fresh: box('.analytics-bar-fresh'),
        refresh: box('.analytics-refresh'),
      },
      failure: box('.refresh-failed'),
      retry: box('.refresh-failed-retry'),
      panel: box('.analytics-panel'),
      said,
      mark: mark !== null && getComputedStyle(mark).visibility === 'visible',
    }
  })

type BarState = Awaited<ReturnType<typeof barState>>

/** The failure is said in its words, and its retry stands, inside the bar's line and the window. */
function expectSaid(name: string, state: BarState) {
  expect.soft(state.said, `${name}: the failure's words`).toBeGreaterThan(40)
  const line = state.line ?? { left: Number.NaN, right: Number.NaN }
  const none = { left: Number.NaN, right: Number.NaN }
  for (const [part, box] of [
    ['failure', state.failure ?? none],
    ['retry', state.retry ?? none],
  ] as const) {
    expect
      .soft(box.left, `${name}: the ${part} before the line`)
      .toBeGreaterThanOrEqual(line.left - 0.5)
    expect
      .soft(box.right, `${name}: the ${part} past the line`)
      .toBeLessThanOrEqual(line.right + 0.5)
    expect.soft(box.right, `${name}: the ${part} past the window`).toBeLessThanOrEqual(state.window)
  }
}

/**
 * Every control of the bar stands where it stood, to the half pixel the bar counts as rounding
 * when it fits its line (`useBarRoom`).
 */
function expectInPlace(name: string, after: BarState['controls'], before: BarState['controls']) {
  for (const [control, was] of Object.entries(before)) {
    const now = after[control as keyof BarState['controls']]
    expect.soft(now === null, `${name}: ${control} shown`).toBe(was === null)
    if (!was || !now) continue
    for (const edge of ['left', 'top', 'right'] as const)
      expect
        .soft(Math.abs(now[edge] - was[edge]), `${name}: ${control}'s ${edge} moved`)
        .toBeLessThanOrEqual(0.5)
  }
}

const WIDTHS = [360, 390, 760, 1024, 1280, 1440, 1920] as const

// Playwright hides scrollbars, and one that arrives narrows what it scrolls on a real screen.
test.use({ locale: 'ru-RU', launchOptions: { ignoreDefaultArgs: ['--hide-scrollbars'] } })

for (const width of WIDTHS)
  test(`a failed refresh is said in words with its retry and moves nothing at ${width}px`, async ({
    page,
  }, info) => {
    const fail = await serveFailing(page, width)
    const seen: Record<string, unknown> = {}
    for (const [name, state] of Object.entries(PERIODS)) {
      fail(false)
      await open(page, state)
      const before = await barState(page)
      fail(true)
      await failRefresh(page)
      const after = await barState(page)
      seen[name] = { before, after }
      expectSaid(name, after)
      expect.soft(after.bar, `${name}: the bar's height`).toBe(before.bar)
      expect.soft(after.body, `${name}: the top under the bar`).toBe(before.body)
      expect.soft(after.panel, `${name}: the panel's box`).toEqual(before.panel)
      expectInPlace(name, after.controls, before.controls)
      // The failure's own retry, at every width, asks again: answered, the failure goes.
      fail(false)
      await page
        .locator('.refresh-failed')
        .getByRole('button', { name: /Повторить/u })
        .click()
      await expect
        .soft(page.locator('.refresh-failed'), `${name}: the failure retried`)
        .toBeHidden()
    }
    await record(info, `bar-states failed ${width}`, seen)
  })

/** Widths the bar is of one height for every period at: a phone, two rows, one line. */
const ONE_HEIGHT = [390, 760, 1024, 1440, 1920] as const

for (const width of ONE_HEIGHT)
  test(`a span of days moves neither the bar nor the panel at ${width}px`, async ({
    page,
  }, info) => {
    await serveFailing(page, width)
    await open(page, PERIODS.week)
    const week = await barState(page)
    await page.getByRole('radio', { name: 'Свой' }).click()
    await expect(page.locator('.analytics-bar input[type="date"]')).toHaveCount(2)
    await frames(page)
    const days = await barState(page)
    await record(info, `bar-states days ${width}`, { week, days })
    expect(days.bar, "the bar's height").toBe(week.bar)
    expect(days.body, 'the top under the bar').toBe(week.body)
  })

/** How far the chosen period stands past either end of the periods' row, which scrolls sideways. */
const chosenPast = (page: Page) =>
  page.evaluate(() => {
    const strip = document.querySelector('.analytics-period') as HTMLElement
    const chosen = strip.querySelector('.active') as HTMLElement
    const row = strip.getBoundingClientRect()
    const own = chosen.getBoundingClientRect()
    return Math.max(row.left - own.left, own.right - row.right, 0)
  })

for (const width of [360, 390] as const)
  test(`the chosen period stands in view on a phone at ${width}px`, async ({ page }, info) => {
    const fail = await serveFailing(page, width)
    const past: Record<string, number> = {}
    for (const [name, state] of Object.entries(PERIODS)) {
      await open(page, state)
      past[`${name} opened`] = await chosenPast(page)
      fail(true)
      await failRefresh(page)
      past[`${name} failed`] = await chosenPast(page)
      fail(false)
    }
    await open(page, PERIODS.week)
    await page.getByRole('radio', { name: 'Свой' }).click()
    await expect(page.locator('.analytics-bar input[type="date"]')).toHaveCount(2)
    await frames(page)
    past['days chosen'] = await chosenPast(page)
    await record(info, `bar-states chosen ${width}`, past)
    for (const [name, value] of Object.entries(past))
      expect.soft(value, `the chosen period past the row, ${name}`).toBeLessThanOrEqual(0.5)
  })

for (const width of [390, 760, 1440] as const)
  test(`a failed read leaves no live mark in the bar at ${width}px`, async ({ page }, info) => {
    const fail = await serveFailing(page, width)
    const seen: Record<string, unknown> = {}
    // A live period whose figures stand: its mark.
    await open(page, PERIODS.today)
    seen.live = await barState(page)
    expect((seen.live as BarState).mark, 'the live mark with figures').toBe(true)
    // A refresh that failed beside the figures it kept: no mark.
    fail(true)
    await failRefresh(page)
    seen.refreshFailed = await barState(page)
    expect((seen.refreshFailed as BarState).mark, 'the live mark beside a failure').toBe(false)
    // A read that failed with nothing to show: no mark.
    await page.goto(pageAt(PERIODS.today))
    await expect(page.locator('.platform-state-title')).toHaveCount(1)
    await frames(page)
    seen.readFailed = await barState(page)
    expect((seen.readFailed as BarState).mark, 'the live mark after a failed read').toBe(false)
    // An answer brings it back.
    fail(false)
    await page.locator('.analytics-refresh').click()
    await expect(page.locator('.analytics-bar-fresh time')).toBeVisible()
    await frames(page)
    seen.answered = await barState(page)
    expect((seen.answered as BarState).mark, 'the live mark once a read answers').toBe(true)
    await record(info, `bar-states mark ${width}`, seen)
  })

/** Where the bar's line ends, and the panel's content, and whether the panel scrolls. */
const rightEdges = (page: Page) =>
  page.evaluate(() => {
    const panel = document.querySelector<HTMLElement>('.analytics-panel')
    const line = document.querySelector('.analytics-bar-line')?.getBoundingClientRect()
    if (!panel || !line) return null
    const end = Number.parseFloat(getComputedStyle(panel).paddingRight)
    const left = panel.getBoundingClientRect().left + panel.clientLeft
    return {
      bar: line.right,
      panel: left + panel.clientWidth - end,
      scrolls: panel.scrollHeight > panel.clientHeight,
    }
  })

for (const width of [1280, 1440] as const)
  test(`the bar and the panel end on one right edge at ${width}px, scrolled or not`, async ({
    page,
  }, info) => {
    await serveFailing(page, width)
    const seen: Record<string, unknown> = {}
    for (const height of [500, 3000]) {
      await page.setViewportSize({ width, height })
      await open(page, PERIODS.week)
      const edges = await rightEdges(page)
      seen[height] = edges
      expect(edges?.scrolls, `${height}px high: the panel scrolls`).toBe(height === 500)
      expect(
        Math.abs((edges?.panel ?? Number.NaN) - (edges?.bar ?? Number.NaN)),
        `${height}px high: the panel's end against the bar's`,
      ).toBeLessThanOrEqual(0.5)
    }
    await record(info, `bar-states edges ${width}`, seen)
  })
