/**
 * What a task's side panel says its figures are of, in the real app over the browser double. The
 * oracle is the requirement (`DESIGN.md`, Analytics): the heading of the figures names the period
 * of the page as the page names a period, and another period chosen is named instead; under them
 * the task's figures of all time, its agents' time and its cost, are the very figures the task's
 * card says in its line, by the same names, since both are one read said one way: the agents'
 * time is the card's «Agent time», never its «Work on the clock».
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { task } from '../fixtures/analytics.ts'
import type { TimedStretch } from '../fixtures/analytics.ts'
import { WORK_GROUP as WORK } from '../fixtures/quotaSpent.ts'
import { richUsage, usageAnswer } from '../fixtures/usage.ts'
import { pageAt, record, serve, serveTask } from './analyticsPage.ts'
import { expectNoSilentClipping } from './overflow.ts'
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

test('a task’s panel names the period of its figures and says the figures of all time its card says', async ({
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
  const allTime = panel.locator('[data-part="all-time"]')
  await expect(allTime.getByRole('heading')).toHaveText('All time')
  const agents = allTime.locator('[data-figure="agents"]')
  await expect(agents.locator('dt')).toHaveText('Agent time')
  await expect(agents.locator('dd')).toHaveText('≈\u{A0}11\u{A0}h\u{A0}14\u{A0}min')
  const cost = allTime.locator('[data-figure="cost"] dd')
  await expect(cost).toHaveText('≈\u{A0}$1,234.56')
  const name = await agents.locator('dt').textContent()
  const time = await agents.locator('dd').textContent()
  const said = { agents: `${name ?? ''} ${time ?? ''}`, cost: await cost.textContent() }

  // The task's card says the same figures in its line, the agents' time by the same name.
  await panel.getByRole('link', { name: 'Open the card' }).click()
  await expect(page.locator('.drawer [data-fact="cost"]')).toHaveText(said.cost ?? '')
  await expect(page.locator('.drawer [data-fact="agents"]')).toHaveText(said.agents)

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

for (const width of [1440, 1024])
  test(`at ${width}px the figures of all time stand whole inside the panel`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height: 900 })
    await serve(page, WORLD)
    await serveTask(page)
    await page.route('**/api/planning/work-item/usage?*', (route) =>
      route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify(usageAnswer(richUsage({ estimated_api_cost_usd: ALL_TIME }))),
      }),
    )
    const panel = await openPanel(page, detail)
    const allTime = panel.locator('[data-part="all-time"]')
    await expect(allTime.locator('[data-figure="agents"] dd')).not.toBeEmpty()
    const rows = await allTime.evaluate((element) => {
      const room = element.getBoundingClientRect()
      return [...element.querySelectorAll('dt, dd')].map((cell) => {
        const box = cell.getBoundingClientRect()
        return {
          text: cell.textContent,
          inside: box.left >= room.left - 0.5 && box.right <= room.right + 0.5,
          lines: Math.round(box.height / Number.parseFloat(getComputedStyle(cell).lineHeight)),
        }
      })
    })
    await record(info, `value figures of all time ${width}`, rows)
    expect(rows).toHaveLength(4)
    for (const row of rows) {
      expect(row.inside, `${row.text} inside the panel`).toBe(true)
      expect(row.lines, `${row.text} on one line`).toBe(1)
    }
    await expectNoSilentClipping(
      page,
      `figures of all time at ${width}px`,
      '[data-part="all-time"]',
    )
  })
