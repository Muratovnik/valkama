/**
 * A long-running chain as the graph receives it: six hundred and nine members,
 * four in five of them closed, with the shape a real one grows into.
 *
 * The root epic closed with its 270 children done. One child led to a second
 * epic, still open, that collected 240 items of its own (90 open); another led to
 * a follow-up epic that has closed while 3 of its 12 children are still open; a
 * third led to an epic that closed with all 8 of its children done; and 76 more
 * items (26 open) were discovered from the root's children and filed under no
 * epic. That is 609 members: 489 closed and 120 open.
 *
 * Built rather than written out, so the counts above are arithmetic a reader can
 * check, and so a test can ask what the default leaves out without a 609-row
 * literal.
 */
import type { GraphScope, GraphSource } from '@/widgets/work-item-graph/utils/graphLayout.ts'

import type { PlanningEdge, WorkItemBrief } from '@/shared/api/planningModel.ts'

const OPEN = { state_id: 'todo', key: 'todo', name: 'Todo', category: 'queued', is_terminal: false }
const DONE = {
  state_id: 'done',
  key: 'done',
  name: 'Done',
  category: 'completed',
  is_terminal: true,
}

const identity = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

function brief(
  n: number,
  closed: boolean,
  parent: string | null,
  container = false,
): WorkItemBrief {
  return {
    work_item_id: identity(n),
    planning_space_id: 'space-1',
    reference: `LONG-${n}`,
    number: n,
    title: `Chain item ${n}`,
    kind: container ? 'epic' : 'task',
    priority: 'medium',
    state: closed ? DONE : OPEN,
    claim_ref: '',
    claim_state: null,
    parent_id: parent,
    container,
    ready: !closed,
    labels: [],
    source: '',
    checklist: [],
    revision: 0,
    created_at: '2026-10-01T10:00:00Z',
    updated_at: '2026-10-01T10:00:00Z',
    comment_count: 0,
  } as WorkItemBrief
}

/** `count` items under `parent`, the first `open` of them still open. */
function batch(start: number, count: number, open: number, parent: string | null) {
  return Array.from({ length: count }, (_, index) => brief(start + index, index >= open, parent))
}

export function longChainSpace(): {
  closedEpic: WorkItemBrief
  doneEpic: WorkItemBrief
  openEpic: WorkItemBrief
  root: WorkItemBrief
  scope: GraphScope
  source: GraphSource
} {
  const root = brief(1, true, null, true)
  const children = batch(10, 270, 0, root.work_item_id)
  const openEpic = brief(2, false, null, true)
  const second = batch(1000, 240, 90, openEpic.work_item_id)
  const closedEpic = brief(3, true, null, true)
  const followUps = batch(2000, 12, 3, closedEpic.work_item_id)
  const doneEpic = brief(4, true, null, true)
  const finished = batch(2100, 8, 0, doneEpic.work_item_id)
  const loose = batch(3000, 76, 26, null)
  const members = [
    ...children,
    openEpic,
    ...second,
    closedEpic,
    ...followUps,
    doneEpic,
    ...finished,
    ...loose,
  ]
  const discovered = (from: WorkItemBrief, to: WorkItemBrief): PlanningEdge => ({
    from: from.work_item_id,
    to: to.work_item_id,
    kind: 'discovered-from',
  })
  const edges: PlanningEdge[] = [
    discovered(openEpic, children[0]),
    discovered(closedEpic, children[1]),
    discovered(doneEpic, children[3]),
    ...loose.map((item, index) => discovered(item, children[(index * 7) % children.length])),
    ...second.slice(0, 80).flatMap((item, index) =>
      index % 2 === 0
        ? [
            {
              from: item.work_item_id,
              to: second[index + 1].work_item_id,
              kind: 'blocks' as const,
            },
          ]
        : [],
    ),
    // Every item of the second wave and of the follow-ups was found while doing
    // an earlier one, which is what makes the chain one graph rather than many.
    ...second.map((item, index) =>
      discovered(item, index < 160 ? children[(index * 3) % children.length] : second[index - 160]),
    ),
    ...followUps.map((item, index) => discovered(item, children[100 + index])),
    ...finished.map((item, index) => discovered(item, children[120 + index])),
  ]
  // An item outside the chain, linked to it, which no scope of the chain draws.
  const outside = brief(9000, false, null)
  edges.push(discovered(outside, children[2]))
  return {
    root,
    openEpic,
    closedEpic,
    doneEpic,
    source: { nodes: [root, ...members, outside], edges },
    scope: {
      kind: 'chain',
      epicId: root.work_item_id,
      members: members.map((item) => item.work_item_id),
    },
  }
}
