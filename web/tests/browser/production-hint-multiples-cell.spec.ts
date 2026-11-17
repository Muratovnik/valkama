/**
 * A small chart's period hint stands at its own column, in the built app. Placed as a detail,
 * below its period and 20rem wide, it stood over the charts of the next row; kept inside its own
 * chart from the chart's top, it stood at the chart's top left corner, over the column pointed at
 * and far from the second column the pointer was on. A period's hint is a chart mark's now
 * (`data-hint-mark`, `hintPlacement.ts`): beside its column, level with its top, or at its floor
 * where it has none. It may stand over a neighbouring chart, since it lets the pointer through to
 * whatever it covers, but it stays inside the window and never covers its own column, at 1440
 * and 1024px. How near it stands is measured with every other mark in
 * `production-analytics-hint-at-mark.spec.ts`.
 */
import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import { value } from '../fixtures/analytics.ts'
import type { TimedStretch } from '../fixtures/analytics.ts'
import { openReport, pageAt, serve } from './analyticsPage.ts'
import { test } from './test.ts'

/** Longer than the rest a hint waits for, and the grace it stays after the pointer leaves. */
const PAST_REST = 1000
/** The room a hint keeps from the window's edge (`EDGE` in `hintPlacement.ts`). */
const EDGE = 8

/** Rests the pointer on the middle of `what`, from a place with no hint, past the rest. */
async function restOn(page: Page, what: Locator) {
  await page.mouse.move(2, 2)
  await page.clock.runFor(PAST_REST)
  const box = await what.boundingBox()
  expect(box, 'the period, drawn').not.toBeNull()
  await page.mouse.move(
    (box?.x ?? 0) + (box?.width ?? 0) / 2,
    (box?.y ?? 0) + (box?.height ?? 0) / 2,
  )
  await page.clock.runFor(PAST_REST)
}

/**
 * Where the shown hint stands against the period `period` of the chart `index`: over its own
 * column, out of the window, or as it should.
 */
const standing = (page: Page, index: number, period: number) =>
  page.evaluate(
    ([own, at, edge]) => {
      const hint = document.querySelector('.tooltip-hint')?.getBoundingClientRect()
      if (!hint) return 'no hint'
      const cell = document.querySelectorAll('.spending-multiples .multiple')[own]
      const drawn = cell
        ?.querySelectorAll('.multiple-period')
        [at]?.querySelector('.multiple-column')
      const column = drawn?.getBoundingClientRect()
      const covers =
        column !== undefined &&
        Math.min(hint.right, column.right) - Math.max(hint.left, column.left) > 1 &&
        Math.min(hint.bottom, column.bottom) - Math.max(hint.top, column.top) > 1
      const width = document.documentElement.clientWidth
      const out = hint.left < edge - 1 || hint.right > width - edge + 1
      if (covers) return 'over its own column'
      return out ? 'out of the window' : 'at its column'
    },
    [index, period, EDGE] as const,
  )

/**
 * Six projects over the three days of the week so far: small charts enough for two rows. The
 * projects are named by identifiers, so their section draws small charts, which the tasks' does
 * not.
 */
const PROJECTS: TimedStretch[] = Array.from({ length: 12 }, (_, index) => ({
  at: new Date(2026, 10, 9 + (index % 3), 10),
  group: {
    project: value(`project-${String(index % 6)}`),
    account: value('5b0c7e21-4a3f-4d8e-9c16-2f7a8b9d0e1f'),
  },
  spend: { seconds: (13 - index) * 3600, tokens: 1000, cost: 1 },
}))

/** Analytics' small multiples drawn as charts, at this window. */
async function openMultiples(page: Page, width: number) {
  await page.addInitScript(() => localStorage.setItem('valkama-locale', 'en'))
  // The hint's delay runs on this clock, so each rest is read after it.
  await page.clock.install()
  await serve(page, PROJECTS)
  await openReport(page, width, pageAt({ by: 'project' }))
  const multiples = page.locator('.spending-multiples')
  await multiples.scrollIntoViewIfNeeded()
  if ((await multiples.getAttribute('data-shown')) !== 'chart')
    await multiples.getByRole('radio', { name: 'Chart', exact: true }).click()
  const cells = multiples.locator('.multiple')
  await expect(cells.first().locator('.multiple-period').first()).toBeVisible()
  return cells
}

for (const width of [1440, 1024]) {
  test(`at ${width}px no period's hint of a small chart covers its column or leaves the window`, async ({
    page,
  }) => {
    const cells = await openMultiples(page, width)
    const count = await cells.count()
    // Charts enough for a row's first, middle and last, and a row after it.
    expect(count).toBeGreaterThanOrEqual(4)
    const stood: { at: string; where: string }[] = []
    for (let index = 0; index < count; index += 1) {
      const cell = cells.nth(index)
      await cell.evaluate((element) => element.scrollIntoView({ block: 'center' }))
      const periods = cell.locator('.multiple-period')
      for (let period = 0, many = await periods.count(); period < many; period += 1) {
        await restOn(page, periods.nth(period))
        stood.push({
          at: `chart ${index}, period ${period}`,
          where: await standing(page, index, period),
        })
      }
    }
    expect(stood.filter(({ where }) => where !== 'at its column')).toEqual([])
  })
}

test('the pointer reaches the next period under a small chart’s hint, which follows it', async ({
  page,
}) => {
  const cells = await openMultiples(page, 1440)
  const cell = cells.first()
  await cell.evaluate((element) => element.scrollIntoView({ block: 'center' }))
  const periods = cell.locator('.multiple-period')
  const hint = page.locator('.tooltip-hint')
  await restOn(page, periods.first())
  const first = await hint.textContent()
  // Along the plot to the next period, under the hint standing beside the first column.
  const next = await periods.nth(1).boundingBox()
  await page.mouse.move(
    (next?.x ?? 0) + (next?.width ?? 0) / 2,
    (next?.y ?? 0) + (next?.height ?? 0) / 2,
    {
      steps: 4,
    },
  )
  await page.clock.runFor(200)
  await expect(hint).toBeVisible()
  await expect(hint).not.toHaveText(first ?? '')
  expect(await standing(page, 0, 1)).toBe('at its column')
})
