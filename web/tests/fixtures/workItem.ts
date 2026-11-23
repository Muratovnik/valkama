import { flushPromises } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'

import type { WorkItem, WorkItemBrief } from '@/shared/api/planningModel.ts'

export function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve
    reject = onReject
  })
  return { promise, reject, resolve }
}

/**
 * The state a test's item stands in. An accepted open goal or stage stands in none, and a
 * test that reaches for its state has built the wrong item.
 */
export function stateOf(item: Pick<WorkItemBrief, 'state'>): NonNullable<WorkItemBrief['state']> {
  if (item.state === null) throw new Error('the item stands in no state')
  return item.state
}

const now = '2026-08-27T18:00:00Z'
export const inspectorResourceRef = {
  kind: 'planning-space' as const,
  resource_id:
    'eyJkYXRhX3Njb3BlX2lkIjoiMjIyMjIyMjItMjIyMi00MjIyLTgyMjItMjIyMjIyMjIyMjIyIiwic3BhY2Vfa2V5IjoiTUFJTiJ9',
}

export function workItemFixture(title: string, revision: number): WorkItem {
  return {
    work_item_id: '00000000-0000-4000-8000-000000000320',
    planning_space_id: '00000000-0000-4000-8000-000000000001',
    reference: 'QA-320',
    number: 320,
    title,
    kind: 'task',
    priority: 'high',
    state: {
      state_id: '00000000-0000-4000-8000-000000000002',
      key: 'dev',
      name: 'Development',
      category: 'active',
      is_terminal: false,
    },
    claim_ref: '',
    claim_state: null,
    parent_id: null,
    labels: [],
    projects: [],
    source: '',
    checklist: [],
    revision,
    created_at: now,
    updated_at: now,
    open: true,
    container_state: null,
    acceptance: null,
    started_at: null,
    waits_for: [],
    workable: false,
    withheld: ['not_ready'],
    lapsed_claim: null,
    comment_count: 0,
    claim: null,
    description: '',
    summary: null,
    summary_comment_id: null,
    links: [],
    refs: [],
    comments: [],
    events: [],
  }
}

/** A button by what it says, in words or, for an icon, in its accessible name. */
export function getButton(wrapper: VueWrapper, text: string) {
  const button = wrapper
    .findAll('button')
    .find((entry) => entry.text() === text || entry.attributes('aria-label') === text)
  if (button === undefined) throw new Error(`Missing button: ${text}`)
  return button
}

/** Turn the chain section to one of its readings, Contents or Chain, and wait for its read. */
export async function chooseScope(wrapper: VueWrapper, name: 'Chain' | 'Contents') {
  const option = wrapper.findAll('.chain-scope button').find((entry) => entry.text() === name)
  if (option === undefined) throw new Error(`Missing reading: ${name}`)
  await option.trigger('click')
  await flushPromises()
}

/** A tab of the card's strip by its name, or undefined where the card does not offer it. */
export function findTab(wrapper: VueWrapper, name: string) {
  return wrapper.findAll('.inspector-tabs [role="tab"]').find((tab) => tab.text() === name)
}

/** Open a tab of the card's strip, once the reads that decide which tabs it offers are in. */
export async function showTab(wrapper: VueWrapper, name: string) {
  await flushPromises()
  const tab = findTab(wrapper, name)
  if (tab === undefined) throw new Error(`Missing tab: ${name}`)
  await tab.trigger('click')
  await flushPromises()
}

/** Open a card's Chain tab, which the card offers once it knows the item has a chain. */
export const showChain = (wrapper: VueWrapper) => showTab(wrapper, 'Chain')

export function value(wrapper: VueWrapper, label: string) {
  return (wrapper.get(`textarea[aria-label="${label}"]`).element as HTMLTextAreaElement).value
}
