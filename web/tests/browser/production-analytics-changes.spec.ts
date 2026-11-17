/**
 * A change of account is said where its day is read — the day's hint, its name and its row of
 * the table — and marked by a line up the plot in its column: no footnote under the chart and no
 * line of words over it, so two changes, or twelve, leave the plot the height it has with none.
 * Each day's hint says it whole in either language at 1440 and 1920 pixels, and nothing moves as
 * the pointer walks the days. «Today», read by its hours at 15:30, says the running hour as under
 * way and stops Tab on it rather than on 23:00, and its hours' names never touch: the axis
 * stepping back from 23:00 by three names 14:00, which used to run into the running 15:00.
 */
import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import { openReport, pageAt, record, serve } from './analyticsPage.ts'
import { NONE, SWITCHING, TWO } from './served/analyticsChanges.ts'
import { test } from './test.ts'

/** Opens the overview at a window size and waits for its chart of days to stand. */
async function openOverview(page: Page, width: number, height: number, address = pageAt()) {
  await page.setViewportSize({ width, height })
  await page.goto(address)
  const chart = page.locator('.analytics-panel .overview-chart')
  await expect(chart.locator('.period-slot').first()).toBeVisible()
  await expect(page.locator('.overview-top .ranked-row').first()).toBeVisible()
  return chart
}

/** The overview chart's plot field and frame, any line over it, and whatever stands under it. */
const plotParts = (page: Page) =>
  page.evaluate(() => {
    const chart = document.querySelector('.overview-chart')
    const box = (selector: string) => {
      const found = chart?.querySelector(selector)?.getBoundingClientRect()
      return found && { top: found.top, height: found.height, width: found.width }
    }
    return {
      field: box('.period-field'),
      readouts: chart?.querySelectorAll('.period-readout').length ?? -1,
      frame: box('.period-frame'),
      notes: chart?.querySelectorAll('.period-notes, .period-markers').length ?? -1,
      marks: chart?.querySelectorAll('.period-mark').length ?? -1,
    }
  })

/**
 * Points at a day over its stack, where no segment of it stands, and waits for its hint, once the
 * hint of a day pointed at before is gone.
 */
async function pointAt(page: Page, column: Locator) {
  const hint = page.getByRole('tooltip')
  await page.mouse.move(0, 0)
  await expect(hint).toBeHidden()
  await column.hover({ position: { x: 2, y: 2 } })
  await expect(hint).toBeVisible()
  return hint
}

test('two account changes leave the overview plot as tall as none at 1440×900, said in the hint', async ({
  page,
}, info) => {
  await serve(page, NONE)
  await openOverview(page, 1440, 900)
  const none = await plotParts(page)

  await serve(page, TWO)
  const chart = await openOverview(page, 1440, 900)
  const two = await plotParts(page)
  await record(info, 'changes-plot', { none, two })

  expect(none.marks).toBe(0)
  expect(two.marks).toBe(2)
  expect(two.notes).toBe(0)
  expect(two.field?.height).toBe(none.field?.height)
  expect(two.frame?.height).toBe(none.frame?.height)
  expect(two.readouts).toBe(0)

  // Each day says its own change in its hint, Wednesday and Tuesday.
  const columns = chart.locator('.period-column')
  await expect(await pointAt(page, columns.last())).toContainText(
    'Account change: f0f0f0f0, 2a2a2a2a → 2a2a2a2a',
  )
  await expect(await pointAt(page, columns.nth(1))).toContainText(
    'Account change: f0f0f0f0 → f0f0f0f0, 2a2a2a2a',
  )
  await expect(chart.locator('.period-slot').nth(1).locator('.period-mark')).toHaveCount(1)

  // The table keeps saying each change in its day's row.
  await chart.getByRole('radio', { name: 'Table' }).click()
  await expect(chart.locator('tbody tr').nth(1)).toContainText(
    'Account change: f0f0f0f0 → f0f0f0f0, 2a2a2a2a',
  )
})

test('twelve account changes are twelve lines up the plot and no line under it', async ({
  page,
}) => {
  await serve(page, SWITCHING)
  const analytics = await openReport(page, 1440, pageAt({ by: 'work_item', period: 'weeks4' }))
  const days = analytics.locator('.spending-days')
  await days.getByRole('radio', { name: 'Chart' }).click()
  await expect(days.locator('.period-mark')).toHaveCount(12)
  await expect(days.locator('.period-notes, .period-markers')).toHaveCount(0)
  // Each day here is a full stack, so a day is read by the keyboard: the one before the latest,
  // stood on with an arrow, says its change in its hint.
  await days.locator('.period-column[tabindex="0"]').focus()
  await page.keyboard.press('ArrowLeft')
  await expect(page.getByRole('tooltip')).toContainText('Account change:')
})

for (const lang of ['en', 'ru'] as const)
  test.describe(`the hint of a day in ${lang === 'ru' ? 'Russian' : 'English'}`, () => {
    test.use({ locale: lang === 'ru' ? 'ru-RU' : 'en-US' })
    for (const width of [1440, 1920])
      test(`says each day whole at ${width}px and moves nothing`, async ({ page }, info) => {
        await serve(page, TWO)
        const chart = await openOverview(page, width, 900)
        const columns = chart.locator('.period-column')
        await page.mouse.move(0, 0)
        const still = await plotParts(page)
        const seen: { cut: boolean; lines: number; text: string }[] = []
        for (let index = 0; index < (await columns.count()); index += 1) {
          const hint = await pointAt(page, columns.nth(index))
          const parts = await plotParts(page)
          expect(parts.field, `day ${index + 1}`).toEqual(still.field)
          expect(parts.frame, `day ${index + 1}`).toEqual(still.frame)
          const text = (await hint.textContent()) ?? ''
          const cut = await page
            .locator('.tooltip-hint')
            .evaluate(
              (element) =>
                element.scrollWidth > element.clientWidth ||
                element.scrollHeight > element.clientHeight,
            )
          seen.push({ text, lines: text.split('\n').length, cut })
        }
        await record(info, `hint-${lang}-${width}`, seen)
        for (const one of seen) expect(one.cut, one.text).toBe(false)
        // Tuesday, five tasks and a change, says each on a line of its own.
        expect(seen[1]?.lines).toBeGreaterThan(5)
      })
  })

/** The names of the hours of the day chart under `chart`, left to right, with their edges. */
const hourNames = (page: Page, chart: string) =>
  page.evaluate(
    (selector) =>
      [...document.querySelectorAll(`${selector} .period-axis .chart-tick`)].map((tick) => {
        const { left, right } = tick.getBoundingClientRect()
        return { text: tick.textContent?.trim() ?? '', left, right }
      }),
    chart,
  )

/** How far apart each name of the hours stands from the one before it, at each window width. */
async function hourGaps(page: Page, chart: string, from: number) {
  const measured: Record<number, { gap: number; text: string }[]> = {}
  for (let width = from; width <= 1920; width += 32) {
    await page.setViewportSize({ width, height: 900 })
    // The running hour is always named; its name stands once the axis is measured again.
    await expect
      .poll(async () => {
        const names = await hourNames(page, chart)
        return names.some((name) => name.text === '15:00')
      })
      .toBe(true)
    const names = await hourNames(page, chart)
    measured[width] = names.slice(1).map((name, at) => ({
      text: name.text,
      gap: Math.round(name.left - (names[at]?.right ?? 0)),
    }))
  }
  return measured
}

/** Every gap of every width: more than a space, 4px in the axis's 12px type. */
function expectApart(measured: Record<number, { gap: number; text: string }[]>) {
  for (const [width, gaps] of Object.entries(measured))
    for (const { text, gap } of gaps) expect(gap, `${text} at ${width}px`).toBeGreaterThanOrEqual(4)
}

/** A Wednesday afternoon an hour after the double's own, when the axis names the hour before. */
const HALF_PAST_THREE = new Date(2026, 10, 11, 15, 30)

test('«Today» says the running hour, and its hours’ names keep apart at every width', async ({
  page,
}, info) => {
  await serve(page, TWO)
  await page.clock.setSystemTime(HALF_PAST_THREE)
  const chart = await openOverview(page, 1440, 900, pageAt({ period: 'today' }))
  await expect(chart.locator('.period-slot')).toHaveCount(24)
  // 15:30 on Wednesday: 15:00 is under way and 16:00 to 23:00 are still to come. Its hint says
  // so, and Tab stops on it rather than on 23:00.
  const running = chart.locator('.period-slot[data-key*="T15:00"] .period-column')
  await expect(await pointAt(page, running)).toHaveText(
    /^Wednesday, November 11 at 15:00: total 0\smin running/u,
  )
  await expect(running).toHaveAttribute('tabindex', '0')
  // The axis steps back from 23:00 by three and so names 14:00, beside the running 15:00: the
  // neighbour gives way rather than touch it.
  const placed = await hourNames(page, '.overview-chart')
  const names = placed.map((name) => name.text)
  // Named as any hour: its hatching and its hint say it is under way.
  expect(names).toContain('15:00')
  expect(names).toContain('17:00')
  expect(names).not.toContain('14:00')

  const overview = await hourGaps(page, '.overview-chart', 1200)

  // The task section's day chart, narrower beside its breakdown, steps its names further apart.
  await openReport(page, 1440, pageAt({ by: 'work_item', period: 'today' }))
  const days = page.locator('.analytics-panel .spending-days')
  await days.getByRole('radio', { name: 'Chart' }).click()
  const hour = days.locator('.period-slot[data-key*="T15:00"] .period-column')
  await expect(await pointAt(page, hour)).toHaveText(/^Wednesday, November 11 at 15:00/u)
  // From 1200 up: under it the page takes turns between its list of sections and one section.
  const section = await hourGaps(page, '.analytics-panel .spending-days', 1200)

  await record(info, 'today-hour-gaps', { overview, section })
  expectApart(overview)
  expectApart(section)
})
