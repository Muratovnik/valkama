import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { planningWorkItemEntity } from '@/shared/api/platformPlanningRefs.ts'
import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { installBackend } from './backend.ts'
import { enableExecutionTab } from './executionFixtures.ts'
import { finishedCard, heldCard, openPlanFor, threeAgents } from './openSessionFixtures.ts'
import { spaceScope, workItemRef } from './planningFixtures.ts'

/**
 * The card with every kind of holder, in the real app with the plan's route answered, and the
 * links it asked the browser to open (`production-open-session.spec.ts`,
 * `production-open-session-clipboard.spec.ts`).
 */

const CARD = serializePlatformRoute({
  module_id: 'planning',
  scope: spaceScope,
  entity: planningWorkItemEntity(workItemRef),
})

interface Opening {
  always?: string
  closed?: boolean
  locale?: 'en' | 'ru'
  width?: number
}

export async function openCard(
  page: Page,
  { always, closed, locale = 'en', width = 1280 }: Opening = {},
) {
  await page.setViewportSize({ width, height: 1500 })
  await page.addInitScript(
    ({ always: place, language }) => {
      localStorage.setItem('valkama-locale', language)
      if (place)
        localStorage.setItem(
          'valkama-settings',
          JSON.stringify({ sessions: { claude: { fallback: 'vscode', always: place } } }),
        )
    },
    { always, language: locale },
  )
  await enableExecutionTab(page)
  await installBackend(page, {
    agents: threeAgents,
    card: closed ? finishedCard : heldCard,
    closedWith: closed ? 'It is done.' : undefined,
    openPlan: openPlanFor,
  })
  await page.goto(CARD)
  await expect(page.locator('.drawer .card-holder button.open-action')).toBeVisible()
}

export const openedLinks = (page: Page) =>
  page.evaluate(() => (window as unknown as { __opened?: string[] }).__opened ?? [])
