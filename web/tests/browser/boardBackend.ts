/**
 * The board specs' server for one space: it answers reads from the space's list and applies
 * the moves it is sent, so a spec and a unit test both drive the same table.
 */
import type { Page } from '@playwright/test'

import { chainResponse } from '../fixtures/chain.ts'
import { BACKLOG, boardSpace, chainOf, DEV, DONE, endOf } from './boardFixtures.ts'
import { workItem } from './planningFixtures.ts'
import { planningReadFor } from './planningReadFixture.ts'

interface Write {
  body: Record<string, unknown>
  path: string
}

/**
 * A server for one space that answers reads from its list and applies the
 * transitions it is sent, refusing a move while `refuse` is set.
 */
export async function serve(page: Page, refuse: { message: string | null } = { message: null }) {
  const space = boardSpace()
  const writes: Write[] = []
  await page.route('**/api/planning?*', async (route) => {
    const response = planningReadFor(new URL(route.request().url()).searchParams)
    if (response.status === 200 && 'work_items' in response.body)
      response.body.work_items = [...response.body.work_items, ...(space as never[])]
    await route.fulfill({
      status: response.status,
      contentType: 'application/json',
      body: JSON.stringify(response.body),
    })
  })
  const move = async (route: Parameters<Parameters<Page['route']>[1]>[0]) => {
    const path = new URL(route.request().url()).pathname
    const body = route.request().postDataJSON() as Record<string, unknown>
    writes.push({ path, body })
    if (refuse.message !== null)
      return route.fulfill({
        status: 409,
        contentType: 'application/json',
        body: JSON.stringify({ error: { code: 'conflict', message: refuse.message } }),
      })
    const at = space.findIndex((item) => item.reference === body.id)
    const [item] = space.splice(at, 1)
    const state = [BACKLOG, DEV, DONE].find((entry) => entry.key === body.state) ?? item.state
    const moved = { ...item, state, revision: item.revision + 1 }
    space.splice(endOf(space, state), 0, moved)
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        ...workItem,
        work_item_id: moved.work_item_id,
        reference: moved.reference,
        number: moved.number,
        title: moved.title,
        state: moved.state,
        parent_id: moved.parent_id,
        revision: moved.revision,
      }),
    })
  }
  await page.route('**/api/planning/work-item/update', move)
  await page.route('**/api/planning/work-item/transition', move)
  await page.route('**/api/planning/work-item/chain?*', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify(chainResponse(chainOf(space) as never)),
    }),
  )
  return writes
}
