/**
 * Two projects with a space each, and the shell's way of moving between them.
 *
 * The second project's space is empty, and its read can be made to wait: `hold`
 * is asked once per read and the answer goes out when what it returns settles.
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { planningSpaceEntity } from '@/shared/api/platformPlanningRefs.ts'
import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { installBackend } from './backend.ts'
import {
  dataScopeId,
  globalScope,
  planningReadModel,
  planningReadyFor,
  planningSpace,
  projectId,
  projectScope,
  spaceRef,
} from './planningFixtures.ts'
import { planningReadFor } from './planningReadFixture.ts'

export const SECOND = 'second-project'
const SECOND_KEY = 'NEXT'
export const SECOND_TITLE = 'Second Project'
const secondSpace = { data_scope_id: dataScopeId, space_key: SECOND_KEY }

const mapped = (project_id: string, title: string, space_key: string) => ({
  project_id,
  title,
  binding_state: 'mapped',
  resources: [
    {
      resource_ref: planningSpaceEntity({ data_scope_id: dataScopeId, space_key }),
      state: 'mapped',
    },
  ],
})

/** The scope a platform read asked for, which its answer has to repeat. */
function askedScope(url: URL) {
  const project_id = url.searchParams.get('project_id')
  return url.searchParams.get('scope_kind') === 'project' && project_id !== null
    ? { kind: 'project' as const, project_ref: { project_id } }
    : globalScope
}

const ready = (url: URL, interface_version: string, payload: unknown) =>
  JSON.stringify({
    interface_version,
    scope: askedScope(url),
    state: { interface_version: 'valkama-ui-state', status: 'ready', payload },
  })

/** The directory of both projects, and the spaces of the one asked about. */
function directory(url: URL) {
  const first = planningReadyFor(spaceRef)
  const asked = askedScope(url)
  const inSecond = asked.kind === 'project' && asked.project_ref.project_id === SECOND
  return {
    ...first,
    projects: [
      ...first.projects,
      {
        project_id: SECOND,
        title: SECOND_TITLE,
        binding_state: 'mapped',
        planning_spaces: [{ space_ref: secondSpace, title: SECOND_TITLE, work_item_count: 0 }],
      },
    ],
    planning_spaces: inSecond
      ? [{ ...first.planning_spaces[0], space_ref: secondSpace, title: SECOND_TITLE }]
      : first.planning_spaces,
  }
}

/** Two projects, each with a space of its own; `hold` keeps the second's read until it settles. */
export async function serveTwoProjects(page: Page, hold?: () => Promise<unknown>) {
  await installBackend(page)
  await page.route(
    (url) => url.pathname === '/api/platform/context',
    (route) =>
      route.fulfill({
        contentType: 'application/json',
        body: ready(new URL(route.request().url()), 'valkama-context', {
          primary: { data_scope_id: dataScopeId, is_writable: true },
          projects: [
            mapped(projectId, 'Example Project', spaceRef.space_key),
            mapped(SECOND, SECOND_TITLE, SECOND_KEY),
          ],
          ui_prefs: null,
        }),
      }),
  )
  await page.route(
    (url) => url.pathname === '/api/platform/planning',
    (route) => {
      const url = new URL(route.request().url())
      return route.fulfill({
        contentType: 'application/json',
        body: ready(url, 'valkama-planning', directory(url)),
      })
    },
  )
  await page.route('**/api/planning?*', async (route) => {
    const query = new URL(route.request().url()).searchParams
    if (query.get('project') === SECOND) {
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

export const firstProject = (state?: Record<string, string | boolean>) =>
  serializePlatformRoute({ module_id: 'planning', scope: projectScope, state })

/** Choose a place in the shell's scope picker. */
export async function chooseScope(page: Page, name: string) {
  await page.locator('.operating-scope [role="combobox"]').click()
  await page.getByRole('option', { name: new RegExp(name, 'u') }).click()
}

export const inSecond = async (page: Page) => {
  await expect(page).toHaveURL(new RegExp(`/modules/planning/project/${SECOND}(\\?|$)`, 'u'))
  await expect(page.locator('.operating-scope [role="combobox"]')).toContainText(SECOND_TITLE)
}
