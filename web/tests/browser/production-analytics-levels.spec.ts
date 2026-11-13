/**
 * The Analytics panel lays out four levels, each with its own air and its own heading size: the
 * groups of a section 24px apart, the blocks of a group 16px, the lines of a block 8px, and a
 * heading of 16px over a section, 15px over a group and 14px over a block, so no heading is the
 * size of the level over it. The panel shows one section at a time, so no two sections stand
 * together to be measured.
 *
 * The quota is read with six accounts, as a workstation that holds six reads it: each account is
 * a group on a surface of its own, its windows side by side where the width allows. Six accounts
 * once ran together into one list 4279 pixels long, each 16px from the next under a heading as
 * large as its section's.
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { quotaOfSix } from '../fixtures/quota.ts'
import { NOW, openReport, pageAt, record, serve, serveQuota } from './analyticsPage.ts'
import { test } from './test.ts'

/** The air between each two parts of what `selector` holds that stand one under the other. */
const gaps = (page: Page, selector: string) =>
  page.evaluate((body) => {
    const parts = [...(document.querySelector(body)?.children ?? [])]
      .map((part) => part.getBoundingClientRect())
      .filter((box) => box.height > 0)
    return parts.slice(1).flatMap((box, index) => {
      const above = parts[index]
      return above && box.top >= above.bottom - 0.5 ? [Math.round(box.top - above.bottom)] : []
    })
  }, selector)

/** The computed size of the first heading `selector` finds, in pixels. */
const size = (page: Page, selector: string) =>
  page
    .locator(selector)
    .first()
    .evaluate((heading) => getComputedStyle(heading).fontSize)

/** Opens a section of the quota from the rail. */
async function openQuota(page: Page, width: number, height: number, section: string) {
  await serve(page)
  await serveQuota(page, quotaOfSix(NOW))
  await page.setViewportSize({ width, height })
  await page.goto(pageAt())
  await page.locator(`.analytics-rail-entry[data-section="${section}"]`).click()
  await expect(page.locator('.quota-account')).toHaveCount(6)
  await expect(page.locator('.window-spend[data-state="loading"]')).toHaveCount(0)
  await page.evaluate(() => document.fonts.ready)
}

test('at 1440×900 the task section keeps the air of its groups and blocks and their heading sizes', async ({
  page,
}, info) => {
  await serve(page)
  await openReport(page, 1440, pageAt({ by: 'work_item' }))
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.evaluate(() => document.fonts.ready)
  const seen = {
    // The figures, the charts and the table: the groups of the section.
    groups: await gaps(page, '.dimension-section > .level-body'),
    // The line to the table, the two charts side by side and the day chart: blocks of a group.
    blocks: await gaps(page, '.dimension-charts > .level-body'),
    block: await size(page, '.spending-bars .level-heading'),
    table: await size(page, '.spending-table-title .level-heading'),
  }
  await record(info, 'levels task 1440x900', seen)
  expect(seen.groups, 'the groups of the section').toEqual([24, 24])
  expect(seen.blocks, 'the blocks of the charts').toEqual([16, 16])
  expect(seen.block, 'a chart’s heading').toBe('14px')
  expect(seen.table, 'the table’s heading').toBe('14px')
})

test('at 1440×900 the overview keeps the air of its groups and its cards', async ({
  page,
}, info) => {
  await serve(page)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(pageAt())
  await expect(page.locator('.overview-panel .period-field')).toBeVisible()
  await page.evaluate(() => document.fonts.ready)
  const seen = {
    groups: await gaps(page, '.overview-panel > .panel-level > .level-body'),
    cards: await page.evaluate(() => {
      const [first, second] = [...document.querySelectorAll('.overview-cards > .level-body > *')]
      const one = first?.getBoundingClientRect()
      const two = second?.getBoundingClientRect()
      return one && two ? Math.round(two.left - one.right) : null
    }),
  }
  await record(info, 'levels overview 1440x900', seen)
  expect(seen.groups, 'the figures, the chart and the cards').toEqual([24, 24])
  expect(seen.cards, 'two cards side by side').toBe(16)
})

/** The widths the quota is measured at, and how tall its six accounts may stand at each. */
const QUOTA_SIZES = [
  { width: 1440, height: 900, tallest: Number.POSITIVE_INFINITY },
  // Six accounts stood 4279 pixels tall here when each was a block under its section's heading.
  { width: 1670, height: 985, tallest: 4279 },
]

/** How tall `selector` stands, in whole pixels. */
const heightOf = (page: Page, selector: string) =>
  page.locator(selector).evaluate((part) => Math.round(part.getBoundingClientRect().height))

for (const { width, height, tallest } of QUOTA_SIZES)
  test(`at ${width}×${height} the quota is a section of account groups on surfaces, windows side by side`, async ({
    page,
  }, info) => {
    await openQuota(page, width, height, 'quota_week')
    const seen = {
      height: await heightOf(page, '.quota-panel'),
      accounts: await gaps(page, '.quota-panel .chart-section > .level-body'),
      lines: await gaps(page, '.quota-window > .level-body'),
      section: await size(page, '.quota-panel .chart-section > .level-head > .level-heading'),
      group: await size(page, '.quota-account > .level-head > .level-heading'),
      block: await size(page, '.quota-window > .level-head > .level-heading'),
      surface: await page
        .locator('.quota-account')
        .first()
        .evaluate((account) => {
          const style = getComputedStyle(account)
          return { ground: style.backgroundColor, radius: style.borderRadius }
        }),
      // «Work» reads a week and a model's week.
      work: await page
        .locator('.quota-account[data-account="Work"] .quota-window')
        .evaluateAll((windows) =>
          windows.map((window) => {
            const { top, left, width: wide } = window.getBoundingClientRect()
            return { top: Math.round(top), left: Math.round(left), width: Math.round(wide) }
          }),
        ),
    }
    await record(info, `levels quota ${width}x${height}`, seen)
    expect(seen.accounts, 'the six accounts').toEqual([24, 24, 24, 24, 24])
    expect(new Set(seen.lines), 'the lines of a window').toEqual(new Set([8]))
    expect([seen.section, seen.group, seen.block]).toEqual(['16px', '15px', '14px'])
    expect(seen.surface.ground, 'an account on a surface').not.toBe('rgba(0, 0, 0, 0)')
    expect(seen.surface.radius).not.toBe('0px')
    const [week, model] = seen.work
    expect(model?.top, 'the two windows of «Work» on one row').toBe(week?.top)
    expect((model?.left ?? 0) - (week?.left ?? 0) - (week?.width ?? 0), 'apart as blocks').toBe(16)
    expect(seen.height, 'six accounts').toBeLessThan(tallest)
  })
