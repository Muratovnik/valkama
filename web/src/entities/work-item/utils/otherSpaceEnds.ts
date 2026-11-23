/**
 * The far end of a link with another space, as the record a view draws a card from.
 *
 * A space's read holds its own items, the items of other spaces that name its project, and
 * for every link with an end among them the other end where the read holds no item for it
 * (`other_space_ends`): its number, title, kind, state and space, and nothing else. A view
 * that draws that end — the graph, in its space's frame — draws it as it draws any card, so
 * the end is given the shape of one: what the read says, and for the rest what an item
 * nobody has touched says. It is open unless its state is a terminal one; a null state is
 * an accepted open goal or stage, or one the store could not resolve, and neither says it
 * is finished. Nothing here counts it: it is not part of the space's work.
 */
import type { PlanningReadModel, WorkItemBrief } from '@/shared/api/planningModel.ts'

type OtherSpaceEnd = NonNullable<PlanningReadModel['other_space_ends']>[number]

export function otherSpaceEndBrief(end: OtherSpaceEnd): WorkItemBrief {
  const number = Number(end.reference.slice(end.reference.lastIndexOf('-') + 1))
  return {
    work_item_id: end.work_item_id,
    planning_space_id: '',
    reference: end.reference,
    number: Number.isFinite(number) ? number : 0,
    title: end.title,
    kind: end.kind,
    priority: 'medium',
    // The end's own space names its states; its id is no state this space's workflow has.
    state: end.state ? { state_id: '', ...end.state } : null,
    open: !end.state?.is_terminal,
    container_state: null,
    acceptance: null,
    started_at: null,
    waits_for: [],
    claim_ref: '',
    claim_state: null,
    parent_id: null,
    labels: [],
    projects: [],
    other_space: end.space,
    source: '',
    checklist: [],
    revision: 0,
    created_at: '',
    updated_at: '',
    workable: false,
    withheld: [],
    lapsed_claim: null,
    comment_count: 0,
  }
}

/** Every far end the read holds, as cards. */
export const otherSpaceEndBriefs = (model: Pick<PlanningReadModel, 'other_space_ends'>) =>
  (model.other_space_ends ?? []).map((end) => otherSpaceEndBrief(end))
