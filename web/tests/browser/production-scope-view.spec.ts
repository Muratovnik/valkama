/**
 * A change of space keeps how the operator was looking and nothing of what they were
 * looking at. The board, the list or the graph and the board's grouping are a way of
 * looking; a filter, an open card and a chain belong to the space they were set in. The
 * browser's Back returns to that space with all of it. A card's drawer stands over the
 * scope picker, so a card open at the moment of the move is `scopeSwitch.spec.ts`'s case.
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { planningSpaceEntity, planningWorkItemEntity } from '@/shared/api/platformPlanningRefs.ts'
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
  workItemRef,
} from './planningFixtures.ts'
import { planningReadFor } from './planningReadFixture.ts'
import { test } from './test.ts'

const SECOND = 'second-project'
const SECOND_KEY = 'NEXT'
const SECOND_TITLE = 'Second Project'
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

/** Two projects, each with a space of its own. */
async function serveTwoProjects(page: Page) {
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

const firstProject = (state?: Record<string, string | boolean>) =>
  serializePlatformRoute({ module_id: 'planning', scope: projectScope, state })

/** Choose a place in the shell's scope picker. */
async function chooseScope(page: Page, name: string) {
  await page.locator('.operating-scope [role="combobox"]').click()
  await page.getByRole('option', { name: new RegExp(name, 'u') }).click()
}

const inSecond = async (page: Page) => {
  await expect(page).toHaveURL(new RegExp(`/modules/planning/project/${SECOND}(\\?|$)`, 'u'))
  await expect(page.locator('.operating-scope [role="combobox"]')).toContainText(SECOND_TITLE)
}

/** The module state the address holds, decoded. */
function addressState(page: Page): unknown {
  const state = new URL(page.url()).searchParams.get('state')
  return state === null ? null : JSON.parse(Buffer.from(state, 'base64url').toString())
}

const SURFACES = {
  graph: '.graph',
  list: '.work-item-list',
} as const

for (const view of ['graph', 'list'] as const) {
  test(`the ${view} stays open from one project to another`, async ({ page }) => {
    await serveTwoProjects(page)
    await page.goto(firstProject({ view }))
    await expect(page.locator(SURFACES[view])).toBeVisible()
    await chooseScope(page, SECOND_TITLE)
    await inSecond(page)
    await expect(page.locator(SURFACES[view])).toBeVisible()
    expect(addressState(page)).toEqual({ view })
  })

  test(`the ${view} stays open through all projects, whichever way back is taken`, async ({
    page,
  }) => {
    await serveTwoProjects(page)
    await page.goto(firstProject({ view }))
    await expect(page.locator(SURFACES[view])).toBeVisible()

    await chooseScope(page, 'Global')
    const second = page.locator('.portfolio-project').filter({ hasText: SECOND })
    await second.getByRole('button', { name: /Open project/iu }).click()
    await inSecond(page)
    await expect(page.locator(SURFACES[view])).toBeVisible()

    await chooseScope(page, 'Global')
    await expect(page.locator('.portfolio-project')).toHaveCount(2)
    await chooseScope(page, 'Example Project')
    await expect(page.locator(SURFACES[view])).toBeVisible()
    expect(addressState(page)).toEqual({ view })
  })
}

test('the board’s grouping stays from one project to another', async ({ page }) => {
  await serveTwoProjects(page)
  await page.goto(firstProject({ group: 'epic' }))
  const grouping = page.getByRole('button', { name: 'By epic' })
  await expect(grouping).toHaveAttribute('aria-pressed', 'true')
  await chooseScope(page, SECOND_TITLE)
  await inSecond(page)
  await expect(page.getByRole('button', { name: 'By epic' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  expect(addressState(page)).toEqual({ group: 'epic' })
})

test('the board stays the board, with nothing in the address', async ({ page }) => {
  await serveTwoProjects(page)
  await page.goto(firstProject())
  await expect(page.locator('.work-item-board')).toBeVisible()
  await chooseScope(page, SECOND_TITLE)
  await expect(page).toHaveURL(new RegExp(`/modules/planning/project/${SECOND}$`, 'u'))
  await expect(page.locator('.work-item-board')).toBeVisible()
})

test('a filter and a chain stay with their space, and Back finds them there', async ({ page }) => {
  await serveTwoProjects(page)
  const state = { view: 'list', query: 'gateway', ready: true }
  const left = firstProject(state)
  await page.goto(left)
  await expect(page.getByRole('combobox', { name: 'Filter work' })).toHaveValue('gateway')
  await chooseScope(page, SECOND_TITLE)
  await inSecond(page)
  expect(addressState(page)).toEqual({ view: 'list' })
  await expect(page.getByRole('combobox', { name: 'Filter work' })).toHaveValue('')

  await page.goBack()
  await expect(page).toHaveURL(left)
  await expect(page.locator('.operating-scope [role="combobox"]')).toContainText('Example Project')
  await expect(page.getByRole('combobox', { name: 'Filter work' })).toHaveValue('gateway')
  expect(addressState(page)).toEqual(state)
})

test('a card closed before the move stays closed', async ({ page }) => {
  await serveTwoProjects(page)
  const card = serializePlatformRoute({
    module_id: 'planning',
    scope: projectScope,
    entity: planningWorkItemEntity(workItemRef),
    state: { view: 'list' },
  })
  await page.goto(card)
  await expect(page.locator('.drawer')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.locator('.drawer')).toHaveCount(0)
  await chooseScope(page, SECOND_TITLE)
  await inSecond(page)
  await expect(page.locator('.drawer')).toHaveCount(0)
  expect(new URL(page.url()).searchParams.get('entity')).toBeNull()
  expect(addressState(page)).toEqual({ view: 'list' })
})

test('another module’s state is its own: a change of scope hands it nothing', async ({ page }) => {
  await serveTwoProjects(page)
  await page.goto(
    serializePlatformRoute({
      module_id: 'settings',
      scope: projectScope,
      state: { query: 'theme', view: 'graph' },
    }),
  )
  await expect(page.locator('.app-shell')).toBeVisible()
  await chooseScope(page, SECOND_TITLE)
  await expect(page).toHaveURL(new RegExp(`/modules/settings/project/${SECOND}$`, 'u'))
})
