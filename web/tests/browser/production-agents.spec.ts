/**
 * The agents on a card, in the real app: where the section stands, what a long list
 * does at both widths, and that news of an agent reaches an open card through the
 * stream it already has.
 */
import AxeBuilder from '@axe-core/playwright'
import { expect } from '@playwright/test'

import { planningWorkItemEntity } from '@/shared/api/platformPlanningRefs.ts'
import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { installBackend } from './backend.ts'
import { expectNoSilentClipping } from './overflow.ts'
import { projectScope, workItemRef } from './planningFixtures.ts'
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

const CARD = serializePlatformRoute({
  module_id: 'planning',
  scope: projectScope,
  entity: planningWorkItemEntity(workItemRef),
})

for (const width of [1440, 390]) {
  test(`a long list of agents stands folded and whole at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    const agents = Array.from({ length: 94 }, (_, index) => agent(index))
    await installBackend(page, { agents: () => agents })
    await page.goto(CARD)
    const section = page.locator('.drawer .agents')
    await expect(section.locator('.agent')).toHaveCount(3)
    await expect(section.locator('.section-header-count')).toHaveText('94')
    await expect(section.locator('.agent').first()).toContainText(LONG_LABEL)
    await expect(section.locator('.agent').first()).toContainText(
      'ambiguous: the coordinator held 19 items',
    )
    await expectNoSilentClipping(page, `agents at ${width}px`)
    // The dot between two facts is drawing: a screen reader says the facts, not it.
    expect(await section.locator('.agent').first().ariaSnapshot()).not.toContain('·')

    const toggle = section.locator('.agents-more')
    await toggle.focus()
    await page.keyboard.press('Enter')
    await expect(section.locator('.agent')).toHaveCount(94)
    await expect(section.locator('.agent').nth(3)).toBeFocused()
    await expectNoSilentClipping(page, `open agents at ${width}px`)
    const results = await new AxeBuilder({ page })
      .include('.drawer .agents')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze()
    expect(results.violations.map((violation) => violation.id)).toEqual([])
    await toggle.focus()
    await page.keyboard.press('Enter')
    await expect(section.locator('.agent')).toHaveCount(3)
    await expect(toggle).toBeFocused()
  })
}

test('a card with no agents has no section', async ({ page }) => {
  await installBackend(page)
  await page.goto(CARD)
  await expect(page.locator('.drawer .overview')).toBeVisible()
  await expect(page.locator('.drawer .agents')).toHaveCount(0)
})

test('news of an agent reaches an open card, with no frame of the model and no poll', async ({
  page,
}) => {
  const agents = [agent(0)]
  await installBackend(page, { agents: () => agents })
  const stream = await installStreamDouble(page)
  await page.clock.install()
  await page.goto(CARD)
  const section = page.locator('.drawer .agents')
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
  expect(reads).toEqual(['/api/modules/planning/work-item'])
})
