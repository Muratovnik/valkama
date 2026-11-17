/**
 * The records production-state-names.spec.ts serves.
 */
import { planningReadModel, spaceRef, workItem } from '../planningFixtures.ts'
import {
  briefAnswer,
  cardRead,
  SPACE_READ,
  spaceModelWith,
  withoutPlace,
} from '../servedAnswers.ts'
import type { Served } from '../servedContracts.ts'

const identity = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

/** The workflow a new space is given, with Review renamed. */
const STATES = [
  ['triage', 'Triage', 'triage', false],
  ['deferred', 'Deferred', 'deferred', false],
  ['ready', 'Ready', 'ready', false],
  ['dev', 'Dev', 'active', false],
  ['review', 'Code review', 'review', false],
  ['done', 'Done', 'completed', true],
  ['blocked', 'Blocked', 'blocked', false],
  ['cancelled', 'Cancelled', 'cancelled', true],
] as const

/** Each state as an item holds it: the workflow's declaration without its place. */
const held = STATES.map(([key, name, category, terminal], index) => ({
  state_id: identity(950 + index),
  key,
  name,
  category,
  is_terminal: terminal,
}))
export const states = held.map((state, index) => ({ ...state, position: index }))

export const WORKFLOW = {
  ...planningReadModel.workflow,
  initial_state_id: states[0].state_id,
  states,
  transitions: states.slice(1).map((state, index) => ({
    from: states[index].state_id,
    to: state.state_id,
  })),
}

export type Brief = (typeof planningReadModel.work_items)[number]
const stateOf = (key: string) => held.find((entry) => entry.key === key) ?? held[0]

const brief = (number: number, key: string) =>
  ({
    ...planningReadModel.work_items[1],
    work_item_id: identity(number),
    reference: `MAIN-${number}`,
    number,
    title: `Work in ${key}`,
    state: stateOf(key),
    open: !stateOf(key).is_terminal,
    workable: false,
    claim_ref: '',
    claim_state: null,
    parent_id: null,
  }) as Brief

export const SPACE = [brief(11, 'ready'), brief(12, 'dev'), brief(13, 'review'), brief(14, 'done')]

/** What the finder answers: an item in Dev and one in the renamed state, with their marks. */
export function finderAnswer() {
  const row = (item: Brief) => ({
    target: {
      space_ref: spaceRef,
      reference: item.reference,
      writable: true,
    },
    item: {
      work_item_id: item.work_item_id,
      planning_space_id: workItem.planning_space_id,
      reference: item.reference,
      title: item.title,
      kind: item.kind,
      priority: item.priority,
      state: { name: item.state?.name, category: item.state?.category, is_terminal: false },
      open: true,
      container_state: null,
      claim_ref: '',
    },
  })
  return {
    interface_version: 'valkama-planning-search',
    query: 'Work',
    limit: 50,
    has_more: false,
    items: [row(SPACE[1] as Brief), row(SPACE[2] as Brief)],
    coverage: [{ space_ref: spaceRef, status: 'searched', reason: null }],
  }
}

/**
 * What the read of a reference answers: its card, the fixture's work item standing as the
 * space's row, or for a brief read the row itself.
 */
export const cardOf = (reference: string | null, brief = false) => {
  const found = SPACE.find((item) => item.reference === reference) ?? (SPACE[1] as Brief)
  return briefAnswer((brief ? withoutPlace(found) : { ...workItem, ...found, links: [] }) as never)
}

export const served: Served[] = [
  {
    name: 'served/stateNames.ts SPACE',
    url: SPACE_READ,
    body: spaceModelWith({ work_items: SPACE, workflow: WORKFLOW, links: [] }),
  },
  ...SPACE.flatMap(({ reference }) =>
    [false, true].map((brief) => ({
      name: `served/stateNames.ts cardOf(${reference}, ${brief})`,
      url: cardRead(reference, brief),
      body: cardOf(reference, brief).json,
    })),
  ),
  {
    name: 'served/stateNames.ts finderAnswer()',
    url: '/api/modules/planning/search?q=Work',
    body: finderAnswer(),
  },
]
