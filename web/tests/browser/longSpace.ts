/**
 * A space of as many work items as a spec asks for, served in place of the
 * planning read, for the specs that measure what many rows or tiles cost and
 * how a long list behaves.
 */
import type { Page } from '@playwright/test'

import { planningReadModel } from './planningFixtures.ts'
import { planningReadFor } from './planningReadFixture.ts'

export const identity = (n: number) =>
  `00000000-0000-4000-8000-${String(5000 + n).padStart(12, '0')}`

/** A workflow of six states, as wide a board as a desktop column is narrow. */
const STATES = (
  [
    ['backlog', 'Backlog', 'backlog', false],
    ['todo', 'Todo', 'queued', false],
    ['dev', 'Dev', 'active', false],
    ['review', 'Review', 'review', false],
    ['blocked', 'Blocked', 'blocked', false],
    ['done', 'Done', 'completed', true],
  ] as const
).map(([key, name, category, terminal], position) => ({
  state_id: identity(900 + position),
  key,
  name,
  category,
  is_terminal: terminal,
  position,
}))

const workflow = {
  ...planningReadModel.workflow,
  initial_state_id: STATES[0].state_id,
  states: STATES,
  transitions: STATES.slice(1).map((state, index) => ({
    from: STATES[index].state_id,
    to: state.state_id,
  })),
}

/** An item names its state without the workflow's ordering. */
export const stateOf = (index: number) => {
  const { key, name, category, is_terminal, state_id } = STATES[index % (STATES.length - 1)]
  return { key, name, category, is_terminal, state_id }
}

export function brief(number: number, state: ReturnType<typeof stateOf>, extra: object = {}) {
  return {
    ...planningReadModel.work_items[1],
    work_item_id: identity(number),
    reference: `MAIN-${number}`,
    number,
    title: `Work item ${number} with a title long enough to take two lines`,
    state,
    kind: 'task',
    priority: 'medium',
    claim_ref: '',
    claim_state: null,
    parent_id: null,
    labels: [],
    ready: false,
    checklist: [],
    revision: 1,
    ...extra,
  }
}

/** Answer the planning read with these items, once `answered` settles. */
export async function serveSpace(
  page: Page,
  items: object[],
  links: object[] = [],
  answered: Promise<void> = Promise.resolve(),
) {
  await page.route('**/api/planning?*', async (route) => {
    await answered
    const response = planningReadFor(new URL(route.request().url()).searchParams)
    if (response.status === 200 && 'work_items' in response.body)
      Object.assign(response.body, { workflow, work_items: items, links, stale_claims: [] })
    await route.fulfill({
      status: response.status,
      contentType: 'application/json',
      body: JSON.stringify(response.body),
    })
  })
}

/** Two frames with nothing left to do: every observer has answered. */
export const stillFrames = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<void>((done) => {
        requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(done, 300)))
      }),
  )
