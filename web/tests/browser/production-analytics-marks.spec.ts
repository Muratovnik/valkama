/**
 * Every mark of the Analytics charts says itself in a hint over the page and acts as its row of
 * the table does, in the real app. The oracle is the requirement: a segment of a day, a ranked
 * row and a day the keyboard stands on each show a hint, and none of them moves the plot, the
 * panel's first block or the table by a pixel; so does a ranked row the panel has to scroll to,
 * pointed at or brought under a resting pointer by the wheel. A ranked row prints its figure and
 * its share, so its hint is what it does not print: here, a task's name too long for its two lines,
 * said whole. No line of words stands over a plot, so the drawing field keeps that room; a task's
 * segment opens the task's side panel, whose «Open the card» opens the card over the page, the
 * module still Analytics, and closing them gives back the section, the period and the scroll.
 * Each run prints what it measured.
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { planningWorkItemRef } from '@/shared/api/platformPlanningRefs.ts'
import { parsePlatformRoute } from '@/shared/api/platformRoute.ts'

import { task } from '../fixtures/analytics.ts'
import type { TimedStretch } from '../fixtures/analytics.ts'
import { openReport, pageAt, record, serve, serveTask } from './analyticsPage.ts'
import { openOverview, TASKS, worked, WORLD } from './overviewPage.ts'
import { workItem, workItemRef } from './planningFixtures.ts'
import { expectNoLineOverPlot } from './plotWords.ts'
import { test } from './test.ts'

const path = (page: Page) => page.url().slice(new URL(page.url()).origin.length)

/** A title past what a list's two lines hold at any width here; the words are made up. */
const longTitle = (part: number) =>
  `${'Rework the import of planning documents into the board and check each step, '.repeat(7)}part ${String(part)}`

/**
 * `WORLD` with every task named past two lines, so each task's row is cut and its hint says the
 * name whole: the one thing such a row does not print.
 */
const CUT_NAMES: TimedStretch[] = WORLD.map((stretch) => {
  const at = TASKS.indexOf(stretch.group.work_item as (typeof TASKS)[number])
  return at < 0
    ? stretch
    : { ...stretch, group: { ...stretch.group, work_item: task(at + 1, longTitle(at + 1)) } }
})

/** What a task's row says in its hint: its name whole, to the end its row cuts. */
const WHOLE_NAME = / part \d$/u

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
  await serve(page, CUT_NAMES)
  const analytics = await openReport(page, 1440, pageAt({ by: 'work_item' }))
  await page.setViewportSize({ width: 1440, height: 900 })
  const days = analytics.locator('.spending-days')
  await expect(days).toHaveAttribute('data-shown', 'chart')
  // No line of words stands over the plot: each mark says itself in its hint.
  await expectNoLineOverPlot(page, '.spending-days [data-chart="periods"]')

  // A segment: its series, its value and its share of the day.
  const segment = days.locator('.period-segment').first()
  const onSegment = await hintOf(
    page,
    () => segment.scrollIntoViewIfNeeded(),
    () => segment.hover(),
  )
  expect(onSegment.says).toMatch(/ of the total\n/u)

  // A ranked row: what its printed name and figure leave out, its name cut on its second line.
  const row = analytics.locator('.spending-bars .ranked-line').first()
  const onRow = await hintOf(
    page,
    () => row.scrollIntoViewIfNeeded(),
    () => row.hover(),
  )
  expect(onRow.says).toMatch(WHOLE_NAME)

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

/** What the hint says and where the parts stand while it shows, and once the pointer has left. */
async function shownAndGone(page: Page) {
  const hint = page.getByRole('tooltip')
  await expect(hint).toBeVisible()
  const says = (await hint.textContent()) ?? ''
  const now = await standing(page)
  await page.mouse.move(0, 0)
  await expect(hint).toBeHidden()
  return { says, now, gone: await standing(page) }
}

/** The panel's scroll, and how far its first ranked row stands below what the panel shows. */
const reach = (page: Page) =>
  page.locator('.analytics-panel').evaluate((panel) => {
    const row = panel.querySelector('.spending-bars .ranked-line')?.getBoundingClientRect()
    return {
      scrolled: panel.scrollTop,
      below: (row?.bottom ?? 0) - panel.getBoundingClientRect().bottom,
    }
  })

test('a ranked row the panel scrolls to reach says its name whole, and nothing moves', async ({
  page,
}, info) => {
  await serve(page, CUT_NAMES)
  const analytics = await openReport(page, 1440, pageAt({ by: 'work_item' }))
  await page.setViewportSize({ width: 1440, height: 400 })
  const days = analytics.locator('.spending-days')
  await expect(days).toHaveAttribute('data-shown', 'chart')
  const before = await reach(page)
  expect(before.scrolled).toBe(0)
  expect(before.below, 'the row stands below what the panel shows').toBeGreaterThan(0)

  // A hint was up a moment ago, so the next one comes at once, before the scroll's event.
  await days.locator('.period-segment').first().hover()
  await expect(page.getByRole('tooltip')).toBeVisible()
  await page.mouse.move(0, 0)
  await expect(page.getByRole('tooltip')).toBeHidden()
  const row = analytics.locator('.spending-bars .ranked-line').first()
  await row.hover()
  const after = await reach(page)
  expect(after.scrolled, 'pointing at the row scrolled the panel').toBeGreaterThan(0)
  const seen = await shownAndGone(page)
  await record(info, 'a ranked row reached by the scroll', { before, after, ...seen })
  expect(seen.says).toMatch(WHOLE_NAME)
  expect(seen.now, 'the hint moved nothing').toEqual(seen.gone)
})

test('a ranked row a wheel brings under a resting pointer says itself, and nothing moves', async ({
  page,
}, info) => {
  await serve(page, CUT_NAMES)
  const analytics = await openReport(page, 1440, pageAt({ by: 'work_item' }))
  await page.setViewportSize({ width: 1440, height: 400 })
  await expect(analytics.locator('.spending-days')).toHaveAttribute('data-shown', 'chart')
  const start = await reach(page)
  expect(start.below, 'the row stands below what the panel shows').toBeGreaterThan(0)

  // The pointer rests near the panel's foot, over no mark, where the rows will pass.
  const at = await page.locator('.analytics-panel').evaluate((panel) => {
    const row = panel.querySelector('.spending-bars .ranked-line')?.getBoundingClientRect()
    const foot = panel.getBoundingClientRect().bottom
    return { x: (row?.x ?? 0) + (row?.width ?? 0) / 2, y: foot - 40 }
  })
  await page.mouse.move(at.x, at.y)
  const hint = page.getByRole('tooltip')
  await expect(hint).toBeHidden()
  // The wheel moves the panel under the pointer, which itself never moves.
  for (let step = 0; step < 4; step++) await page.mouse.wheel(0, 60)
  const under = () =>
    page.evaluate(
      ({ x, y }) => document.elementFromPoint(x, y)?.closest('.ranked-line')?.textContent ?? null,
      at,
    )
  await expect.poll(under, { message: 'a ranked row came under the pointer' }).not.toBeNull()
  const seen = await shownAndGone(page)
  await record(info, 'a ranked row under a resting pointer', { under: await under(), ...seen })
  expect(seen.says).toMatch(WHOLE_NAME)
  expect(seen.now, 'the hint moved nothing').toEqual(seen.gone)
})

test('with no line over the plot, the drawing field at 1440×900 takes the room the panel leaves', async ({
  page,
}, info) => {
  await serve(page, WORLD)
  await openOverview(page, 1440, 900)
  const field = (selector: string) =>
    page.locator(selector).evaluate((element) => element.getBoundingClientRect().height)
  const overview = await field('.overview-chart .period-field')
  const overviewScroll = await page
    .locator('.analytics-panel')
    .evaluate((panel) => panel.scrollHeight - panel.clientHeight)
  await openReport(page, 1440, pageAt({ by: 'work_item' }))
  await page.setViewportSize({ width: 1440, height: 900 })
  const section = await field('.spending-days .period-field')
  await record(info, 'analytics field heights', { overview, overviewScroll, section })
  // The overview's field fills what the panel leaves under the cards, so the room a line over
  // the plot took goes to the field; it never drops under its 200 px floor, and the panel scrolls
  // only with the field at that floor (the rule `production-analytics-overview-fit` holds).
  expect(overview).toBeGreaterThanOrEqual(200)
  expect(
    overviewScroll <= 1 || Math.round(overview) === 200,
    'a panel that scrolls keeps the field at its floor',
  ).toBe(true)
  // The section's field: the height it had while a line of words stood over the plot.
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

/** What the page shows of its view: the section the rail marks, the period chosen, the scroll. */
async function viewShown(page: Page) {
  const section = page.locator('.analytics-rail [aria-current="page"] .analytics-rail-name')
  const period = page.getByRole('radiogroup', { name: 'Period' }).getByRole('radio', {
    checked: true,
  })
  return {
    section: await section.evaluate((node) => node.textContent?.trim()),
    period: await period.evaluate((node) => node.textContent?.trim()),
    panel: await page.locator('.analytics-panel').evaluate((panel) => panel.scrollTop),
  }
}

test('a task’s segment opens its panel and from it its card over the page, which close back to the section, period and scroll', async ({
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
  // The panel is the page's one scroll, so reaching the day chart scrolls the panel.
  const before = await viewShown(page)
  expect(before.panel, 'the panel scrolled to the day chart').toBeGreaterThan(0)

  await segment.click()
  const details = page.getByRole('dialog', { name: `Details: MAIN-264 ${workItem.title}` })
  await expect(details).toBeVisible()
  const detail = JSON.stringify({ by: 'work_item', value: HELD.id })
  await expect.poll(() => path(page)).toBe(pageAt({ ...VIEW, detail }))
  expect(uses.filter((kind) => kind === 'task_open')).toEqual([])
  await details.getByRole('link', { name: 'Open the card' }).click()
  const drawer = page.locator('.drawer')
  await expect(drawer).toContainText(workItem.title)
  // The module is still Analytics: its path, its view in the address, and the card named there.
  expect(new URL(page.url()).pathname.startsWith('/modules/analytics/')).toBe(true)
  const opened = parsePlatformRoute(new URL(page.url()))
  expect(opened.module_id).toBe('analytics')
  expect(opened.state).toEqual({ ...VIEW, detail })
  expect(planningWorkItemRef(opened.entity)).toEqual(workItemRef)
  await expect.poll(() => uses.filter((kind) => kind === 'task_open')).toHaveLength(1)

  await drawer.locator('.drawer-frame-close').click()
  await expect(drawer).toBeHidden()
  await expect(details).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(details).toBeHidden()
  await expect.poll(() => path(page)).toBe(address)
  const after = await viewShown(page)
  await record(info, 'analytics segment card', { before, after })
  expect(after).toEqual(before)
  expect(after.period).toBe('Past 4 weeks')
})
