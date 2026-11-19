/**
 * A task pressed on the Analytics page opens its side panel, and the panel's «Open the card» opens
 * the task's card over the page, in the real app. The oracle is the requirement: the module stays
 * Analytics, its address keeps the view with the panel and names the card as the board's address
 * does, so Back closes it; the card is the board's card, whose field edit reaches the store;
 * closing it gives back the panel, and closing that the page as it was left — its section, its
 * period and where its panel was scrolled to. A modified press is still a link's. Each run prints
 * what it measured.
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { planningWorkItemRef } from '@/shared/api/platformPlanningRefs.ts'
import { parsePlatformRoute } from '@/shared/api/platformRoute.ts'

import { pageAt, record, serve, serveTask } from './analyticsPage.ts'
import { workItem, workItemRef } from './planningFixtures.ts'
import { HELD, WORLD } from './served/analyticsCardOverlay.ts'
import { test } from './test.ts'
/** A period other than the page's own default, so that keeping it says something. */
const VIEW = { period: 'weeks4' }
const PAGE = pageAt(VIEW)
/** The task's side panel over the view, which the card is opened from. */
const DETAIL = JSON.stringify({ by: 'work_item', value: HELD.id })
const DETAILS = `Details: MAIN-264 ${workItem.title}`

/** Opens the task's card from its side panel, which a press on its row opened. */
async function openCard(page: Page) {
  const details = page.getByRole('dialog', { name: DETAILS })
  await details.getByRole('link', { name: 'Open the card' }).click()
  return details
}

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
  const details = await openCard(page)
  const drawer = page.locator('.drawer')
  await expect(drawer).toContainText(workItem.title)
  await expect(drawer.locator('.card-priority')).toBeVisible()
  // The module is still Analytics: its path, its view in the address, and the card named there.
  expect(new URL(page.url()).pathname.startsWith('/modules/analytics/')).toBe(true)
  const opened = parsePlatformRoute(new URL(page.url()))
  expect(opened.module_id).toBe('analytics')
  expect(opened.state).toEqual({ ...VIEW, detail: DETAIL })
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
  // The panel the card was opened from stands again, and closing it gives the page back.
  await expect(details).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(details).toBeHidden()
  await expect.poll(() => path(page)).toBe(PAGE)
  const after = await viewShown(page)
  await record(info, 'analytics card overlay', { before, after, writes: store.writes })
  expect(after).toEqual(before)
  expect(after.section).toBe('Overview')
  expect(after.period).toBe('Past 4 weeks')
})

for (const width of [1440, 390])
  test(`the card stands over the page at the window's right edge, above everything there, at ${width}px`, async ({
    page,
  }, info) => {
    await serveStore(page)
    await serveTask(page)
    await page.setViewportSize({ width, height: 800 })
    // A phone shows the section rather than the list of sections; the address says which.
    await page.goto(pageAt({ ...VIEW, open: 'section' }))
    const row = page.locator('[data-card="work_item"] a.ranked-line[href="/open/MAIN-264"]')
    await expect(row).toBeVisible()
    await row.click()
    await openCard(page)
    const drawer = page.locator('.drawer')
    await expect(drawer).toContainText(workItem.title)
    await expect(drawer.locator('.card-priority')).toBeVisible()
    // The card slides in from the right edge: it is measured where it comes to rest.
    await expect(drawer).toHaveCSS('transform', 'none')
    const placed = await drawer.evaluate((element) => {
      const box = element.getBoundingClientRect()
      const middle = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)
      return {
        left: Math.round(box.left),
        right: Math.round(box.right),
        top: Math.round(box.top),
        bottom: Math.round(box.bottom),
        window: { width: innerWidth, height: innerHeight },
        onTop: middle !== null && element.contains(middle),
      }
    })
    await record(info, `analytics card overlay placed ${width}`, placed)
    // At the window's right edge and inside it, and what is pressed in its middle is the card's.
    expect(Math.abs(placed.right - placed.window.width)).toBeLessThanOrEqual(1)
    expect(placed.left).toBeGreaterThanOrEqual(0)
    expect(placed.top).toBeGreaterThanOrEqual(0)
    expect(placed.bottom).toBeLessThanOrEqual(placed.window.height)
    expect(placed.onTop).toBe(true)
    // The page is still there under it.
    await expect(page.locator('.analytics-page')).toBeAttached()
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
  const details = await openCard(page)
  await expect(page.locator('.drawer')).toContainText(workItem.title)
  await page.goBack()
  await expect(page.locator('.drawer')).toBeHidden()
  await expect(details).toBeVisible()
  await expect.poll(() => path(page)).toBe(pageAt({ ...VIEW, detail: DETAIL }))
  await page.goBack()
  await expect(details).toBeHidden()
  await expect.poll(() => path(page)).toBe(PAGE)
  expect(await viewShown(page)).toEqual(before)
})
