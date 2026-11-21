/**
 * A value's side panel whose period before cannot be read, in the real app over the browser double.
 * The oracle is the requirement (`DESIGN.md`, Analytics: nothing moves when a failure is said or
 * when the next answer replaces it): the steps of the period before are read after the panel's days
 * are drawn, and when that read fails the note under the days says so in room the days keep for it,
 * so none of the panel's parts moves when it is said or when a later answer takes it away. Today
 * is read again every 30 s while it is on show, and the panel with it.
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

/** The task the backend holds, worked yesterday and today under two models and two accounts. */
const IMPORT = task(264, workItem.title)
const IMPORT_NAME = `MAIN-264 ${workItem.title}`
const WORKED: TimedStretch[] = [
  {
    at: new Date(2026, 10, 10, 10),
    group: { work_item: IMPORT, model: value('model-a'), ...WORK },
    spend: { seconds: 1800, tokens: 100_000, cost: 3 },
  },
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
const PARTS = ['actions', 'figures', 'days', 'model', 'seat'] as const

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
  test(`at ${width}px a task's panel whose period before cannot be read says so under its days, and nothing in it moves then or when a later answer reads it`, async ({
    page,
  }, info) => {
    const said = messages.en.analytics
    await page.clock.install({ time: NOW })
    await serve(page, WORKED)
    await serveTask(page)
    // Registered last, so it is asked first: the panel's read of the period before, the value's
    // steps with no breakdown, is refused while `failing` holds; every other read is answered.
    let failing = false
    let refused = 0
    await page.route('**/api/analytics/usage?*', async (route) => {
      const query = new URL(route.request().url()).searchParams
      const before = query.has('work_item') && !query.has('group_by')
      if (!failing || !before) return route.fallback()
      refused += 1
      return route.fulfill({ status: 500, contentType: 'application/json', body: '{}' })
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
    const note = panel
      .locator('[data-part="days"]')
      .getByText(said.overview.before.failed)
      .filter({ visible: true })
    await expect(note).toHaveCount(0)
    const before = await placed(panel)

    failing = true
    await page.clock.runFor(30_000)
    await expect(note).toHaveCount(1)
    expect(refused, 'the period before was asked again and refused').toBeGreaterThan(0)
    const during = await placed(panel)
    expect(during, 'the note said under the days').toEqual(before)

    failing = false
    await page.clock.runFor(30_000)
    await expect(note).toHaveCount(0)
    const after = await placed(panel)
    expect(after, 'a later answer read the period before').toEqual(before)
    await record(info, `value-before-failed-${width}`, { before, during, after })
  })
