/**
 * A filter repaints nothing it leaves, in the real app at 1440 by 900, in English and in Russian.
 * The «Model» section is open with each model's hue read in its tile on the rail, its bar, its
 * small chart and the day columns' key; a filter of medium effort chosen in the bar then takes
 * away claude-opus-5-5, the largest model, which only worked at high effort, and every model left
 * keeps the hue it had in each of the four, one hue across them. The same holds for the section
 * split by effort: the pairs left at medium effort keep their hues in the bars, the small charts
 * and the day columns, and the sixth pair, which the period gives no hue, stays in the neutral.
 * A colour taken from a place in the filtered answer moves every survivor up a hue. Each run
 * prints the colours it read.
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { pairKey } from '@/pages/analytics/utils/usageValues.ts'

import { value } from '../fixtures/analytics.ts'
import type { TimedStretch } from '../fixtures/analytics.ts'
import { openDimension } from './analyticsFilter.ts'
import { hues } from './analyticsHues.ts'
import { LEGEND_SERIES, openReport, pageAt, record, serve } from './analyticsPage.ts'
import { drawLined } from './drawnViews.ts'
import { test } from './test.ts'

const HOUR = 3600
const at = (day: number) => new Date(2026, 10, day, 10)

const OPUS = 'claude-opus-5-5'
const SONNET = 'claude-sonnet-5-5'
const HAIKU = 'claude-haiku-5-5'
const MINI = 'claude-mini-5-5'

/** One stretch of a model at an effort, `hours` long, on a day of November. */
const stretch = (day: number, model: string, effort: string, hours: number): TimedStretch => ({
  at: at(day),
  group: { model: value(model), effort: value(effort) },
  spend: { seconds: hours * HOUR },
})

/**
 * The week so far: claude-opus-5-5 6 h, all at high effort; claude-sonnet-5-5 5 h, 3 h of it at
 * medium; claude-haiku-5-5 2 h 30 min, 1 h 30 min at medium; claude-mini-5-5 half an hour at
 * medium. By the pair, six pairs, the smallest claude-mini-5-5 · medium.
 */
const WORLD: TimedStretch[] = [
  stretch(9, OPUS, 'high', 4),
  stretch(10, OPUS, 'high', 2),
  stretch(9, SONNET, 'medium', 2),
  stretch(11, SONNET, 'medium', 1),
  stretch(10, SONNET, 'high', 2),
  stretch(10, HAIKU, 'medium', 1.5),
  stretch(11, HAIKU, 'high', 1),
  stretch(11, MINI, 'medium', 0.5),
]

const modelKey = (model: string) => `v:${model}`
const pair = (model: string, effort: string) => pairKey(value(model), value(effort))

/** The effort's dimension as the filter's menu names it. */
const EFFORT = { en: 'Effort', ru: 'Усилие' } as const

/** Chooses medium effort in the bar's filter, as a reader does, and closes its menu. */
async function filterMedium(page: Page, effort: string) {
  const menu = await openDimension(page, effort)
  await menu.getByRole('option', { name: 'medium', exact: true }).click()
  await page.keyboard.press('Escape')
  await expect(menu).toBeHidden()
}

/** The three channels of a computed colour. */
const channels = (colour: string) => (colour.match(/\d+/gu) ?? []).slice(0, 3).map(Number)

type Hues = Awaited<ReturnType<typeof hues>>
type Part = keyof Hues

/** Every part that draws `key` draws it in the hue it had before, and every part draws it. */
function expectKept(before: Hues, after: Hues, key: string, parts: readonly Part[]) {
  for (const part of parts) {
    expect(before[part][key], `${key} before, in ${part}`).toBeTruthy()
    expect(after[part][key], `${key} after, in ${part}`).toBe(before[part][key])
  }
}

for (const locale of ['en', 'ru'] as const) {
  test.describe(`in ${locale}`, () => {
    test.beforeEach(async ({ page }) => {
      await page.addInitScript((chosen) => localStorage.setItem('valkama-locale', chosen), locale)
      await serve(page, WORLD)
    })

    test('a filter that takes the largest model away leaves every other model its hue', async ({
      page,
    }, info) => {
      await openReport(page, 1440, pageAt({ by: 'model' }))
      await page.setViewportSize({ width: 1440, height: 900 })
      await drawLined(page.locator('.spending-bars'))
      const tile = page.locator('[data-section="model"] .mini-share-part')
      await expect(tile.first()).toBeVisible()
      await expect(page.locator('.spending-bars .ranked-label').first()).toHaveText(OPUS)
      const before = await hues(page, 'model')

      await filterMedium(page, EFFORT[locale])
      await expect(page.locator('.spending-bars .ranked-label').first()).toHaveText(SONNET)
      for (const gone of [
        tile.and(page.locator(`[data-key="${modelKey(OPUS)}"]`)),
        page.locator(`.spending-days [data-hint-list="legend"] [data-series="${modelKey(OPUS)}"]`),
        page.locator(`.spending-multiples .multiple[data-key="${modelKey(OPUS)}"]`),
      ])
        await expect(gone).toHaveCount(0)
      const after = await hues(page, 'model')
      await record(info, `colour under a filter ${locale}`, { before, after })

      expect(Object.keys(after.bars)).not.toContain(modelKey(OPUS))
      for (const model of [SONNET, HAIKU, MINI]) {
        const key = modelKey(model)
        expectKept(before, after, key, ['tile', 'bars', 'multiples', 'days'])
        // One hue on the page: the tile's, in every part.
        for (const part of ['bars', 'multiples', 'days'] as const)
          expect(after[part][key], `${model} in ${part}`).toBe(after.tile[key])
      }
    })

    test('a filter that takes the largest pair away leaves every other pair its hue', async ({
      page,
    }, info) => {
      await openReport(page, 1440, pageAt({ by: 'model', across: 'effort' }))
      await page.setViewportSize({ width: 1440, height: 900 })
      await expect(page.locator('.spending-bars .ranked-label').first()).toHaveText(
        `${OPUS} · high`,
      )
      await expect(page.locator(`.spending-days ${LEGEND_SERIES}`)).not.toHaveCount(0)
      const before = await hues(page, 'model')

      await filterMedium(page, EFFORT[locale])
      await expect(page.locator('.spending-bars .ranked-label').first()).toHaveText(
        `${SONNET} · medium`,
      )
      await expect(page.locator('.spending-bars .ranked-label', { hasText: '· high' })).toHaveCount(
        0,
      )
      await expect(page.locator(`.spending-days ${LEGEND_SERIES}`)).toHaveCount(3)
      const after = await hues(page, 'model')
      await record(info, `pair colour under a filter ${locale}`, { before, after })

      for (const [model, effort] of [
        [SONNET, 'medium'],
        [HAIKU, 'medium'],
      ] as const)
        expectKept(before, after, pair(model, effort), ['bars', 'multiples', 'days'])
      // The sixth pair has no hue of the period's: a grey before and after, and the day columns
      // fold it into «other» rather than naming it.
      const mini = pair(MINI, 'medium')
      expectKept(before, after, mini, ['bars', 'multiples'])
      const [red, green, blue] = channels(after.bars[mini] ?? '')
      expect(red, 'the sixth pair is a grey').toBe(green)
      expect(green, 'the sixth pair is a grey').toBe(blue)
      expect(after.days[mini]).toBeUndefined()
      expect(Object.keys(after.days)).toContain('other')
    })
  })
}
