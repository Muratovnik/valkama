/**
 * A small chart's period hint stands inside its own chart, in the built app. Placed as a detail,
 * below its period and 20rem wide, it stood over the charts of the next row and the one beside
 * its own: every period of every chart of Analytics' small multiples covered another chart at
 * 1440 and 1024px. Each chart keeps its periods' hints inside it now (`data-hint-frame`): the
 * hint is drawn no wider than the chart and stands inside it from its top, over part of its own
 * plot, and lets the pointer through to the next period it covers.
 *
 * A hint taller than its chart cannot stand wholly inside it: a chart is 90px high, and at 1024px,
 * 171px wide, the hint of a task with a long name takes five lines, 104px. It then stands from the
 * chart's top down into the air under it, over no other chart, and says so.
 */
import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import { openReport, serve } from './analyticsPage.ts'
import { test } from './test.ts'

/** Longer than the rest a hint waits for, and the grace it stays after the pointer leaves. */
const PAST_REST = 1000

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
 * Where the shown hint stands against the chart `index` of the small multiples: what of it
 * stands outside that chart, past a pixel, and which other charts it overlaps.
 */
const standing = (page: Page, index: number) =>
  page.evaluate((own) => {
    const hint = document.querySelector('.tooltip-hint')?.getBoundingClientRect()
    if (!hint) return 'no hint'
    const cells = [...document.querySelectorAll('.spending-multiples .multiple')].map((cell) =>
      cell.getBoundingClientRect(),
    )
    const cell = cells[own]
    if (!cell) return 'no chart'
    const out = [
      cell.left - hint.left,
      hint.right - cell.right,
      cell.top - hint.top,
      hint.bottom - cell.bottom,
    ]
    const over = cells.flatMap((other, at) =>
      at !== own &&
      Math.min(hint.right, other.right) - Math.max(hint.left, other.left) > 1 &&
      Math.min(hint.bottom, other.bottom) - Math.max(hint.top, other.top) > 1
        ? [at]
        : [],
    )
    const [left, right, top, bottom] = out.map((past) => past > 1)
    if (over.length === 0 && !left && !right && !top)
      if (!bottom) return 'inside its chart'
      else if (hint.height > cell.height) return 'from its chart’s top, taller than it'
    return `past its chart by ${out.map((past) => past.toFixed(1)).join(', ')}, over charts ${over.join(', ')}`
  }, index)

/** Where a hint stands at each window: wholly inside its chart, or from its top where taller. */
const STANDS: Record<number, readonly string[]> = {
  1440: ['inside its chart'],
  1024: ['inside its chart', 'from its chart’s top, taller than it'],
}

/** Analytics' small multiples drawn as charts, at this window. */
async function openMultiples(page: Page, width: number) {
  await page.addInitScript(() => localStorage.setItem('valkama-locale', 'en'))
  // The hint's delay runs on this clock, so each rest is read after it.
  await page.clock.install()
  await serve(page)
  await openReport(page, width)
  const multiples = page.locator('.spending-multiples')
  await multiples.scrollIntoViewIfNeeded()
  if ((await multiples.getAttribute('data-shown')) !== 'chart')
    await multiples.getByRole('radio', { name: 'Chart', exact: true }).click()
  const cells = multiples.locator('.multiple')
  await expect(cells.first().locator('.multiple-period').first()).toBeVisible()
  return cells
}

for (const width of [1440, 1024]) {
  test(`at ${width}px every period's hint of a small chart stands inside its own chart`, async ({
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
        stood.push({ at: `chart ${index}, period ${period}`, where: await standing(page, index) })
      }
    }
    expect(stood.filter(({ where }) => !STANDS[width]?.includes(where))).toEqual([])
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
  // Along the plot to the next period, under the hint standing over the chart.
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
  expect(await standing(page, 0)).toBe('inside its chart')
})
