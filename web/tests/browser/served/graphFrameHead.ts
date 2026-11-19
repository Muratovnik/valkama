/**
 * The records production-graph-frame-head.spec.ts serves.
 */
import type { WorkItemBrief } from '@/shared/api/planningModel.ts'

import { broadSpace } from '../../fixtures/graphSpaces.ts'
import { SPACE_READ, spaceModelWith } from '../servedAnswers.ts'
import type { Served } from '../servedContracts.ts'

const { model } = broadSpace()
export const identity = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

function stateOf(key: string): NonNullable<WorkItemBrief['state']> {
  const found = model.work_items.find((entry) => entry.state?.key === key)
  if (!found?.state) throw new Error(`the broad space has no item in ${key}`)
  return found.state
}

function item(n: number, key: string, overrides: Partial<WorkItemBrief> = {}): WorkItemBrief {
  return {
    ...model.work_items[0],
    work_item_id: identity(n),
    reference: `MAIN-${n}`,
    number: n,
    title: `Item ${n}`,
    kind: 'task',
    parent_id: null,
    state: stateOf(key),
    open: !stateOf(key).is_terminal,
    claim_ref: '',
    claim_state: null,
    ...overrides,
  }
}

export const LONG_TITLE =
  'Reconcile the release notes with what the installer actually ships to the desktop and to the server'

/** The longest reference the read model takes, on a card. */
export const LONG_REFERENCE = 'LONGKEYS-123456789'
/** An ordinary reference, on a card with work live on it. */
export const LIVE_REFERENCE = 'MAIN-123'

/** An open goal with two open tasks among finished ones: it starts open. */
export const OPEN = 1
/** An open goal nothing was ever filed under. */
export const EMPTY = 10
/** An open goal whose every task is finished: «Open» hides them all. */
export const FINISHED = 20
/** An open goal with so much open work that it starts folded, and every group in its counts. */
export const CROWDED = 40

function underGoal(parent: number, from: number, keys: readonly string[]): WorkItemBrief[] {
  return keys.map((key, index) => item(from + index, key, { parent_id: identity(parent) }))
}

const repeat = (key: string, count: number) => Array.from({ length: count }, () => key)

export const SPACE: WorkItemBrief[] = [
  item(OPEN, 'dev', { kind: 'goal', title: LONG_TITLE }),
  item(2, 'todo', { parent_id: identity(OPEN), reference: LONG_REFERENCE }),
  item(3, 'dev', { parent_id: identity(OPEN), reference: LIVE_REFERENCE }),
  ...underGoal(OPEN, 4, ['done', 'done', 'done']),
  item(EMPTY, 'review', { kind: 'goal', title: LONG_TITLE }),
  item(FINISHED, 'dev', { kind: 'goal', title: 'Connect the release' }),
  ...underGoal(FINISHED, 21, repeat('done', 7)),
  item(CROWDED, 'dev', { kind: 'goal', title: LONG_TITLE }),
  ...underGoal(CROWDED, 100, [
    ...repeat('done', 120),
    ...repeat('review', 12),
    ...repeat('dev', 12),
    ...repeat('blocked', 12),
    ...repeat('backlog', 30),
  ]),
  // The work under no goal, past the threshold, so it starts folded with its one button.
  ...Array.from({ length: 25 }, (_, index) => item(400 + index, 'todo')),
]

/** The same space among enough other goals that its whole field is far out. */
export const AMONG_MANY: WorkItemBrief[] = [
  ...SPACE,
  ...Array.from({ length: 90 }, (_, index) => item(1000 + index, 'review', { kind: 'goal' })),
]

/** The space's read: these items in the broad space's workflow, with work live on the third. */
export const frameHeadSpace = (items: WorkItemBrief[]) => ({
  workflow: model.workflow,
  work_items: items,
  links: [],
  live_work: { [identity(3)]: { state: 'working' } },
})

export const served: Served[] = [
  {
    name: 'served/graphFrameHead.ts SPACE',
    url: SPACE_READ,
    body: spaceModelWith(frameHeadSpace(SPACE)),
  },
  {
    name: 'served/graphFrameHead.ts AMONG_MANY',
    url: SPACE_READ,
    body: spaceModelWith(frameHeadSpace(AMONG_MANY)),
  },
]
