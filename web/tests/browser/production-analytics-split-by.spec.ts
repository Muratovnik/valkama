/**
 * The second dimension is the section's, in the real app at 1440 by 1000, in English and in
 * Russian: «Split by» in the heading of the «Model» section chooses «Effort», and the ranked bars,
 * the small charts, the day columns and the table then read the pairs, «claude-opus-5-5 · high»,
 * the model first, each pair in one hue in the bars, its small chart and the day columns. The bars
 * add up to the table's total, and so do the day columns, for the same period and filters. The
 * split is the address: a reload opens it again, and Back takes it away, a step of its own. In
 * Russian the heading holds the section's name, its «ⓘ» and the choice on one line at 1280 and
 * 1440 pixels. Each run prints what it measured.
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { messages } from '@/shared/i18n/index.ts'

import { value } from '../fixtures/analytics.ts'
import type { TimedStretch } from '../fixtures/analytics.ts'
import { hues } from './analyticsHues.ts'
import { openReport, pageAt, record, serve } from './analyticsPage.ts'
import { test } from './test.ts'

type Locale = 'en' | 'ru'

const HOUR = 3600
const at = (day: number) => new Date(2026, 10, day, 10)

/** One stretch of a model at an effort, `hours` long, on a day of November. */
const stretch = (day: number, model: string, effort: string, hours: number): TimedStretch => ({
  at: at(day),
  group: { model: value(model), effort: value(effort) },
  spend: { seconds: hours * HOUR },
})

/**
 * The week so far, five pairs in 12 h 30 min: claude-opus-5-5 at high effort 6 h over Monday and
 * Tuesday, at medium 3 h; claude-sonnet-5-5 at high 2 h and at medium 1 h; claude-haiku-5-5 at
 * high half an hour. The Monday before, an hour of claude-opus-5-5 at high, to compare with.
 */
const WORLD: TimedStretch[] = [
  stretch(9, 'claude-opus-5-5', 'high', 4),
  stretch(9, 'claude-sonnet-5-5', 'medium', 1),
  stretch(10, 'claude-opus-5-5', 'high', 2),
  stretch(10, 'claude-opus-5-5', 'medium', 3),
  stretch(11, 'claude-sonnet-5-5', 'high', 2),
  stretch(11, 'claude-haiku-5-5', 'high', 0.5),
  stretch(2, 'claude-opus-5-5', 'high', 1),
]

const PAIRS = [
  'claude-opus-5-5 · high',
  'claude-opus-5-5 · medium',
  'claude-sonnet-5-5 · high',
  'claude-sonnet-5-5 · medium',
  'claude-haiku-5-5 · high',
]
const TOTAL_MINUTES = 12 * 60 + 30

/** The minutes of a span of agent time as the page writes it: «12 h 30 min», «12 ч 30 мин». */
function minutesOf(text: string): number {
  let minutes = 0
  for (const [, count, unit = ''] of text.matchAll(/(\d+)\s*([a-zа-я]+)/giu)) {
    const amount = Number(count)
    if (/^[dд]/iu.test(unit)) minutes += amount * 24 * 60
    else if (/^[hч]/iu.test(unit)) minutes += amount * 60
    else if (/^(?:min|мин)/iu.test(unit)) minutes += amount
  }
  return minutes
}

const path = (page: Page) => page.url().slice(new URL(page.url()).origin.length)

const MODEL = pageAt({ by: 'model' })
const SPLIT = pageAt({ by: 'model', across: 'effort' })

/** The «Model» section open in `locale` at `width`. */
async function openModels(page: Page, locale: Locale, width: number) {
  await page.addInitScript((chosen) => localStorage.setItem('valkama-locale', chosen), locale)
  await serve(page, WORLD)
  return openReport(page, width, MODEL)
}

/** Splits the open section by effort through «Split by» in its heading. */
async function splitByEffort(page: Page, locale: Locale) {
  await page.locator('.dimension-section > .level-head .dimension-split .choice-trigger').click()
  const effort = messages[locale].analytics.dimensions.effort
  await page.getByRole('option', { name: effort, exact: true }).click()
}

const trimmed = (texts: readonly string[]) => texts.map((one) => one.trim())
const minutes = (texts: readonly string[]) => texts.map((one) => minutesOf(one))

/**
 * What the bars, the table and the day columns show, as names and minutes. A name is read by its
 * words: a pair's two parts are boxes of their own on one line, which `innerText` breaks apart.
 */
async function shown(page: Page, locale: Locale) {
  const bars = page.locator('.spending-bars .ranked-row')
  const barLabels = await bars.locator('.ranked-label').allTextContents()
  const barValues = await bars.locator('.ranked-value').allInnerTexts()
  const multipleNames = await page
    .locator('.spending-multiples .multiple .multiple-name')
    .allTextContents()
  const table = page.locator('.spending-table')
  const tableLabels = await table.locator('tbody th').allTextContents()
  const tableTotal = await table.locator('tfoot td[data-measure="time"]').textContent()
  // The day columns as their table: each day's total under the column the words call it.
  const days = page.locator('.spending-days')
  await days.locator('.segmented-option').nth(1).click()
  await expect(days.locator('table')).toBeVisible()
  const headings = trimmed(await days.locator('thead th').allInnerTexts())
  const totalAt = headings.indexOf(messages[locale].analytics.days.total)
  const dayTotals = await days
    .locator('tbody tr')
    .evaluateAll(
      (rows, column) => rows.map((row) => row.children[column]?.textContent ?? ''),
      totalAt,
    )
  await days.locator('.segmented-option').nth(0).click()
  return {
    multipleNames: trimmed(multipleNames),
    barNames: trimmed(barLabels),
    barMinutes: minutes(barValues),
    tableNames: trimmed(tableLabels),
    tableTotal: minutesOf(tableTotal ?? ''),
    daySeries: headings.slice(1, totalAt),
    dayMinutes: minutes(dayTotals),
  }
}

const sum = (values: readonly number[]) => values.reduce((all, one) => all + one, 0)

for (const locale of ['en', 'ru'] as const) {
  test(`in ${locale}, the Model section split by Effort reads its pairs in the bars and the table, and is the address`, async ({
    page,
  }, info) => {
    await openModels(page, locale, 1440)
    await splitByEffort(page, locale)
    await expect.poll(() => path(page)).toBe(SPLIT)
    await expect(page.locator('.spending-bars .ranked-label').first()).toHaveText(PAIRS[0] ?? '')

    await expect(page.locator('.spending-days .chart-key[data-series]')).toHaveCount(PAIRS.length)
    const split = await shown(page, locale)
    const drawn = await hues(page, 'model')
    await record(info, `analytics split by ${locale}`, { ...split, hues: drawn })
    // Every pair, the model first, largest first, in the bars, the small charts, the day columns
    // and the table alike.
    expect(split.barNames).toEqual(PAIRS)
    expect(split.multipleNames).toEqual(PAIRS)
    expect(split.daySeries).toEqual(PAIRS)
    expect(split.tableNames).toEqual(PAIRS)
    // Each pair is one hue in the three charts, and five pairs are five hues.
    const keys = Object.keys(drawn.bars)
    expect(keys).toHaveLength(PAIRS.length)
    for (const key of keys) {
      expect(drawn.multiples[key], key).toBe(drawn.bars[key])
      expect(drawn.days[key], key).toBe(drawn.bars[key])
    }
    expect(new Set(Object.values(drawn.bars)).size).toBe(PAIRS.length)
    // The bars and the day columns each add up to the table's total, the period's 12 h 30 min.
    expect(split.tableTotal).toBe(TOTAL_MINUTES)
    expect(sum(split.barMinutes)).toBe(split.tableTotal)
    expect(sum(split.dayMinutes)).toBe(split.tableTotal)

    // A reload opens the same split.
    await page.reload()
    await expect(page.locator('.spending-bars .ranked-label').first()).toHaveText(PAIRS[0] ?? '')
    expect(path(page)).toBe(SPLIT)
    await expect(page.locator('.spending-table tbody th')).toHaveText(PAIRS)

    // Back takes the split away: the section's own values again.
    await page.goBack()
    await expect.poll(() => path(page)).toBe(MODEL)
    await expect(page.locator('.spending-bars .ranked-label').first()).toHaveText('claude-opus-5-5')
    const back = await page.locator('.spending-table tbody th').allInnerTexts()
    expect(back.some((name) => name.includes(' · '))).toBe(false)
  })
}

test('in ru, the section heading holds its name, its «ⓘ» and «Split by» on one line at 1280 and 1440', async ({
  page,
}, info) => {
  await openModels(page, 'ru', 1440)
  await splitByEffort(page, 'ru')
  await expect.poll(() => path(page)).toBe(SPLIT)
  const measured: Record<number, unknown> = {}
  for (const width of [1280, 1440]) {
    await page.setViewportSize({ width, height: 1000 })
    const room = await page.evaluate(() => {
      const head = document.querySelector('.dimension-section > .level-head')
      const box = (selector: string) => head?.querySelector(selector)?.getBoundingClientRect()
      const name = box('.level-heading')
      const about = box('.level-about')
      const choice = box('.dimension-split')
      const label = box('.dimension-split-label')
      if (!head || !name || !about || !choice || !label) throw new Error('a part is missing')
      const row = head.getBoundingClientRect()
      return {
        head: { left: row.left, right: row.right, height: row.height },
        name: { right: name.right, top: name.top, bottom: name.bottom },
        about: { right: about.right },
        label: { left: label.left, top: label.top, bottom: label.bottom },
        choice: { left: choice.left, right: choice.right, top: choice.top, bottom: choice.bottom },
      }
    })
    measured[width] = room
    // One line: the choice stands beside the name, not under it, and ends inside the row.
    expect(room.choice.top, `${width}px`).toBeLessThan(room.name.bottom)
    expect(room.name.top, `${width}px`).toBeLessThan(room.choice.bottom)
    expect(room.label.left, `${width}px`).toBeGreaterThan(room.about.right)
    expect(room.choice.right, `${width}px`).toBeLessThanOrEqual(room.head.right + 0.5)
  }
  await record(info, 'analytics split heading ru', measured)
})
