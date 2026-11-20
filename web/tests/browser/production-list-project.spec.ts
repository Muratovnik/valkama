/**
 * «Project» in the built list, on a space of two projects with «All projects» chosen,
 * at the list's widths. Where the list stands every column it names what each row
 * changes after «Goal and stage»; narrower it folds with that column and follows the
 * path on the line under the title. At 1270px of list, the narrowest that stands both,
 * the title keeps 36 characters beside both at their widest in either language, and nothing
 * is pushed past the edge.
 */
import { expect } from '@playwright/test'
import type { Page, TestInfo } from '@playwright/test'

import { installBackend } from './backend.ts'
import { boardRoute, shot } from './boardPage.ts'
import { brief, identity, longRead, stateOf, stillFrames } from './longSpace.ts'
import { expectNoSilentClipping } from './overflow.ts'
import { planningSpace, projectId } from './planningFixtures.ts'
import { spaceAnswer } from './servedAnswers.ts'
import { test } from './test.ts'

const BETA = 'beta-project'
const named = (id: string, name: string) => ({
  project_id: id,
  display_name: name,
  source: 'named',
})
// Names past the column's measure, so the widest the column gets is what the title is left.
const EXAMPLE_NAME = 'Example Project of the Workspace Tools'
const BETA_NAME = 'Beta Project of the Service Library'
const GOAL = 'Launch the public beta of the service'
const EXAMPLE = named(projectId, EXAMPLE_NAME)
const BETA_NAMED = named(BETA, BETA_NAME)

/** A goal with a task naming one project; work naming both, the other and none. */
const items = [
  brief(1, stateOf(1), { kind: 'goal', title: GOAL, projects: [EXAMPLE] }),
  brief(2, stateOf(1), { parent_id: identity(1), projects: [EXAMPLE] }),
  brief(3, stateOf(1), { projects: [EXAMPLE, BETA_NAMED] }),
  brief(4, stateOf(2), { projects: [BETA_NAMED] }),
  brief(5, stateOf(1)),
]

async function open(page: Page, width: number, locale = 'en') {
  await page.addInitScript((chosen) => localStorage.setItem('valkama-locale', chosen), locale)
  await page.setViewportSize({ width, height: 800 })
  await installBackend(page)
  await page.route('**/api/planning?*', async (route) => {
    await route.fulfill(
      spaceAnswer(new URL(route.request().url()).searchParams, {
        ...longRead(items),
        planning_space: {
          ...planningSpace,
          projects: [
            { ...planningSpace.projects[0], display_name: EXAMPLE_NAME },
            { project_id: BETA, display_name: BETA_NAME, root: 'C:/beta', default: false },
          ],
        },
      }),
    )
  })
  await page.goto(boardRoute({ view: 'list', sort: 'reference' }))
  await expect(page.locator('.work-item-list tbody tr.list-row').first()).toBeVisible()
  await stillFrames(page)
}

const list = (page: Page) => page.locator('.work-item-list')
const rowOf = (page: Page, reference: string) =>
  list(page)
    .locator('tbody tr.list-row:not(.list-row-held)')
    .filter({
      has: page.locator(`[data-reference="${reference}"]`),
    })

/** Nothing past the list's right edge, nothing cut without its hover; and the screenshot. */
async function heldToEdge(page: Page, width: number, info: TestInfo) {
  const overflow = await list(page).evaluate((element) => element.scrollWidth - element.clientWidth)
  expect(overflow, 'nothing is pushed past the right edge').toBeLessThanOrEqual(0)
  await expectNoSilentClipping(page, `the list with «Project» at ${width}px`)
  await page.screenshot(shot(info, `list-project-${width}.png`))
}

test('«Project» stands after «Goal and stage» at 1600px and names what each row changes', async ({
  page,
}, info) => {
  await open(page, 1600)
  await expect(list(page)).toHaveAttribute('data-fit', 'full')
  const heads = list(page).locator('thead th .list-sort:not(.folded)')
  await expect(heads.nth(2)).toHaveText('Goal and stage')
  await expect(heads.nth(3)).toHaveText('Project')
  await expect(
    list(page).locator('tbody tr.list-row:not(.list-row-held) .list-project'),
  ).toHaveText([EXAMPLE_NAME, EXAMPLE_NAME, 'Several projects', BETA_NAME, '—'])
  await heldToEdge(page, 1600, info)
})

for (const [width, fit] of [
  [1280, 'wide'],
  [1024, 'medium'],
  [390, 'narrow'],
] as const) {
  test(`«Project» at ${width}px follows the path under the title`, async ({ page }, info) => {
    await open(page, width)
    await expect(list(page)).toHaveAttribute('data-fit', fit)
    await expect(list(page).locator('.list-project')).toHaveCount(0)
    // Folded, it follows the path on the line under the title; work naming none says nothing.
    const facts = rowOf(page, 'MAIN-2').locator('.list-facts').first()
    await expect(facts.locator('.list-fact').first()).toHaveText(GOAL)
    await expect(facts).toContainText(EXAMPLE_NAME)
    await expect(rowOf(page, 'MAIN-3').locator('.list-facts').first()).toContainText(
      'Several projects',
    )
    await expect(rowOf(page, 'MAIN-5').locator('.list-title')).not.toContainText('—')
    await heldToEdge(page, width, info)
  })
}

// In both languages: beside «Conditions» the title of a list 1240px wide kept 34.2 characters
// in English and 32.8 in Russian.
for (const [locale, goal, project] of [
  ['en', 'Goal and stage', 'Project'],
  ['ru', 'Цель и этап', 'Проект'],
] as const)
  test(`from 1270px «Project» stands beside «Goal and stage», and the title keeps 36 characters in ${locale}`, async ({
    page,
  }, info) => {
    await open(page, 1600, locale)
    // Both at their widest: the names run past the column's measure.
    const sized = async (width: number) => {
      await list(page).evaluate((element, inline) => {
        element.style.inlineSize = `${inline}px`
      }, width)
      return list(page).evaluate((element) => {
        const title = element.querySelector<HTMLElement>(
          'tbody tr.list-row:not(.list-row-held) .list-title',
        )
        const probe = document.createElement('span')
        probe.style.cssText = 'position:absolute;visibility:hidden;inline-size:1ch'
        title?.append(probe)
        const characters =
          (title?.getBoundingClientRect().width ?? 0) / probe.getBoundingClientRect().width
        probe.remove()
        return { characters, overflow: element.scrollWidth - element.clientWidth }
      })
    }
    const room = await sized(1270)
    await expect(list(page)).toHaveAttribute('data-fit', 'full')
    const heads = list(page).locator('thead th .list-sort:not(.folded)')
    await expect(heads.nth(2)).toHaveText(goal)
    await expect(heads.nth(3)).toHaveText(project)
    expect(room.characters).toBeGreaterThanOrEqual(36)
    expect(room.overflow, 'nothing is pushed past the right edge').toBeLessThanOrEqual(0)
    await page.screenshot(shot(info, `list-project-1270-of-list-${locale}.png`))
    // A pixel narrower, the two fold together and the rest of the columns stand.
    await sized(1269)
    await expect(list(page)).toHaveAttribute('data-fit', 'wide')
    await expect(list(page).locator('thead th .list-sort.folded')).toHaveText([goal, project])
  })
