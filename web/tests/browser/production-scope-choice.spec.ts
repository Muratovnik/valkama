/**
 * The scope choice of the context bar: «All spaces», then a space, then — in a space with
 * more than one project — one of its projects, a project of another space standing there
 * with its space's key. What is chosen is what the board, the list and the graph show. An
 * address in the retired form, which named a project, opens nothing: it says so and offers
 * the choice of a space, and carries nothing of itself over. A space's saved views stay
 * with the space whatever the scope narrows to.
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { planningWorkItemEntity } from '@/shared/api/platformPlanningRefs.ts'
import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { installBackend } from './backend.ts'
import { requestedShot } from './keptShots.ts'
import {
  blockedWorkItem,
  dataScopeId,
  globalScope,
  planningReadModel,
  planningSpace,
  projectId,
  spaceRef,
  spaceScope,
  workItem,
  workItemRef,
} from './planningFixtures.ts'
import { planningReadFor } from './planningReadFixture.ts'
import { listed } from './savedViewsPage.ts'
import { test } from './test.ts'

const SECOND_PROJECT = 'second-project'
const SIDE = { data_scope_id: dataScopeId, space_key: 'SIDE' }

const SPACES = [
  {
    ...spaceRef,
    name: planningSpace.name,
    default_project: projectId,
    projects: [
      { project_id: projectId, display_name: 'Example Project' },
      { project_id: SECOND_PROJECT, display_name: 'Second project' },
    ],
    // A project of another space that items of this one name.
    other_space_projects: [
      { project_id: 'side-project', display_name: 'Side project', space_key: 'SIDE' },
    ],
  },
  {
    ...SIDE,
    name: 'Side space',
    default_project: 'side-project',
    projects: [{ project_id: 'side-project', display_name: 'Side project' }],
    other_space_projects: [],
  },
]

/** The view the address names, and the surface that draws it. */
const SURFACES = { kanban: '.work-item-board', list: '.work-item-list', graph: '.graph' } as const

/**
 * Two spaces, the first with two projects. The first space read whole holds both of its
 * items; narrowed to the second project it holds only the blocking one.
 */
async function serveScopes(page: Page) {
  const served = await installBackend(page, { contextSpaces: SPACES })
  await page.addInitScript(() => localStorage.setItem('valkama-locale', 'ru'))
  /** The project each read of a space narrowed to, or null for the whole space. */
  const reads: (string | null)[] = []
  await page.route('**/api/planning?*', async (route) => {
    const query = new URL(route.request().url()).searchParams
    reads.push(query.get('project'))
    const answer = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
    if (query.get('space_key') === SIDE.space_key) return answer(emptySide())
    if (query.get('project') !== SECOND_PROJECT) {
      const response = planningReadFor(query)
      return answer(response.body, response.status)
    }
    return answer({
      ...planningReadModel,
      work_items: planningReadModel.work_items.filter(
        (item) => item.reference === blockedWorkItem.reference,
      ),
      links: [],
      stale_claims: [],
    })
  })
  return { ...served, reads }
}

/** The side space, with nothing in it yet. */
function emptySide() {
  const space = { ...planningSpace, key: SIDE.space_key, name: 'Side space' }
  return {
    ...planningReadModel,
    planning_spaces: [{ ...planningReadModel.planning_spaces[0], ...space }],
    planning_space: space,
    work_items: [],
    links: [],
    stale_claims: [],
  }
}

const spaceChoice = (page: Page) => page.locator('[data-scope-choice="space"] [role="combobox"]')
const projectChoice = (page: Page) =>
  page.locator('[data-scope-choice="project"] [role="combobox"]')

async function choose(trigger: ReturnType<typeof spaceChoice>, page: Page, name: RegExp) {
  await trigger.click()
  await page.getByRole('option', { name }).click()
  await expect(page.getByRole('listbox')).toHaveCount(0)
}

for (const width of [1280, 760, 390]) {
  test.describe(`at ${width}px`, () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize({ width, height: 900 })
    })

    for (const view of ['kanban', 'list', 'graph'] as const) {
      test(`the ${view} shows the work of the scope chosen, space and then project`, async ({
        page,
      }) => {
        const { reads } = await serveScopes(page)
        await page.goto(
          serializePlatformRoute({ module_id: 'planning', scope: globalScope, state: { view } }),
        )
        await expect(spaceChoice(page)).toContainText('Все пространства')
        // «All spaces» chooses no project.
        await expect(page.locator('[data-scope-choice="project"]')).toHaveCount(0)

        await choose(spaceChoice(page), page, /^MAIN/u)
        const surface = page.locator(SURFACES[view])
        await expect(surface).toContainText(workItem.title)
        await expect(surface).toContainText(blockedWorkItem.title)
        await expect(projectChoice(page)).toContainText('Все проекты')
        await requestedShot(page, `scope-space-${view}-${width}`)

        await choose(projectChoice(page), page, /Second project/u)
        await expect(page).toHaveURL(
          new RegExp(
            `/modules/planning/space/${dataScopeId}/MAIN/project/${SECOND_PROJECT}(\\?|$)`,
            'u',
          ),
        )
        await expect(surface).toContainText(blockedWorkItem.title)
        await expect(surface).not.toContainText(workItem.title)
        expect(reads.at(-1)).toBe(SECOND_PROJECT)

        // Back to the whole space, which reads with no project.
        await choose(projectChoice(page), page, /Все проекты/u)
        await expect(surface).toContainText(workItem.title)
        expect(reads.at(-1)).toBeNull()
      })
    }

    // On a phone the workspace is under 586px and the two choices stack at one width.
    const stacked = width === 390

    test('the two choices stand in one row, or stacked at one edge on a phone, at one height', async ({
      page,
    }) => {
      await serveScopes(page)
      await page.goto(serializePlatformRoute({ module_id: 'planning', scope: spaceScope }))
      const space = await spaceChoice(page).boundingBox()
      const project = await projectChoice(page).boundingBox()
      expect(space && project).toBeTruthy()
      const [a, b] = [
        space ?? { x: 0, y: 0, width: 0, height: 0 },
        project ?? { x: 0, y: 0, width: 0, height: 0 },
      ]
      expect(Math.abs(a.height - b.height)).toBeLessThan(1)
      expect(Math.abs(a.y - b.y) < 1).toBe(!stacked)
      expect(Math.abs(a.x - b.x) < 1).toBe(stacked)
      expect(b.y >= a.y + a.height).toBe(stacked)
      expect(b.x >= a.x + a.width).toBe(!stacked)
    })

    test('the project choice stands only in a space with several projects, another space’s with its key', async ({
      page,
    }) => {
      await serveScopes(page)
      await page.goto(serializePlatformRoute({ module_id: 'planning', scope: spaceScope }))
      await expect(spaceChoice(page)).toContainText('MAIN')
      await projectChoice(page).click()
      const side = page.getByRole('option', { name: /Side project/u })
      await expect(side).toContainText('SIDE')
      await requestedShot(page, `scope-projects-${width}`)
      await page.keyboard.press('Escape')

      // A space with one project has nothing to narrow.
      await choose(spaceChoice(page), page, /^SIDE/u)
      await expect(page).toHaveURL(new RegExp(`/modules/planning/space/${dataScopeId}/SIDE`, 'u'))
      await expect(page.locator('[data-scope-choice="project"]')).toHaveCount(0)
    })

    test('an address with a project says it is unavailable, offers a space and keeps nothing of itself', async ({
      page,
    }) => {
      await serveScopes(page)
      const retired = `/modules/planning/project/${projectId}?state=${Buffer.from(JSON.stringify({ view: 'list', query: 'gateway' })).toString('base64url')}&entity=${encodeURIComponent(Buffer.from(JSON.stringify(planningWorkItemEntity(workItemRef))).toString('base64url'))}`
      await page.goto(retired)
      const recovery = page.locator('.route-recovery')
      await expect(recovery).toContainText('Недоступно')
      await expect(recovery).toContainText('Адрес с проектом больше не открывается')
      await requestedShot(page, `scope-retired-${width}`)

      await recovery.getByRole('button', { name: 'Выбрать пространство' }).click()
      await expect(page.getByRole('listbox')).toBeVisible()
      await page.getByRole('option', { name: /^MAIN/u }).click()
      await expect(page).toHaveURL(new RegExp(`/modules/planning/space/${dataScopeId}/MAIN$`, 'u'))
      await expect(page.locator('.drawer')).toHaveCount(0)
      await expect(page.locator(SURFACES.kanban)).toBeVisible()
    })

    test('a space’s saved views stay with it, narrowed to a project or not', async ({ page }) => {
      await serveScopes(page)
      // Saved as a build before spaces kept them: by the space's store and key.
      await page.addInitScript((place) => {
        const views = { [place]: [{ name: 'Columns', state: { view: 'kanban', group: 'goal' } }] }
        localStorage.setItem('valkama-settings', JSON.stringify({ views }))
      }, `${dataScopeId}:MAIN`)
      await page.goto(serializePlatformRoute({ module_id: 'planning', scope: spaceScope }))
      await expect(page.locator('[data-reference]').first()).toBeVisible()
      expect(await listed(page, 'ru')).toEqual(['Columns'])
      await choose(projectChoice(page), page, /Second project/u)
      await expect(page.locator('[data-reference]').first()).toBeVisible()
      expect(await listed(page, 'ru')).toEqual(['Columns'])
      await choose(spaceChoice(page), page, /^SIDE/u)
      expect(await listed(page, 'ru')).toEqual([])
    })
  })
}
