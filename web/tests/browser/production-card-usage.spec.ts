/**
 * How much work an item took, on its card in the real app. The double answers on the route the
 * interface really reads; `tests/test_planning_scope_http.py` holds that a real listener answers
 * there too.
 */
import { expect } from '@playwright/test'
import type { Page, Route } from '@playwright/test'

import { planningWorkItemEntity } from '@/shared/api/platformPlanningRefs.ts'
import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { noUsage, richUsage, usageAnswer } from '../fixtures/usage.ts'
import { deferred } from '../fixtures/workItem.ts'
import { installBackend } from './backend.ts'
import { expectNoSilentClipping } from './overflow.ts'
import { attachedWorkItemRef, projectScope, workItemRef } from './planningFixtures.ts'
import { installStreamDouble } from './streamDouble.ts'
import { test } from './test.ts'

const USAGE_PATH = '/api/planning/work-item/usage'

const CARD = serializePlatformRoute({
  module_id: 'planning',
  scope: projectScope,
  entity: planningWorkItemEntity(workItemRef),
})

const line = (page: Page) => page.locator('.drawer .usage-line')

/** Answer the reads of this item's usage with `answer`, counting them. */
async function serveUsage(page: Page, answer: (route: Route) => Promise<void> | void) {
  const asked: URL[] = []
  await page.route(`**${USAGE_PATH}?*`, async (route) => {
    asked.push(new URL(route.request().url()))
    await answer(route)
  })
  return asked
}

const fulfil = (usage: ReturnType<typeof richUsage>) => (route: Route) =>
  route.fulfill({ contentType: 'application/json', body: JSON.stringify(usageAnswer(usage)) })

test('the line says the time, the estimated cost and the tokens processed anew', async ({
  page,
}) => {
  await installBackend(page)
  const asked = await serveUsage(page, fulfil(richUsage()))
  await page.goto(CARD)
  await expect(line(page)).toContainText('Work')
  await expect(line(page)).toContainText('≈\u{A0}7\u{A0}h\u{A0}38\u{A0}min')
  await expect(line(page)).toContainText('≈\u{A0}$240.67')
  await expect(line(page)).toContainText('18.3M\u{A0}tokens')
  expect(asked.map((url) => url.searchParams.get('scope'))).toEqual(['item'])
  expect(asked[0].searchParams.get('id')).toBe(workItemRef.reference)
  // Named for the reader who cannot hover: the tab says the same in words.
  const said = await line(page).getAttribute('aria-description')
  expect(said).toContain('not a bill')
  expect(said).toContain('rebuilt from transcripts')
  expect(said).toContain('All agents together: 11\u{A0}h\u{A0}14\u{A0}min.')
})

test('an item nobody worked on has no line, no zeros and no room for one', async ({ page }) => {
  await installBackend(page)
  await serveUsage(page, fulfil(noUsage()))
  await page.goto(CARD)
  await expect(page.locator('.drawer .overview')).toBeVisible()
  await expect(line(page)).toHaveCount(0)
  await expect(page.locator('.drawer .card-usage')).toBeHidden()
})

test('a failed read leaves the card working and says nothing on it', async ({ page }) => {
  await installBackend(page)
  await serveUsage(page, (route) =>
    route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'failed', message: 'failed' } }),
    }),
  )
  await page.goto(CARD)
  const drawer = page.locator('.drawer')
  await expect(drawer.locator('.overview')).toBeVisible()
  await expect(line(page)).toHaveCount(0)
  await expect(drawer.locator('.card-facts')).toBeVisible()
  await expect(drawer.getByRole('tab', { name: 'Memory' })).toBeVisible()
  await drawer.getByRole('tab', { name: 'Memory' }).click()
  await expect(drawer.getByRole('tab', { name: 'Memory' })).toHaveAttribute('aria-selected', 'true')
})

test('a read that answers late never moves what stands under the head', async ({ page }) => {
  await installBackend(page)
  const held = deferred<void>()
  await serveUsage(page, async (route) => {
    await held.promise
    await fulfil(richUsage())(route)
  })
  await page.goto(CARD)
  // The head waits for the read, as it waits for the record: nothing stands to be pushed.
  await expect(page.locator('.drawer .card-facts')).toHaveCount(0)
  held.resolve()
  await expect(line(page)).toBeVisible()
  await expect(page.locator('.drawer .card-facts')).toBeVisible()
})

test('a read that hangs keeps the head waiting for a moment and no longer', async ({ page }) => {
  await installBackend(page)
  await serveUsage(page, () => new Promise<void>(() => {}))
  await page.goto(CARD)
  await expect(page.locator('.drawer .card-facts')).toBeVisible()
  await expect(page.locator('.drawer .overview')).toBeVisible()
  await expect(line(page)).toHaveCount(0)
})

test('news from the stream reads the numbers again once a minute at most, and silence never', async ({
  page,
}) => {
  await installBackend(page)
  let usage = richUsage()
  const asked = await serveUsage(page, (route) => fulfil(usage)(route))
  const stream = await installStreamDouble(page)
  await page.clock.install()
  await page.goto(CARD)
  await expect(line(page)).toContainText('$240.67')
  expect(asked).toHaveLength(1)

  // Nothing said, nothing read, however long it stays open.
  await page.clock.fastForward('05:00')
  expect(asked).toHaveLength(1)

  usage = richUsage({ estimated_api_cost_usd: 300 })
  await stream.signal('agents')
  await expect(line(page)).toContainText('$300.00')
  expect(asked).toHaveLength(2)

  // Sooner than the collector can have moved, the news waits for the minute and is one read.
  usage = richUsage({ estimated_api_cost_usd: 400 })
  await stream.signal('agents')
  await stream.signal('agents')
  await page.clock.fastForward('00:30')
  expect(asked).toHaveLength(2)
  await page.clock.fastForward('00:31')
  await expect(line(page)).toContainText('$400.00')
  expect(asked).toHaveLength(3)
})

test('a press on the line goes to the Agents tab', async ({ page }) => {
  await installBackend(page, {
    agents: () => [
      {
        agent_id: 'agent00000000000',
        session_id: '6f1c2a8e-0000-4000-8000-000000000001',
        agent_type: 'general-purpose',
        label: 'An agent',
        started_at: '2026-08-13T08:00:00Z',
        last_activity_at: '2026-08-13T08:29:00Z',
        ended_at: null,
        steps: [],
        link: 'exact',
        coordinator_items: null,
      },
    ],
  })
  await serveUsage(page, fulfil(richUsage()))
  await page.goto(CARD)
  await line(page).click()
  await expect(page.locator('.drawer .agents')).toBeVisible()
})

for (const width of [390, 1280]) {
  test(`extreme numbers neither overflow nor clip at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await installBackend(page)
    await serveUsage(
      page,
      fulfil(
        richUsage({
          elapsed_seconds: 3_600_000,
          agent_seconds: 7_200_000,
          estimated_api_cost_usd: 13_000.55,
          tokens: { ...richUsage().tokens, input: 9_000_000_000 },
          unpriced_models: ['model-with-no-price'],
        }),
      ),
    )
    await page.goto(CARD)
    await expect(line(page)).toContainText('$13,000.55+')
    await expectNoSilentClipping(page, `usage line at ${width}px`)
    const box = await line(page).boundingBox()
    const drawer = await page.locator('.drawer').boundingBox()
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(
      (drawer?.x ?? 0) + (drawer?.width ?? 0),
    )
  })
}

test('an item of an attached store asks nothing of a read that answers for the primary', async ({
  page,
}) => {
  await installBackend(page, { includeAttachedDuplicate: true })
  const asked = await serveUsage(page, fulfil(richUsage()))
  await page.goto(
    serializePlatformRoute({
      module_id: 'planning',
      scope: projectScope,
      entity: planningWorkItemEntity(attachedWorkItemRef),
    }),
  )
  await expect(page.locator('.drawer .overview')).toBeVisible()
  await expect(line(page)).toHaveCount(0)
  expect(asked).toEqual([])
})
