import type { VueWrapper } from '@vue/test-utils'

import type { WorkItem } from '@/shared/api/planningModel.ts'

export function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve
    reject = onReject
  })
  return { promise, reject, resolve }
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
    source: '',
    checklist: [],
    revision,
    created_at: now,
    updated_at: now,
    container: false,
    ready: false,
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

export function getButton(wrapper: VueWrapper, text: string) {
  const button = wrapper.findAll('button').find((entry) => entry.text() === text)
  if (button === undefined) throw new Error(`Missing button: ${text}`)
  return button
}

export function value(wrapper: VueWrapper, label: string) {
  return (wrapper.get(`textarea[aria-label="${label}"]`).element as HTMLTextAreaElement).value
}
