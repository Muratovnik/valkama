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
