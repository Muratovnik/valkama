/**
 * The space the board suite serves: a goal with work in every state, a goal
 * with nothing under it yet, a closed goal and loose work under no goal. Titles
 * are long where a lane head must shorten them.
 *
 * The double's own placement is here too, written from the contract rather than
 * taken from the client, so the order a test expects after a move is the
 * server's answer and not the board's guess.
 */
import type { WorkItemBrief } from '@/shared/api/planningModel.ts'

import { planningReadModel } from './planningFixtures.ts'

const identity = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
export const [BACKLOG, DEV, DONE] = planningReadModel.workflow.states.map(
  ({ position: _position, ...state }) => state,
)
type State = typeof BACKLOG

// These two titles keep the length, and no prefix drawn wider, of the titles the lane headings'
// base was measured with (`laneHeadBase.ts`), which that base counts the letters of.
export const LONG_GOAL =
  'Board lanes: read the space by chain, with each lane’s open and closed work counted where its lane begins'
const EMPTY_GOAL =
  'An idea opened yesterday and given nothing yet, titled long enough to need an ellipsis at every width'

function brief(
  number: number,
  state: State,
  title: string,
  extra: Partial<Omit<WorkItemBrief, 'state'>> = {},
) {
  return {
    ...planningReadModel.work_items[1],
    work_item_id: identity(number),
    reference: `MAIN-${number}`,
    number,
    title,
    state,
    priority: 'medium',
    claim_ref: '',
    claim_state: null,
    parent_id: null,
    open: !state.is_terminal,
    workable: state === BACKLOG,
    revision: 1,
    ...extra,
  }
}

export type Brief = ReturnType<typeof brief>

const under = (goal: number) => ({ parent_id: identity(goal) })
/**
 * When finished work closed, a day of October 2026. The space lists it in the
 * order of work, so the Done column's own order is not the list's.
 */
const closedOn = (day: number) => ({
  closed_at: `2026-10-${String(day).padStart(2, '0')}T10:00:00Z`,
})

/** The space in the order of work: the order a read of it lists, state by state. */
export function boardSpace(): Brief[] {
  return [
    brief(401, DEV, LONG_GOAL, { kind: 'goal', workable: false }),
    brief(402, BACKLOG, 'Persist the order of a column', under(401)),
    brief(403, BACKLOG, 'Place new work at the end of its state', under(401)),
    brief(404, BACKLOG, 'Take the next ready item by its place', under(401)),
    brief(405, DEV, 'Move a tile from the keyboard', under(401)),
    brief(406, DONE, 'Fold a lane with nothing open', { ...under(401), ...closedOn(21) }),
    brief(410, BACKLOG, EMPTY_GOAL, { kind: 'goal', workable: false }),
    brief(420, DONE, 'The first board', {
      kind: 'goal',
      workable: false,
      ...closedOn(5),
    }),
    brief(421, DONE, 'Columns by workflow state', { ...under(420), ...closedOn(3) }),
    brief(422, DONE, 'Drag between columns', { ...under(420), ...closedOn(25) }),
    // More labels than a column's line holds, so the line has a count to make room for.
    brief(430, BACKLOG, 'Loose work under no goal', {
      labels: ['agent-packets', 'coordinator', 'decision-review', 'ui'],
      projects: [],
    }),
  ]
}

/** Where `rank` puts an item among the items of `state`, in a flat list grouped later. */
export function insertAt(items: Brief[], state: State, rank: unknown) {
  const peers = items.flatMap((item, at) => (item.state.key === state.key ? [at] : []))
  const anchor = typeof rank === 'string' ? /^(before|after):(.+)$/u.exec(rank) : null
  if (anchor) {
    const at = items.findIndex((item) => item.reference === anchor[2])
    return anchor[1] === 'before' ? at : at + 1
  }
  if (rank === 'first' && peers.length) return peers[0]
  return peers.length ? (peers.at(-1) ?? 0) + 1 : items.length
}

/** The chain of MAIN-401 as the server answers it: its children, in the order of work. */
export function chainOf(space: Brief[]) {
  const order = [
    'active',
    'review',
    'ready',
    'triage',
    'deferred',
    'blocked',
    'completed',
    'cancelled',
  ]
  const members = space
    .filter((item) => item.parent_id === identity(401))
    .map((item, index) => ({ item, index }))
    .sort(
      (left, right) =>
        order.indexOf(left.item.state.category) - order.indexOf(right.item.state.category) ||
        left.index - right.index,
    )
    .map(({ item }) => item)
  const closed = members.filter((item) => item.state.is_terminal).length
  return {
    root: {
      work_item_id: identity(401),
      reference: 'MAIN-401',
      title: LONG_GOAL,
      kind: 'goal' as const,
      has_children: true,
      totals: { chain: members.length, tree: members.length },
    },
    scope: 'chain' as const,
    total: members.length,
    closed,
    open: members.length - closed,
    workable: members.filter((item) => item.workable).length,
    by_category: {},
    by_container_state: {},
    origins: [
      {
        parent_reference: 'MAIN-401',
        parent_title: null,
        count: members.length,
        open: members.length - closed,
      },
    ],
    series: [{ day: '2026-10-20', created: 5, closed: 1, total: 5, closed_total: 1 }],
    recent: { days: 7, created: 5, closed: 1, trend: 'steady' as const },
    members: members.map((item, index) => ({
      work_item_id: item.work_item_id,
      reference: item.reference,
      title: item.title,
      kind: item.kind,
      state: {
        key: item.state.key,
        name: item.state.name,
        category: item.state.category,
        is_terminal: item.state.is_terminal,
      },
      open: item.open,
      container_state: item.container_state,
      claim_ref: '',
      claim_state: null,
      parent_reference: 'MAIN-401',
      created_at: '2026-10-20T10:00:00Z',
      closed_at: item.state.is_terminal ? '2026-10-21T10:00:00Z' : null,
      workable: item.workable,
      rank: index + 1,
    })),
    edges: [],
  }
}
