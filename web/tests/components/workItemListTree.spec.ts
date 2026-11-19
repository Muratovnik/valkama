/**
 * The list grouped by goal as a tree of rows: a goal five levels deep, each level a
 * row whose level a reader hears, folded and opened through the shared tree's
 * choices, which a list made again keeps; and under a filter what matched with the
 * path to it, each path row said to be one and counting what matched under it.
 */
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'

import WorkItemList from '@/widgets/work-item-views/components/WorkItemList.vue'

import type { WorkItemBrief } from '@/shared/api/planningModel.ts'

import { boardItem } from '../fixtures/board.ts'
import { i18n } from '../support/workItemBoardHarness.ts'

afterEach(() => {
  document.body.innerHTML = ''
  localStorage.clear()
})

// A goal, three stages one under another, and a task under the last: five levels.
const kinds = ['goal', 'stage', 'stage', 'stage', 'task'] as const
const chain = kinds.map((kind, at) =>
  boardItem(at + 1, 'backlog', {
    kind,
    parent_id: at === 0 ? null : boardItem(at).work_item_id,
  }),
)
const references = chain.map((item) => item.reference)
/** The rows of a level by their numbers, so no fixture leans on the default order. */
const BY_REFERENCE = { key: 'reference', descending: false } as const

async function tree(items: WorkItemBrief[], filtered: boolean) {
  const wrapper = mount(WorkItemList, {
    attachTo: document.body,
    global: { plugins: [i18n()] },
    props: {
      items,
      links: [],
      sort: BY_REFERENCE,
      tree: { filtered, scope: chain, space: 'main' },
    },
  })
  await flushPromises()
  return wrapper
}

const rows = () => [...document.querySelectorAll<HTMLElement>('tbody tr[data-reference]')]
const rowOf = (reference: string) =>
  document.querySelector<HTMLElement>(`tbody tr[data-reference="${reference}"]`)
const said = (row: HTMLElement) => ({
  reference: row.dataset.reference,
  level: row.getAttribute('aria-level'),
  expanded: row.getAttribute('aria-expanded'),
  path: row.getAttribute('aria-description'),
})

describe('a goal five levels deep', () => {
  it('stands as five rows, each a level deeper, every container open', async () => {
    await tree(chain, false)
    expect(rows().map((row) => said(row))).toEqual([
      { reference: 'MAIN-1', level: '1', expanded: 'true', path: null },
      { reference: 'MAIN-2', level: '2', expanded: 'true', path: null },
      { reference: 'MAIN-3', level: '3', expanded: 'true', path: null },
      { reference: 'MAIN-4', level: '4', expanded: 'true', path: null },
      // The task holds nothing, so it is neither open nor folded.
      { reference: 'MAIN-5', level: '5', expanded: null, path: null },
    ])
    expect(document.querySelector('table')?.getAttribute('role')).toBe('treegrid')
  })

  it('folds what is under a row, and a list made again keeps the fold', async () => {
    const first = await tree(chain, false)
    rowOf('MAIN-3')?.querySelector<HTMLElement>('.tree-toggle')?.click()
    await flushPromises()
    expect(rows().map((row) => row.dataset.reference)).toEqual(['MAIN-1', 'MAIN-2', 'MAIN-3'])
    expect(rowOf('MAIN-3')?.getAttribute('aria-expanded')).toBe('false')

    first.unmount()
    await tree(chain, false)
    expect(rows().map((row) => row.dataset.reference)).toEqual(['MAIN-1', 'MAIN-2', 'MAIN-3'])
    expect(rowOf('MAIN-3')?.getAttribute('aria-expanded')).toBe('false')
  })
})

describe('the tree under a filter', () => {
  it('shows the task that matched with its goal and stages as path rows', async () => {
    await tree(chain.slice(-1), true)
    const path = 'Shown as a path: does not match the filter itself'
    expect(rows().map((row) => said(row))).toEqual([
      { reference: 'MAIN-1', level: '1', expanded: 'true', path },
      { reference: 'MAIN-2', level: '2', expanded: 'true', path },
      { reference: 'MAIN-3', level: '3', expanded: 'true', path },
      { reference: 'MAIN-4', level: '4', expanded: 'true', path },
      { reference: 'MAIN-5', level: '5', expanded: null, path: null },
    ])
    // Each path row counts the one match under it; the match counts nothing.
    for (const reference of references.slice(0, -1))
      expect(rowOf(reference)?.textContent).toContain('1 match')
    expect(rowOf('MAIN-5')?.textContent).not.toContain('match')
  })

  it('draws a container that matched as a row of its own, without the work under it', async () => {
    await tree(chain.slice(2, 3), true)
    expect(rows().map((row) => said(row))).toEqual([
      expect.objectContaining({ reference: 'MAIN-1', path: expect.any(String) }),
      expect.objectContaining({ reference: 'MAIN-2', path: expect.any(String) }),
      // Nothing under it matched, so it has nothing to open.
      { reference: 'MAIN-3', level: '3', expanded: null, path: null },
    ])
  })
})

/** Each row by what names it to the keys, its level, and what a reader hears it named. */
const shown = () =>
  [...document.querySelectorAll<HTMLElement>('tbody tr[data-id]')].map((row) => ({
    id: row.dataset.reference,
    level: row.getAttribute('aria-level'),
    name: (row.getAttribute('aria-labelledby') ?? '')
      .split(' ')
      .map((id) => document.querySelector(`#${CSS.escape(id)}`)?.textContent?.trim())
      .join(' '),
  }))

describe("another space's cards in the tree", () => {
  // This space's goal with a task under it and a task under no goal; another space's
  // goal and task under ALPHA, and a task under BETA, each naming this space's project.
  const goal = boardItem(1, 'backlog', { kind: 'goal' })
  const own = [goal, boardItem(2, 'backlog', { parent_id: goal.work_item_id }), boardItem(3)]
  const alpha = { key: 'ALPHA', name: 'Alpha' }
  const elsewhere = [
    boardItem(50, 'backlog', { kind: 'goal', other_space: alpha }),
    // Its parent is in its own space, which this read does not hold.
    boardItem(51, 'done', { parent_id: boardItem(49).work_item_id, other_space: alpha }),
    boardItem(60, 'backlog', { other_space: { key: 'BETA', name: 'Beta' } }),
  ].map((item) => ({
    ...item,
    reference: item.reference.replace('MAIN', item.other_space?.key ?? 'MAIN'),
  }))
  const scope = [...elsewhere, ...own]

  async function spaces(items: WorkItemBrief[], filtered: boolean) {
    mount(WorkItemList, {
      attachTo: document.body,
      global: { plugins: [i18n()] },
      props: { items, links: [], sort: BY_REFERENCE, tree: { filtered, scope, space: 'main' } },
    })
    await flushPromises()
  }

  it('stand in one group a space, after this space’s rows, as a list without a tree', async () => {
    await spaces(scope, false)
    expect(shown()).toEqual([
      expect.objectContaining({ id: 'MAIN-1', level: '1' }),
      expect.objectContaining({ id: 'MAIN-2', level: '2' }),
      expect.objectContaining({ id: 'MAIN-3', level: '1' }),
      { id: 'group:space:ALPHA', level: '1', name: 'Space ALPHA · Alpha' },
      expect.objectContaining({ id: 'ALPHA-50', level: '2' }),
      expect.objectContaining({ id: 'ALPHA-51', level: '2' }),
      { id: 'group:space:BETA', level: '1', name: 'Space BETA · Beta' },
      expect.objectContaining({ id: 'BETA-60', level: '2' }),
    ])
    // Another space's goal holds nothing here, so it has nothing to open.
    const goalThere = document.querySelector('tbody tr[data-reference="ALPHA-50"]')
    expect(goalThere?.hasAttribute('aria-expanded')).toBe(false)
    const group = document.querySelector('tbody tr[data-reference="group:space:ALPHA"]')
    expect(group?.getAttribute('aria-expanded')).toBe('true')
  })

  it('fold from their row, which opens no card', async () => {
    const wrapper = mount(WorkItemList, {
      attachTo: document.body,
      global: { plugins: [i18n()] },
      props: {
        items: scope,
        links: [],
        sort: BY_REFERENCE,
        tree: { filtered: false, scope, space: 'main' },
      },
    })
    await flushPromises()
    const group = () =>
      document.querySelector<HTMLElement>('tbody tr[data-reference="group:space:ALPHA"]')
    group()?.querySelector<HTMLElement>('td:last-child')?.click()
    await flushPromises()
    expect(group()?.getAttribute('aria-expanded')).toBe('false')
    expect(shown().map((row) => row.id)).not.toContain('ALPHA-50')
    expect(wrapper.emitted('open')).toBeUndefined()
  })

  it('go, every group with them, when the filter keeps another space’s cards out', async () => {
    await spaces(own, true)
    expect(shown().map((row) => row.id)).toEqual(['MAIN-1', 'MAIN-2', 'MAIN-3'])
  })

  it('stand alone in their groups when the filter asks for them', async () => {
    await spaces(elsewhere, true)
    expect(shown().map((row) => row.id)).toEqual([
      'group:space:ALPHA',
      'ALPHA-50',
      'ALPHA-51',
      'group:space:BETA',
      'BETA-60',
    ])
  })
})
