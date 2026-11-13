/**
 * A task pressed on the Analytics page opens its card over the page, in the real app. The oracle
 * is the requirement: the module stays Analytics, its address keeps the view and names the card
 * as the board's address does, so Back closes it; the card is the board's card, whose field edit
 * reaches the store; closing it gives the page back as it was left — its section, its period and
 * where its panel was scrolled to. A modified press is still a link's. Each run prints what it
 * measured.
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { planningWorkItemRef } from '@/shared/api/platformPlanningRefs.ts'
import { parsePlatformRoute } from '@/shared/api/platformRoute.ts'

import { task } from '../fixtures/analytics.ts'
import type { TimedStretch } from '../fixtures/analytics.ts'
import { pageAt, record, serve, serveTask } from './analyticsPage.ts'
import { worked } from './overviewPage.ts'
import { workItem, workItemRef } from './planningFixtures.ts'
import { test } from './test.ts'

/** The task the store holds, worked on this week and the week before, beside another one. */
const HELD = task(264, workItem.title)
const WORLD: TimedStretch[] = [
  worked(9, HELD, ['model-a', 'main', 'alpha'], 5),
  worked(10, task(2, 'Write the release notes'), ['model-b', 'subagent', 'beta'], 3),
  worked(11, HELD, ['model-a', 'main', 'alpha'], 1),
  worked(2, HELD, ['model-a', 'main', 'alpha'], 2),
]

/** A period other than the page's own default, so that keeping it says something. */
const VIEW = { period: 'weeks4' }
const PAGE = pageAt(VIEW)

const path = (page: Page) => page.url().slice(new URL(page.url()).origin.length)

/**
 * The store fixture's record of the task, which the card reads and writes: a field written is
 * what the next read answers.
 */
async function serveStore(page: Page) {
  const held = { priority: workItem.priority as string, revision: 3 }
  const writes: Record<string, unknown>[] = []
  await serve(page, WORLD, false, { card: (read) => ({ ...read, ...held }) })
  await page.route('**/api/planning/work-item/update', async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>
    writes.push(body)
    if (typeof body.priority === 'string') held.priority = body.priority
    held.revision += 1
    await route.fulfill({ json: { ...workItem, ...held } })
  })
  return { held, writes }
}

/** Opens the overview at a height its panel scrolls in, and waits for the task's row. */
async function openOverview(page: Page) {
  await page.setViewportSize({ width: 1440, height: 640 })
  await page.goto(PAGE)
  const panel = page.locator('.analytics-panel')
  await expect(panel.locator('.overview-panel')).toBeVisible()
  const row = panel.locator('[data-card="work_item"] a.ranked-line[href="/open/MAIN-264"]')
  await expect(row).toBeVisible()
  return { panel, row }
}

/** What the page shows of its view: the section the rail marks, the period chosen, the scroll. */
async function viewShown(page: Page) {
  const section = page.locator('.analytics-rail [aria-current="page"] .analytics-rail-name')
  const period = page.getByRole('radiogroup', { name: 'Period' }).getByRole('radio', {
    checked: true,
  })
  return {
    section: await section.evaluate((node) => node.textContent?.trim()),
    period: await period.evaluate((node) => node.textContent?.trim()),
    scrollTop: await page.locator('.analytics-panel').evaluate((panel) => panel.scrollTop),
    overview: await page.locator('.analytics-panel .overview-panel').isVisible(),
  }
}

test('a task pressed on the overview opens its card over the page, which edits and closes back to the view', async ({
  page,
}, info) => {
  const store = await serveStore(page)
  const uses = await serveTask(page)
  const { row } = await openOverview(page)
  // The task's row stands low on the overview, so reaching it scrolls the panel.
  await row.scrollIntoViewIfNeeded()
  const before = await viewShown(page)
  expect(before.scrollTop).toBeGreaterThan(0)

  await row.click()
  const drawer = page.locator('.drawer')
  await expect(drawer).toContainText(workItem.title)
  await expect(drawer.locator('.card-priority')).toBeVisible()
  // The module is still Analytics: its path, its view in the address, and the card named there.
  expect(new URL(page.url()).pathname.startsWith('/modules/analytics/')).toBe(true)
  const opened = parsePlatformRoute(new URL(page.url()))
  expect(opened.module_id).toBe('analytics')
  expect(opened.state).toEqual(VIEW)
  expect(planningWorkItemRef(opened.entity)).toEqual(workItemRef)
  // The page stands under the card as it was left.
  await expect(page.locator('.analytics-panel .overview-panel')).toBeVisible()
  expect(await page.locator('.analytics-panel').evaluate((panel) => panel.scrollTop)).toBe(
    before.scrollTop,
  )
  await expect.poll(() => uses.filter((kind) => kind === 'task_open')).toHaveLength(1)

  // One field edit: the priority, which the store fixture takes and the card reads back.
  await drawer.locator('.card-priority .choice-trigger').click()
  await page.getByRole('option', { name: /^Urgent/u }).click()
  await expect.poll(() => store.writes.length).toBe(1)
  expect(store.writes[0]).toMatchObject({ id: workItemRef.reference, priority: 'urgent' })
  expect(store.held.priority).toBe('urgent')
  await expect(drawer.locator('.card-priority')).toContainText('Urgent')

  await drawer.locator('.drawer-frame-close').click()
  await expect(drawer).toBeHidden()
  await expect.poll(() => path(page)).toBe(PAGE)
  const after = await viewShown(page)
  await record(info, 'analytics card overlay', { before, after, writes: store.writes })
  expect(after).toEqual(before)
  expect(after.section).toBe('Overview')
  expect(after.period).toBe('Past 4 weeks')
})

test('Back closes the card over the page, and a modified press stays a link', async ({ page }) => {
  await serveStore(page)
  await serveTask(page)
  const { row } = await openOverview(page)
  await row.scrollIntoViewIfNeeded()
  const before = await viewShown(page)

  // A press with Ctrl is the browser's to take elsewhere: the page leaves it be and opens nothing.
  // The press is stopped before the browser follows it, so no address is opened from here.
  await page.evaluate(() => {
    window.addEventListener('click', (event) => {
      if (!event.ctrlKey) return
      document.body.dataset.leftToBrowser = String(!event.defaultPrevented)
      event.preventDefault()
    })
  })
  await row.click({ modifiers: ['Control'] })
  await expect(page.locator('body')).toHaveAttribute('data-left-to-browser', 'true')
  expect(path(page)).toBe(PAGE)
  await expect(page.locator('.drawer')).toBeHidden()

  await row.click()
  await expect(page.locator('.drawer')).toContainText(workItem.title)
  await page.goBack()
  await expect(page.locator('.drawer')).toBeHidden()
  await expect.poll(() => path(page)).toBe(PAGE)
  expect(await viewShown(page)).toEqual(before)
})
