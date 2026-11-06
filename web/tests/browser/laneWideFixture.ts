/**
 * The board's space with a workflow wider than a desktop's board, and epics with work in the last
 * state, out of sight to the right: the lane headings that name work out of sight.
 */
import type { Page } from '@playwright/test'

import { boardSpace } from './boardFixtures.ts'
import { planningReadFor } from './planningReadFixture.ts'

/** The board's own space, read through `wideSpace`, over what `serve` answers. */
export async function serveWide(page: Page) {
  await page.route('**/api/planning?*', async (route) => {
    const response = planningReadFor(new URL(route.request().url()).searchParams)
    const model = response.body as unknown as Model
    await route.fulfill({
      status: response.status,
      contentType: 'application/json',
      body: JSON.stringify(
        response.status === 200 && 'work_items' in model
          ? wideSpace({ ...model, work_items: [...model.work_items, ...boardSpace()] })
          : model,
      ),
    })
  })
}

type Model = Record<string, unknown> & {
  work_items: Record<string, unknown>[]
  workflow: { states: Record<string, unknown>[] }
}

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

/**
 * The board's space with a workflow wider than a desktop's board, and epics with work in
 * the last state, out of sight to the right: the headings that once wrapped their hidden
 * actions, or their note of that work beside a title shown whole, onto a row of its own.
 */
function wideSpace(model: Model): Model {
  const [backlog, dev, done] = model.workflow.states
  const between = ['Review', 'Testing', 'Staging', 'Blocked'].map((name, index) => ({
    ...dev,
    state_id: id(950 + index),
    key: name.toLowerCase(),
    name,
  }))
  const states = [backlog, dev, ...between, done].map((state, position) => ({
    ...state,
    position,
  }))
  // An item names its state without the workflow's ordering.
  const blocked = Object.fromEntries(
    Object.entries(states.at(-2) ?? {}).filter(([key]) => key !== 'position'),
  )
  const [template] = model.work_items
  // One title that fits beside its counts and its note of work out of sight, and one
  // that fits only when it gives way, each with work in the last state.
  const titles = [
    'Lane heads keep their counts beside a title shown whole, at every width',
    'Lane heads that shorten a long title before they move its counts and their note of work off the line',
  ]
  const added = titles.flatMap((title, index) => [
    {
      ...template,
      work_item_id: id(491 + 2 * index),
      reference: `MAIN-${491 + 2 * index}`,
      number: 491 + 2 * index,
      title,
      kind: 'epic',
      container: true,
      parent_id: null,
    },
    {
      ...template,
      work_item_id: id(492 + 2 * index),
      reference: `MAIN-${492 + 2 * index}`,
      number: 492 + 2 * index,
      title: 'Work waiting at the far end of the board',
      state: blocked,
      parent_id: id(491 + 2 * index),
    },
  ])
  return {
    ...model,
    workflow: { ...model.workflow, states },
    work_items: [...model.work_items, ...added],
  }
}
