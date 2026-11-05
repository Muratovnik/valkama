/**
 * The agents on a card, in the real app: a tab of their own that the card offers only
 * while it has some, a list grouped by the parent session its rows open, and news of an
 * agent reaching an open card through the stream it already has.
 */
import AxeBuilder from '@axe-core/playwright'
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { planningWorkItemEntity } from '@/shared/api/platformPlanningRefs.ts'
import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { installBackend } from './backend.ts'
import { shot } from './boardPage.ts'
import { IN_VSCODE, openPlanFor } from './openSessionFixtures.ts'
import { expectNoSilentClipping } from './overflow.ts'
import { blockedWorkItem, projectScope, workItemRef } from './planningFixtures.ts'
import { installStreamDouble } from './streamDouble.ts'
import { test } from './test.ts'

const LONG_LABEL =
  'Проверить экспорт и журналы на утечку метки при параллельных запусках субагентов'

const agent = (index: number, overrides = {}) => ({
  agent_id: `agent${String(index).padStart(11, '0')}`,
  session_id: '6f1c2a8e-0000-4000-8000-000000000001',
  agent_type: 'general-purpose',
  label: index === 0 ? LONG_LABEL : '',
  started_at: '2026-08-13T08:00:00Z',
  last_activity_at: '2026-08-13T08:29:00Z',
  ended_at: null,
  steps: [],
  link: 'claim',
  coordinator_items: 19,
  ...overrides,
})

const placed = { agent: null, family: 'claude' }
const LIVE_PARENT = {
  ...placed,
  session: IN_VSCODE,
  state: 'live',
  opened_in: 'ide',
  opened_host: 'vscode',
}
/** A parent the fixtures' plan does not name, which it answers as a desktop app's session. */
const ENDED_PARENT = {
  ...placed,
  session: '77777777-0000-4000-8000-000000000002',
  state: 'ended',
  opened_in: 'app',
  opened_host: 'claude-desktop',
}
const NO_PARENT = {
  session: null,
  agent: null,
  family: '',
  state: 'none',
  opened_in: '',
  opened_host: '',
}

/** Rows in the order the read gives them, each under the parent named at its place. */
const rowsOf = (...parents: object[]) =>
  parents.map((executor, index) => agent(index, { executor, label: `Agent number ${index}` }))

const CARD = serializePlatformRoute({
  module_id: 'planning',
  scope: projectScope,
  entity: planningWorkItemEntity(workItemRef),
})

const tabs = (page: Page) => page.locator('.drawer .inspector-tabs').getByRole('tab')
const WITHOUT_AGENTS = ['Overview', 'Memory', 'Relations', 'System events']

/** The card's Agents tab, chosen as a reader chooses it. */
async function openAgents(page: Page) {
  const tab = page.locator('.drawer .inspector-tabs').getByRole('tab', { name: /^Agents \d+$/u })
  await tab.click()
  await expect(tab).toHaveAttribute('aria-selected', 'true')
  return page.locator('.drawer .agents')
}

for (const width of [1440, 390]) {
  test(`a long list of agents stands whole on its tab at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 900 })
    const agents = Array.from({ length: 94 }, (_, index) => agent(index))
    await installBackend(page, { agents: () => agents })
    await page.goto(CARD)
    await expect(tabs(page).nth(1)).toHaveText('Agents 94')

    const section = await openAgents(page)
    // Every row at once, in the order the read gives them, with no fold and no toggle.
    await expect(section.locator('.agent')).toHaveCount(94)
    await expect(section.locator('.agent').first()).toContainText(LONG_LABEL)
    // Said once for the group, not in each of its 94 rows.
    await expect(section.locator('.agent-group-link')).toHaveText([
      'ambiguous: the coordinator held 19 items',
    ])
    await expect(section.locator('.agent').first()).not.toContainText('ambiguous')
    await expect(page.locator('.drawer').getByRole('button', { name: /^Show /u })).toHaveCount(0)
    // The tab names it and counts it; nothing under the tab says it again.
    await expect(section.getByRole('heading')).toHaveCount(0)
    await expect(section.locator('.section-header-count')).toHaveCount(0)
    await expectNoSilentClipping(page, `agents at ${width}px`)
    // The dot between two facts is drawing: a screen reader says the facts, not it.
    expect(await section.locator('.agent').first().ariaSnapshot()).not.toContain('·')
    const results = await new AxeBuilder({ page })
      .include('.drawer .agents')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze()
    expect(results.violations.map((violation) => violation.id)).toEqual([])
    await page.screenshot(shot(info, `agents-tab-${width}.png`))
  })

  for (const closed of [false, true]) {
    test(`Overview says nothing of the agents on ${closed ? 'a closed' : 'an open'} item at ${width}px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 })
      const agents = Array.from({ length: 27 }, (_, index) => agent(index))
      await installBackend(page, {
        agents: () => agents,
        closedWith: closed ? 'The export carries no label.' : undefined,
      })
      await page.goto(CARD)
      const drawer = page.locator('.drawer')
      await expect(drawer.locator('.overview')).toBeVisible()
      await expect(drawer.locator('.agents')).toHaveCount(0)
      await expect(drawer.locator('.overview')).not.toContainText(LONG_LABEL)
      await expect(tabs(page).nth(1)).toHaveText('Agents 27')
      const section = await openAgents(page)
      await expect(section.locator('.agent')).toHaveCount(27)
    })
  }
}

test('a parent’s way back stands once, over its rows, and in no row', async ({ page }) => {
  const agents = rowsOf(LIVE_PARENT, LIVE_PARENT, LIVE_PARENT)
  await installBackend(page, { agents: () => agents, openPlan: openPlanFor })
  await page.goto(CARD)
  const section = await openAgents(page)
  await expect(section.locator('.agent')).toHaveCount(3)
  const open = section.getByRole('button', { name: 'Open the parent session in VS Code' })
  await expect(open).toHaveCount(1)
  await expect(section.locator('.agent button.open-action')).toHaveCount(0)
  await expect(section.locator('.agent-group')).toHaveCount(1)
  // It stands over the list, and one parent needs no name to tell it from another.
  const below = await section.evaluate((node) => {
    const button = node.querySelector('button.open-action')?.getBoundingClientRect()
    const row = node.querySelector('.agent')?.getBoundingClientRect()
    return (row?.top ?? 0) - (button?.bottom ?? 0)
  })
  expect(below).toBeGreaterThan(0)
  await expect(section.locator('.agent-group-id')).toHaveCount(0)
})

test('rows of two parents stand under two heads, the parent of the newest first', async ({
  page,
}) => {
  const agents = rowsOf(ENDED_PARENT, LIVE_PARENT, ENDED_PARENT)
  await installBackend(page, { agents: () => agents, openPlan: openPlanFor })
  await page.goto(CARD)
  const section = await openAgents(page)
  const groups = section.locator('.agent-group')
  await expect(groups).toHaveCount(2)
  await expect(groups.first().locator('.agent')).toHaveCount(2)
  await expect(groups.first().locator('.agent').first()).toContainText('Agent number 0')
  await expect(groups.first().locator('.agent').nth(1)).toContainText('Agent number 2')
  await expect(groups.nth(1).locator('.agent')).toHaveCount(1)
  await expect(section.getByRole('button', { name: /^Open the parent session/u })).toHaveCount(2)
  // Two heads can read alike, so each says whose it is.
  await expect(groups.locator('.agent-group-id')).toHaveText([
    ENDED_PARENT.session.slice(0, 8),
    LIVE_PARENT.session.slice(0, 8),
  ])
})

test('rows with no session to open have no head and no button, and their facts stay', async ({
  page,
}) => {
  const agents = [agent(0, { executor: NO_PARENT })]
  await installBackend(page, { agents: () => agents })
  await page.goto(CARD)
  const section = await openAgents(page)
  await expect(section.locator('.agent')).toHaveCount(1)
  await expect(section.locator('button.open-action')).toHaveCount(0)
  await expect(section.locator('.agent-group-link')).toHaveText([
    'ambiguous: the coordinator held 19 items',
  ])
  await expect(section.locator('.agent').first()).not.toContainText('ambiguous')
})

test('a group says its ambiguity once as a range of its rows, and a row keeps its count in its tooltip', async ({
  page,
}) => {
  const agents = [
    agent(0, { executor: LIVE_PARENT, coordinator_items: 13 }),
    agent(1, { executor: LIVE_PARENT, coordinator_items: 19 }),
    agent(2, { executor: LIVE_PARENT, link: 'exact', coordinator_items: null }),
  ]
  await installBackend(page, { agents: () => agents, openPlan: openPlanFor })
  await page.goto(CARD)
  const section = await openAgents(page)
  await expect(section.locator('.agent-group')).toHaveCount(1)
  await expect(section.locator('.agent-group-link')).toHaveText([
    'ambiguous: the coordinator held 13–19 items',
  ])
  await expect(section.locator('.agent').nth(0)).not.toContainText('ambiguous')
  await expect(section.locator('.agent').nth(1)).not.toContainText('ambiguous')
  await expect(section.locator('.agent').nth(2)).toContainText('wrote to this item')
  await expect(section.locator('.agent').nth(0)).toHaveAttribute(
    'title',
    'ambiguous: the coordinator held 13 items',
  )
  await expect(section.locator('.agent').nth(1)).toHaveAttribute(
    'aria-description',
    'ambiguous: the coordinator held 19 items',
  )
})

test('with no agents the card offers no tab', async ({ page }) => {
  await installBackend(page)
  await page.goto(CARD)
  await expect(page.locator('.drawer .overview')).toBeVisible()
  await expect(page.locator('.drawer .agents')).toHaveCount(0)
  await expect(tabs(page)).toHaveText(WITHOUT_AGENTS)
})

test('with agents the tab stands after Overview and the arrows reach it with no gap', async ({
  page,
}) => {
  const agents = [agent(0)]
  await installBackend(page, { agents: () => agents })
  await page.goto(CARD)
  await expect(tabs(page)).toHaveText(['Overview', 'Agents 1', ...WITHOUT_AGENTS.slice(1)])
  // A screen reader hears the name and the number as one phrase.
  await expect(page.getByRole('tab', { name: 'Agents 1', exact: true })).toBeVisible()
  const panel = page.locator('.drawer .inspector-panel')
  await tabs(page).first().focus()
  for (const reached of [1, 2, 3, 4]) {
    await page.keyboard.press('ArrowRight')
    await expect(tabs(page).nth(reached)).toBeFocused()
    await expect(tabs(page).nth(reached)).toHaveAttribute('aria-selected', 'true')
    await expect(panel).toHaveAttribute(
      'aria-labelledby',
      (await tabs(page).nth(reached).getAttribute('id')) ?? '',
    )
  }
  await page.keyboard.press('ArrowRight')
  await expect(tabs(page).first()).toBeFocused()
  await page.keyboard.press('ArrowRight')
  await expect(page.locator('.drawer .agents .agent')).toHaveCount(1)
})

test('a card that stops offering the tab steps to Overview on the read that says so', async ({
  page,
}) => {
  const agents = [agent(0)]
  await installBackend(page, { agents: () => agents })
  const stream = await installStreamDouble(page)
  await page.goto(CARD)
  await openAgents(page)
  agents.length = 0
  await stream.signal('agents')
  await expect(tabs(page)).toHaveText(WITHOUT_AGENTS)
  await expect(tabs(page).first()).toHaveAttribute('aria-selected', 'true')
  await expect(page.locator('.drawer .overview')).toBeVisible()
  await expect(page.locator('.drawer .agents')).toHaveCount(0)
})

/**
 * A card with an agent whose name is a way to another card, the one with no agents, which
 * leaves from the tab with the section as it stands. Coming back is what `then` decides.
 */
async function leftFromTheTab(page: Page, then: { agentsOnReturn: number }) {
  let left = false
  const agents = [agent(0, { label: `See ${blockedWorkItem.reference}` })]
  await installBackend(page, {
    agents: () => (left ? agents.slice(0, then.agentsOnReturn) : agents),
    card: (read) => (read.reference === blockedWorkItem.reference ? { ...read, agents: [] } : read),
  })
  await page.goto(CARD)
  const section = await openAgents(page)
  const drawer = page.locator('.drawer')
  await section.getByRole('link', { name: blockedWorkItem.reference }).click()
  await expect(drawer.locator('.head-reference')).toHaveText(blockedWorkItem.reference)
  left = true
  return drawer
}

test('another card opens on Overview, and one with no agents offers no tab', async ({ page }) => {
  const drawer = await leftFromTheTab(page, { agentsOnReturn: 1 })
  await expect(tabs(page)).toHaveText(WITHOUT_AGENTS)
  await expect(tabs(page).first()).toHaveAttribute('aria-selected', 'true')
  await expect(drawer.locator('.overview')).toBeVisible()
  await expect(drawer.locator('.inspector-panel')).toHaveAttribute(
    'aria-labelledby',
    (await tabs(page).first().getAttribute('id')) ?? '',
  )
})

test('Back returns to the tab the card was left on, before the read has said it has agents', async ({
  page,
}) => {
  const drawer = await leftFromTheTab(page, { agentsOnReturn: 1 })
  await drawer.locator('.head-back').click()
  await expect(drawer.locator('.head-reference')).toHaveText(workItemRef.reference)
  await expect(tabs(page).nth(1)).toHaveText('Agents 1')
  await expect(tabs(page).nth(1)).toHaveAttribute('aria-selected', 'true')
  await expect(drawer.locator('.agents .agent')).toHaveCount(1)
})

test('Back to a card whose agents are gone by then lands on Overview', async ({ page }) => {
  const drawer = await leftFromTheTab(page, { agentsOnReturn: 0 })
  await drawer.locator('.head-back').click()
  await expect(drawer.locator('.head-reference')).toHaveText(workItemRef.reference)
  await expect(tabs(page)).toHaveText(WITHOUT_AGENTS)
  await expect(tabs(page).first()).toHaveAttribute('aria-selected', 'true')
  await expect(drawer.locator('.overview')).toBeVisible()
})

test('news of an agent reaches an open card, with no frame of the model and no poll', async ({
  page,
}) => {
  const agents = [agent(0)]
  await installBackend(page, { agents: () => agents })
  const stream = await installStreamDouble(page)
  await page.clock.install()
  await page.goto(CARD)
  const section = await openAgents(page)
  await expect(section.locator('.agent')).toHaveCount(1)

  const reads: string[] = []
  page.on('request', (request) => {
    const { pathname } = new URL(request.url())
    if (pathname === '/api/modules/planning/work-item' || pathname.startsWith('/api/planning')) {
      reads.push(pathname)
    }
  })
  await page.clock.fastForward('05:00')
  expect(reads).toEqual([])

  agents.unshift(agent(1, { label: 'Started just now' }))
  await stream.signal('agents')
  await expect(section.locator('.agent').first()).toContainText('Started just now')
  await expect(tabs(page).nth(1)).toHaveText('Agents 2')
  // The record and the numbers of the work: the chain and the space stay as they are.
  expect(reads.toSorted()).toEqual([
    '/api/modules/planning/work-item',
    '/api/planning/work-item/usage',
  ])
})
