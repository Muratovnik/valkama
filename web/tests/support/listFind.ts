/**
 * The list's own find as its specs drive it (`workItemListFind.spec.ts`): a list of four rows
 * mounted on the page, the find bar's parts, the keys pressed into it, and the marks it paints,
 * read from a registry of the CSS Custom Highlight API's shape, which happy-dom lacks.
 */
import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { vi } from 'vitest'

import WorkItemList from '@/widgets/work-item-views/components/WorkItemList.vue'

import type { WorkItemBrief } from '@/shared/api/planningModel.ts'

import { boardItem } from '../fixtures/board.ts'
import { keptOrder } from './listOrder.ts'
import { i18n } from './workItemBoardHarness.ts'

class TestHighlight extends Set<AbstractRange> {
  priority = 0
  constructor(...ranges: AbstractRange[]) {
    super(ranges)
  }
}
export const painted = new Map<string, TestHighlight>()

/** The registry in the API's place, emptied, for a test to read the marks from. */
export function stubHighlights() {
  painted.clear()
  vi.stubGlobal('Highlight', TestHighlight)
  vi.stubGlobal('CSS', Object.assign(Object.create(CSS) as typeof CSS, { highlights: painted }))
}

// The list sorts by Updated, newest first: these read MAIN-4, 3, 2, 1. «login»
// is in MAIN-4 twice and in MAIN-1 once, and in none of the rows' other words.
const titles = [
  'Fix the login page',
  'Café wifi drops',
  'Nothing to see',
  'Login, then login again',
]
export const items = titles.map((title, index) =>
  boardItem(index + 1, 'backlog', { title, updated_at: `2026-10-0${index + 1}T10:00:00Z` }),
)

export async function list(locale: 'en' | 'ru' = 'en', shown: WorkItemBrief[] = items) {
  const plugin = i18n()
  plugin.global.locale.value = locale
  const host = keptOrder()
  const wrapper = host.hold(
    mount(WorkItemList, {
      attachTo: document.body,
      global: { plugins: [plugin] },
      props: { items: shown, links: [], ...host.props },
    }),
  )
  await flushPromises()
  return wrapper
}

export type List = VueWrapper

export const rowButton = (wrapper: List, reference: string) =>
  wrapper.get<HTMLButtonElement>(`tbody .list-open[data-reference="${reference}"]`).element
export const bar = () => document.querySelector<HTMLElement>('[role="search"]')
export const field = () => bar()?.querySelector('input') ?? null
export const count = () => bar()?.querySelector('.list-find-now')?.textContent?.trim()

export function key(target: EventTarget, init: KeyboardEventInit) {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
  target.dispatchEvent(event)
  return event
}
export const findKeys = (init: KeyboardEventInit = {}) =>
  key(document.activeElement ?? document.body, { code: 'KeyF', ctrlKey: true, key: 'f', ...init })

export async function typeIn(term: string) {
  const input = field()
  if (!input) throw new Error('no find bar to type in')
  input.value = term
  input.dispatchEvent(new Event('input', { bubbles: true }))
  await flushPromises()
}

export async function open(wrapper: List, term: string) {
  rowButton(wrapper, 'MAIN-2').focus()
  findKeys()
  await flushPromises()
  if (!field()) throw new Error('Ctrl+F opened no find bar')
  await typeIn(term)
}

export async function press(init: KeyboardEventInit) {
  key(document.activeElement ?? document.body, init)
  await flushPromises()
}

/** The row a mark is drawn in, by its reference, and the mark's words. */
function markOf(range: AbstractRange) {
  const node = range.startContainer
  const element = node instanceof Element ? node : node.parentElement
  const row = element?.closest('tr')?.querySelector<HTMLElement>('.list-open')
  return { row: row?.dataset.reference, text: (range as Range).toString() }
}
const marksIn = (name: string) => [...(painted.get(name) ?? [])].map((range) => markOf(range))
export const current = () => marksIn('list-find-current')
export const others = () => marksIn('list-find')
