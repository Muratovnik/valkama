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
import {
  agentsInEveryState,
  CRASHED,
  IN_VSCODE,
  openPlanFor,
  shortHolderCard,
} from './openSessionFixtures.ts'
import { projectScope, workItemRef } from './planningFixtures.ts'
import { test } from './test.ts'

const CARD = serializePlatformRoute({
  module_id: 'planning',
  scope: projectScope,
  entity: planningWorkItemEntity(workItemRef),
})

interface Opening {
  always?: string
  /** Where the page's clock starts, installed before the page loads. */
  clock?: string
  locale?: 'en' | 'ru'
  width?: number
}

/** The card, with its holder and one agent for each state; `lost` makes one session gone. */
async function openCard(page: Page, { always, clock, locale = 'en', width = 1280 }: Opening = {}) {
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
  if (clock) await page.clock.install({ time: new Date(clock) })
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

test('a press that finds the session gone tells every button of it, and keeps focus', async ({
  page,
}) => {
  const { lost } = await openCard(page)
  const head = page.locator('.drawer .card-holder')
  const firstAgent = page.locator('.drawer .agents .agent').first()
  await expect(firstAgent.locator('button.open-action')).toContainText('VS Code · running')
  lost.add(IN_VSCODE)

  await head.locator('button.open-action').focus()
  await page.keyboard.press('Enter')
  await expect(
    page.getByRole('status').filter({ hasText: 'The client no longer has this session.' }),
  ).toHaveCount(1)
  // The holder and the agent whose parent is the same session say it at once.
  await expect(head.locator('.open-action-still')).toContainText('session gone')
  await expect(firstAgent.locator('.open-action-still')).toContainText('session gone')
  await expect(firstAgent.locator('button.open-action')).toHaveCount(0)
  // Another session's row is left as it was.
  await expect(page.locator('.drawer .agents .agent').nth(1)).toContainText('Claude Desktop')
  // Focus stays on the holder, now on the way to why it opens nothing.
  await expect(head.locator('.open-action-why')).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('tooltip')).toContainText('The client no longer has this session.')
})

for (const locale of ['en', 'ru'] as const)
  for (const width of [1500, 390])
    test(`the holder reads whole beside a place the setting chose, ${width}px in ${locale}`, async ({
      page,
    }) => {
      await openCard(page, { always: 'claude-desktop', locale, width })
      const head = page.locator('.drawer .card-holder button.open-action')
      await expect(head).toContainText(locale === 'en' ? 'by your setting' : 'по настройке')
      const name = head.locator('.open-action-name')
      await expect(name).toHaveText('claude · 6f1c2a8e-0000')
      const cut = await name.evaluate((node) => node.scrollWidth > node.clientWidth)
      expect(cut, 'the holder’s name is cut').toBe(false)
      // Nothing of the card reaches past the drawer's edge on a phone either.
      const edges = await head.evaluate((node) => {
        const drawer = node.closest('.drawer')?.getBoundingClientRect()
        return { right: node.getBoundingClientRect().right, edge: drawer?.right ?? 0 }
      })
      expect(edges.right).toBeLessThanOrEqual(edges.edge)
    })

// The session fell silent at 09:15 on the 10th: 2 days 23 hours before the clock's 08:30
// on the 13th, which is 2.97 days and no «2 days».
for (const [locale, silent] of [
  ['en', ', 2\u{A0}d 23\u{A0}h ago. It may have crashed'],
  ['ru', ', 2\u{A0}дн. 23\u{A0}ч назад. Возможно, она упала'],
] as const)
  test(`a silent session says how long ago in the units the agents use, in ${locale}`, async ({
    page,
  }) => {
    await openCard(page, { clock: '2026-08-13T08:30:00Z', locale })
    await page.locator(`.step-holder button.open-action[title*="${CRASHED}"]`).click()
    await expect(page.locator('.open-panel')).toContainText(silent)
  })

for (const [locale, look, first, second] of [
  ['en', 'See it in VS Code:', 'Open the project window in VS Code', 'Open the session in VS Code'],
  ['ru', 'Посмотреть в VS Code:', 'Открыть окно проекта в VS Code', 'Открыть сессию в VS Code'],
] as const)
  test(`each action of a running session's panel names where it leads, in ${locale}`, async ({
    page,
  }) => {
    await openCard(page, { locale })
    await page.locator('.step-holder button.open-action').nth(1).click()
    const panel = page.locator('.open-panel')
    await expect(panel).toContainText(look)
    await expect(panel.getByRole('button')).toHaveText([first, second])
    await expect(page.getByRole('button', { name: first, exact: true })).toBeFocused()
  })
