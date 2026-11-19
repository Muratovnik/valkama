/**
 * The reader's own period between two moments, in the real app over the browser double: «Today»
 * open, the address of three of its hours is a new place in the history. The chart then holds
 * those three hours and no other, the read asks for them by the hour and compares them with the
 * three hours right before, and the bar names the span in place of the two days, with nothing in
 * it moved, at the widths where the bar is one line and at 1024px, where it is two rows and the
 * name stands at the second row's start. Back is «Today» again, its whole day. A span
 * whose name is longer than the line has room for once it gave up all else is cut at its end,
 * the read again kept at the line's end and its whole words laid over it under the pointer.
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { task } from '../fixtures/analytics.ts'
import { openReport, pageAt, record } from './analyticsPage.ts'
import { shot } from './boardPage.ts'
import { wholeText } from './hintFramesPage.ts'
import { at, NOW, serveLive } from './liveDouble.ts'
import { TODAY } from './served/analyticsMomentSpan.ts'
import { test } from './test.ts'
/**
 * «Today» and three of its hours, with what else the address holds: the section on show, where the
 * screen is too narrow for the list of sections beside it.
 */
const addresses = (held: Record<string, string>) => ({
  today: pageAt({ period: 'today', ...held }),
  span: pageAt({ period: 'custom', from: '2026-11-11T10:00', to: '2026-11-11T13:00', ...held }),
})

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
      ['.period-bar-periods', '.analytics-refresh', '.analytics-bar', '.analytics-panel'].map(
        (selector) => {
          const box = document.querySelector(selector)?.getBoundingClientRect()
          if (!box) return [selector, null]
          const edge = selector === '.analytics-refresh' ? box.right : box.x
          return [selector, [edge, box.y, box.height].map((value) => Math.round(value))]
        },
      ),
    ),
  )

/**
 * The widths the span is named at, each with what the name stands beside: the periods on the one
 * line, and at 1024px, where the bar is two rows, the read again on the second; and what the
 * address holds beside the period: there the section on show, which a narrow screen opens alone.
 */
const ROWS = [
  [1024, '.analytics-refresh', { open: 'section' }],
  [1200, '.period-bar-periods', {}],
  [1440, '.period-bar-periods', {}],
  [1920, '.period-bar-periods', {}],
] as const

for (const lang of ['en', 'ru'] as const)
  test.describe(`a span of moments, ${lang}`, () => {
    test.use({ locale: lang === 'ru' ? 'ru-RU' : 'en-US' })

    for (const [width, row, held] of ROWS)
      test(`three hours of «Today» are read and named at ${width}px, and Back is «Today» again`, async ({
        page,
      }, info) => {
        const words = WORDS[lang]
        const { today, span } = addresses(held)
        await page.clock.install({ time: NOW })
        const double = await serveLive(page, TODAY)
        const analytics = await openReport(page, width, today)
        const periods = analytics.locator('.period-bar-periods')
        await expect(periods.getByRole('radio', { name: words.today })).toBeChecked()
        await expect(analytics.locator('.spending-days .period-slot')).toHaveCount(24)
        await page.evaluate(() => document.fonts.ready)
        const before = await steady(page)
        const opened = await page.evaluate(() => history.length)

        // The span's address, as a new place in the history the app itself goes to.
        await page.evaluate((to) => {
          history.pushState({}, '', to)
          dispatchEvent(new PopStateEvent('popstate'))
        }, span)
        await expect.poll(() => path(page)).toBe(span)
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
        const name = analytics.locator('.period-bar-span')
        await expect(name).toHaveText(words.span)
        await expect(analytics.locator('.period-bar-days')).toHaveCount(0)
        await expect(periods.getByRole('radio', { name: words.today })).not.toBeChecked()
        const after = await steady(page)
        // The name shares the middle of the row it stands on, whole on its one line.
        const centred = await page.evaluate((beside) => {
          const middle = (selector: string) => {
            const box = document.querySelector(selector)?.getBoundingClientRect()
            return box ? box.y + box.height / 2 : Number.NaN
          }
          const span = document.querySelector('.period-bar-span')
          return {
            off: Math.abs(middle('.period-bar-span') - middle(beside)),
            // No name at all is as wrong as a name cut short.
            cut: !span || span.scrollWidth > span.clientWidth,
          }
        }, row)
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
        await expect.poll(() => path(page)).toBe(today)
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
      const name = page.locator('.period-bar-span')
      const words = WORDS[lang].night

      /** Whether the line ends at the read again, and whether the name is cut and laid whole. */
      async function nameState() {
        // The line fits once it gave up what it can, and gives nothing up for room it has.
        await expect
          .poll(() =>
            page.evaluate(() => {
              const line = document.querySelector('.period-bar-line')?.getBoundingClientRect()
              const end = document.querySelector('.analytics-refresh')?.getBoundingClientRect()
              return Math.round((end?.right ?? Number.POSITIVE_INFINITY) - (line?.right ?? 0))
            }),
          )
          .toBeLessThanOrEqual(0)
        const cut = await name.evaluate((element) => element.scrollWidth > element.clientWidth)
        await name.hover()
        const whole = wholeText(page).filter({ hasText: words })
        // The whole name is laid over the cut one after a moment, or never: wait for it only
        // where the name is cut.
        await expect(whole).toHaveCount(Number(cut))
        await page.mouse.move(0, 0)
        return { name: await name.textContent(), cut }
      }

      // At 1200px the line has room for the name whole, and nothing is laid over it.
      await openReport(page, 1200, NIGHT_ADDRESS)
      await page.evaluate(() => document.fonts.ready)
      await expect(name).toHaveText(words)
      const wide = await nameState()
      expect(wide.cut, 'the name cut at 1200px').toBe(false)

      // At 1120px, about the narrowest window the bar is one line in, a read again that failed
      // says so beside it, and the line has room for the name only once it gave up all else: it
      // is cut at its end, and its whole words are laid over it.
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
