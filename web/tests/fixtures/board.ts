/**
 * A small space for the board's own tests: a four-state workflow and items built
 * by number, so a test names the item it means by the number it reads as.
 */
import type { PlanningWorkflow, WorkItemBrief } from '@/shared/api/planningModel.ts'

export const boardId = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

const STATES = [
  ['backlog', 'Backlog', 'triage', false],
  ['todo', 'Todo', 'ready', false],
  ['dev', 'Dev', 'active', false],
  ['done', 'Done', 'completed', true],
] as const

export const boardWorkflow: PlanningWorkflow = {
  workflow_id: boardId(700),
  name: 'Default',
  initial_state_id: boardId(900),
  states: STATES.map(([key, name, category, terminal], index) => ({
    state_id: boardId(900 + index),
    key,
    name,
    category,
    is_terminal: terminal,
    position: index,
  })),
  transitions: [],
}

export type BoardStateKey = (typeof STATES)[number][0]

/** The state an item names: the workflow's, without the workflow's ordering. */
export function boardState(key: BoardStateKey): NonNullable<WorkItemBrief['state']> {
  const state = boardWorkflow.states.find((entry) => entry.key === key)
  if (state === undefined) throw new Error(`no state ${key}`)
  return {
    state_id: state.state_id,
    key: state.key,
    name: state.name,
    category: state.category,
    is_terminal: state.is_terminal,
  }
}

export function boardItem(
  n: number,
  state: BoardStateKey = 'backlog',
  overrides: Partial<WorkItemBrief> = {},
): WorkItemBrief {
  return {
    work_item_id: boardId(n),
    planning_space_id: boardId(800),
    reference: `MAIN-${n}`,
    number: n,
    title: `Item ${n}`,
    kind: 'task',
    priority: 'medium',
    state: boardState(state),
    claim_ref: '',
    claim_state: null,
    parent_id: null,
    labels: [],
    source: '',
    checklist: [],
    revision: 1,
    created_at: '2026-10-30T10:00:00Z',
    updated_at: '2026-10-30T10:00:00Z',
    open: !(overrides.state ?? boardState(state)).is_terminal,
    container_state: null,
    acceptance: null,
    started_at: null,
    waits_for: [],
    workable: state === 'backlog' || state === 'todo',
    withheld: state === 'backlog' || state === 'todo' ? [] : ['not_ready'],
    comment_count: 0,
    ...overrides,
  }
}

/** A goal with children, as the read model says one: a container of kind goal. */
export function boardGoal(
  n: number,
  state: BoardStateKey = 'dev',
  overrides: Partial<WorkItemBrief> = {},
) {
  return boardItem(n, state, {
    kind: 'goal',
    workable: false,
    withheld: ['container'],
    ...overrides,
  })
}

/** References in the order they are listed. */
export const references = (items: readonly WorkItemBrief[]) => items.map((item) => item.reference)
