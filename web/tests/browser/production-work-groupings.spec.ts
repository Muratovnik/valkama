/**
 * The Work views' groupings, order and new filter conditions in the built application,
 * at the widths the screens were drawn for: the board at a desk's and a phone's, the list
 * at a laptop's too.
 *
 * The board groups by goal, by stage or by project, and a tile under a stage names it on
 * its second line; the list groups by project as rows that fold; the view menu orders the
 * work, and a reload keeps the order; the filter keeps work waiting for my answer, work of
 * another space or none of it, a project's work and a goal's subtree. Each is read from the
 * screen, and the screen is held to its edge.
 */
import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import { boardSpace, LONG_GOAL } from './boardFixtures.ts'
import { routeState, shot } from './boardPage.ts'
import { expectNoSilentClipping } from './overflow.ts'
import { dataScopeId, planningSpace, projectId } from './planningFixtures.ts'
import { planningReadFor } from './planningReadFixture.ts'
import { openSpace, seed, WORDS } from './savedViewsPage.ts'
import { test } from './test.ts'

const BETA = 'beta-project'
const named = (id: string, name: string) => ({
  project_id: id,
  display_name: name,
  source: 'named',
})

/**
 * The board's space and four more: a stage under the long goal, a task under that stage, a
 * task naming two projects whose question waits for the answer, and a card of another space.
 */
function groupedSpace() {
  const [goal, task] = boardSpace()
  if (!goal || !task) throw new Error('the board space lost its goal')
  const stage = {
    ...goal,
    work_item_id: '00000000-0000-4000-8000-000000000440',
    reference: 'MAIN-440',
    number: 440,
    title: 'A stage of the goal',
    kind: 'stage' as const,
    parent_id: goal.work_item_id,
  }
  const card = (number: number, extra: Record<string, unknown>) => ({
    ...task,
    work_item_id: `00000000-0000-4000-8000-000000000${number}`,
    reference: `MAIN-${number}`,
    number,
    parent_id: null,
    ...extra,
  })
  return [
    ...boardSpace(),
    stage,
    card(441, {
      title: 'Work under the stage',
      parent_id: stage.work_item_id,
      // In progress, beside the stage: the goal's backlog already shows all the tiles it holds.
      state: goal.state,
      projects: [named(projectId, 'Example Project')],
    }),
    card(442, {
      title: 'Work waiting for my answer',
      projects: [named(projectId, 'Example Project'), named(BETA, 'Beta Project')],
      workable: false,
      withheld: ['question'],
      created_at: '2026-11-01T10:00:00Z',
    }),
    card(443, {
      title: 'Work of another space',
      other_space: { key: 'ALPHA', name: 'Alpha space' },
      projects: [named(projectId, 'Example Project')],
    }),
  ]
}

/** The read of the space answers with the grouped space and a second project bound to it. */
async function serveGrouped(page: Page, width: number) {
  await seed(page, 'en', width)
  await page.route('**/api/planning?*', async (route) => {
    const query = new URL(route.request().url()).searchParams
    const response = planningReadFor(query, true)
    if (
      response.status === 200 &&
      'work_items' in response.body &&
      query.get('data_scope_id') === dataScopeId
    ) {
      response.body.work_items = [...response.body.work_items, ...(groupedSpace() as never[])]
      response.body.planning_space = {
        ...planningSpace,
        projects: [
          ...planningSpace.projects,
          { project_id: BETA, display_name: 'Beta Project', root: 'C:/beta', default: false },
        ],
      } as never
    }
    await route.fulfill({
      status: response.status,
      contentType: 'application/json',
      body: JSON.stringify(response.body),
    })
  })
}

/** The references the stage draws now, sorted. */
const drawn = (page: Page) =>
  page
    .locator('.workspace-stage [data-reference]')
    .evaluateAll((nodes) =>
      [...new Set(nodes.map((node) => (node as HTMLElement).dataset.reference))].toSorted(
        (a = '', b = '') => a.localeCompare(b),
      ),
    )

const laneNames = (page: Page) =>
  page.locator('.board-lane').evaluateAll((nodes) => nodes.map((node) => node.ariaLabel ?? ''))

/** A choice of the view menu, opened and taken. */
async function inMenu(page: Page, choice: string, option: string) {
  await page.locator('.workspace-head').getByRole('button', { name: 'View', exact: true }).click()
  await page
    .getByRole('menu')
    .locator(`[data-choice="${choice}"]`)
    .getByRole('menuitemradio', { name: option, exact: true })
    .click()
  await expect(page.getByRole('menu')).toHaveCount(0)
}

/** A value of the filter's menu: a condition at once, or a facet's value through its step. */
async function filterBy(page: Page, value: string, facet?: string) {
  await page.getByRole('combobox', { name: WORDS.en.filter }).click()
  if (facet) await page.getByRole('option', { name: facet, exact: true }).click()
  await page.getByRole('option', { name: value }).first().click()
  await page.keyboard.press('Escape')
}

for (const width of [1280, 390]) {
  test(`the board groups by goal, stage and project at ${width}px`, async ({ page }, info) => {
    await serveGrouped(page, width)
    await openSpace(page, undefined, { group: 'goal' })
    // By goal: work under a stage stands in the goal's lane and names the stage under its title.
    await expect(page.locator('.tile-stage')).toHaveText('Stage MAIN-440 · A stage of the goal')
    expect(await laneNames(page)).toContain('No goal')
    expect(await laneNames(page)).toContain('Space ALPHA · Alpha space')
    await page.screenshot(shot(info, `board-goal-${width}.png`))

    await inMenu(page, 'grouping', 'By stage')
    expect(routeState(page).group).toBe('stage')
    expect(await laneNames(page)).toContain(`${LONG_GOAL} › A stage of the goal`)
    await expect(page.locator('.tile-stage')).toHaveCount(0)
    await page.screenshot(shot(info, `board-stage-${width}.png`))

    await inMenu(page, 'grouping', 'By project')
    expect(await laneNames(page)).toEqual([
      'Example Project',
      'Beta Project',
      'Several projects',
      'No project',
    ])
    await page.screenshot(shot(info, `board-project-${width}.png`))
    await page.reload()
    expect(await laneNames(page)).toEqual([
      'Example Project',
      'Beta Project',
      'Several projects',
      'No project',
    ])
    await expectNoSilentClipping(page, 'the Work header', '.workspace-head')
  })

  test(`the filter keeps what its new conditions and facets say at ${width}px`, async ({
    page,
  }, info) => {
    await serveGrouped(page, width)
    await openSpace(page)
    await page.getByRole('combobox', { name: WORDS.en.filter }).click()
    await page.screenshot(shot(info, `filter-menu-${width}.png`))
    await page.keyboard.press('Escape')

    await filterBy(page, 'Waiting for my answer')
    expect(await drawn(page)).toEqual(['MAIN-442'])
    await page.getByRole('button', { name: 'Reset', exact: true }).first().click()

    await filterBy(page, 'Beta Project', 'Project')
    expect(await drawn(page)).toEqual(['MAIN-442'])
    expect(routeState(page).proj).toBe(BETA)
    await page.getByRole('button', { name: 'Reset', exact: true }).first().click()

    await filterBy(page, 'MAIN-440 · A stage of the goal', 'Goal or stage')
    expect(await drawn(page)).toEqual(['MAIN-440', 'MAIN-441'])
    await page.screenshot(shot(info, `filter-goal-${width}.png`))
    await page.getByRole('button', { name: 'Reset', exact: true }).first().click()

    await filterBy(page, 'From another space')
    expect(await drawn(page)).toEqual(['MAIN-443'])
    // «≠» on its chip keeps every card of another space out instead.
    await page.getByRole('button', { name: 'Is not: From another space' }).click()
    expect(await drawn(page)).not.toContain('MAIN-443')
    expect(routeState(page).elsewhere).toBe('%-other')
    await page.reload()
    expect(await drawn(page)).not.toContain('MAIN-443')
    await expect(page.getByText('Not from another space')).toBeVisible()
  })
}

for (const width of [1280, 1024, 390]) {
  test(`the list groups by project and keeps its order across a reload at ${width}px`, async ({
    page,
  }, info) => {
    await serveGrouped(page, width)
    await openSpace(page, undefined, { view: 'list' })
    await inMenu(page, 'grouping', 'By project')
    const groups = page.locator('tbody tr[data-id^="group:"] .list-group-name')
    await expect(groups).toHaveText([
      'Example Project',
      'Beta Project',
      'Several projects',
      'No project',
    ])
    await page.screenshot(shot(info, `list-project-${width}.png`))

    // A group folds from the keyboard as a goal's row does, and opens again.
    const several = page.locator('tbody tr[data-id="group:projects:several"]')
    await several.focus()
    await page.keyboard.press('ArrowLeft')
    await expect(several).toHaveAttribute('aria-expanded', 'false')
    await expect(page.locator('tbody tr[data-reference="MAIN-442"]')).toHaveCount(0)
    await page.keyboard.press('Enter')
    await expect(several).toHaveAttribute('aria-expanded', 'true')

    await inMenu(page, 'grouping', 'No grouping')
    await inMenu(page, 'sort', 'Created')
    await inMenu(page, 'direction', 'Newest first')
    expect(routeState(page)).toMatchObject({ view: 'list', sort: 'created', desc: true })
    const first = page.locator('tbody .list-open').first()
    await expect(first).toHaveText('MAIN-442')
    await page.reload()
    await expect(first).toHaveText('MAIN-442')
    await page.locator('.workspace-head').getByRole('button', { name: 'View', exact: true }).click()
    await expect(
      page.getByRole('menu').getByRole('menuitemradio', { name: 'Created', exact: true }),
    ).toHaveAttribute('aria-checked', 'true')
    await page.keyboard.press('Escape')
    await expectNoSilentClipping(page, 'the Work header', '.workspace-head')
  })
}
