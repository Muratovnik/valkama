/**
 * The list's own find on a list as it is drawn: Ctrl+F (⌘F) opens a search bar
 * over the list in place of the browser's, unless something lies over the list;
 * the count says which match is current of how many; Enter, Shift+Enter, F3 and
 * Shift+F3 walk the matches round; Escape closes the bar and gives focus back;
 * every drawn match is marked, the current one apart; and the current match
 * stays on its row while the list changes under it.
 *
 * happy-dom has no CSS Custom Highlight API, so a registry of the same shape
 * stands in for it and the marks are read from there. The words of a row are
 * read through `rowWords`, watched here for how often the find reads them.
 */
import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import WorkItemList from '@/widgets/work-item-views/components/WorkItemList.vue'
import { rowWords } from '@/widgets/work-item-views/utils/listRowWords.ts'

import type { WorkItemBrief } from '@/shared/api/planningModel.ts'
import ChoiceSelect from '@/shared/ui/ChoiceSelect.vue'
import { claimOverlayOwnership, releaseOverlayOwnership } from '@/shared/ui/overlayStack.ts'

import { boardItem } from '../fixtures/board.ts'
import { i18n } from '../support/workItemBoardHarness.ts'

vi.mock('@/widgets/work-item-views/utils/listRowWords.ts', async (original) => {
  const actual = await original<typeof import('@/widgets/work-item-views/utils/listRowWords.ts')>()
  return { ...actual, rowWords: vi.fn(actual.rowWords) }
})
const reads = vi.mocked(rowWords)

class TestHighlight extends Set<AbstractRange> {
  priority = 0
  constructor(...ranges: AbstractRange[]) {
    super(ranges)
  }
}
const painted = new Map<string, TestHighlight>()

beforeEach(() => {
  painted.clear()
  reads.mockClear()
  vi.stubGlobal('Highlight', TestHighlight)
  vi.stubGlobal('CSS', Object.assign(Object.create(CSS) as typeof CSS, { highlights: painted }))
})

afterEach(() => {
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

// The list sorts by Updated, newest first: these read MAIN-4, 3, 2, 1. «login»
// is in MAIN-4 twice and in MAIN-1 once, and in none of the rows' other words.
const titles = [
  'Fix the login page',
  'Café wifi drops',
  'Nothing to see',
  'Login, then login again',
]
const items = titles.map((title, index) =>
  boardItem(index + 1, 'backlog', { title, updated_at: `2026-10-0${index + 1}T10:00:00Z` }),
)

async function list(locale: 'en' | 'ru' = 'en', shown: WorkItemBrief[] = items) {
  const plugin = i18n()
  plugin.global.locale.value = locale
  const wrapper = mount(WorkItemList, {
    attachTo: document.body,
    global: { plugins: [plugin] },
    props: { items: shown, links: [] },
  })
  await flushPromises()
  return wrapper
}

type List = VueWrapper

const rowButton = (wrapper: List, reference: string) =>
  wrapper.get<HTMLButtonElement>(`tbody .list-open[data-reference="${reference}"]`).element
const bar = () => document.querySelector<HTMLElement>('[role="search"]')
const field = () => bar()?.querySelector('input') ?? null
const count = () => bar()?.querySelector('.list-find-now')?.textContent?.trim()

function key(target: EventTarget, init: KeyboardEventInit) {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })
  target.dispatchEvent(event)
  return event
}
const findKeys = (init: KeyboardEventInit = {}) =>
  key(document.activeElement ?? document.body, { code: 'KeyF', ctrlKey: true, key: 'f', ...init })

async function typeIn(term: string) {
  const input = field()
  if (!input) throw new Error('no find bar to type in')
  input.value = term
  input.dispatchEvent(new Event('input', { bubbles: true }))
  await flushPromises()
}

async function open(wrapper: List, term: string) {
  rowButton(wrapper, 'MAIN-2').focus()
  findKeys()
  await flushPromises()
  if (!field()) throw new Error('Ctrl+F opened no find bar')
  await typeIn(term)
}

/** Boxes measured as a hand sets them: the list is as wide as `resizeList` last said. */
function measuredBoxes() {
  const observers: { report: ResizeObserverCallback; targets: Element[] }[] = []
  vi.stubGlobal(
    'ResizeObserver',
    class {
      readonly watch: { report: ResizeObserverCallback; targets: Element[] }
      constructor(report: ResizeObserverCallback) {
        this.watch = { report, targets: [] }
        observers.push(this.watch)
      }
      observe(target: Element) {
        this.watch.targets.push(target)
      }
      unobserve() {}
      disconnect() {}
    },
  )
  return async function resizeList(width: number) {
    const list = document.querySelector('.work-item-list')
    if (!list) throw new Error('no list to resize')
    const entry = { contentRect: { width }, target: list } as unknown as ResizeObserverEntry
    for (const { report, targets } of observers)
      if (targets.includes(list)) report([entry], {} as ResizeObserver)
    await flushPromises()
  }
}

async function press(init: KeyboardEventInit) {
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
const current = () => marksIn('list-find-current')
const others = () => marksIn('list-find')

describe('Ctrl+F on the list', () => {
  it('opens the list’s find bar in place of the browser’s, a named search with its field focused', async () => {
    await list()
    const event = findKeys()
    await flushPromises()
    expect(event.defaultPrevented).toBe(true)
    expect(bar()?.getAttribute('aria-label')).toBe('Find in the list')
    expect(document.activeElement).toBe(field())
    expect(field()?.getAttribute('aria-label') ?? field()?.labels?.[0]?.textContent).toBeTruthy()
    // The count is a polite status, and it describes the field.
    const status = bar()?.querySelector('[role="status"]')
    expect(status).not.toBeNull()
    expect(field()?.getAttribute('aria-describedby')).toContain(status?.id)
  })

  it('opens it on ⌘F as well, and leaves Ctrl+Shift+F to the browser', async () => {
    await list()
    expect(findKeys({ ctrlKey: false, metaKey: true }).defaultPrevented).toBe(true)
    await flushPromises()
    expect(bar()).not.toBeNull()
    document.body.innerHTML = ''
    await list()
    expect(findKeys({ shiftKey: true }).defaultPrevented).toBe(false)
  })

  it('is the browser’s while a card, a dialog or the finder lies over the list', async () => {
    await list()
    const lease = claimOverlayOwnership(
      () => null,
      'drawer',
      () => {},
    )
    try {
      const event = findKeys()
      await flushPromises()
      expect(event.defaultPrevented).toBe(false)
      expect(bar()).toBeNull()
    } finally {
      releaseOverlayOwnership(lease)
    }
    await flushPromises()
    expect(findKeys().defaultPrevented).toBe(true)
  })

  it('is the browser’s while a choice list is open over the list, and the list’s once it closes', async () => {
    await list()
    const select = mount(ChoiceSelect, {
      attachTo: document.body,
      props: {
        label: 'Move to',
        placeholder: 'Move to',
        modelValue: '',
        options: [
          { value: 'review', label: 'Review' },
          { value: 'done', label: 'Done' },
        ],
      },
    })
    const trigger = select.get('.choice-trigger')
    await trigger.trigger('keydown', { key: 'Enter' })
    await flushPromises()
    expect(document.querySelector('[role="listbox"]')).not.toBeNull()
    const over = findKeys()
    await flushPromises()
    expect(over.defaultPrevented).toBe(false)
    expect(bar()).toBeNull()

    key(document.activeElement ?? document.body, { key: 'Escape' })
    await flushPromises()
    expect(trigger.attributes('aria-expanded')).toBe('false')
    expect(findKeys().defaultPrevented).toBe(true)
    select.unmount()
  })

  // Dvorak types F where QWERTY has Y and U where QWERTY has F; a Russian layout
  // types «а» in F's place, and no Latin letter at all.
  it('takes the key that types F, and the key in F’s place only where it types no Latin letter', async () => {
    await list()
    expect(findKeys({ code: 'KeyF', key: 'u' }).defaultPrevented).toBe(false)
    await flushPromises()
    expect(bar()).toBeNull()
    expect(findKeys({ code: 'KeyY', key: 'f' }).defaultPrevented).toBe(true)
    await flushPromises()
    expect(bar()).not.toBeNull()

    document.body.innerHTML = ''
    await list('ru')
    expect(findKeys({ code: 'KeyF', key: 'а' }).defaultPrevented).toBe(true)
    await flushPromises()
    expect(bar()).not.toBeNull()

    document.body.innerHTML = ''
    await list()
    // Caps Lock on: the letter is still F.
    expect(findKeys({ code: 'KeyF', key: 'F' }).defaultPrevented).toBe(true)
  })
})

describe('the words of the rows', () => {
  it('are read once for a term, not again for each key typed into it', async () => {
    const wrapper = await list()
    await open(wrapper, 'l')
    expect(reads).toHaveBeenCalledTimes(items.length)
    for (const term of ['lo', 'log', 'logi', 'login']) await typeIn(term)
    expect(count()).toBe('1 of 3')
    expect(reads).toHaveBeenCalledTimes(items.length)
  })

  it('are read again where the list’s width changes what a row prints, not at every pixel', async () => {
    const resizeList = measuredBoxes()
    const wrapper = await list()
    await open(wrapper, 'login')
    await resizeList(1000)
    const read = reads.mock.calls.length
    // Still the same columns, and still wide enough for the labels.
    for (const width of [1010, 1100, 1240]) await resizeList(width)
    expect(reads).toHaveBeenCalledTimes(read)
    // Narrower than the labels need: the rows read again.
    await resizeList(880)
    expect(reads).toHaveBeenCalledTimes(read + items.length)
    expect(count()).toBe('1 of 3')
  })
})

describe('a term in the bar', () => {
  it('counts every match in the rows’ words and marks each, the current one apart', async () => {
    const wrapper = await list()
    await open(wrapper, 'LOGIN')
    expect(count()).toBe('1 of 3')
    expect(current()).toEqual([{ row: 'MAIN-4', text: 'Login' }])
    expect(others()).toEqual([
      { row: 'MAIN-4', text: 'login' },
      { row: 'MAIN-1', text: 'login' },
    ])
    expect(painted.get('list-find-current')?.priority).toBeGreaterThan(
      painted.get('list-find')?.priority ?? 0,
    )
  })

  it('marks as many matches as it counts, in words the row shows, wherever they stand', async () => {
    const wrapper = await list()
    // The state's word, in its own cell of every row.
    await open(wrapper, 'backlog')
    const marks = [...current(), ...others()]
    expect(count()).toBe(`1 of ${items.length}`)
    expect(marks).toHaveLength(items.length)
    // Each mark is the state's word as its row writes it, whatever its case.
    for (const mark of marks) expect(mark.text.toLowerCase()).toBe('backlog')
  })

  it('says so when nothing matches, and the steps go nowhere', async () => {
    const wrapper = await list()
    await open(wrapper, 'nowhere at all')
    expect(count()).toBe('No matches')
    expect(current()).toEqual([])
    await press({ key: 'Enter' })
    expect(count()).toBe('No matches')
  })

  it('counts in Russian as well', async () => {
    const wrapper = await list('ru')
    await open(wrapper, 'login')
    expect(count()).toBe('1 из 3')
    await open(wrapper, 'nowhere at all')
    expect(count()).toBe('Нет совпадений')
  })
})

describe('a term in a tree', () => {
  // A goal six levels deep, filtered down to its deepest row: the five above it
  // stand as its path, and the deepest stands past the indent's fifth level.
  const kinds = ['goal', 'stage', 'stage', 'stage', 'stage', 'task'] as const
  const chain = kinds.map((kind, at) =>
    boardItem(at + 1, 'backlog', {
      kind,
      parent_id: at === 0 ? null : boardItem(at).work_item_id,
    }),
  )
  const deepest = chain.slice(-1)

  async function tree() {
    const plugin = i18n()
    const wrapper = mount(WorkItemList, {
      attachTo: document.body,
      global: { plugins: [plugin] },
      props: { items: deepest, links: [], tree: { filtered: true, scope: chain, space: 'main' } },
    })
    await flushPromises()
    return wrapper
  }

  it('finds a path row by what matched under it, as the row prints it', async () => {
    const wrapper = await tree()
    await open(wrapper, '1 match')
    expect(count()).toBe('1 of 5')
    expect([...current(), ...others()]).toEqual(
      ['MAIN-1', 'MAIN-2', 'MAIN-3', 'MAIN-4', 'MAIN-5'].map((row) => ({ row, text: '1 match' })),
    )
  })

  it('finds a row deeper than the indent by the parent it prints', async () => {
    const wrapper = await tree()
    await open(wrapper, 'in MAIN-5')
    expect(count()).toBe('1 of 1')
    expect(current()).toEqual([{ row: 'MAIN-6', text: 'in MAIN-5' }])
  })
})

describe('the steps between matches', () => {
  it('go on with Enter and F3 and back with Shift, round past either end', async () => {
    const wrapper = await list()
    await open(wrapper, 'login')
    await press({ key: 'Enter' })
    expect(count()).toBe('2 of 3')
    expect(current()).toEqual([{ row: 'MAIN-4', text: 'login' }])
    await press({ key: 'Enter' })
    expect(count()).toBe('3 of 3')
    expect(current()).toEqual([{ row: 'MAIN-1', text: 'login' }])
    await press({ key: 'Enter' })
    expect(count()).toBe('1 of 3')
    await press({ key: 'Enter', shiftKey: true })
    expect(count()).toBe('3 of 3')
    await press({ key: 'F3' })
    expect(count()).toBe('1 of 3')
    await press({ key: 'F3', shiftKey: true })
    expect(count()).toBe('3 of 3')
    // Focus stays in the field through every step.
    expect(document.activeElement).toBe(field())
  })

  it('close with Escape, which gives focus back to where it was and clears the marks', async () => {
    const wrapper = await list()
    await open(wrapper, 'login')
    await press({ key: 'Escape' })
    expect(bar()).toBeNull()
    expect(document.activeElement).toBe(rowButton(wrapper, 'MAIN-2'))
    expect(painted.size).toBe(0)
  })

  it('close with Escape onto the list’s Tab stop once the element focus came from has gone', async () => {
    const wrapper = await list()
    await open(wrapper, 'login')
    await wrapper.setProps({ items: items.filter((item) => item.reference !== 'MAIN-2') })
    await flushPromises()
    expect(document.querySelector('[data-reference="MAIN-2"]')).toBeNull()
    await press({ key: 'Escape' })
    expect(bar()).toBeNull()
    const stop = document.querySelector('.work-item-list .list-open[tabindex="0"]')
    expect(stop).not.toBeNull()
    expect(document.activeElement).toBe(stop)
  })
})

describe('a list that goes with its find open', () => {
  it('leaves no mark registered and no listener on the window', async () => {
    // A list first opened alone, so what the page keeps for its whole life (the
    // settings' storage) is in place before the listeners are counted.
    const first = await list()
    first.unmount()
    const added = vi.spyOn(globalThis, 'addEventListener')
    const removed = vi.spyOn(globalThis, 'removeEventListener')
    const wrapper = await list()
    await open(wrapper, 'login')
    expect(painted.size).toBeGreaterThan(0)
    // The open find listens on the window for its keys, so the spy sees what it must take away.
    expect(added.mock.calls.map(([type]) => type)).toContain('keydown')
    wrapper.unmount()
    await flushPromises()
    expect(painted.size).toBe(0)
    const left = added.mock.calls.filter(
      ([type, listener]) =>
        !removed.mock.calls.some(([gone, done]) => gone === type && done === listener),
    )
    expect(left.map(([type]) => type)).toEqual([])
    expect(findKeys().defaultPrevented).toBe(false)
    added.mockRestore()
    removed.mockRestore()
  })
})

describe('the current match as the list changes', () => {
  it('stays on its row when a row above it goes, and the count follows', async () => {
    const wrapper = await list()
    await open(wrapper, 'login')
    await press({ key: 'Enter', shiftKey: true })
    expect(current()).toEqual([{ row: 'MAIN-1', text: 'login' }])
    await wrapper.setProps({ items: items.filter((item) => item.reference !== 'MAIN-4') })
    await flushPromises()
    expect(count()).toBe('1 of 1')
    expect(current()).toEqual([{ row: 'MAIN-1', text: 'login' }])
    expect(document.activeElement).toBe(field())
  })

  it('stays on its row and its order in it when the list is sorted again', async () => {
    const wrapper = await list()
    await open(wrapper, 'login')
    await press({ key: 'Enter' })
    expect(current()).toEqual([{ row: 'MAIN-4', text: 'login' }])
    // By reference, A to Z: MAIN-1 leads, and MAIN-4's two matches come last.
    await wrapper.get('thead .list-sort').trigger('click')
    await flushPromises()
    expect(count()).toBe('3 of 3')
    expect(current()).toEqual([{ row: 'MAIN-4', text: 'login' }])
  })

  it('goes on from where its row stood once the row no longer matches', async () => {
    const wrapper = await list()
    await open(wrapper, 'login')
    const changed = items.map((item) =>
      item.reference === 'MAIN-4' ? { ...item, revision: 2, title: 'Signed in' } : item,
    )
    await wrapper.setProps({ items: changed })
    await flushPromises()
    expect(count()).toBe('1 of 1')
    expect(current()).toEqual([{ row: 'MAIN-1', text: 'login' }])
  })
})
