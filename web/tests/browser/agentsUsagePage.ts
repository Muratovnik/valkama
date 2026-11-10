/**
 * The card whose Agents tab the usage specs open, and the doubles that answer its reads: the
 * record names one agent, and the usage routes the interface really reads answer with what a
 * spec hands them.
 */
import type { Page } from '@playwright/test'

import type { ItemUsage } from '@/shared/api/planningUsageApi.ts'
import { planningWorkItemEntity } from '@/shared/api/platformPlanningRefs.ts'
import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { PARENT_SESSION, sessionUsage, usageAnswer } from '../fixtures/usage.ts'
import { installBackend } from './backend.ts'
import { projectScope, workItemRef } from './planningFixtures.ts'

export const CARD = serializePlatformRoute({
  module_id: 'planning',
  scope: projectScope,
  entity: planningWorkItemEntity(workItemRef),
})

/** The one agent the record names, the same run the read counts first. */
export const named = {
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

export async function serve(page: Page, item: ItemUsage | null, session = sessionUsage()) {
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

export async function openAgents(page: Page) {
  const tab = page.locator('.drawer .inspector-tabs').getByRole('tab', { name: /^Agents \d+$/u })
  await tab.click()
  return page.locator('.drawer .agents')
}
