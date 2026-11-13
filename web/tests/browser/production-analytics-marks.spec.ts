/**
 * Every mark of the Analytics charts says itself in a hint over the page and acts as its row of
 * the table does, in the real app. The oracle is the requirement: a segment of a day, a ranked
 * row and a day the keyboard stands on each show a hint, and none of them moves the plot, the
 * panel's first block or the table by a pixel; no line of words stands over a plot, so the
 * drawing field keeps that room; a task's segment opens the task's card over the page, the
 * module still Analytics, and closing it gives back the section, the period and the scroll. Each
 * run prints what it measured.
 */
import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import { planningWorkItemRef } from '@/shared/api/platformPlanningRefs.ts'
import { parsePlatformRoute } from '@/shared/api/platformRoute.ts'

import { task } from '../fixtures/analytics.ts'
import type { TimedStretch } from '../fixtures/analytics.ts'
import { openReport, pageAt, record, serve, serveTask } from './analyticsPage.ts'
import { openOverview, worked, WORLD } from './overviewPage.ts'
import { workItem, workItemRef } from './planningFixtures.ts'
import { test } from './test.ts'

const path = (page: Page) => page.url().slice(new URL(page.url()).origin.length)

/** Where the parts a hint must not move stand: the plot, the panel's first block, the table. */
const standing = (page: Page) =>
  page.evaluate(() => {
    // This body runs in the page, so a helper at the module's own scope would not be there.
    // eslint-disable-next-line unicorn/consistent-function-scoping -- see above
    const box = (element: Element | null | undefined) => {
      const found = element?.getBoundingClientRect()
      return found ? [found.x, found.y, found.width, found.height] : null
    }
    return {
      plot: box(document.querySelector('.spending-days .period-plot')),
      first: box(document.querySelector('.analytics-panel')?.firstElementChild),
      table: box(document.querySelector('.spending-table')),
    }
  })

/**
 * The hint a mark shows, and where the parts stood just before and while it shows. The mark is
 * brought into view first, by `reach`, so the scroll that takes is not read as a move; the hint
 * of a mark pointed at before is gone first.
 */
async function hintOf(page: Page, reach: () => Promise<void>, show: () => Promise<void>) {
  const hint = page.getByRole('tooltip')
  await reach()
  await page.mouse.move(0, 0)
  await expect(hint).toBeHidden()
  const still = await standing(page)
  await show()
  await expect(hint).toBeVisible()
  return { says: (await hint.textContent()) ?? '', still, now: await standing(page) }
}

test('a segment, a ranked row and a day the keyboard stands on each say themselves in a hint, and nothing moves', async ({
  page,
}, info) => {
  await serve(page, WORLD)
  const analytics = await openReport(page, 1440, pageAt({ by: 'work_item' }))
  await page.setViewportSize({ width: 1440, height: 900 })
  const days = analytics.locator('.spending-days')
  await expect(days).toHaveAttribute('data-shown', 'chart')
  await expect(page.locator('.period-readout, .step-readout')).toHaveCount(0)

  // A segment: its series, its value and its share of the day.
  const segment = days.locator('.period-segment').first()
  const onSegment = await hintOf(
    page,
    () => segment.scrollIntoViewIfNeeded(),
    () => segment.hover(),
  )
  expect(onSegment.says).toMatch(/ of the total\n/u)

  // A ranked row: what its printed name and figure leave out, its share of the whole.
  const row = analytics.locator('.spending-bars .ranked-line').first()
  const onRow = await hintOf(
    page,
    () => row.scrollIntoViewIfNeeded(),
    () => row.hover(),
  )
  expect(onRow.says).toMatch(/ of the total/u)

  // A day the keyboard stands on: its sum, then its series, a line each.
  const stop = days.locator('.period-column[tabindex="0"]')
  const onDay = await hintOf(
    page,
    () => stop.focus(),
    () => page.keyboard.press('ArrowLeft'),
  )
  expect(onDay.says).toMatch(/^Tuesday, November 10: total /u)
  expect(onDay.says.split('\n').length).toBeGreaterThan(2)

  const seen = { onSegment, onRow, onDay }
  await record(info, 'analytics mark hints', seen)
  for (const [name, { still, now }] of Object.entries(seen))
    expect(now, `moved under ${name}`).toEqual(still)
})

test('with no line over the plot, the drawing field at 1440×900 is at least as tall as it was', async ({
  page,
}, info) => {
  await serve(page, WORLD)
  await openOverview(page, 1440, 900)
  const field = (selector: string) =>
    page.locator(selector).evaluate((element) => element.getBoundingClientRect().height)
  const overview = await field('.overview-chart .period-field')
  await openReport(page, 1440, pageAt({ by: 'work_item' }))
  await page.setViewportSize({ width: 1440, height: 900 })
  const section = await field('.spending-days .period-field')
  await record(info, 'analytics field heights', { overview, section })
  // The heights the field had while a line of words stood over the plot, with this same world.
  expect(overview).toBeGreaterThanOrEqual(225)
  expect(section).toBeGreaterThanOrEqual(160)
})

/** The task the store holds, worked on this week and the week before, beside another one. */
const HELD = task(264, workItem.title)
const HELD_WORLD: TimedStretch[] = [
  worked(9, HELD, ['model-a', 'main', 'alpha'], 5),
  worked(10, task(2, 'Write the release notes'), ['model-b', 'subagent', 'beta'], 3),
  worked(11, HELD, ['model-a', 'main', 'alpha'], 1),
  worked(2, HELD, ['model-a', 'main', 'alpha'], 2),
]

/** A period other than the page's own default, so that keeping it says something. */
const VIEW = { by: 'work_item', period: 'weeks4' }

/** What the page shows of its view: the section the rail marks, the period chosen, the scrolls. */
async function viewShown(page: Page, charts: Locator) {
  const section = page.locator('.analytics-rail [aria-current="page"] .analytics-rail-name')
  const period = page.getByRole('radiogroup', { name: 'Period' }).getByRole('radio', {
    checked: true,
  })
  return {
    section: await section.evaluate((node) => node.textContent?.trim()),
    period: await period.evaluate((node) => node.textContent?.trim()),
    panel: await page.locator('.analytics-panel').evaluate((panel) => panel.scrollTop),
    charts: await charts.evaluate((element) => element.scrollTop),
  }
}

test('a task’s segment opens its card over the page, which closes back to the section, period and scroll', async ({
  page,
}, info) => {
  await serve(page, HELD_WORLD)
  const uses = await serveTask(page)
  const address = pageAt(VIEW)
  const analytics = await openReport(page, 1440, address)
  await page.setViewportSize({ width: 1440, height: 640 })
  const days = analytics.locator('.spending-days')
  await expect(days).toHaveAttribute('data-shown', 'chart')
  const segment = days.locator('a.period-segment[href="/open/MAIN-264"]').last()
  await segment.scrollIntoViewIfNeeded()
  const charts = analytics.locator('.dimension-charts')
  const before = await viewShown(page, charts)
  expect(before.charts, 'the charts scrolled to the day chart').toBeGreaterThan(0)

  await segment.click()
  const drawer = page.locator('.drawer')
  await expect(drawer).toContainText(workItem.title)
  // The module is still Analytics: its path, its view in the address, and the card named there.
  expect(new URL(page.url()).pathname.startsWith('/modules/analytics/')).toBe(true)
  const opened = parsePlatformRoute(new URL(page.url()))
  expect(opened.module_id).toBe('analytics')
  expect(opened.state).toEqual(VIEW)
  expect(planningWorkItemRef(opened.entity)).toEqual(workItemRef)
  await expect.poll(() => uses.filter((kind) => kind === 'task_open')).toHaveLength(1)

  await drawer.locator('.drawer-frame-close').click()
  await expect(drawer).toBeHidden()
  await expect.poll(() => path(page)).toBe(address)
  const after = await viewShown(page, charts)
  await record(info, 'analytics segment card', { before, after })
  expect(after).toEqual(before)
  expect(after.period).toBe('Past 4 weeks')
})
