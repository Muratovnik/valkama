/**
 * «Goal and stage» in the list: the goal and stages a row stands under, read from
 * the whole space, so a filter that leaves the goal out of the rows still names
 * it; a dash for work under no goal and nothing for another space's card, whose
 * goal the read does not name. It sorts the list, folds into the line under the
 * title where the list is too narrow for it, and the tree by goal, which shows a
 * row's goal by where it stands, does not draw it.
 */
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'

import WorkItemList from '@/widgets/work-item-views/components/WorkItemList.vue'

import { boardId, boardItem } from '../fixtures/board.ts'
import { i18n } from '../support/workItemBoardHarness.ts'

afterEach(() => {
  document.body.innerHTML = ''
  localStorage.clear()
})

const goal = boardItem(1, 'backlog', { kind: 'goal', title: 'Launch' })
const stage = boardItem(2, 'backlog', { kind: 'stage', title: 'Beta', parent_id: boardId(1) })
const task = boardItem(3, 'backlog', { title: 'Write notes', parent_id: boardId(2) })
const lone = boardItem(4, 'backlog', { title: 'Tidy up' })
const elsewhere = {
  ...boardItem(5, 'backlog', {
    title: 'Their part',
    parent_id: boardId(9),
    other_space: { key: 'ALPHA', name: 'Alpha' },
  }),
  reference: 'ALPHA-5',
}
const space = [goal, stage, task, lone, elsewhere]
const BY_REFERENCE = { key: 'reference', descending: false } as const

async function list(props: Partial<InstanceType<typeof WorkItemList>['$props']>) {
  const wrapper = mount(WorkItemList, {
    attachTo: document.body,
    global: { plugins: [i18n()] },
    props: { items: space, links: [], sort: BY_REFERENCE, ...props },
  })
  await flushPromises()
  return wrapper
}

/** A row's reference: a tree's row carries it, a flat list's on its reference cell. */
const referenceOf = (row: HTMLElement) =>
  row.dataset.reference ?? row.querySelector<HTMLElement>('[data-reference]')?.dataset.reference
const rows = () => [...document.querySelectorAll<HTMLElement>('tbody tr')]
const rowOf = (reference: string) => rows().find((row) => referenceOf(row) === reference)
const order = () => rows().map((row) => referenceOf(row))
const heads = () => [...document.querySelectorAll('thead th')].map((th) => th.textContent?.trim())
const goalCells = () =>
  Object.fromEntries(
    rows().map((row) => [referenceOf(row), row.querySelector('.list-goal')?.textContent?.trim()]),
  )

describe('the goal and stage column', () => {
  it('stands after the title and names each row’s goal and stages, goal first', async () => {
    await list({})
    expect(heads().slice(0, 3)).toEqual(['Ref', 'Title', 'Goal and stage'])
    expect(goalCells()).toEqual({
      'MAIN-1': '—',
      'MAIN-2': 'Launch',
      'MAIN-3': 'Launch › Beta',
      'MAIN-4': '—',
      'ALPHA-5': '',
    })
  })

  it('reads the goal from the whole space where the rows leave it out', async () => {
    await list({ items: [task], spaceItems: space })
    expect(goalCells()).toEqual({ 'MAIN-3': 'Launch › Beta' })
  })

  it('sorts the list by the path, and the other way round', async () => {
    const wrapper = await list({})
    const head = wrapper.findAll('thead th')[2]
    await head.get('button').trigger('click')
    expect(wrapper.emitted('sort')?.at(-1)).toEqual([{ key: 'goal', descending: false }])
    await wrapper.setProps({ sort: { key: 'goal', descending: false } })
    // No path first, by number; then «Launch» before «Launch › Beta».
    expect(order()).toEqual(['MAIN-1', 'MAIN-4', 'ALPHA-5', 'MAIN-2', 'MAIN-3'])
    expect(head.attributes('aria-sort')).toBe('ascending')
  })

  // A list of 1000px folds the column alone, and prints the labels under the title; one
  // of 700px folds the state, the priority and the holder with it into a line of facts.
  for (const [width, fit] of [
    [1000, 'wide'],
    [700, 'medium'],
  ] as const) {
    it(`folds under the title and leads what a ${fit} list prints there`, async () => {
      const held = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth')
      Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
        configurable: true,
        get: () => width,
      })
      try {
        await list({})
        expect(document.querySelector<HTMLElement>('.work-item-list')?.dataset.fit).toBe(fit)
        expect(document.querySelector('.list-goal')).toBeNull()
        const under = [...(rowOf('MAIN-3')?.querySelectorAll('.list-title > span') ?? [])]
        const lines = under.filter((line) => !line.classList.contains('list-name'))
        expect(lines[0]?.className).toBe('list-facts')
        expect(lines[0]?.textContent?.trim().startsWith('Launch › Beta')).toBe(true)
        expect(lines.some((line) => line.classList.contains('list-under'))).toBe(fit === 'wide')
        // Work under no goal says nothing there: the dash is the column's word.
        expect(rowOf('MAIN-4')?.querySelector('.list-title')?.textContent).not.toContain('—')
      } finally {
        if (held) Object.defineProperty(HTMLElement.prototype, 'clientWidth', held)
      }
    })
  }
})

describe('the goal and stage column in a tree', () => {
  it('is not drawn in the tree by goal, which shows the goal by the row’s place', async () => {
    await list({ tree: { filtered: false, scope: space, space: 'main' } })
    expect(heads()).not.toContain('Goal and stage')
    expect(document.querySelector('.list-goal')).toBeNull()
  })

  it('is drawn in the list by project, whose groups are not goals', async () => {
    await list({
      tree: { filtered: false, grouping: 'project', scope: space, space: 'main' },
    })
    expect(heads()).toContain('Goal and stage')
    expect(goalCells()['MAIN-3']).toBe('Launch › Beta')
  })
})
