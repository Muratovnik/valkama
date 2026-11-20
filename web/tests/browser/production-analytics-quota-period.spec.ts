/**
 * The quota's step lines over the page's period, in the built app, at the widths it is used at
 * (`QuotaPanel`, `QuotaWindow`, `StepLine`). The oracle is the rule (DESIGN.md, Analytics, the
 * quota's panel): the figures and the bar of a window card are its current window's, and its step
 * line covers the period, never less than that window, holding every window of its kind the
 * period overlaps, each whole, the count falling to nothing at each reset, the earlier ones in the
 * neutral ink and the current one at the right end. Every line of a section runs over as long a
 * time as the longest, to its own reset, so the two windows of an account side by side share their
 * plots' top and their time axis moment for moment. The axis names the start of the first window a
 * line holds and its current reset, whole, under the moments they stand at. Where the line holds
 * the window before the current one, the line under the card that names it is gone.
 *
 * The fixture (`quotaWithHistory`): «Work»'s week holds four weeks before the current one, which
 * started four days before now and resets in three; its model's week resets with it and keeps
 * nothing before it. «4 weeks» starts at midnight 27 days ago, so it overlaps all four; «This week»
 * starts on Monday, after the last of them reset, so it overlaps none. Each run attaches what it
 * measured.
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { quotaWithHistory } from '../fixtures/quotaHistory.ts'
import { NOW, openPanel, pageAt, record, serve, serveQuota, shortfalls } from './analyticsPage.ts'
import { drawLined } from './drawnViews.ts'
import { test } from './test.ts'

const HOUR = 3_600_000
const DAY = 24 * HOUR

/** How far two parts may stand apart and still be level, or a moment off its place: a pixel's rounding. */
const LEVEL = 0.5

/** A window card of «Work» in the week's section, by its kind. */
const card = (kind: string) => `[data-account="Work"] [data-window="${kind}"]`

/** What a window's step line draws over its plot, each moment as a share of the plot across. */
const lineOf = (page: Page, kind: string) =>
  page.locator(`${card(kind)} [data-chart="steps"]`).evaluate((figure) => {
    const field = figure.querySelector('[data-region="field"]')?.getBoundingClientRect()
    const plot = figure.querySelector('[data-region="plot"]')?.getBoundingClientRect()
    if (!field || !plot) throw new Error('a step line has a plot and its field')
    const across = (x: number) => (x - field.left) / field.width
    const middle = (element: Element) => {
      const box = element.getBoundingClientRect()
      return across(box.left + box.width / 2)
    }
    const now = figure.querySelector('[data-mark="now"]')
    const word = (end: string) => {
      const found = figure.querySelector(`[data-region="axis"] [data-moment="${end}"]`)
      const box = found?.getBoundingClientRect()
      return {
        text: found?.textContent.trim() ?? '',
        left: box ? across(box.left) : null,
        right: box ? across(box.right) : null,
        top: box?.top ?? null,
      }
    }
    const paint = (selector: string) => {
      const found = figure.querySelector(selector)
      return found ? getComputedStyle(found).stroke : null
    }
    return {
      top: plot.top,
      width: field.width,
      now: now ? middle(now) : null,
      drops: [
        ...figure.querySelectorAll('[data-target="restart"][data-drop] [data-mark="place"]'),
      ].map((drop) => middle(drop)),
      restarts: figure.querySelectorAll('[data-target="restart"]').length,
      readings: figure.querySelectorAll('[data-reading]').length,
      line: paint('[data-mark="line"]'),
      earlier: paint('[data-mark="earlier"]'),
      earlierKey: Boolean(figure.querySelector('[data-region="head"] [data-key="earlier"]')),
      from: word('from'),
      to: word('to'),
    }
  })

/** Opens the week's section of the page at `period`, drawn as charts. */
async function openWeeks(page: Page, width: number, period: string) {
  await serve(page)
  await serveQuota(page, quotaWithHistory(NOW))
  await page.setViewportSize({ width, height: 1000 })
  await openPanel(page, pageAt({ by: 'quota_week', period }))
  await expect(page.locator('[data-account]')).not.toHaveCount(0)
  await drawLined(page.locator('.chart-section').first())
  await page.evaluate(() => document.fonts.ready)
}

/**
 * The fixture's moments, independent of the page: «Work»'s week started 4 days before now and
 * resets in 3, the four weeks before it back to back, and «4 weeks» from midnight 27 days ago.
 */
const START = NOW.getTime() - 4 * DAY
const RESET = NOW.getTime() + 3 * DAY
const FIRST = START - 4 * 7 * DAY

/**
 * Whether two plots start level where their cards stand side by side, their tops level: a pair on
 * one row; cards one under the other are no pair to hold level.
 */
const levelBeside = (cards: number[], top: number, other: number) =>
  Math.abs((cards[0] ?? 0) - (cards[1] ?? 1)) >= LEVEL || Math.abs(top - other) < LEVEL

/** Where a moment stands across a line from `from` to the reset `RESET`. */
const share = (at: number, from: number) => (at - from) / (RESET - from)

for (const width of [1440, 1024, 390])
  test(`at ${width}px over «4 weeks» a week's line holds its windows, the pair on one scale`, async ({
    page,
  }, info) => {
    await openWeeks(page, width, 'weeks4')
    const [week, model] = [await lineOf(page, 'week'), await lineOf(page, 'week_model')]
    const cards = await page
      .locator(`${card('week')}, ${card('week_model')}`)
      .evaluateAll((both) => both.map((one) => one.getBoundingClientRect().top))
    const cut = await shortfalls(page, '[data-window] [data-region="axis"] [data-moment]')
    await record(info, `quota period weeks4 ${width}`, { week, model, cards, cut })
    await info.attach(`quota-period-weeks4-${width}.png`, {
      body: await page.locator(card('week')).screenshot(),
      contentType: 'image/png',
    })
    // Five windows, each whole: the count falls to nothing at each of the four resets, which stand
    // where the weeks before turned over, and the current week ends the line with now in it.
    const drops = [1, 2, 3, 4].map((week) => share(FIRST + week * 7 * DAY, FIRST))
    expect(week.drops, 'a fall at each reset').toHaveLength(drops.length)
    for (const [index, at] of drops.entries())
      expect(Math.abs((week.drops[index] ?? -1) - at) * week.width, `reset ${index}`).toBeLessThan(
        LEVEL + 1,
      )
    expect(
      Math.abs((week.now ?? -1) - share(NOW.getTime(), FIRST)) * week.width,
      'now in the current week',
    ).toBeLessThan(LEVEL + 1)
    // One restart inside the second week besides the four falls; every reading of every week.
    expect(week.restarts, 'the falls and the restart inside a week').toBe(5)
    expect(week.readings, 'the readings of the five weeks').toBe(3 + 4 + 3 + 3 + 4)
    // The weeks before in the neutral ink, which the legend names; the current one in its hue.
    expect(week.earlier, 'the weeks before drawn').not.toBeNull()
    expect(week.earlier, 'the weeks before in another ink').not.toBe(week.line)
    expect(week.earlierKey, 'the legend names the weeks before').toBe(true)
    // The model's week keeps nothing before its current one, and its line runs over as long a time
    // to the same reset: now at the same place across both plots, the model's week empty before it.
    expect(model.drops, 'nothing before the model week').toEqual([])
    expect(
      Math.abs((model.now ?? -1) - (week.now ?? 1)) * week.width,
      'now on one scale',
    ).toBeLessThan(LEVEL + 1)
    expect(Math.abs(model.width - week.width), 'plots as wide').toBeLessThan(LEVEL + 1)
    // The axis names the first start and the reset under the moments they stand at, whole.
    expect(week.from.text, 'the first week its start').toMatch(/^start /u)
    expect(week.to.text, 'the current week its reset').toMatch(/^resets /u)
    expect(
      Math.abs((week.from.left ?? -1) * week.width),
      'its start at the line start',
    ).toBeLessThan(LEVEL + 1)
    expect(Math.abs(((week.to.right ?? 0) - 1) * week.width), 'its reset at the end').toBeLessThan(
      LEVEL + 1,
    )
    expect(model.from.text, 'the model week its own start').toMatch(/^start /u)
    expect(model.to.text, 'the model week its reset').toMatch(/^resets /u)
    // The model week's start word stands at its start, or moves out toward the empty scale whole
    // where the words would not fit beside each other; never over its reset's.
    expect(model.from.left ?? 1, 'its start no further on than its start').toBeLessThanOrEqual(
      share(START, FIRST) + LEVEL / model.width,
    )
    expect((model.from.right ?? 1) <= (model.to.left ?? 0), 'the two words apart').toBe(true)
    expect(
      cut.filter(({ short }) => short > 0),
      'no axis word cut',
    ).toEqual([])
    // Side by side, the pair's plots start level.
    expect(levelBeside(cards, week.top, model.top), 'the pair level where side by side').toBe(true)
  })

for (const width of [1440, 1024, 390])
  test(`at ${width}px over «This week» a week's line holds its one window whole, as before`, async ({
    page,
  }, info) => {
    await openWeeks(page, width, 'week')
    const [week, model] = [await lineOf(page, 'week'), await lineOf(page, 'week_model')]
    const cut = await shortfalls(page, '[data-window] [data-region="axis"] [data-moment]')
    await record(info, `quota period week ${width}`, { week, model, cut })
    // One window across the whole plot: no fall, no ink of a window before, now 4 days of 7 in.
    expect(week.drops).toEqual([])
    expect(week.earlier).toBeNull()
    expect(week.earlierKey).toBe(false)
    expect(week.readings).toBe(4)
    expect(Math.abs((week.now ?? -1) - share(NOW.getTime(), START)) * week.width).toBeLessThan(
      LEVEL + 1,
    )
    expect(Math.abs((week.from.left ?? -1) * week.width)).toBeLessThan(LEVEL + 1)
    expect(Math.abs(((week.to.right ?? 0) - 1) * week.width)).toBeLessThan(LEVEL + 1)
    expect(Math.abs((model.now ?? -1) - (week.now ?? 1)) * week.width).toBeLessThan(LEVEL + 1)
    expect(
      cut.filter(({ short }) => short > 0),
      'no axis word cut',
    ).toEqual([])
  })

test('the line under a week that names the week before goes where the line holds that week', async ({
  page,
}) => {
  // The control: over «This week» the line holds the current week alone, so the line under it
  // names the week before, which ran out.
  await openWeeks(page, 1440, 'week')
  const previous = page.locator(`${card('week')} [data-past="line"]`)
  await expect(previous).toHaveCount(1)
  await expect(previous).toContainText('ran out')
  // Over «4 weeks» the line holds that week, so nothing under it names it again.
  await openPanel(page, pageAt({ by: 'quota_week', period: 'weeks4' }))
  await expect(
    page.locator(`${card('week')} [data-chart="steps"] [data-target="restart"][data-drop]`),
  ).toHaveCount(4)
  await expect(page.locator(`${card('week')} [data-past]`)).toHaveCount(0)
})
