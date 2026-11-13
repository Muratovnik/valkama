/**
 * The reader's own period between two moments, in the real app over the browser double: «Today»
 * open, the address of three of its hours is a new place in the history. The chart then holds
 * those three hours and no other, the read asks for them by the hour and compares them with the
 * three hours right before, and the bar names the span in place of the two days, with nothing in
 * it moved, at the widths where the bar is one line. Back is «Today» again, its whole day. A span
 * whose name is longer than the line has room for once it gave up all else is cut at its end,
 * the read again kept at the line's end and the hint saying the name whole.
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { task } from '../fixtures/analytics.ts'
import type { TimedStretch } from '../fixtures/analytics.ts'
import { openReport, pageAt, record } from './analyticsPage.ts'
import { shot } from './boardPage.ts'
import { at, NOW, serveLive } from './liveDouble.ts'
import { test } from './test.ts'

/**
 * Work today inside the span, from 10:00 to 13:00, beside work earlier and later, and some in
 * the three hours right before it, which the span is compared with.
 */
const TODAY: TimedStretch[] = [
  { at: at(7, 30), group: { work_item: task(1, 'Fix') }, spend: { seconds: 900 } },
  { at: at(6, 40), group: { work_item: task(1, 'Fix') }, spend: { seconds: 3600 } },
  { at: at(10, 20), group: { work_item: task(1, 'Fix') }, spend: { seconds: 1800 } },
  { at: at(12, 40), group: { work_item: task(2, 'Read') }, spend: { seconds: 600 } },
  { at: at(13, 30), group: { work_item: task(2, 'Read') }, spend: { seconds: 3600 } },
]

const TODAY_ADDRESS = pageAt({ period: 'today' })
const SPAN_ADDRESS = pageAt({ period: 'custom', from: '2026-11-11T10:00', to: '2026-11-11T13:00' })
/** Three hours across midnight: the longest name a span of one day's hours has. */
const NIGHT_ADDRESS = pageAt({
  period: 'custom',
  from: '2026-11-10T22:00',
  to: '2026-11-11T01:00',
})

/** What each language calls «Today» and the span, as the bar names it. */
const WORDS = {
  en: {
    today: 'Today',
    span: /^Nov\s11,\s10:00\s–\s13:00$/u,
    night: /^Nov\s10,\s22:00\s–\sNov\s11,\s01:00$/u,
    before: /09:59/u,
  },
  ru: {
    today: 'Сегодня',
    span: /^11\sнояб\.,\s10:00\s?–\s?13:00$/u,
    night: /^10\sнояб\.,\s22:00\s–\s11\sнояб\.,\s01:00$/u,
    before: /09:59/u,
  },
} as const

const path = (page: Page) => page.url().slice(new URL(page.url()).origin.length)

/** The columns of the overview's chart, by the hour each starts at. */
const columns = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('.spending-days .period-slot')].map(
      (slot) => slot.dataset.key ?? '',
    ),
  )

/**
 * Where the bar's parts that stand in every period are, and the panel under the bar: each by the
 * edge it is held to, the read again by its end, since a line short of room gives up its words.
 */
const steady = (page: Page) =>
  page.evaluate(() =>
    Object.fromEntries(
      ['.analytics-period', '.analytics-refresh', '.analytics-bar', '.analytics-panel'].map(
        (selector) => {
          const box = document.querySelector(selector)?.getBoundingClientRect()
          if (!box) return [selector, null]
          const edge = selector === '.analytics-refresh' ? box.right : box.x
          return [selector, [edge, box.y, box.height].map((value) => Math.round(value))]
        },
      ),
    ),
  )

for (const lang of ['en', 'ru'] as const)
  test.describe(`a span of moments, ${lang}`, () => {
    test.use({ locale: lang === 'ru' ? 'ru-RU' : 'en-US' })

    for (const width of [1200, 1440, 1920])
      test(`three hours of «Today» are read and named at ${width}px, and Back is «Today» again`, async ({
        page,
      }, info) => {
        const words = WORDS[lang]
        await page.clock.install({ time: NOW })
        const double = await serveLive(page, TODAY)
        const analytics = await openReport(page, width, TODAY_ADDRESS)
        const periods = analytics.locator('.analytics-period')
        await expect(periods.getByRole('radio', { name: words.today })).toBeChecked()
        await expect(analytics.locator('.spending-days .period-slot')).toHaveCount(24)
        await page.evaluate(() => document.fonts.ready)
        const before = await steady(page)
        const opened = await page.evaluate(() => history.length)

        // The span's address, as a new place in the history the app itself goes to.
        await page.evaluate((to) => {
          history.pushState({}, '', to)
          dispatchEvent(new PopStateEvent('popstate'))
        }, SPAN_ADDRESS)
        await expect.poll(() => path(page)).toBe(SPAN_ADDRESS)
        expect(await page.evaluate(() => history.length)).toBe(opened + 1)

        // The chart holds the span's three hours and no other.
        await expect(analytics.locator('.spending-days .period-slot')).toHaveCount(3)
        const shown = await columns(page)
        expect(shown.map((key) => new Date(key).getHours())).toEqual([10, 11, 12])
        expect(shown.map((key) => new Date(key).getDate())).toEqual([11, 11, 11])
        // Half an hour and ten minutes inside it, against a quarter of an hour right before it.
        await expect(analytics.locator('.tile-figure[data-measure="time"]')).toHaveText(
          lang === 'ru' ? /^40\sмин$/u : /^40\smin$/u,
        )
        const change = analytics.locator('.spending-tiles .tile-change').first()
        await expect(change).toContainText('167')
        await expect(change).toContainText(words.before)

        // Asked between its moments by the hour, compared with as long right before it.
        const asked = double.asked.filter(
          (query) => query.get('from') === new Date(2026, 10, 11, 10).toISOString(),
        )
        expect(asked.length).toBeGreaterThan(0)
        for (const query of asked) {
          expect(query.get('to')).toBe(new Date(2026, 10, 11, 13).toISOString())
          expect(query.get('step')).toBe('hour')
        }
        expect(asked.some((query) => query.get('compare') === 'true')).toBe(true)

        // The bar names the span in place of the two days, the period chosen its own.
        const name = analytics.locator('.analytics-bar-span')
        await expect(name).toHaveText(words.span)
        await expect(analytics.locator('.analytics-bar-days')).toHaveCount(0)
        await expect(periods.getByRole('radio', { name: words.today })).not.toBeChecked()
        const after = await steady(page)
        // The name shares the periods' middle, whole on its one line.
        const centred = await page.evaluate(() => {
          const middle = (selector: string) => {
            const box = document.querySelector(selector)?.getBoundingClientRect()
            return box ? box.y + box.height / 2 : Number.NaN
          }
          const span = document.querySelector('.analytics-bar-span')
          return {
            off: Math.abs(middle('.analytics-bar-span') - middle('.analytics-period')),
            // No name at all is as wrong as a name cut short.
            cut: !span || span.scrollWidth > span.clientWidth,
          }
        })
        await analytics
          .locator('.analytics-bar')
          .screenshot(shot(info, `analytics-moment-span-bar-${lang}-${width}.png`))
        await record(info, `moment-span ${lang} ${width}`, {
          columns: shown,
          name: await name.textContent(),
          centred,
          before,
          after,
          asked: asked.map((query) => Object.fromEntries(query)),
        })
        expect(centred.off).toBeLessThanOrEqual(1)
        expect(centred.cut, 'the name is cut').toBe(false)
        // Nothing in the bar moved, and the panel under it did not either.
        expect(after).toEqual(before)

        // Back is «Today» again, its whole day by the hour.
        await page.goBack()
        await expect.poll(() => path(page)).toBe(TODAY_ADDRESS)
        await expect(periods.getByRole('radio', { name: words.today })).toBeChecked()
        await expect(analytics.locator('.spending-days .period-slot')).toHaveCount(24)
        await expect(name).toHaveCount(0)
      })

    test('a name longer than the line’s room is cut last, the read again at the line’s end', async ({
      page,
    }, info) => {
      await page.clock.install({ time: NOW })
      await serveLive(page, [
        ...TODAY,
        { at: at(0, 20), group: { work_item: task(1, 'Fix') }, spend: { seconds: 600 } },
      ])
      // Registered last, so it is asked first: while failing, every read is refused.
      let failing = false
      await page.route('**/api/analytics/usage?*', (route) =>
        failing
          ? route.fulfill({ status: 500, contentType: 'application/json', body: '{}' })
          : route.fallback(),
      )
      const name = page.locator('.analytics-bar-span')
      const words = WORDS[lang].night

      /** Whether the line ends at the read again, and whether the name is cut and has a hint. */
      async function nameState() {
        // The line fits once it gave up what it can, and gives nothing up for room it has.
        await expect
          .poll(() =>
            page.evaluate(() => {
              const line = document.querySelector('.analytics-bar-line')?.getBoundingClientRect()
              const end = document.querySelector('.analytics-refresh')?.getBoundingClientRect()
              return Math.round((end?.right ?? Number.POSITIVE_INFINITY) - (line?.right ?? 0))
            }),
          )
          .toBeLessThanOrEqual(0)
        const cut = await name.evaluate((element) => element.scrollWidth > element.clientWidth)
        await name.hover()
        const hint = page.getByRole('tooltip').filter({ hasText: words })
        // A hint shows after a moment, or never: wait for one only where the name is cut.
        await expect(hint).toHaveCount(Number(cut))
        await page.mouse.move(0, 0)
        return { name: await name.textContent(), cut }
      }

      // At 1200px the line has room for the name whole, and it has no hint.
      await openReport(page, 1200, NIGHT_ADDRESS)
      await page.evaluate(() => document.fonts.ready)
      await expect(name).toHaveText(words)
      const wide = await nameState()
      expect(wide.cut, 'the name cut at 1200px').toBe(false)

      // At 1120px, about the narrowest window the bar is one line in, a read again that failed
      // says so beside it, and the line has room for the name only once it gave up all else: it
      // is cut at its end, and its hint says it whole.
      const analytics = await openReport(page, 1120, NIGHT_ADDRESS)
      await page.evaluate(() => document.fonts.ready)
      await expect(name).toHaveText(words)
      failing = true
      await analytics.locator('.analytics-refresh').click()
      await expect(analytics.locator('.refresh-failed')).toBeVisible()
      const narrow = await nameState()
      expect(narrow.cut, 'the name cut at 1120px beside a failure').toBe(true)
      await record(info, `moment-span night ${lang}`, { wide, narrow })
    })
  })
