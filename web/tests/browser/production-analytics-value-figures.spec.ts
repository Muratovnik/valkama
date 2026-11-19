/**
 * What a task's side panel says its figures are of, in the real app over the browser double. The
 * oracle is the requirement (`DESIGN.md`, Analytics): the heading of the figures names the period
 * of the page as the page names a period, and another period chosen is named instead; the task's
 * cost of all time ends the figures, and it is the very figure the task's card says in its line,
 * since both are one read said one way.
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { task } from '../fixtures/analytics.ts'
import type { TimedStretch } from '../fixtures/analytics.ts'
import { WORK_GROUP as WORK } from '../fixtures/quotaSpent.ts'
import { richUsage, usageAnswer } from '../fixtures/usage.ts'
import { pageAt, record, serve, serveTask } from './analyticsPage.ts'
import { workItem } from './planningFixtures.ts'
import { test } from './test.ts'

/** The task the backend holds, whose card opens. */
const IMPORT = task(264, workItem.title)
const NAME = `MAIN-264 ${workItem.title}`

/** Two hours of it on Tuesday and one on Wednesday, beside another task on Monday. */
const WORLD: TimedStretch[] = [
  {
    at: new Date(2026, 10, 10, 10),
    group: { work_item: IMPORT, ...WORK },
    spend: { seconds: 7200, tokens: 2_000_000, cost: 20 },
  },
  {
    at: new Date(2026, 10, 11, 10),
    group: { work_item: IMPORT, ...WORK },
    spend: { seconds: 3600, tokens: 800_000, cost: 8 },
  },
  {
    at: new Date(2026, 10, 9, 10),
    group: { work_item: task(2, 'Write the release notes'), ...WORK },
    spend: { seconds: 1800, tokens: 100_000, cost: 1 },
  },
]

/** What the task's work came to over all its time, as the card's read answers it. */
const ALL_TIME = 1234.56

const detail = { by: 'work_item', detail: JSON.stringify({ by: 'work_item', value: IMPORT.id }) }

async function openPanel(page: Page, state: Record<string, string>) {
  await page.goto(pageAt(state))
  const panel = page.getByRole('dialog', { name: `Details: ${NAME}` })
  await expect(panel).toBeVisible()
  await expect(panel.locator('[data-part="figures"]')).toBeVisible()
  return panel
}

test('a task’s panel names the period of its figures and says the cost of all time its card says', async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await serve(page, WORLD)
  await serveTask(page)
  const asked: string[] = []
  await page.route('**/api/planning/work-item/usage?*', async (route) => {
    asked.push(new URL(route.request().url()).search)
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(usageAnswer(richUsage({ estimated_api_cost_usd: ALL_TIME }))),
    })
  })

  // The week, from Monday the 9th to Wednesday afternoon.
  const panel = await openPanel(page, detail)
  const heading = panel.locator('[data-part="figures"]').getByRole('heading')
  await expect(heading).toHaveText('Figures · Nov 9 – 11')
  const allTime = panel.locator('[data-figure="all-time"]')
  await expect(allTime.locator('dt')).toHaveText('All time')
  await expect(allTime.locator('dd')).toHaveText('≈\u{A0}$1,234.56')
  const said = await allTime.locator('dd').textContent()

  // The task's card says the same figure in its line.
  await panel.getByRole('link', { name: 'Open the card' }).click()
  const cost = page.locator('.drawer [data-fact="cost"]')
  await expect(cost).toHaveText(said ?? '')

  // The reader's own days, Tuesday and Wednesday: the panel names them instead.
  const own = await openPanel(page, {
    ...detail,
    period: 'custom',
    from: '2026-11-10',
    to: '2026-11-11',
  })
  await expect(own.locator('[data-part="figures"]').getByRole('heading')).toHaveText(
    'Figures · Nov 10 – 11',
  )
  // The panel asks as the card does: the item by its reference, its own work alone.
  expect(new Set(asked)).toEqual(new Set(['?id=MAIN-264&scope=item']))
  await record(info, 'value figures', { said, asked })
})
