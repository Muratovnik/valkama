/**
 * The agents on a card, in the real app: where the section stands, what a long list
 * does at both widths, and that news of an agent reaches an open card through the
 * stream it already has.
 */
import AxeBuilder from '@axe-core/playwright'
import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import { planningWorkItemEntity } from '@/shared/api/platformPlanningRefs.ts'
import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { installBackend } from './backend.ts'
import { shot } from './boardPage.ts'
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

/** The two ways a reader presses a toggle. */
const PRESSES = {
  mouse: (toggle: Locator) => toggle.click(),
  keyboard: async (toggle: Locator) => {
    await toggle.focus()
    await toggle.page().keyboard.press('Enter')
  },
}

/** How far down the page a section of the card stands, as a reader sees the order. */
async function top(page: Page, section: string) {
  const box = await page.locator(`.drawer ${section}`).boundingBox()
  if (!box) throw new Error(`${section} is not on the card`)
  return box.y
}

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

  for (const [input, press] of Object.entries(PRESSES)) {
    test(`closing a long list by ${input} at ${width}px keeps its toggle in sight`, async ({
      page,
    }, info) => {
      await page.setViewportSize({ width, height: 900 })
      const agents = Array.from({ length: 94 }, (_, index) => agent(index))
      // A long body under the list, or the drawer's scroll runs out as the list
      // shrinks and brings the toggle back by itself, which a real card does not do.
      await installBackend(page, { agents: () => agents, longRead: true })
      await page.goto(CARD)
      const section = page.locator('.drawer .agents')
      const toggle = section.locator('.agents-more')

      await press(toggle)
      await expect(section.locator('.agent')).toHaveCount(94)
      await expect(section.locator('.agent').nth(3)).toBeFocused()
      await expect(section.locator('.agent').nth(3)).toBeInViewport()

      // The toggle stands at the end of the list, so a reader closing it is far down.
      await toggle.scrollIntoViewIfNeeded()
      await press(toggle)
      await expect(section.locator('.agent')).toHaveCount(3)
      await expect(toggle).toBeFocused()
      // An observer of the viewport sees the drawer's own clip as well as the window's.
      await expect(toggle).toBeInViewport({ ratio: 1 })
      const uncovered = await toggle.evaluate((button) => {
        const { height, width: wide, x, y } = button.getBoundingClientRect()
        return button.contains(document.elementFromPoint(x + wide / 2, y + height / 2))
      })
      expect(uncovered).toBe(true)
      await page.screenshot(shot(info, `agents-closed-by-${input}-${width}.png`))
    })
  }

  test(`closing a long list while the card's body still glides keeps its toggle in sight at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 })
    const agents = Array.from({ length: 94 }, (_, index) => agent(index))
    await installBackend(page, { agents: () => agents, longRead: true })
    await page.goto(CARD)
    const section = page.locator('.drawer .agents')
    const toggle = section.locator('.agents-more')
    await PRESSES.keyboard(toggle)
    await expect(section.locator('.agent')).toHaveCount(94)

    // From the top, so the scroll a focus starts condenses the head and the body glides,
    // after the focus move that would have ended a glide already running. A key does not
    // wait for the page to hold still, as a pointer does, and this one is long enough.
    const body = page.locator('.drawer-frame-body')
    await body.evaluate((node) => node.scrollTo({ top: 0 }))
    await expect(page.locator('.drawer-frame-head.condensed')).toHaveCount(0)
    await page.addStyleTag({ content: ':root { --duration-surface: 4s }' })
    await toggle.focus()
    await expect
      .poll(() => body.evaluate((node) => node.getAnimations({ subtree: true }).length))
      .toBeGreaterThan(0)
    await page.keyboard.press('Enter')
    await expect(section.locator('.agent')).toHaveCount(3)
    await page.evaluate(() =>
      Promise.allSettled(document.getAnimations().map((animation) => animation.finished)),
    )
    await expect(toggle).toBeInViewport({ ratio: 1 })
  })

  test(`on a closed item the agents stand under its outcome at ${width}px`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height: 900 })
    const agents = Array.from({ length: 27 }, (_, index) =>
      agent(index, { ended_at: '2026-08-13T08:29:00Z' }),
    )
    await installBackend(page, { agents: () => agents, closedWith: 'The export carries no label.' })
    await page.goto(CARD)
    await expect(page.locator('.drawer .agents .agent')).toHaveCount(3)
    expect(await top(page, '.description-section')).toBeLessThan(await top(page, '.outcome'))
    expect(await top(page, '.outcome')).toBeLessThan(await top(page, '.agents'))
    await page.screenshot(shot(info, `agents-on-closed-${width}.png`))
  })

  test(`on an open item the agents stand above its description at ${width}px`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height: 900 })
    const agents = Array.from({ length: 27 }, (_, index) => agent(index))
    await installBackend(page, { agents: () => agents })
    await page.goto(CARD)
    await expect(page.locator('.drawer .agents .agent')).toHaveCount(3)
    expect(await top(page, '.agents')).toBeLessThan(await top(page, '.description-section'))
    await page.screenshot(shot(info, `agents-on-open-${width}.png`))
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
