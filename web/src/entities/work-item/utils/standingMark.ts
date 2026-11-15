/**
 * Where an item stands, as a mark: the state it stands in, or, for an accepted open goal or
 * stage, which stands in none, what it derives from the work under it — in that state's
 * words and tone. Every surface that marks a state, and every choice of one, draws it here.
 */
import type { FacetForm, FacetMark } from '@/entities/work-item/utils/facets.ts'

import type { WorkItemBrief } from '@/shared/api/planningModel.ts'

/**
 * Where an item stands, as every surface knows it: open or not, and the state it
 * stands in, or, for an accepted open goal or stage, which stands in none, what it
 * derives from the work under it.
 */
export interface StateSubject {
  open: boolean
  state:
    | (Pick<NonNullable<WorkItemBrief['state']>, 'name' | 'category'> & {
        is_terminal?: boolean
        key?: string
      })
    | null
  container_state?: WorkItemBrief['container_state']
}

export function stateMark(
  item: Pick<StateSubject, 'container_state' | 'state'>,
  form: FacetForm,
): FacetMark {
  const { state } = item
  const value = state?.category ?? item.container_state ?? 'not_started'
  return {
    facet: 'state',
    value,
    form,
    glyph: value === 'cancelled' ? 'state-cancelled' : null,
    text: state ? { state } : { key: `workItem.containerState.${value}` },
    tone: { dimension: 'work-item-state', state: value },
    // The card's state is its transition menu, so a click there moves the
    // item; state filters come from the bar's menu instead.
    filter: null,
    quiet: false,
  }
}
