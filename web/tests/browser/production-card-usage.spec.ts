/**
 * How much work an item took, on its card in the real app. The double answers on the route the
 * interface really reads; `tests/test_planning_scope_http.py` holds that a real listener answers
 * there too.
 */
import { expect } from '@playwright/test'
import type { Locator, Page, Route } from '@playwright/test'

import { readAddress } from '@/shared/api/analyticsAddress.ts'
import { planningWorkItemEntity } from '@/shared/api/platformPlanningRefs.ts'
import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { NO_TOKENS, noUsage, richUsage, usageAnswer, whoUsage } from '../fixtures/usage.ts'
import { deferred } from '../fixtures/workItem.ts'
import { openAgents, serve as serveAgents } from './agentsUsagePage.ts'
import { installBackend } from './backend.ts'
import { shot } from './boardPage.ts'
import { largeChainHere, serve, showChain } from './chainFixtures.ts'
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
  // The time on the clock, and beside it the agents' time that ran side by side, each named.
  await expect(line(page).locator('[data-fact="time"]')).toHaveText(
    'Work on the clock ≈\u{A0}7\u{A0}h\u{A0}38\u{A0}min',
  )
  await expect(line(page).locator('[data-fact="agents"]')).toHaveText(
    'Agent time ≈\u{A0}11\u{A0}h\u{A0}14\u{A0}min',
  )
  await expect(line(page)).toContainText('≈\u{A0}$240.67')
  await expect(line(page)).toContainText('18.3M\u{A0}tokens')
  expect(asked.map((url) => url.searchParams.get('scope'))).toEqual(['item'])
  expect(asked[0].searchParams.get('id')).toBe(workItemRef.reference)
  // Named for the reader who cannot hover: the tab says the same in words.
  const said = await line(page).getAttribute('aria-description')
  expect(said).toContain('not a bill')
  expect(said).toContain('rebuilt from transcripts')
  expect(said).toContain('Agents worked in parallel')
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

/** A member of the chain with work under way, which its open groups list. */
function workUnderWay(chain: ReturnType<typeof largeChainHere>) {
  const member = chain.members.find((entry) => entry.state.category === 'active')
  if (!member) throw new Error('the chain has work under way')
  return member
}

test('an epic reads its whole scope, and each member of its chain says its share', async ({
  page,
}) => {
  const chain = largeChainHere()
  const member = workUnderWay(chain)
  await installBackend(page, { card: (read) => ({ ...read, kind: 'epic' }) })
  await serve(page, chain)
  const asked = await serveUsage(
    page,
    fulfil(
      richUsage({
        scope: 'epic',
        by_item: [
          ...richUsage().by_item,
          {
            work_item_id: member.work_item_id,
            reference: member.reference,
            title: member.title,
            elapsed_seconds: 8280,
            agent_seconds: 9000,
            tokens: richUsage().tokens,
            estimated_api_cost_usd: 34.89,
            unpriced_tokens: 0,
          },
        ],
      }),
    ),
  )
  await page.goto(CARD)
  await expect(line(page)).toContainText('Work on the epic')
  // The whole scope for the summary and the chain; the item's own runs for the agents' rows.
  expect(asked.map((url) => url.searchParams.get('scope'))).toEqual(
    expect.arrayContaining(['epic', 'item']),
  )
  await showChain(page)
  const row = page.locator(`.drawer .chain-row[data-reference="${member.reference}"]`)
  await expect(row.locator('.chain-row-usage')).toHaveText(
    /≈\u{A0}2\u{A0}h\u{A0}18\u{A0}min\s*≈\u{A0}\$34\.89/u,
  )
  // A member nobody worked on says nothing, not a zero.
  await expect(page.locator('.drawer .chain-row-usage')).toHaveCount(1)
})

/**
 * The Agents tab of an item three agents worked on, said the way the read says the owner's epic:
 * the work split by effort into rows of one role and class, and rows of under a minute with no
 * tokens. The figures are synthetic.
 */
function threeAgents() {
  const usage = whoUsage()
  const [subagent, main, advisor] = usage.roles
  const half = (line: typeof subagent) => ({
    ...line,
    seconds: line.seconds / 2,
    tokens: { ...NO_TOKENS, input: (line.tokens.input ?? 0) / 2 },
    estimated_api_cost_usd: (line.estimated_api_cost_usd ?? 0) / 2,
  })
  const nothing = { tokens: NO_TOKENS, estimated_api_cost_usd: null, unpriced_tokens: 0 }
  return whoUsage({
    agents: [
      ...usage.agents,
      { ...usage.agents[0], agent_id: 'agent00000000001', seconds: 0, ...nothing },
    ],
    roles: [
      { ...half(subagent), effort: { id: 'high', unknown: false } },
      { ...half(subagent), effort: { id: 'low', unknown: false } },
      main,
      advisor,
      // Under a minute and nothing counted: what the tab used to list as «no data no data».
      {
        role: 'subagent',
        launch_class: { id: null, unknown: true },
        effort: { id: null, unknown: true },
        seconds: 20,
        ...nothing,
      },
      { ...main, effort: { id: 'high', unknown: false }, seconds: 0, ...nothing },
    ],
  })
}

const two = (value: number) => String(value).padStart(2, '0')

/** The day a moment falls on in the browser's calendar, which is this machine's: `2026-08-13`. */
function dayOf(moment: string) {
  const at = new Date(moment)
  return `${at.getFullYear()}-${two(at.getMonth() + 1)}-${two(at.getDate())}`
}

/**
 * Whether an element stands whole in the window and in every box that scrolls around it, and
 * nothing held over it, such as the card's head, covers its first and last line.
 */
function standsInView(element: Element) {
  const box = element.getBoundingClientRect()
  const bounds = [{ top: 0, bottom: window.innerHeight }]
  for (let up = element.parentElement; up; up = up.parentElement) {
    const { overflowY } = getComputedStyle(up)
    if (overflowY !== 'auto' && overflowY !== 'scroll') continue
    const frame = up.getBoundingClientRect()
    bounds.push({ top: frame.top, bottom: frame.bottom })
  }
  const seen = (y: number) => element.contains(document.elementFromPoint(box.left + 2, y))
  return (
    bounds.every((bound) => box.top >= bound.top && box.bottom <= bound.bottom) &&
    seen(box.top + 2) &&
    seen(box.bottom - 2)
  )
}

/**
 * Where the text of each line of the head starts: the first figure, the link, the line under them
 * when there is one, the caption and the first row's name. One column: they start at one edge.
 */
const starts = (head: Element) =>
  [
    '.work-usage-figures button',
    '.work-usage-analytics',
    '.work-usage-note',
    '.work-usage-caption',
    '.work-usage-name',
  ].flatMap((selector) => {
    const element = head.querySelector(selector)
    if (!element) return []
    const text = document.createRange()
    text.selectNodeContents(element)
    return [Math.round(text.getBoundingClientRect().left * 10) / 10]
  })

async function expectOneEdge(head: Locator, count: number) {
  const lefts = await head.evaluate(starts)
  expect(lefts, `the head's lines start at ${lefts.join(', ')}`).toHaveLength(count)
  expect(Math.max(...lefts) - Math.min(...lefts)).toBeLessThanOrEqual(1)
}

test('at 1440×900 the tab shows the figures and the way to Analytics without a scroll', async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  const usage = { ...threeAgents(), unpriced_models: ['model-with-no-price'] }
  await serveAgents(page, usage)
  await page.goto(CARD)
  const section = await openAgents(page)
  await expect(page.locator('.drawer .inspector-tabs').getByRole('tab').nth(1)).toHaveText(
    'Agents 3',
  )
  const head = section.locator('.work-usage')
  const figures = head.locator('.work-usage-figures')
  const link = head.getByRole('link', { name: 'Open in Analytics' })
  await expect(figures).toBeVisible()
  await expect(link).toBeVisible()
  expect(await figures.evaluate(standsInView), 'the figures stand in view').toBe(true)
  expect(await link.evaluate(standsInView), 'the link stands in view').toBe(true)
  // The link stands straight under the figures, and nothing else stands between them.
  const [over, under] = await Promise.all([figures.boundingBox(), link.boundingBox()])
  expect((under?.y ?? 0) - ((over?.y ?? 0) + (over?.height ?? 0))).toBeLessThanOrEqual(16)
  // The address carries the card's task and the days its work spans.
  const state = new URL((await link.getAttribute('href')) ?? '', 'http://localhost').searchParams
  const view = readAddress(
    JSON.parse(Buffer.from(state.get('state') ?? '', 'base64url').toString('utf8')),
  )
  expect(view.filters).toEqual({ work_item: [usage.work_item_id] })
  const [first, last] = [usage.account_stretches[0], usage.account_stretches.at(-1)]
  expect(view).toMatchObject({
    period: 'custom',
    from: dayOf(first.started_at),
    to: dayOf(last?.ended_at ?? ''),
  })
  // One breakdown: who did the work, no effort, and no row with no minute and no tokens.
  await expect(head.locator('.work-usage-caption').first()).toHaveText('Who did the work')
  await expect(head).not.toContainText('Tokens by kind')
  await expect(head).not.toContainText('Models')
  await expect(head).not.toContainText('effort')
  const rows = head.locator('[data-breakdown="roles"] .work-usage-row')
  await expect(rows).toHaveCount(3)
  await expect(head).not.toContainText(/under a minute\s*no data/u)
  // The two halves of the subagent's work are one row again, as much as the read's whole row.
  await expect(rows.nth(0)).toContainText('Subagent · bero')
  await expect(rows.nth(0)).toContainText('8\u{A0}h\u{A0}20\u{A0}min')
  await expect(rows.nth(0)).toContainText('≈\u{A0}$180.00')
  // The one line of notes stands under the link, and every line starts at one edge.
  await expect(head.locator('.work-usage-note')).toHaveText(
    'The cost is incomplete: no price for model-with-no-price.',
  )
  await expectOneEdge(head, 5)
  await page.screenshot(shot(info, 'agents-tab-1440.png'))
})

test.describe('under a finger', () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 900 } })

  test('at 390 the head stands whole, and a figure says what it counts to a finger', async ({
    page,
  }, info) => {
    await serveAgents(page, threeAgents())
    await page.goto(CARD)
    const section = await openAgents(page)
    const figures = section.locator('.work-usage-figures')
    await expect(figures.getByRole('button')).toHaveText([
      'Work on the clock ≈\u{A0}7\u{A0}h\u{A0}38\u{A0}min',
      'Agent time ≈\u{A0}11\u{A0}h\u{A0}14\u{A0}min',
      'Cost ≈\u{A0}$240.67',
      /^Tokens /u,
    ])
    // No line of notes under figures that need none: each says its why on a press.
    await expect(section.locator('.work-usage-note')).toHaveCount(0)
    await expectOneEdge(section.locator('.work-usage'), 4)
    await figures.getByRole('button', { name: /^Cost/u }).tap()
    await expect(page.getByRole('tooltip')).toContainText('not a bill')
    await expectNoSilentClipping(page, 'the agents tab at 390px')
    await page.screenshot(shot(info, 'agents-tab-390.png'))
  })
})
