/**
 * Two spaces in one store, and the shell's way of moving between them.
 *
 * The second space is empty, and its read can be made to wait: `hold` is asked once per
 * read and the answer goes out when what it returns settles.
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { installBackend } from './backend.ts'
import {
  dataScopeId,
  globalScope,
  planningReadModel,
  planningReadyFor,
  planningSpace,
  shellSpaceFor,
  spaceRef,
  spaceScope,
} from './planningFixtures.ts'
import { planningReadFor } from './planningReadFixture.ts'

export const SECOND_KEY = 'NEXT'
export const SECOND_TITLE = 'Second space'
const secondSpace = { data_scope_id: dataScopeId, space_key: SECOND_KEY }

const ready = (interface_version: string, payload: unknown) =>
  JSON.stringify({
    interface_version,
    scope: globalScope,
    state: { interface_version: 'valkama-ui-state', status: 'ready', payload },
  })

/** «All spaces»: both spaces, the second with nothing in it yet. */
function directory() {
  const { spaces } = planningReadyFor(spaceRef)
  return {
    spaces: [
      ...spaces,
      ...spaces.map((space) => ({
        ...space,
        space_ref: secondSpace,
        title: SECOND_TITLE,
        work_item_count: 0,
        numbers: { triage: 0, ready: 0, active: 0, waiting_owner: 0 },
      })),
    ],
    planning_spaces: [],
  }
}

/** Two spaces of one store; `hold` keeps the second's read until it settles. */
export async function serveTwoSpaces(page: Page, hold?: () => Promise<unknown>) {
  await installBackend(page)
  await page.route(
    (url) => url.pathname === '/api/platform/context',
    (route) =>
      route.fulfill({
        contentType: 'application/json',
        body: ready('valkama-context', {
          primary: { data_scope_id: dataScopeId, is_writable: true },
          spaces: [shellSpaceFor(spaceRef), { ...shellSpaceFor(secondSpace), name: SECOND_TITLE }],
          ui_prefs: null,
        }),
      }),
  )
  await page.route(
    (url) => url.pathname === '/api/platform/planning',
    (route) =>
      route.fulfill({
        contentType: 'application/json',
        body: ready('valkama-planning', directory()),
      }),
  )
  await page.route('**/api/planning?*', async (route) => {
    const query = new URL(route.request().url()).searchParams
    if (query.get('space_key') === SECOND_KEY) {
      await hold?.()
      const space = { ...planningSpace, key: SECOND_KEY, name: SECOND_TITLE }
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          ...planningReadModel,
          planning_spaces: [{ ...planningReadModel.planning_spaces[0], ...space }],
          planning_space: space,
          work_items: [],
          links: [],
        }),
      })
      return
    }
    const response = planningReadFor(query)
    await route.fulfill({
      status: response.status,
      contentType: 'application/json',
      body: JSON.stringify(response.body),
    })
  })
}

export const firstSpace = (state?: Record<string, string | boolean>) =>
  serializePlatformRoute({ module_id: 'planning', scope: spaceScope, state })

/** Choose a place in the shell's space choice, by its name or key. */
export async function chooseScope(page: Page, name: string) {
  await page.locator('.operating-scope [role="combobox"]').click()
  await page.getByRole('option', { name: new RegExp(name, 'u') }).click()
}

export const inSecond = async (page: Page) => {
  await expect(page).toHaveURL(
    new RegExp(`/modules/planning/space/${dataScopeId}/${SECOND_KEY}(\\?|$)`, 'u'),
  )
  await expect(page.locator('.operating-scope [role="combobox"]')).toContainText(SECOND_KEY)
}
