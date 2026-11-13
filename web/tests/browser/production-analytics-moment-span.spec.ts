/**
 * The reader's own period between two moments, in the real app over the browser double: «Today»
 * open, the address of three of its hours is a new place in the history. The chart then holds
 * those three hours and no other, the read asks for them by the hour and compares them with the
 * three hours right before, and the bar names the span in place of the two days, with nothing in
 * it moved. Back is «Today» again, its whole day.
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

/** What each language calls «Today» and the span, as the bar names it. */
const WORDS = {
  en: { today: 'Today', span: /^Nov\s11,\s10:00\s–\s13:00$/u, before: /09:59/u },
  ru: { today: 'Сегодня', span: /^11\sнояб\.,\s10:00\s?–\s?13:00$/u, before: /09:59/u },
} as const

const path = (page: Page) => page.url().slice(new URL(page.url()).origin.length)

/** The columns of the overview's chart, by the hour each starts at. */
const columns = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('.spending-days .period-slot')].map(
      (slot) => slot.dataset.key ?? '',
    ),
  )

/** Where the bar's parts that stand in every period are, and the panel under the bar. */
const steady = (page: Page) =>
  page.evaluate(() =>
    Object.fromEntries(
      ['.analytics-period', '.analytics-refresh', '.analytics-bar', '.analytics-panel'].map(
        (selector) => {
          const box = document.querySelector(selector)?.getBoundingClientRect()
          return [
            selector,
            box ? [box.x, box.y, box.height].map((value) => Math.round(value)) : null,
          ]
        },
      ),
    ),
  )

for (const lang of ['en', 'ru'] as const)
  test.describe(`a span of moments, ${lang}`, () => {
    test.use({ locale: lang === 'ru' ? 'ru-RU' : 'en-US' })

    test('three hours of «Today» are read and named, and Back is «Today» again', async ({
      page,
    }, info) => {
      const words = WORDS[lang]
      await page.clock.install({ time: NOW })
      const double = await serveLive(page, TODAY)
      const analytics = await openReport(page, 1440, TODAY_ADDRESS)
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
      await analytics
        .locator('.analytics-bar')
        .screenshot(shot(info, `analytics-moment-span-bar-${lang}.png`))
      await record(info, `moment-span ${lang}`, {
        columns: shown,
        name: await name.textContent(),
        before,
        after,
        asked: asked.map((query) => Object.fromEntries(query)),
      })
      // Nothing in the bar moved, and the panel under it did not either.
      expect(after).toEqual(before)

      // Back is «Today» again, its whole day by the hour.
      await page.goBack()
      await expect.poll(() => path(page)).toBe(TODAY_ADDRESS)
      await expect(periods.getByRole('radio', { name: words.today })).toBeChecked()
      await expect(analytics.locator('.spending-days .period-slot')).toHaveCount(24)
      await expect(name).toHaveCount(0)
    })
  })
