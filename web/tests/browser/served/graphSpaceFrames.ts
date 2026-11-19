/**
 * The records production-graph-space-frames.spec.ts serves: a goal five levels deep, its
 * deepest stage in progress and a sibling stage awaiting confirmation, a task under no goal,
 * two cards of another space that name this space's project, and the far end of a link with
 * a third space; and a link whose source the read could not read.
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

const ALPHA = { key: 'ALPHA', name: 'Alpha' }
const BETA = { key: 'BETA', name: 'Beta' }

function item(n: number, key: string | null, overrides: Partial<WorkItemBrief> = {}) {
  const state = key === null ? null : stateOf(key)
  return {
    ...model.work_items[0],
    work_item_id: identity(n),
    reference: `MAIN-${n}`,
    number: n,
    title: `Item ${n}`,
    kind: 'task' as WorkItemBrief['kind'],
    parent_id: null,
    state,
    open: !state?.is_terminal,
    container_state: null,
    acceptance: null,
    waits_for: [],
    claim_ref: '',
    claim_state: null,
    other_space: null,
    ...overrides,
  }
}

/** An accepted open goal or stage, which stands in no state and says what it derives. */
const container = (
  n: number,
  parent: number | null,
  derived: NonNullable<WorkItemBrief['container_state']>,
) =>
  item(n, null, {
    kind: parent === null ? 'goal' : 'stage',
    parent_id: parent === null ? null : identity(parent),
    title: parent === null ? 'Ship the release' : `Stage ${n}`,
    container_state: derived,
    acceptance: { basis: 'owner', at: '2026-11-01T10:00:00Z' },
  })

/** The frames' levels, from the goal down: each stage stands in the one before it. */
export const LEVELS = [1001, 1002, 1003, 1004, 1005] as const
/** The stage whose work is all done, so it waits for its confirmation: a five-digit number. */
export const AWAITING = 10_007

export const ITEMS = [
  container(1001, null, 'in_progress'),
  container(1002, 1001, 'in_progress'),
  container(1003, 1002, 'in_progress'),
  container(1004, 1003, 'in_progress'),
  container(1005, 1004, 'in_progress'),
  item(1006, 'dev', { parent_id: identity(1005), title: 'The deepest task' }),
  container(AWAITING, 1004, 'awaiting_confirmation'),
  item(1008, 'done', { parent_id: identity(AWAITING) }),
  item(1010, 'todo', { title: 'Under no goal' }),
  // Another space's cards, which name this space's project; one's goal is in its own space.
  item(41, 'todo', { reference: 'ALPHA-41', other_space: ALPHA, parent_id: identity(9040) }),
  item(42, 'todo', { reference: 'ALPHA-42', other_space: ALPHA, kind: 'goal' }),
]

/** The far end of a link with a third space, which the read holds no item for. */
export const END = {
  work_item_id: identity(7007),
  reference: 'BETA-7',
  title: 'Accept the import',
  kind: 'task',
  state: { key: 'todo', name: 'Todo', category: 'ready', is_terminal: false },
  space: BETA,
}

/** The source of a link the read could not read: no item and no end names it. */
export const UNREAD_SOURCE = identity(8003)

export const LINKS = [
  { from: identity(1006), to: END.work_item_id, kind: 'blocks' },
  { from: identity(41), to: identity(1006), kind: 'relates-to' },
  { from: identity(1010), to: identity(42), kind: 'blocks' },
  { from: UNREAD_SOURCE, to: identity(1010), kind: 'blocks', reference: 'GAMMA-3' },
].map((link) =>
  link.kind === 'blocks'
    ? {
        ...link,
        state_name: 'Todo',
        state_category: 'ready',
        is_terminal: false,
        state_unavailable: null,
        container_state: null,
      }
    : link,
)

/** The space's read: these items, links and far ends in the broad space's workflow. */
export const spaceFramesRead = (items: readonly object[] = ITEMS) => ({
  workflow: model.workflow,
  work_items: items,
  links: LINKS,
  other_space_ends: [END],
})

export const served: Served[] = [
  {
    name: 'served/graphSpaceFrames.ts',
    url: SPACE_READ,
    body: spaceModelWith(spaceFramesRead()),
  },
]
