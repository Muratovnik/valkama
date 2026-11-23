/**
 * What the bar keeps whole when its line is short of room, in the real app over the browser
 * double: the age of the newest record is never the part that is cut. A record of an earlier day
 * names its day short, by its date with the month, and says its whole age at 1440 and 1024px.
 *
 * A refresh that fails says so in the bar with its retry, readable, and the bar stays inside the
 * window at 1440, 1280 and 1024px beside the app's navigation, in «Now», «Today» and this week,
 * with an age of seconds or of hours: no part of it past the line's end, the read again in the
 * window, the age whole, and the bar as high as before, so nothing under it moves. A live
 * period's mark is not drawn beside the failure, which says the reads do not stand.
 *
 * Beside the reader's own span of days or of moments, in either language, the read again stands
 * inside the bar at every width from 1024 to 1920px: the line gives up its words, its room between
 * parts and the word around the age, and never a day. At each width the bar's controls stand
 * where they stood when the age was 5 s, however old it grows: the freshness is one width.
 *
 * Below 50rem, at 1024, 1100 and 1106px, the bar beside that span is the two rows of a preset's,
 * in either language and at an age of 5 s or 59 min: the periods and the filters, then the ends at
 * the second row's start and the read again at its end, the days whole, the bar as high as the
 * week's and «Now»'s and the panel where it was.
 *
 * The age is measured where its letters are drawn, against every box that would hide what it
 * covers, rather than by a box's scroll width, which misses a cut of a fraction of a pixel.
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { openReport, pageAt, record } from './analyticsPage.ts'
import { NOW, serveLive } from './liveDouble.ts'
import { DAYS } from './served/analyticsBarRoom.ts'
import { test } from './test.ts'
/**
 * Where the age the freshness shows is drawn, how wide its words are, and every box that would
 * hide what it covers: each around it up to the bar that does not show what overflows it, and the
 * window. Its words are the time's text a reader sees, the sentence's start and any word the line
 * gave up being hidden for assistive technology; they are read from their letters, and measured
 * again in a copy that takes the same type, where nothing can cut them.
 */
async function agePlace(page: Page) {
  await page.evaluate(() => document.fonts.ready)
  const time = page.locator('.analytics-bar-fresh time')
  const drawn = await time.evaluate((element: HTMLElement) => {
    const texts: Text[] = []
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); node; node = walker.nextNode())
      if (!node.parentElement?.closest('.visually-hidden') && node.textContent)
        texts.push(node as Text)
    const age = texts.map((text) => text.data).join('')
    const range = document.createRange()
    range.setStart(texts[0] ?? element, 0)
    range.setEnd(texts.at(-1) ?? element, texts.at(-1)?.length ?? 0)
    const { left, right } = range.getBoundingClientRect()
    const copy = document.createElement('span')
    copy.textContent = age
    copy.style.cssText = 'position: absolute; visibility: hidden; white-space: pre'
    element.after(copy)
    const need = copy.getBoundingClientRect().width
    copy.remove()
    return { age, need, at: [left, right] }
  })
  const around = await time.evaluate((element) => {
    const clips = [{ name: 'the window', left: 0, right: document.documentElement.clientWidth }]
    for (let box: Element | null = element; box; box = box.parentElement) {
      if (getComputedStyle(box).overflowX !== 'visible') {
        const { left, right } = box.getBoundingClientRect()
        clips.push({ name: box.className || box.tagName, left, right })
      }
      if (box.matches('.analytics-bar')) break
    }
    return { words: element.textContent?.trim() ?? '', clips }
  })
  return { ...drawn, ...around }
}

/** The age stands whole, inside every box that would hide what it covers. */
function expectWholeAge(drawn: Awaited<ReturnType<typeof agePlace>>) {
  const [left = 0, right = 0] = drawn.at
  expect(right - left, `«${drawn.age}» drawn narrower than its words`).toBeGreaterThanOrEqual(
    drawn.need - 0.5,
  )
  for (const clip of drawn.clips) {
    expect(left, `«${drawn.age}» starts before ${clip.name}`).toBeGreaterThanOrEqual(
      clip.left - 0.5,
    )
    expect(right, `«${drawn.age}» is cut by ${clip.name}`).toBeLessThanOrEqual(clip.right + 0.5)
  }
}

/**
 * Newest records of an earlier day: last evening, 18 h 30 min before now, the longest age a day
 * gives, and three days back.
 */
const EARLIER_RECORDS = [
  { back: 'yesterday', earlier: new Date(NOW.getTime() - (18 * 60 + 30) * 60_000) },
  { back: 'days ago', earlier: new Date(NOW.getTime() - (3 * 24 + 2) * 3_600_000) },
] as const

/** The freshness of each: the day by its date with the month, short, then the clock and the age. */
const EARLIER_WORDS = {
  en: {
    'yesterday': /^Newest record Nov\s10,\s20:00 · 18\sh\s30\smin\sago$/u,
    'days ago': /^Newest record Nov\s8,\s12:30 · 3\sd\s2\sh\sago$/u,
  },
  ru: {
    'yesterday': /^Последняя запись 10\sнояб\.,\s20:00 · 18\sч\s30\sмин\sназад$/u,
    'days ago': /^Последняя запись 8\sнояб\.,\s12:30 · 3\sдн\.\s2\sч\sназад$/u,
  },
} as const

for (const lang of ['en', 'ru'] as const)
  test.describe(`the bar's room, ${lang}`, () => {
    test.use({ locale: lang === 'ru' ? 'ru-RU' : 'en-US' })

    for (const width of [1440, 1024])
      for (const { back, earlier } of EARLIER_RECORDS)
        test(`a record from ${back} says its date short and its whole age at ${width}px`, async ({
          page,
        }, info) => {
          const double = await serveLive(page, DAYS)
          double.lastEventAt = earlier
          await page.setViewportSize({ width, height: 900 })
          await page.goto(pageAt())
          await expect(page.locator('.analytics-bar-fresh time')).toBeVisible()
          const drawn = await agePlace(page)
          await record(info, `bar-earlier-record ${lang} ${back} ${width}`, drawn)
          expectWholeAge(drawn)
          expect(drawn.words).toMatch(EARLIER_WORDS[lang][back])
        })
  })

/** The failure as the bar says it, with its retry. */
const FAILED = { en: 'Could not refresh · Retry', ru: 'Не удалось обновить · Повторить' }

/** Newest records a failure is said beside: seconds old, and the long age of the same day. */
const AGES = [
  { age: 'seconds', earlier: new Date(NOW.getTime() - 9000) },
  { age: 'hours', earlier: new Date(NOW.getTime() - (6 * 60 + 44) * 60_000) },
] as const

/** Where the bar's line and each part on it stand across the page, and the bar's height. */
const barParts = (page: Page) =>
  page.evaluate(() => {
    const across = (selector: string) => {
      const box = document.querySelector(selector)?.getBoundingClientRect()
      return box ? { left: box.left, right: box.right } : null
    }
    const parts = Object.fromEntries(
      [
        '.period-bar-periods',
        '.analytics-filter-add',
        '.analytics-bar-fresh',
        '.refresh-failed',
        '.refresh-failed-words',
        '.refresh-failed-retry',
        '.analytics-refresh',
      ].flatMap((selector) => {
        const box = across(selector)
        return box ? [[selector, box]] : []
      }),
    ) as Record<string, { left: number; right: number }>
    const bar = document.querySelector('.analytics-bar')?.getBoundingClientRect()
    const panel = document.querySelector('.analytics-panel')?.getBoundingClientRect()
    return {
      window: document.documentElement.clientWidth,
      line: across('.period-bar-line'),
      parts,
      mark: document.querySelector('.analytics-bar-fresh-mark') !== null,
      bar: bar?.height ?? 0,
      panel: panel?.top ?? 0,
    }
  })

type BarParts = Awaited<ReturnType<typeof barParts>>

/** Every part the bar shows stands on its line, and in the window. */
function expectOnLine(name: string, after: BarParts) {
  const line = after.line ?? { left: Number.NaN, right: Number.NaN }
  // The navigation stands beside the page: the bar is in what it leaves.
  expect(line.left, name).toBeGreaterThan(0)
  for (const [part, box] of Object.entries(after.parts)) {
    expect(box.left, `${name}: ${part} before the line`).toBeGreaterThanOrEqual(line.left - 0.5)
    expect(box.right, `${name}: ${part} past the line`).toBeLessThanOrEqual(line.right + 0.5)
    expect(box.right, `${name}: ${part} past the window`).toBeLessThanOrEqual(after.window)
  }
}

/** Opens a period and lets the bar's words and room settle. */
async function openPeriod(page: Page, period: string) {
  await page.goto(pageAt(period === 'week' ? {} : { period }))
  await expect(page.locator('.analytics-bar-fresh time')).toBeVisible()
  await page.evaluate(() => document.fonts.ready)
  await page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  )
}

for (const lang of ['en', 'ru'] as const)
  test.describe(`a failed refresh in the bar, ${lang}`, () => {
    test.use({ locale: lang === 'ru' ? 'ru-RU' : 'en-US' })

    for (const width of [1440, 1280, 1024])
      test(`keeps the bar inside the window and the age whole at ${width}px`, async ({
        page,
      }, info) => {
        const double = await serveLive(page, DAYS)
        // Registered last, so it is asked first: while failing, every read is refused.
        let failing = false
        await page.route('**/api/analytics/usage?*', (route) =>
          failing
            ? route.fulfill({ status: 500, contentType: 'application/json', body: '{}' })
            : route.fallback(),
        )
        await page.setViewportSize({ width, height: 900 })
        const seen: Record<string, unknown> = {}
        for (const period of ['now', 'today', 'week'])
          for (const { age, earlier } of AGES) {
            const name = `${period}, ${age}`
            failing = false
            double.lastEventAt = earlier
            await openPeriod(page, period)
            const before = await barParts(page)
            failing = true
            await page.locator('.analytics-refresh').click()
            const failed = page.locator('.refresh-failed')
            await expect(failed).toHaveText(FAILED[lang])
            await page.evaluate(
              () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
            )
            const after = await barParts(page)
            const drawn = await agePlace(page)
            seen[name] = { before, after, age: drawn }
            expectOnLine(name, after)
            expectWholeAge(drawn)
            // The failure reads in words, and its retry stands beside them.
            const words = after.parts['.refresh-failed-words'] ?? { left: 0, right: 0 }
            expect(words.right - words.left, `${name}: the failure's words`).toBeGreaterThan(40)
            await expect(failed.getByRole('button')).toBeVisible()
            // A failed read leaves no live mark, a live period's included: its room stays.
            expect(before.mark, `${name}: the live mark before`).toBe(period !== 'week')
            expect(after.mark, `${name}: the live mark`).toBe(false)
            // Nothing under the bar moves.
            expect(after.bar, `${name}: the bar's height`).toBe(before.bar)
            expect(after.panel, `${name}: the panel's top`).toBe(before.panel)
          }
        await record(info, `bar-failed ${lang} ${width}`, seen)
      })
  })

/** The reader's own periods: a span of days, and a span of two hours' moments. */
const OWN = {
  days: { period: 'custom', from: '2026-11-09', to: '2026-11-11' },
  moments: { period: 'custom', from: '2026-11-11T12:00', to: '2026-11-11T14:00' },
} as const

/** The fields of its days each own period stands as: its first and last day, or none. */
const FIELDS: Record<keyof typeof OWN, number> = { days: 2, moments: 0 }

/** The youngest and the oldest age of the same hour: the freshness keeps one width for both. */
const SPREAD = [5000, 59 * 60_000] as const

for (const lang of ['en', 'ru'] as const)
  test.describe(`the bar beside an own period, ${lang}`, () => {
    test.use({ locale: lang === 'ru' ? 'ru-RU' : 'en-US' })

    for (const [own, address] of Object.entries(OWN))
      test(`keeps the read again inside the bar and the controls in place, by ${own}`, async ({
        page,
      }, info) => {
        await page.clock.install({ time: NOW })
        const double = await serveLive(page, DAYS)
        const seen: Record<string, unknown> = {}
        for (const width of [1024, 1200, 1280, 1440, 1920]) {
          await page.setViewportSize({ width, height: 900 })
          const at: BarParts[] = []
          for (const back of SPREAD) {
            double.lastEventAt = new Date(NOW.getTime() - back)
            await page.goto(pageAt(address))
            await expect(page.locator('.analytics-bar-fresh time')).toBeVisible()
            await page.evaluate(() => document.fonts.ready)
            await page.evaluate(
              () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
            )
            const parts = await barParts(page)
            const name = `${width}px, ${back / 1000} s`
            seen[name] = { parts, age: await agePlace(page) }
            expectOnLine(name, parts)
            const refresh = parts.parts['.analytics-refresh']
            const line = parts.line ?? { right: Number.NaN }
            expect(refresh?.right, `${name}: the read again past the line`).toBeLessThanOrEqual(
              line.right + 0.5,
            )
            expectWholeAge(await agePlace(page))
            at.push(parts)
          }
          const [young, old] = at
          expect(old?.parts, `${width}px: the bar's parts at 59 min`).toEqual(young?.parts)
        }
        await record(info, `bar-own ${lang} ${own}`, seen)
      })
  })

/**
 * Windows the bar is two rows in beside the app's navigation: 1024px, where the periods and two
 * days alone take nearly all of the line, and 1106px, the widest, its bar just under 50rem.
 */
const TWO_ROWS = [1024, 1100, 1106] as const

/** Where the bar's parts stand down the page and across it, its height and the panel's top. */
const rowsOf = (page: Page) =>
  page.evaluate(() => {
    const box = (selector: string) => {
      const found = document.querySelector(selector)?.getBoundingClientRect()
      return found
        ? { top: found.top, bottom: found.bottom, left: found.left, right: found.right }
        : null
    }
    return {
      bar: document.querySelector('.analytics-bar')?.getBoundingClientRect().height ?? 0,
      panel: document.querySelector('.analytics-panel')?.getBoundingClientRect().top ?? 0,
      line: box('.period-bar-line'),
      periods: box('.period-bar-periods'),
      filters: box('.analytics-filter-add'),
      own: box('.period-bar-own'),
      refresh: box('.analytics-refresh'),
      days: [...document.querySelectorAll('.analytics-bar input[type="date"]')].map((field) => {
        const { left, right } = field.getBoundingClientRect()
        return { left, right }
      }),
    }
  })

type Rows = Awaited<ReturnType<typeof rowsOf>>
/** Halfway down a box. */
const middle = (box: { bottom: number; top: number } | null) =>
  box ? (box.top + box.bottom) / 2 : Number.NaN

/** Opens an address with its section on show and lets the bar's words and room settle. */
async function openSection(page: Page, width: number, address: Record<string, string>) {
  await openReport(page, width, pageAt(address))
  await expect(page.locator('.analytics-bar-fresh time')).toBeVisible()
  await page.evaluate(() => document.fonts.ready)
  await page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  )
}

/**
 * The bar of the reader's own period is the two rows of a preset's: the periods and the filters,
 * then the ends at the second row's start and the read again at its end, the bar as high as the
 * week's and «Now»'s, and the panel where it was.
 */
function expectTwoRows(
  name: string,
  own: Rows,
  { now, week }: { now: Rows; week: Rows },
  fields: number,
) {
  expect(own.bar, `${name}: the bar's height against the week's`).toBe(week.bar)
  expect(own.bar, `${name}: the bar's height against «Now»'s`).toBe(now.bar)
  expect(own.panel, `${name}: the panel's top`).toBe(week.panel)
  const line = own.line ?? { left: Number.NaN, right: Number.NaN }
  // The filters beside the periods, on the first row.
  expect(
    Math.abs(middle(own.filters) - middle(own.periods)),
    `${name}: the filters' row`,
  ).toBeLessThanOrEqual(0.5)
  // The ends under the periods, at the second row's start.
  expect(own.own?.top, `${name}: the ends beside the periods`).toBeGreaterThanOrEqual(
    own.periods?.bottom ?? Number.NaN,
  )
  expect(
    Math.abs((own.own?.left ?? Number.NaN) - line.left),
    `${name}: the ends' start`,
  ).toBeLessThanOrEqual(0.5)
  // The read again on that row, at its end.
  expect(
    Math.abs(middle(own.refresh) - middle(own.own)),
    `${name}: the read again's row`,
  ).toBeLessThanOrEqual(0.5)
  expect(
    Math.abs((own.refresh?.right ?? Number.NaN) - line.right),
    `${name}: the read again's end against the line's`,
  ).toBeLessThanOrEqual(0.5)
  // Each day as wide as a date of the widest figures needs beside its picker, its 8.25rem at the
  // root's 16px (`PeriodOwnDays`), and inside the line: the two days of a span of days, none
  // of a span between two moments, which its name stands for.
  expect(own.days, `${name}: the days' fields`).toHaveLength(fields)
  for (const day of own.days) {
    expect(day.right - day.left, `${name}: a day's field`).toBeGreaterThanOrEqual(8.25 * 16)
    expect(day.left, `${name}: a day before the line`).toBeGreaterThanOrEqual(line.left - 0.5)
    expect(day.right, `${name}: a day past the line`).toBeLessThanOrEqual(line.right + 0.5)
  }
}

for (const lang of ['en', 'ru'] as const)
  test.describe(`the bar below 50rem beside an own period, ${lang}`, () => {
    test.use({ locale: lang === 'ru' ? 'ru-RU' : 'en-US' })

    for (const [own, address] of Object.entries(OWN))
      test(`is the two rows of a preset's, the ends under the periods, by ${own}`, async ({
        page,
      }, info) => {
        await page.clock.install({ time: NOW })
        const double = await serveLive(page, DAYS)
        const seen: Record<string, unknown> = {}
        for (const width of TWO_ROWS) {
          double.lastEventAt = new Date(NOW.getTime() - SPREAD[0])
          await openSection(page, width, {})
          const week = await rowsOf(page)
          await openSection(page, width, { period: 'now' })
          const now = await rowsOf(page)
          const at: BarParts[] = []
          for (const back of SPREAD) {
            double.lastEventAt = new Date(NOW.getTime() - back)
            await openSection(page, width, address)
            const name = `${width}px, ${back / 1000} s`
            const rows = await rowsOf(page)
            const parts = await barParts(page)
            const drawn = await agePlace(page)
            seen[name] = { week, now, rows, age: drawn }
            expectOnLine(name, parts)
            expectWholeAge(drawn)
            expectTwoRows(name, rows, { week, now }, FIELDS[own as keyof typeof OWN])
            at.push(parts)
          }
          const [young, old] = at
          expect(old?.parts, `${width}px: the bar's parts at 59 min`).toEqual(young?.parts)
        }
        await record(info, `bar-own-rows ${lang} ${own}`, seen)
      })
  })
