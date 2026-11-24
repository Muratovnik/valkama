/**
 * The bar's states, measured at the widths the bar takes each of its forms in: a phone (360, 390 and
 * 399px, the widest window the narrowest phone's form holds),
 * the two rows of a narrow bar (760 and 1024px), the band where a span of days takes the bar to two
 * rows (1280px), and one line (1440 and 1920px), in Russian, whose words are the longest.
 *
 * A refresh that failed is said in its words at every width, beside the reader's own span of days
 * too, inside the bar's line and the window, and its retry is reached there at every width: where
 * the line has no room for the retry's own word, the words are the retry. Pressed with reads
 * answering, the retry takes the failure away. A failed read leaves no live mark in the bar, neither
 * when the page has nothing to show nor beside the figures a failed refresh kept, and the mark is
 * back once a read answers. A failure said moves nothing: the bar keeps its height, the panel its
 * top, and every control of the bar its place, the filter's field its start, as it takes the room
 * the line leaves. A span of days chosen keeps the bar's height and the panel's top wherever the
 * bar is of one height for every period: in the two rows of a narrow bar, and on a line wide
 * enough for the span; between 50rem and about 1360px the line beside a span is two rows where a
 * preset's is one, which `DESIGN.md` chose over one height, and on a phone the reader's own days
 * take a row of their own only once chosen, rather than a row held empty under every other
 * period. The span's two days stand in one row inside the line, each with a date's whole room,
 * from a phone of 360px up. On a phone every period stands whole in its row, opened, chosen or
 * beside a failure.
 *
 * On the narrowest phones, 360 to 399px, in both languages, the periods stand in two columns or
 * more across the whole first row, and the bar is no taller than at 390px. Where the bar is
 * narrower than 19rem the freshness stands in the cell the periods' short last line leaves, past
 * «Свой» and inside the track, overlapping no period; wider, in the row under them. It reads as the
 * freshness and not as a period: no button, no ground of its own, the muted ink in a size under the
 * periods', outside the choice; wider, under them, it keeps the detail type. Standing beside the
 * periods instead, the freshness left them one column of five lines.
 * A refresh that fails there keeps the row under the periods, inside the bar's line, and the
 * freshness in the cell takes none of that row's room, which the field and a failure share.
 *
 * The bar and the panel end on one right edge whether the panel scrolls or not.
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import {
  barState,
  expectInPlace,
  expectSaid,
  failRefresh,
  frames,
  open,
  serveFailing,
} from './analyticsBarFailure.ts'
import type { BarState } from './analyticsBarFailure.ts'
import { pageAt, record } from './analyticsPage.ts'
import { test } from './test.ts'
/** A preset, a live period, and the reader's own span of days. */
const PERIODS = {
  week: {},
  today: { period: 'today' },
  days: { period: 'custom', from: '2026-11-09', to: '2026-11-11' },
} as const

const WIDTHS = [360, 390, 399, 760, 1024, 1280, 1440, 1920] as const

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

/** Widths the bar is of one height for every period at: two rows, one line. */
const ONE_HEIGHT = [760, 1024, 1440, 1920] as const

/**
 * The room a date has inside its field as the bar first gave it: 8.25rem at the root's 16px, less
 * the field's air of 12px at each end and its edge of 1px (`PeriodOwnDays`).
 */
const DATE_ROOM = 8.25 * 16 - 2 * 12 - 2

/** Each day's field: where it stands, and the room inside its air and edge. */
const dayFields = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll<HTMLInputElement>('.analytics-bar input[type="date"]')].map(
      (field) => {
        const { left, right, top } = field.getBoundingClientRect()
        const style = getComputedStyle(field)
        const room =
          field.clientWidth -
          Number.parseFloat(style.paddingLeft) -
          Number.parseFloat(style.paddingRight)
        return { left, right, top, room }
      },
    ),
  )

/**
 * The two days stand in one row inside the bar's line, each with a date's whole room: at 360px
 * they once needed 288px of a line of 264 and stood under each other.
 */
function expectDaysInOneRow(
  fields: Awaited<ReturnType<typeof dayFields>>,
  line: { left: number; right: number } | null,
) {
  const ends = line ?? { left: Number.NaN, right: Number.NaN }
  expect(fields, "the days' fields").toHaveLength(2)
  const [from, to] = fields
  expect(to?.top, 'the last day beside the first').toBe(from?.top)
  expect(to?.left, 'the last day after the first').toBeGreaterThan(from?.right ?? Number.NaN)
  for (const field of fields) {
    expect(field.left, 'a day before the line').toBeGreaterThanOrEqual(ends.left - 0.5)
    expect(field.right, 'a day past the line').toBeLessThanOrEqual(ends.right + 0.5)
    expect(field.room, "a day's room for its date").toBeGreaterThanOrEqual(DATE_ROOM - 0.5)
  }
}

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
    const fields = await dayFields(page)
    await record(info, `bar-states days ${width}`, { week, days, fields })
    expect(days.bar, "the bar's height").toBe(week.bar)
    expect(days.body, 'the top under the bar').toBe(week.body)
    expectDaysInOneRow(fields, days.line)
  })

// On a phone the days take a row of their own once chosen, so the bar grows by that row; the
// two days still stand in it side by side, each with a date's whole room.
for (const width of [360, 390] as const)
  test(`a span's two days stand in one row of the bar at ${width}px`, async ({ page }, info) => {
    await serveFailing(page, width)
    await open(page, PERIODS.week)
    await page.getByRole('radio', { name: 'Свой' }).click()
    await expect(page.locator('.analytics-bar input[type="date"]')).toHaveCount(2)
    await frames(page)
    const days = await barState(page)
    const fields = await dayFields(page)
    await record(info, `bar-states days ${width}`, { days, fields })
    expectDaysInOneRow(fields, days.line)
  })

/**
 * How far the period that stands furthest out stands past either end of the periods' row or of the
 * window, and how far the row scrolls sideways: every period whole is none of either.
 */
const chosenPast = (page: Page) =>
  page.evaluate(() => {
    const strip = document.querySelector('.period-bar-periods') as HTMLElement
    const row = strip.getBoundingClientRect()
    const window = document.documentElement.clientWidth
    const options = [...strip.querySelectorAll('[role="radio"]')].map((one) => {
      const own = one.getBoundingClientRect()
      return Math.max(row.left - own.left, own.right - row.right, own.right - window, 0)
    })
    return options.length === 5
      ? Math.max(...options, strip.scrollWidth - strip.clientWidth)
      : Number.NaN
  })

for (const width of [360, 390] as const)
  test(`every period stands whole on a phone at ${width}px`, async ({ page }, info) => {
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
      expect.soft(value, `a period past the row, ${name}`).toBeLessThanOrEqual(0.5)
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

/** The periods' name in each language, which names their radio group. */
const PERIODS_LABEL = { en: 'Period', ru: 'Период' } as const
/** The narrowest phones and the phone over them, walked up. */
const PHONES = [360, 370, 380, 390, 399, 400] as const

/**
 * The bar on a phone: its width inside its padding in the root's ems and its height, the periods' track and each
 * segment's box, the freshness's box and its age's, how the freshness is drawn beside the tokens
 * it is drawn in, and a failure's box with the bar's line.
 */
const phoneBar = (page: Page, label: string) =>
  page.evaluate((name) => {
    // This body is serialized and evaluated in the page, so a module-scope
    // helper would not be in scope here.
    // eslint-disable-next-line unicorn/consistent-function-scoping -- see above
    const rect = (found: Element | null | undefined) => {
      const box = found?.getBoundingClientRect()
      return box ? { left: box.left, top: box.top, right: box.right, bottom: box.bottom } : null
    }
    /** What a property of the freshness's own reads as when it is set to `value`. */
    const token = (fresh: HTMLElement, property: 'color' | 'fontSize', value: string) => {
      const probe = document.createElement('span')
      probe.style.setProperty(property === 'color' ? 'color' : 'font', value)
      fresh.append(probe)
      const read = getComputedStyle(probe)[property]
      probe.remove()
      return read
    }
    const root = Number.parseFloat(getComputedStyle(document.documentElement).fontSize)
    const bar = document.querySelector('.analytics-bar')
    const barStyle = bar ? getComputedStyle(bar) : null
    // What the bar's container queries measure: its width inside its padding.
    const inside =
      (bar?.clientWidth ?? 0) -
      Number.parseFloat(barStyle?.paddingLeft ?? '0') -
      Number.parseFloat(barStyle?.paddingRight ?? '0')
    const track = document.querySelector(`[role="radiogroup"][aria-label="${name}"]`)
    const fresh = document.querySelector<HTMLElement>('.analytics-bar-fresh')
    const drawn = fresh ? getComputedStyle(fresh) : null
    return {
      window: document.documentElement.clientWidth,
      ems: inside / root,
      bar: bar?.getBoundingClientRect().height ?? 0,
      track: rect(track),
      segments: [...(track?.querySelectorAll('[role="radio"]') ?? [])]
        .map((one) => rect(one))
        .filter((one) => one !== null),
      fresh: rect(fresh),
      age: rect(fresh?.querySelector('time')),
      drawn: fresh &&
        drawn && {
          tag: fresh.tagName,
          role: fresh.getAttribute('role'),
          inChoice: fresh.closest('[role="radiogroup"]') !== null,
          focusable: fresh.tabIndex >= 0,
          ground: drawn.backgroundColor,
          ink: drawn.color === token(fresh, 'color', 'var(--color-text-muted)'),
        },
      type: drawn && {
        size: Number.parseFloat(drawn.fontSize),
        detail: fresh ? Number.parseFloat(token(fresh, 'fontSize', 'var(--font-detail)')) : 0,
        period: Number.parseFloat(
          getComputedStyle(track?.querySelector('[role="radio"]') ?? document.body).fontSize,
        ),
      },
      failure: rect(document.querySelector('.refresh-failed')),
      line: rect(document.querySelector('.period-bar-line')),
      field: rect(document.querySelector('.analytics-filter-add')),
      refresh: rect(document.querySelector('.analytics-refresh')),
      gap: Number.parseFloat(
        getComputedStyle(document.querySelector('.period-bar-line') ?? document.body).columnGap,
      ),
    }
  }, label)

type PhoneBar = Awaited<ReturnType<typeof phoneBar>>
type Box = NonNullable<PhoneBar['fresh']>

/** How far two boxes overlap each way; overlapping when both are past half a pixel. */
const overlaps = (one: Box, other: Box) =>
  Math.min(one.right, other.right) - Math.max(one.left, other.left) > 0.5 &&
  Math.min(one.bottom, other.bottom) - Math.max(one.top, other.top) > 0.5

/**
 * The periods in two columns or more, the bar no taller than `tallest`, and the freshness where
 * the bar's width puts it: in the cell their last line leaves under 19rem, under them wider.
 */
function expectPhone(name: string, state: PhoneBar, tallest: number) {
  expect(state.segments, `${name}: the periods`).toHaveLength(5)
  const top = state.segments[0]?.top ?? Number.NaN
  const columns = state.segments.filter((one) => Math.abs(one.top - top) <= 0.5).length
  expect.soft(columns, `${name}: the periods' columns`).toBeGreaterThanOrEqual(2)
  expect.soft(state.bar, `${name}: the bar's height`).toBeLessThanOrEqual(tallest + 0.5)
  const fresh = state.fresh ?? { left: Number.NaN, top: Number.NaN, right: 0, bottom: 0 }
  const age = state.age ?? fresh
  const track = state.track ?? fresh
  for (const [at, segment] of state.segments.entries())
    expect.soft(overlaps(fresh, segment), `${name}: the freshness over period ${at}`).toBe(false)
  expect.soft(age.right, `${name}: the age past the window`).toBeLessThanOrEqual(state.window)
  if (state.ems < 19) {
    const last = state.segments.at(-1) ?? fresh
    expect
      .soft(age.left, `${name}: the age before the free cell`)
      .toBeGreaterThanOrEqual(last.right)
    expect.soft(age.right, `${name}: the age past the track`).toBeLessThanOrEqual(track.right)
    // A size under the periods' names, so it does not read as one of them.
    expect
      .soft(state.type?.size, `${name}: the freshness's type beside a period's`)
      .toBeLessThan(state.type?.period ?? Number.NaN)
    expect.soft(age.top, `${name}: the age over the last line`).toBeGreaterThanOrEqual(last.top)
    expect.soft(age.bottom, `${name}: the age under the last line`).toBeLessThanOrEqual(last.bottom)
  } else {
    expect
      .soft(fresh.top, `${name}: the freshness under the periods`)
      .toBeGreaterThanOrEqual(track.bottom)
    expect
      .soft(state.type?.size, `${name}: the freshness's type`)
      .toBe(state.type?.detail ?? Number.NaN)
  }
  expect.soft(state.drawn, `${name}: the freshness drawn as the freshness`).toEqual({
    tag: 'P',
    role: null,
    inChoice: false,
    focusable: false,
    ground: 'rgba(0, 0, 0, 0)',
    ink: true,
  })
}

/**
 * Under 19rem, with no failure said, the freshness standing in the periods' row leaves the row
 * under them to the field and the read again: between them stand only the row's gaps around the
 * failure's column and the freshness's, both empty (`PeriodBar`'s four columns). Standing on the
 * third and fourth columns, the freshness held the third as wide as itself past the read again,
 * 46 to 58px of the row the field and a failure lost.
 */
function expectRowShared(name: string, state: PhoneBar) {
  if (state.ems >= 19 || state.failure !== null) return
  const field = state.field ?? { right: Number.NaN }
  const refresh = state.refresh ?? { left: Number.NaN }
  expect
    .soft(refresh.left - field.right, `${name}: the room the freshness left under the periods`)
    .toBeLessThanOrEqual(3 * state.gap + 0.5)
}

for (const locale of ['ru', 'en'] as const)
  test(`the periods stand in columns and the freshness by them on a phone in ${locale}`, async ({
    page,
  }, info) => {
    await page.addInitScript((chosen) => localStorage.setItem('valkama-locale', chosen), locale)
    const fail = await serveFailing(page, 390)
    await open(page, PERIODS.week)
    const label = PERIODS_LABEL[locale]
    await expect(page.getByRole('radiogroup', { name: label }).getByRole('radio')).toHaveCount(5)
    const seen: Record<string, PhoneBar> = { 'reference 390': await phoneBar(page, label) }
    const tallest = seen['reference 390']?.bar ?? Number.NaN
    for (const width of PHONES) {
      await page.setViewportSize({ width, height: 900 })
      await frames(page)
      const state = await phoneBar(page, label)
      seen[width] = state
      expectPhone(`${width}px`, state, tallest)
      expectRowShared(`${width}px`, state)
    }
    // A refresh that fails on the narrowest phone keeps the row under the periods.
    await page.setViewportSize({ width: 360, height: 900 })
    await frames(page)
    const before = await phoneBar(page, label)
    fail(true)
    await failRefresh(page)
    const after = await phoneBar(page, label)
    seen['360 failed'] = after
    await record(info, `bar-states phone ${locale}`, seen)
    expectPhone('360px failed', after, tallest)
    expect.soft(after.bar, "the failure: the bar's height").toBe(before.bar)
    expect.soft(after.fresh, "the failure: the freshness's box").toEqual(before.fresh)
    const failure = after.failure ?? { left: Number.NaN, top: Number.NaN, right: 0, bottom: 0 }
    const line = after.line ?? failure
    expect
      .soft(failure.top, 'the failure under the periods')
      .toBeGreaterThanOrEqual(after.track?.bottom ?? Number.NaN)
    expect.soft(failure.left, 'the failure before the line').toBeGreaterThanOrEqual(line.left - 0.5)
    expect.soft(failure.right, 'the failure past the line').toBeLessThanOrEqual(line.right + 0.5)
    expect.soft(failure.right, 'the failure past the window').toBeLessThanOrEqual(after.window)
  })

/** Where the bar's line ends, and the panel's content, and whether the panel scrolls. */
const rightEdges = (page: Page) =>
  page.evaluate(() => {
    const panel = document.querySelector<HTMLElement>('.analytics-panel')
    const line = document.querySelector('.period-bar-line')?.getBoundingClientRect()
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
