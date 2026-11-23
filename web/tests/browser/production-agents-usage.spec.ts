/**
 * How much work an item took, on its Agents tab in the real app: the whole at the head with what
 * each figure counts, each agent's share beside it, and its session's total with what bound to no
 * item. The doubles answer on the routes the interface
 * really reads, `/api/planning/work-item/usage` and `/api/planning/session/usage`.
 */
import AxeBuilder from '@axe-core/playwright'
import { expect } from '@playwright/test'

import { noUsage, richUsage, usageAnswer } from '../fixtures/usage.ts'
import { CARD, openAgents, serve, serveGoal } from './agentsUsagePage.ts'
import { shot } from './boardPage.ts'
import { expectNoSilentClipping } from './overflow.ts'
import {
  emptySession,
  extremeUsage,
  goalWhole,
  noCacheWriteUsage,
  unpricedUsage,
} from './served/agentsUsage.ts'
import { installStreamDouble } from './streamDouble.ts'
import { test } from './test.ts'

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

test('the head says the whole, and each figure says what it counts', async ({ page }) => {
  await serve(page, noCacheWriteUsage())
  await page.goto(CARD)
  const section = await openAgents(page)
  const head = section.locator('.work-usage-figures')
  const figure = (name: RegExp) => head.getByRole('button', { name })
  await expect(head.getByRole('button')).toHaveText([
    'Work ≈\u{A0}7\u{A0}h\u{A0}38\u{A0}min',
    'All agents ≈\u{A0}11\u{A0}h\u{A0}14\u{A0}min',
    'Cost ≈\u{A0}$240.67',
    // A kind nobody reported adds nothing, and the cached reads stay apart.
    'Tokens 17.9M',
    'Sessions 1',
  ])
  // What each figure counts is its description and its why, and not a line under the figures.
  await expect(figure(/^Work/u)).toHaveAccessibleDescription(/history is rebuilt from transcripts/u)
  await expect(figure(/^All agents/u)).toHaveAccessibleDescription(/Agents worked in parallel/u)
  await expect(figure(/^Cost/u)).toHaveAccessibleDescription(/at API prices and not a bill/u)
  await expect(figure(/^Tokens/u)).toHaveAccessibleDescription(/Reads from the cache are counted/u)
  await expect(figure(/^Sessions/u)).toHaveAccessibleDescription(/each once/u)
  await expect(section.locator('.work-usage-note')).toHaveCount(0)
  await figure(/^Cost/u).hover()
  await expect(page.getByRole('tooltip')).toContainText('not a bill')
  // The kinds and the models are the Analytics page's, which the link under the figures opens.
  await expect(section.locator('.work-usage')).not.toContainText('Read from cache')
  await expect(section.locator('.work-usage')).not.toContainText('claude-example-2')
})

test('a cost that leaves models out says which, and is marked incomplete', async ({ page }) => {
  await serve(page, unpricedUsage())
  await page.goto(CARD)
  const section = await openAgents(page)
  await expect(section.locator('.work-usage-figures')).toContainText('Cost ≈\u{A0}$240.67+')
  await expect(section.locator('.work-usage-note')).toHaveText(
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
  await serve(page, richUsage(), emptySession())
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

test('a later read that fails keeps the numbers, says so and reads again on request', async ({
  page,
}) => {
  await serve(page, richUsage())
  const stream = await installStreamDouble(page)
  await page.clock.install()
  await page.goto(CARD)
  const section = await openAgents(page)
  await expect(section.locator('.work-usage')).toBeVisible()

  await page.unroute('**/api/planning/work-item/usage?*')
  await page.route('**/api/planning/work-item/usage?*', (route) =>
    route.fulfill({ status: 500, contentType: 'application/json', body: '{}' }),
  )
  await page.clock.fastForward('05:00')
  await stream.signal('agents')
  const failure = section.getByRole('alert')
  await expect(failure).toContainText('Could not read how much work this took.')
  await expect(section.locator('.work-usage')).toBeVisible()

  await page.unroute('**/api/planning/work-item/usage?*')
  await page.route('**/api/planning/work-item/usage?*', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(usageAnswer(richUsage())),
    }),
  )
  await failure.getByRole('button', { name: 'Retry' }).click()
  await expect(section.getByRole('alert')).toHaveCount(0)
  await expect(section.locator('.work-usage')).toBeVisible()
})

test('a goal’s tab lists its own agents, and its counter counts only them', async ({ page }) => {
  const asked = await serveGoal(page, goalWhole(), () => richUsage())
  await page.goto(CARD)
  await expect(page.locator('.drawer .inspector-tabs').getByRole('tab').nth(1)).toHaveText(
    'Agents 2',
  )
  const section = await openAgents(page)
  const rows = section.locator('.agent')
  await expect(rows).toHaveCount(2)
  await expect(rows.nth(0)).toContainText('Build the export')
  await expect(rows.nth(0)).toContainText('≈\u{A0}8\u{A0}h\u{A0}20\u{A0}min')
  await expect(rows.nth(1)).toContainText('The session itself')
  // The children's runs have no row on the goal, so no short id stands in for them.
  await expect(section).not.toContainText('a3a79fc9')
  await expect(section).not.toContainText('a58241d0')
  // The summary keeps the whole of the goal, the children's time included.
  await expect(section.locator('.work-usage-figures').getByRole('button').nth(1)).toHaveText(
    'All agents ≈\u{A0}16\u{A0}h\u{A0}40\u{A0}min',
  )
  expect(asked).toEqual(expect.arrayContaining(['tree', 'item']))
})

test('a goal whose own runs did not read says so on the tab and reads them on request', async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 390, height: 900 })
  let answering = false
  await serveGoal(page, goalWhole(), () => (answering ? richUsage() : null))
  await page.goto(CARD)
  const section = await openAgents(page)
  // The whole still stands; the rows stand without their figures, and say why.
  await expect(section.locator('.work-usage')).toBeVisible()
  await expect(section.locator('.agent')).toHaveCount(1)
  await expect(section.locator('.agent-spent')).toHaveCount(0)
  const failure = section.getByRole('alert')
  await expect(failure).toContainText('Could not read how much work this took.')
  await expectNoSilentClipping(page, 'own runs failed at 390px')
  const results = await new AxeBuilder({ page })
    .include('.drawer .agents')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze()
  expect(results.violations.map((violation) => violation.id)).toEqual([])
  await page.screenshot(shot(info, 'agents-usage-own-runs-failed-390.png'))
  answering = true
  await failure.getByRole('button', { name: 'Retry' }).click()
  await expect(section.locator('.agent')).toHaveCount(2)
  await expect(section.locator('.agent-spent').first()).toContainText(
    '≈\u{A0}8\u{A0}h\u{A0}20\u{A0}min',
  )
  await expect(section.getByRole('alert')).toHaveCount(0)
})

for (const width of [390, 1280]) {
  test(`a long list with extreme numbers stands whole at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 900 })
    await serve(page, extremeUsage())
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
