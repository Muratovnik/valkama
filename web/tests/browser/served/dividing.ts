/**
 * What the dividing specs open: the space with the goal MAIN-330 in it, the card's task under
 * that goal with a condition done and two open, the same task once a part took one of them, and
 * the task once it is a stage with nothing under it or out of its goal.
 */
import { identity, now, workItemRef } from '../planningFixtures.ts'
import { backendRoutes } from '../servedRoutes.ts'
import type { DrivenRoutes } from '../servedRoutes.ts'

type Read = Record<string, unknown>

export const GOAL = { id: identity(330), reference: 'MAIN-330', title: 'Alerts reach everyone' }
/** The part a split files, as the server numbers it. */
export const PART = 'MAIN-331'

/** The space's read with the goal among its rows, and the card's task under it or not. */
const withGoal = (model: Read, placed: boolean) => {
  const rows = model.work_items as Read[]
  const goal = {
    ...rows[0],
    work_item_id: GOAL.id,
    reference: GOAL.reference,
    number: 330,
    title: GOAL.title,
    kind: 'goal',
    state: null,
    container_state: 'in_progress',
    acceptance: { basis: 'owner', at: now },
    claim_ref: '',
    claim_state: null,
    parent_id: null,
    labels: [],
    source: '',
    checklist: [],
  }
  const under = (row: Read) => ({
    ...row,
    parent_id: placed && row.reference === workItemRef.reference ? GOAL.id : row.parent_id,
  })
  return { ...model, work_items: [...rows.map((row) => under(row)), goal] }
}
/** The space with the card's task under the goal. */
export const goalSpace = (model: Read) => withGoal(model, true)
/** The space once the card's task left the goal for the top level. */
export const leftSpace = (model: Read) => withGoal(model, false)

const step = (n: number, text: string, change: object = {}) => ({
  id: identity(740 + n),
  text,
  done: false,
  claimed_by: '',
  done_by: '',
  by_previous_holder: false,
  ...change,
})

/** A condition done and two still open, the last long enough to wrap at a phone's width. */
export const CONDITIONS = [
  step(1, 'Every channel delivers', { done: true, done_by: 'worker-a' }),
  step(2, 'The tray names what failed'),
  step(3, 'Saving the alert settings survives a restart of the desktop shell and of the service'),
]

/** The card's task under the goal, nobody holding it. */
export const placedCard = (read: Read) => ({
  ...read,
  parent_id: GOAL.id,
  parent: GOAL.reference,
  claim_ref: '',
  claim_state: null,
  claim: null,
  checklist: CONDITIONS,
})

/** The task once the part took its last condition: what stays, and where that one went. */
export const splitCard = (read: Read) => ({
  ...placedCard(read),
  checklist: CONDITIONS.slice(0, 2),
  conditions_changed: { removed: [], moved: [{ to: PART, count: 1 }] },
})

/** The task as a stage of the goal: accepted, deriving its state, its conditions kept. */
export const stageCard = (read: Read) => ({
  ...placedCard(read),
  kind: 'stage',
  state: null,
  container_state: 'not_started',
  acceptance: { basis: 'owner', at: now },
})

/** The task moved out of the goal: at the top level, in the workflow's triage state. */
export const movedOutCard = (read: Read) => ({
  ...placedCard(read),
  parent_id: null,
  parent: null,
  state: {
    state_id: identity(900),
    key: 'backlog',
    name: 'Backlog',
    category: 'triage',
    is_terminal: false,
  },
})

export const routes: DrivenRoutes[] = [
  backendRoutes('{ space: goalSpace, card: placedCard }', { space: goalSpace, card: placedCard }),
  backendRoutes('{ space: goalSpace, card: splitCard }', { space: goalSpace, card: splitCard }),
  backendRoutes('{ space: goalSpace, card: stageCard }', { space: goalSpace, card: stageCard }),
  backendRoutes('{ space: leftSpace, card: movedOutCard }', {
    space: leftSpace,
    card: movedOutCard,
  }),
]
