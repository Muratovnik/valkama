/**
 * What the closing specs open: the space in a workflow that can put work off and cancel it,
 * the card's task put off, an accepted goal at work, goals awaiting confirmation with their
 * conditions and without, a step its former holder marked, and the lists a goal's cancel is
 * refused with before and after the work under it changed.
 */
import { devState, identity, now } from '../planningFixtures.ts'
import { backendRoutes } from '../servedRoutes.ts'
import type { DrivenRoutes } from '../servedRoutes.ts'

type Read = Record<string, unknown>
type Workflow = { states: object[]; transitions: object[] }

export const LATER = {
  state_id: identity(903),
  key: 'later',
  name: 'Later',
  category: 'deferred',
  is_terminal: false,
}
export const DROPPED = {
  state_id: identity(904),
  key: 'dropped',
  name: 'Dropped',
  category: 'cancelled',
  is_terminal: true,
}

/** The space's workflow with a state to put work off in and one to cancel it in, from Dev. */
export const closingSpace = (model: Read) => {
  const workflow = model.workflow as Workflow
  return {
    ...model,
    workflow: {
      ...workflow,
      states: [...workflow.states, { ...LATER, position: 3 }, { ...DROPPED, position: 4 }],
      transitions: [
        ...workflow.transitions,
        { from: devState.state_id, to: LATER.state_id },
        { from: devState.state_id, to: DROPPED.state_id },
      ],
    },
  }
}

/** The card's task put off until a day, with why it waits. */
export const deferredCard = (read: Read) => ({
  ...read,
  state: LATER,
  claim_ref: '',
  claim_state: null,
  claim: null,
  deferred: {
    until: '2099-01-02T00:00:00Z',
    until_item: null,
    reason: 'After the release',
    since: now,
    by: { author: 'owner', session_id: null },
    reached_at: null,
  },
})

const step = (n: number, text: string, change: object = {}) => ({
  id: identity(710 + n),
  text,
  done: false,
  claimed_by: '',
  done_by: '',
  by_previous_holder: false,
  ...change,
})

/** A condition done, one still open, and one a holder whose lease lapsed ticked. */
export const CONDITIONS = [
  step(1, 'Every channel delivers', { done: true, done_by: 'worker-a' }),
  step(2, 'The tray names what failed'),
  step(3, 'Sound plays once', { done: true, done_by: 'worker-b', by_previous_holder: true }),
]

/** What closed under the goal without being done, and what left it. */
const CONFIRMATION = {
  since: now,
  steps: CONDITIONS.length,
  cancelled: [{ reference: 'MAIN-270', reason: 'Not needed: the tray covers it' }],
  moved_out: [{ reference: 'MAIN-271', reason: null }],
  asked: null,
  left_for_next_session: null,
}

/** The card's item as an accepted goal: no state of its own, no holder, what it derives. */
export const goalCard =
  (containerState: 'in_progress' | 'awaiting_confirmation', change: object = {}) =>
  (read: Read) => ({
    ...read,
    kind: 'goal',
    state: null,
    container_state: containerState,
    acceptance: { basis: 'owner', at: now },
    claim_ref: '',
    claim_state: null,
    claim: null,
    checklist: [],
    ...(containerState === 'awaiting_confirmation' ? { confirmation: CONFIRMATION } : {}),
    ...change,
  })

export const conditionsGoal = goalCard('awaiting_confirmation', {
  checklist: CONDITIONS,
  confirmation: { ...CONFIRMATION, steps: CONDITIONS.length },
})
export const descriptionGoal = goalCard('awaiting_confirmation', {
  description: 'Every channel delivers the same alert once.',
  confirmation: { ...CONFIRMATION, steps: 0 },
})

/** The card's task with a step its former holder ticked, waiting to be confirmed. */
export const markedCard = (read: Read) => ({ ...read, checklist: [CONDITIONS[2]] })

const row = (n: number, title: string, holder: string[], state = 'Dev') => ({
  reference: `MAIN-${n}`,
  title,
  kind: 'task',
  state: { key: state.toLowerCase(), name: state, category: state === 'Dev' ? 'active' : 'triage' },
  container_state: null,
  holder,
})

/** The refusal a goal's cancel answers with until `cancels` is this list's token. */
export const cancelList = (token: string, cancels: ReturnType<typeof row>[]) => ({
  error: {
    code: 'cancel_list',
    message: `Cancelling MAIN-264 closes ${cancels.length} open items under it.`,
    cancels,
    dependents: [
      {
        reference: 'MAIN-280',
        title: 'Release notes',
        kind: 'task',
        waits_on: 'MAIN-272',
        how: 'blocks',
      },
    ],
    list_token: token,
  },
})
/** The list as the window first reads it. */
export const FIRST_LIST = cancelList('0123456789abcdef', [
  row(272, 'Tray delivery', ['worker-a']),
  row(273, 'Retry after a lost connection', [], 'Backlog'),
])
/** The list once a holder changed on one row and a task was filed under the goal. */
export const CHANGED_LIST = cancelList('fedcba9876543210', [
  row(272, 'Tray delivery', ['worker-b']),
  row(273, 'Retry after a lost connection', [], 'Backlog'),
  row(274, 'Alert sound settings', []),
])

export const routes: DrivenRoutes[] = [
  backendRoutes('{ space: closingSpace }', { space: closingSpace }),
  backendRoutes('{ card: deferredCard }', { space: closingSpace, card: deferredCard }),
  backendRoutes("{ card: goalCard('in_progress') }", {
    space: closingSpace,
    card: goalCard('in_progress'),
  }),
  backendRoutes('{ card: conditionsGoal }', { space: closingSpace, card: conditionsGoal }),
  backendRoutes('{ card: descriptionGoal }', { space: closingSpace, card: descriptionGoal }),
  backendRoutes('{ card: markedCard }', { card: markedCard }),
]
