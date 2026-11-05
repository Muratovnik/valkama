/**
 * How much work an item took, on its Agents tab in the real app: the whole at the head with what
 * each number is, the tokens by kind and the models, each agent's share beside it, and its
 * session's total with what bound to no item. The doubles answer on the routes the interface
 * really reads, `/api/planning/work-item/usage` and `/api/planning/session/usage`.
 */
import AxeBuilder from '@axe-core/playwright'
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { planningWorkItemEntity } from '@/shared/api/platformPlanningRefs.ts'
import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import {
  NO_TOKENS,
  noUsage,
  PARENT_SESSION,
  richUsage,
  sessionUsage,
  usageAnswer,
} from '../fixtures/usage.ts'
import { installBackend } from './backend.ts'
import { shot } from './boardPage.ts'
import { expectNoSilentClipping } from './overflow.ts'
import { projectScope, workItemRef } from './planningFixtures.ts'
import { test } from './test.ts'

const CARD = serializePlatformRoute({
  module_id: 'planning',
  scope: projectScope,
  entity: planningWorkItemEntity(workItemRef),
})

/** The one agent the record names, the same run the read counts first. */
const named = {
  agent_id: 'agent00000000000',
  session_id: PARENT_SESSION,
  agent_type: 'general-purpose',
  label: 'Build the export',
  started_at: '2026-08-13T08:00:00Z',
  last_activity_at: '2026-08-13T08:29:00Z',
  ended_at: '2026-08-13T16:20:00Z',
  steps: [],
  link: 'exact',
  coordinator_items: null,
}

async function serve(
  page: Page,
  item: ReturnType<typeof richUsage> | null,
  session = sessionUsage(),
) {
  await installBackend(page, { agents: () => [named] })
  await page.route('**/api/planning/work-item/usage?*', (route) =>
    item
      ? route.fulfill({ contentType: 'application/json', body: JSON.stringify(usageAnswer(item)) })
      : route.fulfill({ status: 500, contentType: 'application/json', body: '{}' }),
  )
  await page.route('**/api/planning/session/usage?*', (route) =>
    route.fulfill({ contentType: 'application/json', body: JSON.stringify(usageAnswer(session)) }),
  )
}

async function openAgents(page: Page) {
  const tab = page.locator('.drawer .inspector-tabs').getByRole('tab', { name: /^Agents \d+$/u })
  await tab.click()
  return page.locator('.drawer .agents')
}

test('the tab counts the session’s own run with the agents the record names', async ({ page }) => {
  await serve(page, richUsage())
  await page.goto(CARD)
  await expect(page.locator('.drawer .inspector-tabs').getByRole('tab').nth(1)).toHaveText(
    'Agents 2',
  )
  const section = await openAgents(page)
  const rows = section.locator('.agent')
  await expect(rows).toHaveCount(2)
  // Most time first, each with what it spent, the run the record does not name included.
  await expect(rows.nth(0)).toContainText('Build the export')
  await expect(rows.nth(0)).toContainText('≈\u{A0}8\u{A0}h\u{A0}20\u{A0}min')
  await expect(rows.nth(0)).toContainText('≈\u{A0}$180.00')
  await expect(rows.nth(1)).toContainText('The session itself')
  await expect(rows.nth(1)).toContainText('1.5K\u{A0}tokens')
})

test('the head says the whole, what each number is, every kind and every model', async ({
  page,
}) => {
  await serve(page, richUsage({ tokens: { ...richUsage().tokens, cache_write_1h: null } }))
  await page.goto(CARD)
  const section = await openAgents(page)
  const head = section.locator('.work-usage')
  await expect(head.locator('.work-usage-figure')).toHaveText([
    'Work ≈\u{A0}7\u{A0}h\u{A0}38\u{A0}min',
    'All agents ≈\u{A0}11\u{A0}h\u{A0}14\u{A0}min',
    'Cost ≈\u{A0}$240.67',
    'Tokens 17.9M',
  ])
  await expect(head.locator('.work-usage-notes li')).toHaveText([
    /Agents worked in parallel/u,
    /an estimate at API prices and not a bill/u,
    /history is rebuilt from transcripts/u,
  ])
  const kinds = head.locator('.work-usage-grid').first().locator('.work-usage-row')
  await expect(kinds).toHaveText([
    /^Input\s*5,000,000$/u,
    /^Read from cache\s*392,000,000$/u,
    /^Written to cache, short\s*11,000,000$/u,
    // A kind nobody reported says so, and never 0.
    /^Written to cache, long\s*no data$/u,
    /^Output\s*1,900,000$/u,
    /^of it reasoning\s*600,000$/u,
    // Input, cache writes and output: the reasoning is in the output already.
    /^Processed anew\s*17,900,000$/u,
  ])
  const models = head.locator('.work-usage-grid.has-columns .work-usage-row')
  await expect(models).toHaveCount(2)
  await expect(models.nth(1)).toContainText('claude-example-2')
  await expect(models.nth(1)).toContainText('on the side')
  await expect(models.nth(1)).toContainText('≈\u{A0}$66.32')
})

test('a cost that leaves models out says which, and is marked incomplete', async ({ page }) => {
  await serve(page, richUsage({ unpriced_models: ['model-with-no-price'] }))
  await page.goto(CARD)
  const section = await openAgents(page)
  await expect(section.locator('.work-usage-figures')).toContainText('Cost ≈\u{A0}$240.67+')
  await expect(section.locator('.work-usage-notes')).toContainText(
    'The cost is incomplete: no price for model-with-no-price.',
  )
})

test('the session’s head says its whole and what bound to no item', async ({ page }) => {
  await serve(page, richUsage())
  await page.goto(CARD)
  const section = await openAgents(page)
  const totals = section.locator('.session-usage-row')
  await expect(totals).toHaveCount(2)
  await expect(totals.nth(0)).toContainText('Whole session')
  await expect(totals.nth(0)).toContainText('≈\u{A0}3\u{A0}d\u{A0}23\u{A0}h')
  await expect(totals.nth(0)).toContainText('≈\u{A0}$4,888.76')
  await expect(totals.nth(1)).toContainText('No task')
  await expect(totals.nth(1)).toContainText('≈\u{A0}1\u{A0}d\u{A0}17\u{A0}h')
  await expect(totals.nth(1)).toContainText('≈\u{A0}$1,634.49')
})

test('a session nothing was read for has no totals and no zeros', async ({ page }) => {
  await serve(
    page,
    richUsage(),
    sessionUsage({
      elapsed_seconds: 0,
      agent_seconds: 0,
      tokens: NO_TOKENS,
      estimated_api_cost_usd: null,
      by_item: [],
    }),
  )
  await page.goto(CARD)
  const section = await openAgents(page)
  await expect(section.locator('.agent')).toHaveCount(2)
  await expect(section.locator('.session-usage-row')).toHaveCount(0)
  await expect(section).not.toContainText('$0.00')
})

test('an item nobody’s work reached has the tab it had and no numbers in it', async ({ page }) => {
  await serve(page, noUsage())
  await page.goto(CARD)
  const section = await openAgents(page)
  await expect(section.locator('.agent')).toHaveCount(1)
  await expect(section.locator('.work-usage')).toHaveCount(0)
  await expect(section.locator('.agent-spent')).toHaveCount(0)
})

test('a failed read says so on the tab and reads again on request', async ({ page }) => {
  await serve(page, null)
  await page.goto(CARD)
  const section = await openAgents(page)
  await expect(section.locator('.agent')).toHaveCount(1)
  const failure = section.getByRole('alert')
  await expect(failure).toContainText('Could not read how much work this took.')
  await page.unroute('**/api/planning/work-item/usage?*')
  await page.route('**/api/planning/work-item/usage?*', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(usageAnswer(richUsage())),
    }),
  )
  await failure.getByRole('button', { name: 'Retry' }).click()
  await expect(section.locator('.work-usage')).toBeVisible()
  await expect(section.getByRole('alert')).toHaveCount(0)
})

for (const width of [390, 1280]) {
  test(`a long list with extreme numbers stands whole at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 900 })
    const many = Array.from({ length: 40 }, (_, index) => ({
      session_id: PARENT_SESSION,
      agent_id: `run${String(index).padStart(13, '0')}`,
      seconds: index === 0 ? 1 : 3_600_000 - index,
      tokens: { ...NO_TOKENS, input: 9_000_000_000, output: index },
      estimated_api_cost_usd: 13_000.55,
    }))
    await serve(
      page,
      richUsage({
        elapsed_seconds: 3_600_000,
        agent_seconds: 7_200_000,
        estimated_api_cost_usd: 13_000.55,
        agents: many,
      }),
    )
    await page.goto(CARD)
    const section = await openAgents(page)
    await expect(section.locator('.agent')).toHaveCount(41)
    await expect(section.locator('.agent-spent').first()).toContainText('≈\u{A0}$13,000.55')
    await expectNoSilentClipping(page, `agents usage at ${width}px`)
    const results = await new AxeBuilder({ page })
      .include('.drawer .agents')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze()
    expect(results.violations.map((violation) => violation.id)).toEqual([])
    await page.screenshot(shot(info, `agents-usage-${width}.png`))
  })
}
