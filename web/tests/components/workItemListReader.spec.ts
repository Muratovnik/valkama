/**
 * What the list gives a screen reader where a reader's run found it wanting: a fold
 * by a press on a row's arrow reaches the row as the keys do, focus first and the
 * change after, with the arrow taking no focus; the list is one Tab stop, its head
 * reached from the rows by the arrows; and nothing in the list or around it listens
 * for a press but its own controls, since a browser names a listening element
 * clickable to a reader.
 */
import { createApp } from 'vue'

import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

import WorkItemList from '@/widgets/work-item-views/components/WorkItemList.vue'

import type { WorkItemBrief } from '@/shared/api/planningModel.ts'

import { boardId, boardItem } from '../fixtures/board.ts'
import { atListWidth } from '../fixtures/listRoom.ts'
import { i18n } from '../support/workItemBoardHarness.ts'

afterEach(() => {
  vi.restoreAllMocks()
  document.body.innerHTML = ''
  localStorage.clear()
})

const goal = boardItem(1, 'backlog', { kind: 'goal' })
const task = boardItem(2, 'backlog', { parent_id: boardId(1) })
const lone = boardItem(3, 'backlog')
const space = [goal, task, lone]
const BY_REFERENCE = { key: 'reference', descending: false } as const

async function list(tree: boolean, items: WorkItemBrief[] = space) {
  const wrapper = mount(WorkItemList, {
    attachTo: document.body,
    global: { plugins: [i18n()] },
    props: {
      items,
      links: [],
      sort: BY_REFERENCE,
      tree: tree ? { filtered: false, scope: items, space: 'main' } : null,
    },
  })
  await flushPromises()
  return wrapper
}

const rowOf = (reference: string) =>
  document.querySelector<HTMLElement>(`tbody tr[data-reference="${reference}"]`)
const press = async (key: string) => {
  document.activeElement?.dispatchEvent(
    new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
  )
  await flushPromises()
}
const named = () =>
  document.activeElement?.closest<HTMLElement>('[data-reference]')?.dataset.reference ??
  document.activeElement?.textContent?.trim()

/** Every focus the page takes from now on, and whether the goal's row was open then. */
function watchFocus() {
  const seen: { at: string | undefined; open: string | null | undefined }[] = []
  document.addEventListener('focusin', (event) => {
    const target = event.target as HTMLElement
    seen.push({
      at: target.dataset.reference ?? target.className,
      open: rowOf('MAIN-1')?.getAttribute('aria-expanded'),
    })
  })
  return seen
}

describe('a fold by a press on the arrow, while focus is on a row under it', () => {
  // ← on the task goes to the goal, still open; ← there folds it.
  const keyed = [{ at: 'MAIN-1', open: 'true' }]

  it('reaches the row as ← and ← do: focus on the open row, then the fold', async () => {
    await list(true)
    rowOf('MAIN-2')?.focus()
    const seen = watchFocus()
    await press('ArrowLeft')
    await press('ArrowLeft')
    expect(seen).toEqual(keyed)
    expect(rowOf('MAIN-1')?.getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(rowOf('MAIN-1'))
  })

  it('moves focus to the row before it folds, and the arrow takes none', async () => {
    await list(true)
    rowOf('MAIN-2')?.focus()
    const seen = watchFocus()
    const arrow = rowOf('MAIN-1')?.querySelector<HTMLElement>('.tree-toggle')
    const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
    arrow?.dispatchEvent(down)
    expect(down.defaultPrevented).toBe(true)
    arrow?.click()
    await flushPromises()
    expect(seen).toEqual(keyed)
    expect(rowOf('MAIN-1')?.getAttribute('aria-expanded')).toBe('false')
    expect(rowOf('MAIN-2')).toBeNull()
    expect(document.activeElement).toBe(rowOf('MAIN-1'))
  })
})

/** What Tab stops at in the list: everything focusable out of `tabindex="-1"`. */
const tabStops = () =>
  [
    ...document.querySelectorAll<HTMLElement>(
      '.work-item-list button, .work-item-list [tabindex], .work-item-list a[href]',
    ),
  ]
    .filter((element) => element.tabIndex >= 0)
    .map((element) => element.dataset.reference ?? element.textContent?.trim())

const heads = () => [...document.querySelectorAll<HTMLElement>('thead button')]

describe('the list as one Tab stop', () => {
  for (const tree of [false, true])
    it(`stops Tab at its rows' one stop alone, not at the sorts, ${tree ? 'in a tree' : 'flat'}`, async () => {
      await list(tree)
      expect(tabStops()).toEqual(['MAIN-1'])
      expect(heads().length).toBeGreaterThan(1)
      for (const head of heads()) expect(head.getAttribute('tabindex')).toBe('-1')
    })

  it('reaches the head by ↑ from the first row, walks it, and comes back by ↓', async () => {
    await list(false)
    document.querySelector<HTMLElement>('tbody .list-open')?.focus()
    await press('ArrowUp')
    expect(named()).toBe('Ref')
    await press('ArrowRight')
    expect(named()).toBe('Title')
    // The title's choice of order stays in its heading, hidden in a fit that offers the folded
    // sorts as buttons, and the keys pass it by to the next heading's sort.
    expect(document.querySelector('thead [hidden] [role="combobox"]')).not.toBeNull()
    await press('ArrowRight')
    expect(named()).toBe('Goal and stage')
    await press('ArrowLeft')
    expect(named()).toBe('Title')
    await press('End')
    expect(document.activeElement).toBe(heads().at(-1))
    await press('Home')
    expect(named()).toBe('Ref')
    await press('ArrowLeft')
    expect(named()).toBe('Ref')
    await press('ArrowDown')
    expect(named()).toBe('MAIN-1')
  })

  it('goes up from a tree row’s cell to the heading above it', async () => {
    await list(true)
    rowOf('MAIN-1')?.focus()
    await press('ArrowRight')
    await press('ArrowRight')
    // The tree grid's first cell, then the title's.
    expect(document.activeElement?.classList.contains('list-title')).toBe(true)
    await press('ArrowUp')
    expect(named()).toBe('Title')
    await press('ArrowDown')
    expect(document.activeElement).toBe(rowOf('MAIN-1'))
  })

  it('keeps a narrow head’s choice of orders out of the Tab order, reached from the title', async () => {
    await atListWidth(300, async () => {
      await list(false)
      const choice = document.querySelector<HTMLElement>('thead [role="combobox"]')
      expect(choice?.getAttribute('tabindex')).toBe('-1')
      expect(tabStops()).toEqual(['MAIN-1'])
      document.querySelector<HTMLElement>('tbody .list-open')?.focus()
      await press('ArrowUp')
      await press('End')
      expect(document.activeElement).toBe(choice)
    })
  })
})

/** A control a press is for; a listener anywhere else makes its element clickable. */
const CONTROL = 'button, a[href], input, select, textarea, summary, [role="button"]'
const PRESS = new Set(['click', 'mousedown', 'mouseup', 'DOMActivate'])

/** Where an element's `addEventListener` is defined: the DOM's own `EventTarget`. */
function addOwner(): EventTarget {
  let at: object | null = document.createElement('div')
  while (at !== null && !Object.hasOwn(at, 'addEventListener')) at = Object.getPrototypeOf(at)
  if (at === null) throw new Error('no addEventListener on an element')
  return at as EventTarget
}

describe('the press the list listens for', () => {
  for (const tree of [false, true])
    it(`is heard by no element of the list or above it but a control, ${tree ? 'in a tree' : 'flat'}`, async () => {
      const heard: Element[] = []
      const owner = addOwner()
      const add = Reflect.get(owner, 'addEventListener') as EventTarget['addEventListener']
      vi.spyOn(owner, 'addEventListener').mockImplementation(function (
        this: EventTarget,
        ...args: Parameters<EventTarget['addEventListener']>
      ) {
        if (this instanceof Element && PRESS.has(args[0])) heard.push(this)
        Reflect.apply(add, this, args)
      })
      // Mounted by Vue alone: the test library listens on a component's root itself.
      const opened: string[] = []
      const host = document.createElement('div')
      document.body.append(host)
      const app = createApp(WorkItemList, {
        items: space,
        links: [],
        onOpen: (reference: string) => opened.push(reference),
        sort: BY_REFERENCE,
        tree: tree ? { filtered: false, scope: space, space: 'main' } : null,
      })
      app.use(i18n()).mount(host)
      await flushPromises()
      const root = document.querySelector('.work-item-list')
      if (!root) throw new Error('no list')
      const listening = heard
        .filter((element) => root.contains(element) || element.contains(root))
        .filter((element) => !element.matches(CONTROL))
        .map((element) => element.outerHTML.slice(0, 60))
      expect(listening).toEqual([])
      // A press anywhere in a row still opens its card.
      document.querySelector<HTMLElement>('tbody tr:last-child .list-title')?.click()
      expect(opened).toEqual(['MAIN-3'])
      app.unmount()
    })
})
