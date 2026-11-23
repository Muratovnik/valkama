/**
 * The decision table of a quota window card's step line, in the built app, at the widths it is used
 * at (`QuotaPanel`, `QuotaWindow`, `StepLine`). The oracle is the rule (DESIGN.md, Analytics, the
 * quota's panel): how far back from now the period starts decides what a line holds — at «Now» and
 * «This week» a week is its one window across the plot, at «4 weeks» and a custom past range every
 * week the period overlaps — and the two windows of one account always stand on one time axis:
 * «Now» and each reset at the same x on both, their plots level, and the words of each axis on one
 * line wherever they fit there.
 *
 * The fixture (`quotaTable`): «Alpha»'s live week started a day before now and resets in six, so
 * «This week», from Monday, starts in the week before it; its model's week has had no reading since
 * its last reset, the live week's start; «Gamma» has had none since its own reset two days ago.
 * Each run attaches what it measured: the windows each card draws, the x of «Now» and of each reset
 * across its plot, the plots' tops and heights, and each axis word with its lines.
 */
import { expect } from '@playwright/test'
import type { Page, TestInfo } from '@playwright/test'

import { quotaTable } from '../fixtures/quotaTable.ts'
import { NOW, openPanel, pageAt, record, serve, serveQuota } from './analyticsPage.ts'
import { drawLined } from './drawnViews.ts'
import { test } from './test.ts'

/** How far two parts may stand apart and still be level, or a moment off its place: a pixel's rounding. */
const LEVEL = 0.5

/** The periods measured: the two short ones, «4 weeks», and a custom range in the past. */
const PERIODS = {
  now: { period: 'now' },
  week: { period: 'week' },
  weeks4: { period: 'weeks4' },
  custom: { period: 'custom', from: '2026-10-26', to: '2026-11-04' },
} as const

/** What a card's step line draws, each moment as a share of its plot across. */
const lineOf = (page: Page, name: string, kind: string) =>
  page
    .locator(`[data-account="${name}"] [data-window="${kind}"] [data-chart="steps"]`)
    .evaluate((figure) => {
      const field = figure.querySelector('[data-region="field"]')?.getBoundingClientRect()
      const plot = figure.querySelector('[data-region="plot"]')?.getBoundingClientRect()
      if (!field || !plot) throw new Error('a step line has a plot and its field')
      const across = (x: number) => (x - field.left) / field.width
      const middle = (element: Element) => {
        const box = element.getBoundingClientRect()
        return across(box.left + box.width / 2)
      }
      const now = figure.querySelector('[data-mark="now"]')
      const words = [...figure.querySelectorAll('[data-region="axis"] [data-moment]')].map(
        (word) => {
          const range = document.createRange()
          range.selectNodeContents(word)
          const lines = new Set([...range.getClientRects()].map((rect) => Math.round(rect.top)))
          const box = word.getBoundingClientRect()
          return {
            text: word.textContent.trim(),
            lines: lines.size,
            left: across(box.left),
            right: across(box.right),
          }
        },
      )
      return {
        top: plot.top,
        height: plot.height,
        width: field.width,
        now: now ? middle(now) : null,
        drops: [
          ...figure.querySelectorAll('[data-target="restart"][data-drop] [data-mark="place"]'),
        ].map((drop) => middle(drop)),
        readings: figure.querySelectorAll('[data-reading]').length,
        earlier: Boolean(figure.querySelector('[data-mark="earlier"]')),
        muted: (figure as HTMLElement).dataset.muted !== undefined,
        // The field holds no words but what it says with no reading.
        empty: figure.querySelector('[data-region="field"]')?.textContent.trim() ?? '',
        words,
      }
    })

/** Opens the week's section of the page at `period`, drawn as charts. */
async function openWeeks(page: Page, width: number, period: Record<string, string>) {
  await serve(page)
  await serveQuota(page, quotaTable(NOW))
  await page.setViewportSize({ width, height: 1000 })
  await openPanel(page, pageAt({ by: 'quota_week', ...period }))
  await expect(page.locator('[data-account]')).not.toHaveCount(0)
  await drawLined(page.locator('.chart-section').first())
  await page.evaluate(() => document.fonts.ready)
}

/**
 * The four week cards' lines at `period` and `width`, and how far apart the pair's cards stand
 * down the page, attached to the run.
 */
async function measure(page: Page, width: number, name: keyof typeof PERIODS, info: TestInfo) {
  await openWeeks(page, width, PERIODS[name])
  const lines = {
    week: await lineOf(page, 'Alpha', 'week'),
    model: await lineOf(page, 'Alpha', 'week_model'),
    beta: await lineOf(page, 'Beta', 'week'),
    gamma: await lineOf(page, 'Gamma', 'week'),
  }
  const [one = 0, other = 0] = await page
    .locator(
      '[data-account="Alpha"] [data-window="week"], [data-account="Alpha"] [data-window="week_model"]',
    )
    .evaluateAll((both) => both.map((card) => card.getBoundingClientRect().top))
  const apart = Math.abs(one - other)
  await record(info, `quota table ${name} ${width}`, { apart, ...lines })
  return { apart, ...lines }
}

/** Whether two plots stand level and as tall where their cards stand side by side. */
const levelBeside = (
  apart: number,
  one: { height: number; top: number },
  other: { height: number; top: number },
) =>
  apart >= LEVEL ||
  (Math.abs(one.top - other.top) < LEVEL && Math.abs(one.height - other.height) < LEVEL)

const WIDTHS = [1440, 1024, 390]

for (const width of WIDTHS)
  for (const name of ['now', 'week'] as const)
    test(`at ${width}px over «${name}» a week is its one window, the pair on one axis`, async ({
      page,
    }, info) => {
      const { apart, week, model, beta, gamma } = await measure(page, width, name, info)
      // One week across the plot, now a day into it; the model's week the same span, empty.
      expect(week.earlier, 'the live week alone').toBe(false)
      expect(week.drops).toEqual([])
      expect(Math.abs((week.now ?? -1) - 1 / 7) * week.width, 'now a day in').toBeLessThan(
        LEVEL + 1,
      )
      expect(model.readings, 'the model week empty').toBe(0)
      expect(model.empty, 'its plot says so').toMatch(/^Reset at .+, no new readings$/u)
      expect(
        Math.abs((model.now ?? -1) - (week.now ?? 1)) * week.width,
        'now on both',
      ).toBeLessThan(LEVEL + 1)
      expect(model.words.map(({ text }) => text)).toEqual(week.words.map(({ text }) => text))
      // «Gamma» keeps its last week whole, muted; «Beta» its own week, five days and 3 hours in.
      expect(gamma.muted).toBe(true)
      expect(gamma.readings).toBe(2)
      expect(Math.abs((beta.now ?? -1) - (5 + 1 / 8) / 7) * beta.width).toBeLessThan(LEVEL + 1)
      expect(levelBeside(apart, week, model), 'the pair level where side by side').toBe(true)
    })

for (const width of WIDTHS)
  for (const name of ['weeks4', 'custom'] as const)
    test(`at ${width}px over «${name}» a week holds the period, the pair on one axis`, async ({
      page,
    }, info) => {
      const { apart, week, model } = await measure(page, width, name, info)
      // Every fall the model week makes at a reset stands where the live week falls at it.
      expect(week.earlier).toBe(true)
      expect(model.drops.length).toBeGreaterThan(0)
      for (const at of model.drops)
        expect(
          Math.min(...week.drops.map((one) => Math.abs(one - at))) * week.width,
          `a reset at ${at}`,
        ).toBeLessThan(LEVEL + 1)
      // Past its last reset the model week has no reading, and its axis ends saying so.
      expect(model.now).toBeNull()
      expect(model.words.at(-1)?.text).toMatch(/^no readings since /u)
      expect(week.words.at(-1)?.text).toMatch(/^resets /u)
      expect(levelBeside(apart, week, model), 'the pair level where side by side').toBe(true)
    })

for (const width of [1440, 1024])
  for (const name of Object.keys(PERIODS) as (keyof typeof PERIODS)[])
    test(`at ${width}px over «${name}» every axis word stands on one line`, async ({
      page,
    }, info) => {
      const lines = await measure(page, width, name, info)
      const words = [lines.week, lines.model, lines.beta, lines.gamma].flatMap((line) => line.words)
      expect(words).toHaveLength(8)
      for (const word of words) expect(word.lines, word.text).toBe(1)
    })
