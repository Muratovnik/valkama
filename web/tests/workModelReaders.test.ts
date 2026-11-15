/**
 * The readers of the work model the server answers: a record stands in a state or, as an
 * accepted open goal or stage, derives one; whether it holds work and whether it is open
 * are each read in one place; a link's end may be such a container; and an address names
 * a grouping and a chain's scope by the values this build knows.
 *
 * Every record starts from the brief the real server answered
 * (`fixtures/server/card-brief.json`) and changes only what the case is about.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { chainTarget, groupingOf } from '@/pages/planning/composables/usePlanningChainScope.ts'

import { WORK_ITEM_TREE } from '@/entities/work-item/utils/workTree.ts'

import { linkEndStateSaid, validateWorkItemBrief, workableIds } from '@/shared/api/planningModel.ts'
import type { WorkItemBrief } from '@/shared/api/planningModel.ts'
import { standingOf } from '@/shared/lib/useStateName.ts'
import type { StandingItem } from '@/shared/lib/useStateName.ts'

const brief = (): Record<string, unknown> =>
  JSON.parse(
    readFileSync(
      fileURLToPath(new URL('./fixtures/server/card-brief.json', import.meta.url)),
      'utf8',
    ),
  ).state.payload.work_item

/** An accepted open goal as the server says it: no state, and what it derives instead. */
const acceptedGoal = (extra: Record<string, unknown> = {}) => ({
  ...brief(),
  kind: 'goal',
  state: null,
  container_state: 'in_progress',
  acceptance: { basis: 'owner', at: '2026-01-02T03:04:05Z' },
  workable: false,
  ...extra,
})

describe('a record of the work model', () => {
  it('reads a task in its state and an accepted open goal by what it derives', () => {
    expect(validateWorkItemBrief(brief()).state?.category).toBe('triage')
    const goal = validateWorkItemBrief(acceptedGoal())
    expect(goal).toMatchObject({ state: null, container_state: 'in_progress', open: true })
  })

  it('refuses a record with neither a state nor a derived one, and one with both', () => {
    expect(() => validateWorkItemBrief(acceptedGoal({ container_state: null }))).toThrow(
      /a state or a container state/u,
    )
    expect(() => validateWorkItemBrief({ ...brief(), container_state: 'not_started' })).toThrow(
      /a state or a container state/u,
    )
  })

  it('refuses the fields and the values the work model replaced', () => {
    const renamed = brief()
    delete renamed.workable
    expect(() => validateWorkItemBrief({ ...renamed, ready: true })).toThrow()
    expect(() => validateWorkItemBrief({ ...brief(), container: false })).toThrow()
    expect(() =>
      validateWorkItemBrief({
        ...brief(),
        state: { ...(brief().state as object), category: 'queued' },
      }),
    ).toThrow()
    expect(() => validateWorkItemBrief({ ...brief(), kind: 'former' })).toThrow()
  })

  it('takes the workable set from the server’s own word', () => {
    const items = [
      validateWorkItemBrief(brief()),
      validateWorkItemBrief({
        ...brief(),
        work_item_id: '00000000-0000-4000-8000-000000000099',
        workable: false,
      }),
    ]
    expect([...workableIds(items)]).toEqual([items[0].work_item_id])
  })
})

describe('the tree of work', () => {
  it('holds work in a goal and a stage, and in no task, bug or improvement', () => {
    const holds = ['goal', 'stage', 'task', 'bug', 'improvement'].map((kind) =>
      WORK_ITEM_TREE.isContainer({ kind }),
    )
    expect(holds).toEqual([true, true, false, false, false])
  })

  it('reads openness off the record, which a container without a state still says', () => {
    const goal = validateWorkItemBrief(acceptedGoal())
    expect(WORK_ITEM_TREE.isOpen(goal)).toBe(true)
    // A closed record is closed whatever its state says of itself.
    const closed = { ...goal, open: false } satisfies Pick<WorkItemBrief, 'open'>
    expect(WORK_ITEM_TREE.isOpen(closed)).toBe(false)
  })
})

const derived = (container_state: StandingItem['container_state']): StandingItem => ({
  state: null,
  container_state,
})

describe('where an item stands', () => {
  const task = { state: { name: 'Dev', key: 'dev', category: 'active' }, container_state: null }

  it('is drawn as the state’s category, or as the state a container derives', () => {
    expect(standingOf(task)).toBe('active')
    expect(standingOf(derived('awaiting_confirmation'))).toBe('awaiting_confirmation')
  })
})

describe('a link’s end', () => {
  const said = linkEndStateSaid[0]

  it('may be an accepted open container, which names no state and is not terminal', () => {
    expect(
      said({
        state_category: null,
        is_terminal: false,
        state_unavailable: null,
        container_state: 'in_progress',
      }),
    ).toBe(true)
  })

  it('says one of a state, a derived state or why there is none', () => {
    expect(said({ state_category: 'active', is_terminal: false, state_unavailable: null })).toBe(
      true,
    )
    expect(
      said({ state_category: null, is_terminal: null, state_unavailable: 'state_missing' }),
    ).toBe(true)
    // A container end that says it might be finished, or that leaves its state unsaid.
    expect(
      said({
        state_category: null,
        is_terminal: null,
        state_unavailable: null,
        container_state: 'in_progress',
      }),
    ).toBe(false)
    expect(said({ state_category: null, is_terminal: null, state_unavailable: null })).toBe(false)
  })
})

describe('an address of the Work views', () => {
  it('groups by goal, and reads a grouping this build does not know as none', () => {
    expect(groupingOf({ group: 'goal' })).toBe('goal')
    expect(groupingOf({ group: 'former' })).toBe('none')
  })

  it('scopes a chain to the chain or the tree, and reads any other scope as a wrong link', () => {
    expect(chainTarget({ chain: 'MAIN-1', chain_scope: 'tree' })).toEqual({
      status: 'chain',
      reference: 'MAIN-1',
      scope: 'tree',
    })
    expect(chainTarget({ chain: 'MAIN-1', chain_scope: 'former' })).toEqual({
      status: 'invalid',
      reference: 'MAIN-1',
    })
  })
})
