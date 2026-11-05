/**
 * A card with threads on it, mounted the way the inspector mounts its discussion, and how
 * a test reaches into one thread of it.
 */
import { createI18n } from 'vue-i18n'

import { mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'

import InspectorDiscussion from '@/widgets/work-item-inspector/components/InspectorDiscussion.vue'

import type { WorkItem } from '@/shared/api/planningModel.ts'
import { messages } from '@/shared/i18n/index.ts'

import { workItemFixture as record } from '../fixtures/workItem.ts'
import { asRoot } from './threads.ts'

type Row = WorkItem['comments'][number]

export const time = (minute: number) => `2026-11-03T10:${String(minute).padStart(2, '0')}:00Z`
export const MARK = { at: time(50), by: 'user', by_person: true, text: 'Moved to MAIN-14' }
export const root = (id: number, change: Record<string, unknown> = {}) =>
  ({
    id,
    kind: 'comment',
    author: 'kolo',
    at: time(id),
    ...asRoot,
    by_person: false,
    report: null,
    body: `Root ${id}`,
    ...change,
  }) as Row
export const reply = (id: number, parent: number, change: Record<string, unknown> = {}) =>
  root(id, { reply_to: parent, body: `Reply ${id}`, ...change })
export const card = (comments: Row[]): WorkItem => ({ ...record('Task', 3), comments })

export const written = (id: number, parent: number) => ({
  work_item: 'MAIN-12',
  comment_count: 9,
  comment_id: id,
  reply_to: parent,
  reply_to_request: null,
})

export const plugins = [createI18n({ legacy: false, locale: 'en', messages })]
const mounted: VueWrapper[] = []

export function open(
  item: WorkItem,
  props: Partial<InstanceType<typeof InspectorDiscussion>['$props']> = {},
) {
  const wrapper = mount(InspectorDiscussion, {
    attachTo: document.body,
    props: { item, writable: true, ...props },
    global: { plugins },
  })
  mounted.push(wrapper)
  return wrapper
}

export const thread = (wrapper: VueWrapper, id: number) => wrapper.get(`#work-report-${id}`)
export const inThread = (wrapper: VueWrapper, id: number, name: string) => {
  const button = thread(wrapper, id)
    .findAll('button')
    .find((candidate) => candidate.text() === name || candidate.attributes('aria-label') === name)
  if (!button) throw new Error(`No ${name} in thread ${id}`)
  return button
}
export const replyField = (wrapper: VueWrapper) => wrapper.get('textarea[aria-label="Your reply"]')
export const entryIds = (wrapper: VueWrapper) =>
  wrapper.findAll('.thread-entry').map((entry) => entry.attributes('id'))
export const key = (
  target: ReturnType<VueWrapper['get']>,
  name: string,
  init: KeyboardEventInit = {},
) =>
  target.element.dispatchEvent(
    new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true, ...init }),
  )

/** Takes everything `open` mounted off the page, for a test's `afterEach`. */
export function unmountAll() {
  for (const wrapper of mounted.splice(0)) wrapper.unmount()
}

/** Counts a wrapper `open` did not mount itself, so `unmountAll` takes it off too. */
export function track(wrapper: VueWrapper) {
  mounted.push(wrapper)
}
