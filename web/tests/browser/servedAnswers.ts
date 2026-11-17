/**
 * How a spec's records become the answers it serves, with no browser in reach.
 *
 * A helper or spec that serves its own records builds the answer with these, and the
 * module under `served/` that holds those records lists the same answers for
 * `tests/browserRecords.test.ts`: the composition is one function both of them call.
 */
import type { WorkItemBrief } from '@/shared/api/planningModel.ts'

import { dataScopeId, planningReadModel, spaceRef } from './planningFixtures.ts'
import { planningReadFor } from './planningReadFixture.ts'

/** The query the page reads the fixture's space with. */
const SPACE_QUERY = new URLSearchParams({ data_scope_id: dataScopeId, space_key: 'MAIN' })

/** That read, as a path the page asks. */
export const SPACE_READ = `/api/planning?${SPACE_QUERY}`

export type SpaceModel = typeof planningReadModel & Record<string, unknown>

/**
 * The space's read for `query`, as the backend double answers it, with `change` laid over
 * the model when the read found the space: a refusal stays the refusal it was.
 */
export function spaceAnswer(
  query: URLSearchParams,
  change: object | ((model: SpaceModel) => object),
): { json: unknown; status: number } {
  const response = planningReadFor(query)
  if (response.status !== 200 || !('work_items' in response.body))
    return { status: response.status, json: response.body }
  const model = response.body as SpaceModel
  return {
    status: 200,
    json: { ...model, ...(typeof change === 'function' ? change(model) : change) },
  }
}

/** The model a found read of the fixture's space answers, with `change` laid over it. */
export const spaceModelWith = (change: object | ((model: SpaceModel) => object)) =>
  spaceAnswer(SPACE_QUERY, change).json as SpaceModel

/** One item's read that found it, at the scope and reference it was asked for. */
export const itemAnswer = (scope: object, ref: object, item: object) => ({
  interface_version: 'valkama-planning-work-item',
  scope,
  work_item_ref: ref,
  state: { interface_version: 'valkama-ui-state', status: 'ready', payload: { work_item: item } },
})

/** A row of a space as one item's brief read carries it: its place in the queue is the list's. */
export const withoutPlace = (item: object) =>
  Object.fromEntries(Object.entries(item).filter(([key]) => key !== 'queue_order'))

/** The envelope of a brief read that found the item, at the scope of the space it was read in. */
export function briefAnswer(
  item: Partial<WorkItemBrief> & { reference: string },
  space = spaceRef,
) {
  return {
    json: itemAnswer(
      { kind: 'space', space_ref: space },
      { space_ref: space, reference: item.reference },
      withoutPlace(item),
    ),
  }
}

/** The path a card's read asks for `reference` in the fixture's space; `brief` for a preview. */
export const cardRead = (reference: string, brief = false) =>
  `/api/modules/planning/work-item?${new URLSearchParams({
    scope_kind: 'space',
    ...spaceRef,
    reference,
    ...(brief ? { brief: 'true' } : {}),
  })}`
