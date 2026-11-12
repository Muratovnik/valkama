/**
 * What the bar keeps whole when its line is short of room, in the real app over the browser
 * double: the age of the newest record is never the part that is cut. A record of an earlier day
 * names its day short, by its date with the month, and says its whole age at 1440 and 1024px.
 *
 * A refresh that fails says so in the bar with its retry, readable, and the bar stays inside the
 * window at 1440, 1280 and 1024px beside the app's navigation, in «Now», «Today» and this week,
 * with an age of seconds or of hours: no part of it past the line's end, the read again in the
 * window, the age whole, and the bar as high as before, so nothing under it moves. Where it has
 * not the room for all of it, the live mark gives way before the line goes short.
 *
 * The age is measured where its letters are drawn, against every box that would hide what it
 * covers, rather than by a box's scroll width, which misses a cut of a fraction of a pixel.
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
  { at: at(14, 20), group: { work_item: task(2, 'Two') }, spend: { seconds: 300 } },
  { at: new Date(2026, 10, 9, 10), group: { work_item: task(1, 'One') }, spend: { seconds: 3600 } },
  {
    at: new Date(2026, 10, 10, 10),
    group: { work_item: task(2, 'Two') },
    spend: { seconds: 3600 },
  },
]

/**
 * Where the age the freshness ends with is drawn, how wide its words are, and every box that
 * would hide what it covers: each around it up to the bar that does not show what overflows it,
 * and the window. Its words are read from its letters; a short bar draws them after the time
 * (`data-age`), and there they are the time's own box, against their width set beside it, where
 * a copy takes the same type.
 */
async function agePlace(page: Page) {
  await page.evaluate(() => document.fonts.ready)
  const time = page.locator('.analytics-bar-fresh time')
  const drawn = await time.evaluate((element: HTMLElement) => {
    const age = element.dataset.age ?? ''
    if (element.closest('.analytics-bar-short')) {
      const copy = document.createElement('span')
      copy.textContent = age
      copy.style.cssText = 'position: absolute; visibility: hidden; white-space: pre'
      element.after(copy)
      const need = copy.getBoundingClientRect().width
      copy.remove()
      const { left, right } = element.getBoundingClientRect()
      return { age, need, at: [left, right] }
    }
    const texts: Text[] = []
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); node; node = walker.nextNode()) texts.push(node as Text)
    const start = texts
      .map((text) => text.data)
      .join('')
      .lastIndexOf(age)
    const end = start + age.length
    const range = document.createRange()
    let at = 0
    for (const text of texts) {
      if (start >= at && start < at + text.length) range.setStart(text, start - at)
      if (end > at && end <= at + text.length) range.setEnd(text, end - at)
      at += text.length
    }
    const { left, right, width } = range.getBoundingClientRect()
    return { age, need: width, at: [left, right] }
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
        '.analytics-period',
        '.analytics-bar-filters',
        '.analytics-bar-live',
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
      line: across('.analytics-bar-line'),
      parts,
      short: document.querySelector('.analytics-bar-short') !== null,
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

/** Whether a live period's mark went before the line went short for the failure. */
const liveWentFirst = (period: string, before: BarParts, after: BarParts) =>
  period === 'week' || before.short || !after.short || !('.analytics-bar-live' in after.parts)

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
            // The live mark goes before the line goes short.
            expect(liveWentFirst(period, before, after), `${name}: the live mark`).toBe(true)
            // Nothing under the bar moves.
            expect(after.bar, `${name}: the bar's height`).toBe(before.bar)
            expect(after.panel, `${name}: the panel's top`).toBe(before.panel)
          }
        await record(info, `bar-failed ${lang} ${width}`, seen)
      })
  })
