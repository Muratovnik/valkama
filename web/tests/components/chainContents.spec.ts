/**
 * A goal's contents on its card: the counts the chain read gives in scope `tree`, and the work
 * under the goal as the tree of rows, its stages opening down to their tasks.
 *
 * The goal here, MAIN-1, holds a stage MAIN-2 with two tasks, one finished and one under way;
 * a stage MAIN-5 whose only task is finished; and a task MAIN-7 of its own. MAIN-5 holds no
 * open work, so it starts folded, as the tree of rows folds a container with none; MAIN-2
 * holds some, so it starts open.
 */
import { createI18n } from 'vue-i18n'

import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'

import ChainContents from '@/widgets/work-item-inspector/components/ChainContents.vue'

import type { ChainMember, WorkItemChain } from '@/shared/api/planningChainApi.ts'
import { messages } from '@/shared/i18n/index.ts'

const SPACE = '00000000-0000-4000-8000-0000000000aa'

const id = (number: number) => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`

const DONE = { key: 'done', name: 'Done', category: 'completed', is_terminal: true } as const
const DEV = { key: 'dev', name: 'Dev', category: 'active', is_terminal: false } as const

function member(number: number, parent: number, overrides: Partial<ChainMember> = {}): ChainMember {
  return {
    work_item_id: id(number),
    reference: `MAIN-${number}`,
    title: `Item ${number}`,
    kind: 'task',
    state: DEV,
    open: true,
    container_state: null,
    claim_ref: '',
    claim_state: null,
    parent_reference: `MAIN-${parent}`,
    created_at: '2026-10-20T10:00:00Z',
    closed_at: null,
    workable: false,
    queue_order: null,
    ...overrides,
  }
}

const stage = (number: number, derived: ChainMember['container_state']) =>
  member(number, 1, { kind: 'stage', state: null, container_state: derived })
const finished = (number: number, parent: number) =>
  member(number, parent, { state: DONE, open: false, closed_at: '2026-10-29T10:00:00Z' })

/** In the order the read gives them, which is not their numbers' order. */
const MEMBERS = [
  stage(2, 'in_progress'),
  member(4, 2, { claim_ref: 'codex (session 1baa03d7)', claim_state: 'live' }),
  finished(3, 2),
  stage(5, 'awaiting_confirmation'),
  finished(6, 5),
  member(7, 1),
]

function contents(members: ChainMember[] = MEMBERS): WorkItemChain {
  return {
    root: {
      work_item_id: id(1),
      reference: 'MAIN-1',
      title: 'Goal',
      kind: 'goal',
      has_children: members.length > 0,
      totals: { chain: members.length, tree: members.length },
    },
    scope: 'tree',
    total: members.length,
    closed: 2,
    open: members.length - 2,
    workable: 0,
    // What the server counts, written out: two tasks under way, two done; the two stages
    // derive a state of their own and stand in no category.
    by_category: { active: 2, completed: 2 },
    by_container_state: { in_progress: 1, awaiting_confirmation: 1 },
    origins: [],
    series: [],
    recent: { days: 7, created: 0, closed: 0, trend: 'steady' },
    members,
    edges: [],
  }
}

let wrapper: VueWrapper | null = null

function mountContents(chain = contents()) {
  wrapper = mount(ChainContents, {
    attachTo: document.body,
    props: { chain, space: SPACE },
    global: { plugins: [createI18n({ legacy: false, locale: 'en', messages })] },
  })
  return wrapper
}

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
  localStorage.clear()
})

/** Each shown row as its reference, at its level, with whether it is open where it can be. */
function shownRows(found: VueWrapper) {
  return found.findAll('tbody tr').map((row) => {
    const shown = [row.attributes('aria-level'), row.attributes('data-reference')]
    const expanded = row.attributes('aria-expanded')
    return (expanded === undefined ? shown : [...shown, expanded]).join(' ')
  })
}

const row = (found: VueWrapper, reference: string) => found.get(`tr[data-reference="${reference}"]`)

describe('a goal’s contents', () => {
  it('says how much of its work stands in each state, as the read counts it', () => {
    const found = mountContents()
    const counts = (line: string) =>
      found
        .get(`[data-counts="${line}"]`)
        .findAll('[data-count]')
        .map((count) => `${count.attributes('data-count')} ${count.text()}`)
    expect(found.get('[data-counts="category"]').text()).toContain('By state')
    expect(counts('category')).toEqual(['active In progress2', 'completed Done2'])
    // The stages' own states stand apart, under their own words.
    expect(found.get('[data-counts="container"]').text()).toContain('Goals and stages')
    expect(counts('container')).toEqual([
      'in_progress In progress1',
      'awaiting_confirmation Awaiting confirmation1',
    ])
  })

  it('draws the work as a tree, a stage with open work open and one with none folded', () => {
    const found = mountContents()
    expect(found.get('table').attributes('role')).toBe('treegrid')
    expect(shownRows(found)).toEqual([
      '1 MAIN-2 true',
      '2 MAIN-4',
      '2 MAIN-3',
      '1 MAIN-5 false',
      '1 MAIN-7',
    ])
    // A row says where it stands, and who holds it only while it is open.
    expect(row(found, 'MAIN-2').text()).toContain('In progress')
    expect(row(found, 'MAIN-5').text()).toContain('Awaiting confirmation')
    expect(row(found, 'MAIN-4').text()).toContain('codex')
    expect(row(found, 'MAIN-3').text()).toContain('Done')
    expect(row(found, 'MAIN-3').find('.contents-holder').text()).toBe('')
  })

  it('opens a folded stage by its arrow, and keeps the choice for the space', async () => {
    const found = mountContents()
    await row(found, 'MAIN-5').get('button[aria-label="Unfold MAIN-5"]').trigger('click')
    expect(shownRows(found)).toContain('2 MAIN-6')
    expect(row(found, 'MAIN-5').attributes('aria-expanded')).toBe('true')
    // The press folds or opens, and does not open the card.
    expect(found.emitted('open')).toBeUndefined()
    expect(JSON.parse(localStorage.getItem('valkama-tree-folds') ?? '{}')).toEqual({
      [SPACE]: { [id(5)]: false },
    })
  })

  it('walks the rows with the tree’s keys and opens a card by Enter or a press', async () => {
    const found = mountContents()
    // The keys listen on the rows once they are drawn.
    await flushPromises()
    const stageRow = row(found, 'MAIN-5')
    // One Tab stop: the first row.
    expect(
      found.findAll('tbody tr[tabindex="0"]').map((tr) => tr.attributes('data-reference')),
    ).toEqual(['MAIN-2'])
    ;(stageRow.element as HTMLElement).focus()
    await stageRow.trigger('keydown', { key: 'ArrowRight' })
    expect(stageRow.attributes('aria-expanded')).toBe('true')
    const task = row(found, 'MAIN-6')
    ;(task.element as HTMLElement).focus()
    await task.trigger('keydown', { key: 'ArrowLeft' })
    expect(document.activeElement).toBe(stageRow.element)
    await stageRow.trigger('keydown', { key: 'Enter' })
    await row(found, 'MAIN-7').get('.contents-title').trigger('click')
    expect(found.emitted('open')).toEqual([['MAIN-5'], ['MAIN-7']])
  })

  it('says a goal with nothing inside has no work yet, and draws no tree', () => {
    const empty = contents([])
    const found = mountContents({
      ...empty,
      closed: 0,
      open: 0,
      by_category: {},
      by_container_state: {},
    })
    expect(found.text()).toContain('Nothing under it yet.')
    expect(found.find('table').exists()).toBe(false)
    expect(found.find('[data-counts]').exists()).toBe(false)
  })
})
