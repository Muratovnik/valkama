/**
 * The records production-graph-frame-head-lines.spec.ts serves.
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
    open: true,
    container_state: null,
    acceptance: null,
    started_at: null,
    waits_for: [],
    parent_id: null,
    state: stateOf(key),
    claim_ref: '',
    claim_state: null,
    ...overrides,
  }
}

const goal = (n: number, title: string) => item(n, 'dev', { kind: 'goal', title })
const under = (parent: number, from: number, keys: readonly string[]) =>
  keys.map((key, index) => item(from + index, key, { parent_id: identity(parent) }))

/** Open goals whose titles take one, two and three lines, each over the same two tasks. */
export const TITLED = { 1: 1, 10: 2, 20: 3 } as const
export const SPACE: WorkItemBrief[] = [
  goal(1, 'Connect the release'),
  ...under(1, 2, ['todo', 'done']),
  goal(10, 'Reconcile the release notes with the installer'),
  ...under(10, 11, ['todo', 'done']),
  goal(20, 'Reconcile the release notes with what the installer actually ships to the desktop'),
  ...under(20, 21, ['todo', 'done']),
  // Folded, with every group in its counts and what the fold hides under its edge.
  goal(40, 'Crowded'),
  ...under(40, 100, [
    ...Array.from({ length: 30 }, () => 'done'),
    ...Array.from({ length: 25 }, () => 'review'),
    'blocked',
    'dev',
  ]),
  // A goal nothing was filed under, and the work under none.
  item(60, 'review', { kind: 'goal', title: 'Plan the next release' }),
  ...Array.from({ length: 3 }, (_, index) => item(400 + index, 'todo')),
]

export const AMONG_MANY: WorkItemBrief[] = [
  ...SPACE,
  ...Array.from({ length: 90 }, (_, index) => item(1000 + index, 'review', { kind: 'goal' })),
]

/** The space's read: these items in the broad space's workflow, with no links. */
export const linesSpace = (items: WorkItemBrief[]) => ({
  workflow: model.workflow,
  work_items: items,
  links: [],
})

export const served: Served[] = [
  {
    name: 'served/graphFrameHeadLines.ts SPACE',
    url: SPACE_READ,
    body: spaceModelWith(linesSpace(SPACE)),
  },
  {
    name: 'served/graphFrameHeadLines.ts AMONG_MANY',
    url: SPACE_READ,
    body: spaceModelWith(linesSpace(AMONG_MANY)),
  },
]
