/**
 * Every surface that draws a work item's title, opened on a title of the test's choosing,
 * with the element the title's words are drawn in (`production-title-surfaces.spec.ts`).
 *
 * The rule in `scripts/ui-system/title-breaks.mjs` refuses a template that writes a title as
 * text; these are the surfaces it cannot see as well as the ones it can, since a title that
 * reaches a template as an option's label, a run of the card's title or a path is not
 * written there as a title.
 */
import { expect } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import { planningWorkItemEntity } from '@/shared/api/platformPlanningRefs.ts'
import { serializePlatformRoute } from '@/shared/api/platformRoute.ts'

import { branchedChain } from '../fixtures/chainMap.ts'
import { broadSpace } from '../fixtures/graphSpaces.ts'
import { installBackend } from './backend.ts'
import { boardRoute, openList } from './boardPage.ts'
import { graphRoute, serve as serveChain, showRelations } from './chainFixtures.ts'
import { projectId, projectScope, spaceRef, workItem, workItemRef } from './planningFixtures.ts'
import { planningReadFor } from './planningReadFixture.ts'
import { held, openReported, reference, rest, SPACE } from './previewPage.ts'

const CARD = serializePlatformRoute({
  module_id: 'planning',
  scope: projectScope,
  entity: planningWorkItemEntity(workItemRef),
})

/** A read of the fixture with the fixture item's title replaced wherever it stands. */
const retitled = <Value>(value: Value, title: string) =>
  JSON.parse(JSON.stringify(value).split(workItem.title).join(title)) as Value

const withTitle = (title: string) => ({
  space: <Value>(model: Value) => retitled(model, title),
  card: <Value>(read: Value) => retitled(read, title),
})

async function openCard(page: Page) {
  await page.goto(CARD)
  const drawer = page.locator('.drawer')
  await expect(drawer.locator('.card-facts')).toBeVisible()
  return drawer
}

/** The finder's answer, one item found under `title`. */
export const routeFinder = (page: Page, title: string) =>
  page.route('**/api/modules/planning/search?*', (route) =>
    route.fulfill({
      json: {
        interface_version: 'valkama-planning-search',
        query: 'main',
        limit: 50,
        has_more: false,
        items: [
          {
            target: {
              project_id: projectId,
              space_ref: spaceRef,
              reference: workItem.reference,
              writable: true,
            },
            item: {
              work_item_id: workItem.work_item_id,
              planning_space_id: workItem.planning_space_id,
              reference: workItem.reference,
              title,
              state: { name: 'Dev' },
              claim_ref: '',
            },
          },
        ],
        coverage: [
          { project_id: projectId, space_ref: spaceRef, status: 'searched', reason: null },
        ],
      },
    }),
  )

/** The related-work picker's answer, one candidate under `title`. */
export const routePicker = (page: Page, title: string) =>
  page.route('**/api/planning/search?*', (route) =>
    route.fulfill({
      json: {
        interface_version: 'valkama-planning-api',
        work_items: [
          {
            work_item_id: '00000000-0000-4000-8000-000000000107',
            planning_space_id: workItem.planning_space_id,
            reference: 'MAIN-7',
            title,
            state: { name: 'Doing' },
            claim_ref: '',
          },
        ],
      },
    }),
  )

/** A card whose every link leads to an item under `title`. */
export const linkedTo = (title: string) => ({
  card: <Value>(read: Value) => ({
    ...read,
    links: workItem.links.map((link) => ({
      ...link,
      title,
      state_category: 'backlog',
      state_name: 'Backlog',
      is_terminal: false,
      state_unavailable: null,
    })),
  }),
})

const identity = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

/** An epic `MAIN-1` framing `MAIN-2` and `MAIN-3`, all three under `title`. */
async function serveGraph(page: Page, title: string) {
  const { model } = broadSpace()
  const item = (n: number, change: Record<string, unknown>) => ({
    ...model.work_items[0],
    work_item_id: identity(n),
    reference: `MAIN-${n}`,
    number: n,
    title,
    kind: 'task',
    container: false,
    parent_id: null,
    claim_ref: '',
    claim_state: null,
    ...change,
  })
  await installBackend(page)
  await page.route('**/api/planning?*', async (route) => {
    const response = planningReadFor(new URL(route.request().url()).searchParams)
    if (response.status === 200 && 'work_items' in response.body) {
      const body = response.body as unknown as Record<string, unknown>
      body.workflow = model.workflow
      body.work_items = [
        item(1, { kind: 'epic', container: true }),
        item(2, { parent_id: identity(1) }),
        item(3, { parent_id: identity(1) }),
      ]
      body.links = []
    }
    await route.fulfill({ status: response.status, json: response.body })
  })
  await page.goto(graphRoute({}))
  await expect(page.locator('.graph-canvas.settled')).toBeVisible()
}

/** Each surface, opened with its title `title`, and the element its words are drawn in. */
export const TITLE_SURFACES: Record<string, (page: Page, title: string) => Promise<Locator>> = {
  'the list': async (page, title) => {
    await installBackend(page, withTitle(title))
    await openList(page)
    const row = page.locator('.work-item-list tbody tr').filter({ hasText: workItemRef.reference })
    return row.locator('.list-name')
  },
  'the board': async (page, title) => {
    await installBackend(page, withTitle(title))
    await page.goto(boardRoute())
    return page.locator(`.work-item-board [data-reference="${workItemRef.reference}"] .tile-title`)
  },
  "a card's head": async (page, title) => {
    await installBackend(page, withTitle(title))
    const drawer = await openCard(page)
    return drawer.locator('.drawer-frame-name')
  },
  "a card's links": async (page, title) => {
    await installBackend(page, linkedTo(title))
    const drawer = await openCard(page)
    await drawer.getByRole('tab', { name: /Relations/iu }).click()
    return drawer.locator('.link-open .link-title').first()
  },
  'the finder': async (page, title) => {
    await installBackend(page)
    await routeFinder(page, title)
    await page.goto(boardRoute())
    await expect(page.locator('.work-item-board')).toBeVisible()
    await page.keyboard.press('Control+k')
    const dialog = page.getByRole('dialog', { name: 'Go to a task', exact: true })
    await dialog.getByRole('combobox').fill('main')
    return dialog.getByRole('option').locator('.command-title')
  },
  'the picker of related work': async (page, title) => {
    await installBackend(page)
    await routePicker(page, title)
    const drawer = await openCard(page)
    await drawer.getByRole('tab', { name: /Relations/iu }).click()
    await drawer.getByRole('button', { name: 'Add link', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Related task', exact: true })
    await dialog.getByLabel('Reference, number or title').fill('loading')
    await expect(dialog.getByRole('radio')).toHaveCount(1)
    // The reference, its dot and the title: one line of words that breaks as one.
    return dialog.locator('.result-title')
  },
  "the new task's epic list": async (page, title) => {
    const epic = <Value>(model: Value) => {
      const read = retitled(model, title) as Value & { work_items: Record<string, unknown>[] }
      read.work_items = read.work_items.map((item) =>
        item.reference === workItemRef.reference
          ? { ...item, kind: 'epic', container: true, parent_id: null }
          : item,
      )
      return read
    }
    await installBackend(page, { space: epic })
    await page.goto(boardRoute())
    await expect(page.locator('.work-item-board')).toBeVisible()
    await page
      .getByRole('button', { name: /New work item/iu })
      .first()
      .click()
    await page
      .getByRole('dialog', { name: 'New work' })
      .getByRole('combobox', { name: 'Parent' })
      .click()
    const option = page.getByRole('option').filter({ hasText: workItemRef.reference })
    return option.locator('.combo-title')
  },
  "the graph's card": async (page, title) => {
    await serveGraph(page, title)
    return page
      .locator('.flow-node-card')
      .filter({ has: page.locator('.flow-node-id').getByText('MAIN-2', { exact: true }) })
      .locator('.flow-node-title')
  },
  "the graph's frame": async (page, title) => {
    await serveGraph(page, title)
    return page.locator(`.graph-frame[data-frame="${identity(1)}"] .graph-frame-title`).first()
  },
  "a reference's card": async (page, title) => {
    const { entry } = await openReported(page, 'See MAIN-17 now.', [...SPACE, held(17, title)])
    await rest(page, reference(entry, 'MAIN-17'))
    return page.locator('.reference-preview .preview-title')
  },
  "the branch map's tip": async (page, title) => {
    await installBackend(page)
    const chain = branchedChain(
      { id: workItem.work_item_id, reference: workItemRef.reference, title },
      'MAIN',
    )
    await serveChain(page, retitledChain(chain, title))
    await page.goto(CARD)
    // The chain stands in the card's Relations.
    await showRelations(page)
    const section = page.locator('.drawer section.chain')
    const lane = section.getByRole('slider').first()
    await expect(lane).toBeVisible()
    const box = (await lane.boundingBox()) ?? { x: 0, y: 0, width: 0, height: 0 }
    // Resolved against the lane once it holds still, as the chain's own tests point at it.
    await lane.hover({ position: { x: Math.min(200, box.width / 2), y: box.height / 2 } })
    return section.locator('.branch-tip .branch-tip-title')
  },
  'a path in free text': async (page, title) => {
    const path = `docs/${title.replaceAll(' ', '-')}.md`
    const { entry } = await openReported(page, `Read ${path} now.`)
    return entry.locator('.rich-reference').filter({ hasText: path }).first()
  },
}

/** A chain whose every member is under `title`, so whichever the pointer lands on says it. */
function retitledChain<Value>(chain: Value, title: string): Value {
  return JSON.parse(
    JSON.stringify(chain).replaceAll(/"title":"[^"]*"/gu, `"title":${JSON.stringify(title)}`),
  ) as Value
}
