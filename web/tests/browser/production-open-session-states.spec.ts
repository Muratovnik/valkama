/**
 * A session's buttons as its state changes under them, in the real app with the plan's
 * route answered: what each agent row is called in every state its parent session can be
 * in, every button of one session learning together what a press found out, and a holder
 * that reads whole where the card has room for it.
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { planningWorkItemEntity } from '@/shared/api/platformPlanningRefs.ts'
import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { installBackend } from './backend.ts'
import { agentsInEveryState, openPlanFor, shortHolderCard } from './openSessionFixtures.ts'
import { projectScope, workItemRef } from './planningFixtures.ts'
import { test } from './test.ts'

const CARD = serializePlatformRoute({
  module_id: 'planning',
  scope: projectScope,
  entity: planningWorkItemEntity(workItemRef),
})

interface Opening {
  always?: string
  locale?: 'en' | 'ru'
  width?: number
}

/** The card, with its holder and one agent for each state; `lost` makes one session gone. */
async function openCard(page: Page, { always, locale = 'en', width = 1280 }: Opening = {}) {
  await page.setViewportSize({ width, height: 1200 })
  await page.addInitScript(
    ({ language, place }) => {
      localStorage.setItem('valkama-locale', language)
      if (place)
        localStorage.setItem(
          'valkama-settings',
          JSON.stringify({ sessions: { claude: { fallback: 'vscode', always: place } } }),
        )
    },
    { language: locale, place: always },
  )
  const lost = new Set<string>()
  await installBackend(page, {
    agents: agentsInEveryState,
    card: shortHolderCard,
    openPlan: (query) => {
      const answer = openPlanFor(query)
      return lost.has(query.get('session') ?? '')
        ? {
            ...answer,
            state: 'gone',
            opens: null,
            one_action: false,
            steps: [{ kind: 'explain', reason: 'gone', archived: true }],
          }
        : answer
    },
  })
  await page.goto(CARD)
  await expect(page.locator('.drawer .card-holder button.open-action')).toBeVisible()
  await page.locator('.drawer .agents-more').click()
  return { lost }
}

/** What each agent row is: its button's name, or the words that stand instead of one. */
const agentRows = (page: Page) =>
  page.locator('.drawer .agents .agent').evaluateAll((rows) =>
    rows.map((row) => {
      const button = row.querySelector('button.open-action')
      return button
        ? button.getAttribute('aria-label')
        : (row.querySelector('.open-action-still')?.textContent?.trim() ?? '')
    }),
  )

test('every agent row is called by its action and its parent session’s state', async ({ page }) => {
  await openCard(page)
  await expect(page.locator('.drawer .agents .agent')).toHaveCount(8)
  await expect
    .poll(() => agentRows(page))
    .toEqual([
      'Open the parent session in VS Code',
      'Open the parent session in Claude Desktop',
      'Open the parent session — it is running in a terminal: what can be done',
      'session gone',
      'No window · running',
      'Open the parent session in Codex',
      'session folder unknown',
      'Open the parent session — it is running in a terminal: what can be done',
    ])
})

test('in Russian an agent row is called by its action too, running or set', async ({ page }) => {
  await openCard(page, { locale: 'ru' })
  await expect
    .poll(() => agentRows(page))
    .toContain('Открыть родительскую сессию — она идёт в терминале: что можно сделать')
  for (const name of await agentRows(page)) expect(name).not.toMatch(/Сессия Открыть/u)
})

test('under "always open in" an agent row says the setting chose the place', async ({ page }) => {
  await openCard(page, { locale: 'ru', always: 'cursor' })
  await expect(page.locator('.drawer .agents button.open-action').first()).toHaveAttribute(
    'aria-label',
    'Открыть родительскую сессию в Cursor — по настройке',
  )
})
