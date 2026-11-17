/**
 * The spaces the filter's specs read: the board's work with labels on it, and the
 * workflows of many states a long menu has to fit.
 */
import { boardSpace } from '../boardFixtures.ts'
import type { Brief } from '../boardFixtures.ts'
import { identity } from '../planningFixtures.ts'
import { SPACE_READ, spaceModelWith } from '../servedAnswers.ts'
import type { Served } from '../servedContracts.ts'

const LABELS: Record<string, string[]> = {
  'MAIN-402': ['ui', 'board'],
  'MAIN-403': ['ui'],
  'MAIN-404': ['board'],
  'MAIN-405': ['api'],
}

/** Both labels on 402, one each on 403 and 404, another label on 405. */
export const labelledSpace = (): Brief[] =>
  boardSpace().map((item) => ({ ...item, labels: LABELS[item.reference] ?? [] }))

/** What the space's read lays over the model: these items, in this workflow when one is given. */
export const filterSpace = (items: Brief[] = labelledSpace(), workflow?: unknown) => ({
  work_items: items,
  ...(workflow ? { workflow } : {}),
})

/** One label in the whole space, so there is nothing to combine. */
export const oneLabelSpace = () =>
  labelledSpace().map((item) => ({
    ...item,
    labels: item.reference === 'MAIN-402' ? ['ui'] : [],
  }))

/** Sixty labels; an item holds twenty at most, so three of them hold all of these. */
export function sixtyLabelSpace() {
  const labels = Array.from({ length: 60 }, (_, index) => `label-${String(index).padStart(2, '0')}`)
  const carriers = ['MAIN-402', 'MAIN-403', 'MAIN-404']
  return boardSpace().map((item) => {
    const at = carriers.indexOf(item.reference)
    return { ...item, labels: at < 0 ? [] : labels.slice(at * 20, (at + 1) * 20) }
  })
}

const CATEGORIES = [
  'triage',
  'deferred',
  'ready',
  'active',
  'review',
  'completed',
  'blocked',
  'cancelled',
]

/** A workflow of so many states, walking the eight categories over and over. */
export const workflowOf = (count: number) => ({
  workflow_id: identity(700),
  name: 'Default',
  initial_state_id: identity(900),
  states: Array.from({ length: count }, (_, index) => {
    const category = CATEGORIES[index % CATEGORIES.length]
    return {
      state_id: identity(900 + index),
      key: `state-${index}`,
      name: `State ${index}`,
      category,
      is_terminal: category === 'completed' || category === 'cancelled',
      position: index,
    }
  }),
  transitions: [],
})

const LOTS = Array.from({ length: 60 }, (_, index) => `label-${String(index).padStart(2, '0')}`)
const HOLDERS = Array.from({ length: 12 }, (_, index) => `agent-${index}`)

/** The board's work, carrying the labels and held by the holders, an item at most twenty each. */
export const realSpace = () =>
  boardSpace().map((item, index) => ({
    ...item,
    labels: LOTS.slice((index % 3) * 20, (index % 3) * 20 + 20),
    claim_ref: HOLDERS[index % HOLDERS.length],
  }))

/** One label on the first item alone. */
export const onlyLabelSpace = () =>
  boardSpace().map((item, index) => ({ ...item, labels: index ? [] : ['only'] }))

const read = (name: string, items?: Brief[], workflow?: unknown): Served => ({
  name: `served/filter.ts ${name}`,
  url: SPACE_READ,
  body: spaceModelWith(filterSpace(items, workflow)),
})

export const served: Served[] = [
  read('labelledSpace()'),
  read('oneLabelSpace()', oneLabelSpace()),
  read('sixtyLabelSpace()', sixtyLabelSpace()),
  read('realSpace() in workflowOf(8)', realSpace(), workflowOf(8)),
  read('realSpace() in workflowOf(16)', realSpace(), workflowOf(16)),
  read('onlyLabelSpace() in workflowOf(7)', onlyLabelSpace(), workflowOf(7)),
]
