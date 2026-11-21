/**
 * A value's side panel whose read again fails, in the real app over the browser double. The
 * oracle is the requirement (`DESIGN.md`, Analytics: nothing moves when a failure is said or when
 * the next answer replaces it): a read again of the panel's value that fails keeps what the panel
 * showed and says so beside its actions, «Could not refresh · Retry», in room the actions' row
 * keeps for it, so none of the panel's parts moves when it is said or when the retry's answer
 * takes it away. Today is read again every 30 s while it is on show, and the panel with it.
 */
import { expect } from '@playwright/test'
import type { Locator } from '@playwright/test'

import { messages } from '@/shared/i18n/index.ts'

import { task, value } from '../fixtures/analytics.ts'
import type { TimedStretch } from '../fixtures/analytics.ts'
import { NIGHT_GROUP as NIGHT, WORK_GROUP as WORK } from '../fixtures/quotaSpent.ts'
import { NARROW_FRAME, pageAt, record, serve, serveTask } from './analyticsPage.ts'
import { drawLined } from './drawnViews.ts'
import { workItem } from './planningFixtures.ts'
import { test } from './test.ts'

/** The moment the page is read at, the double's own (`serve`). */
const NOW = new Date(2026, 10, 11, 14, 30)

/** The task the backend holds, worked today under two models and two accounts. */
const IMPORT = task(264, workItem.title)
const IMPORT_NAME = `MAIN-264 ${workItem.title}`
const TODAY: TimedStretch[] = [
  {
    at: new Date(2026, 10, 11, 9),
    group: { work_item: IMPORT, model: value('model-a'), ...WORK },
    spend: { seconds: 3600, tokens: 400_000, cost: 6 },
  },
  {
    at: new Date(2026, 10, 11, 11),
    group: { work_item: IMPORT, model: value('model-b'), ...NIGHT },
    spend: { seconds: 1800, tokens: 200_000, cost: 2 },
  },
]

/** The panel's parts in the order they stand, by the hook each documents (`data-part`). */
const PARTS = ['actions', 'figures', 'model', 'seat'] as const

/** Where each part of the panel stands, to the hundredth of a pixel. */
async function placed(panel: Locator) {
  const boxes: Record<string, number[]> = {}
  for (const part of PARTS) {
    const box = await panel.locator(`[data-part="${part}"]`).boundingBox()
    if (!box) throw new Error(`the panel's ${part} is not laid out`)
    boxes[part] = [box.x, box.y, box.width, box.height].map(
      (number) => Math.round(number * 100) / 100,
    )
  }
  return boxes
}

for (const width of [1440, 390])
  test(`at ${width}px a task's panel whose read again fails says so beside its actions, and nothing in it moves then or when the retry answers`, async ({
    page,
  }, info) => {
    const said = messages.en.analytics
    const retry = messages.en.platform.actions.retry
    await page.clock.install({ time: NOW })
    await serve(page, TODAY)
    await serveTask(page)
    // Registered last, so it is asked first: the panel's own reads, the value by model and by
    // account, are refused while `failing` holds; the page's and the period before are answered.
    let failing = false
    await page.route('**/api/analytics/usage?*', async (route) => {
      const query = new URL(route.request().url()).searchParams
      const panels = query.has('work_item') && /model|seat/u.test(query.get('group_by') ?? '')
      return failing && panels
        ? route.fulfill({ status: 500, contentType: 'application/json', body: '{}' })
        : route.fallback()
    })
    await page.setViewportSize({ width, height: 900 })
    const view = { by: 'work_item', period: 'today' }
    await page.goto(pageAt(width < NARROW_FRAME ? { ...view, open: 'section' } : view))
    const bars = page.locator('.spending-bars')
    await drawLined(bars)
    const opens = said.detail.open.replace('{value}', IMPORT_NAME)
    await bars.getByRole('link', { name: opens }).click()
    const panel = page.getByRole('dialog', {
      name: said.detail.label.replace('{title}', IMPORT_NAME),
    })
    await expect(panel).toHaveCSS('transform', 'none')
    for (const part of PARTS) await expect(panel.locator(`[data-part="${part}"]`)).toBeVisible()
    await page.evaluate(() => document.fonts.ready)
    const failed = panel.getByRole('status').filter({ hasText: said.frame.refreshFailed })
    await expect(failed).toBeHidden()
    const before = await placed(panel)

    failing = true
    await page.clock.runFor(30_000)
    await expect(failed).toBeVisible()
    const during = await placed(panel)
    expect(during, 'the failure said beside the actions').toEqual(before)

    failing = false
    await failed.getByRole('button', { name: retry }).click()
    await expect(failed).toBeHidden()
    const after = await placed(panel)
    expect(after, 'the retry answered').toEqual(before)
    await record(info, `value-read-failed-${width}`, { before, during, after })
  })
