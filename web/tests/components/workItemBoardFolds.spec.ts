/**
 * The column of work put off: folded to a strip of its name and count when the board
 * opens, opened and folded back by a press, the choice kept per space, and open under a
 * filter that matches in it. Flat and over the lanes alike, the strip is a narrow track.
 */
import { createI18n } from 'vue-i18n'

import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import WorkItemBoard from '@/widgets/work-item-views/components/WorkItemBoard.vue'

import type { PlanningWorkflow, WorkItemRow } from '@/shared/api/planningModel.ts'
import { messages } from '@/shared/i18n/index.ts'

import { boardId, boardItem, boardWorkflow } from '../fixtures/board.ts'

/** The board's workflow with a state of work put off after Backlog. */
const PUT_OFF = {
  state_id: boardId(950),
  key: 'later',
  name: 'Later',
  category: 'deferred',
  is_terminal: false,
} as const
const workflow: PlanningWorkflow = {
  ...boardWorkflow,
  states: [
    ...boardWorkflow.states.map((state) => ({
      ...state,
      position: state.position + Number(state.position > 0),
    })),
    { ...PUT_OFF, position: 1 },
  ],
}

const space: WorkItemRow[] = [
  boardItem(10, 'backlog'),
  boardItem(11, 'backlog', { state: PUT_OFF, workable: false }),
  boardItem(12, 'backlog', { state: PUT_OFF, workable: false }),
  boardItem(13, 'todo'),
]

function board(props: Partial<InstanceType<typeof WorkItemBoard>['$props']> = {}) {
  return mount(WorkItemBoard, {
    attachTo: document.body,
    props: {
      items: space,
      links: [],
      workflow,
      spaceId: 'space-a',
      spaceItems: space,
      writable: true,
      ...props,
    },
    global: { plugins: [createI18n({ legacy: false, locale: 'en', messages })] },
  })
}

const strip = (wrapper: ReturnType<typeof board>) => wrapper.find('.column-fold')
const tracks = (wrapper: ReturnType<typeof board>) =>
  (wrapper.get('.work-item-board').element as HTMLElement).style.getPropertyValue('--board-tracks')

beforeEach(() => localStorage.clear())
afterEach(() => {
  document.body.innerHTML = ''
})

describe('the column of work put off', () => {
  it('starts folded to a strip that says its name and count and draws no tile', () => {
    const wrapper = board()
    expect(strip(wrapper).attributes('aria-label')).toBe('Unfold Later')
    expect(strip(wrapper).attributes('aria-expanded')).toBe('false')
    expect(strip(wrapper).get('.fold-count').text()).toBe('2')
    expect(wrapper.find('li[data-reference="MAIN-11"]').exists()).toBe(false)
    expect(wrapper.findAll('.work-item-column')).toHaveLength(4)
    // The strip's track is its narrow width, the others share what is left.
    expect(tracks(wrapper).split(' ')).toEqual([
      'var(--column-width)',
      '40px',
      'var(--column-width)',
      'var(--column-width)',
      'var(--column-width)',
    ])
  })

  it('opens on a press, folds again from its head, and keeps the choice per space', async () => {
    const wrapper = board()
    await strip(wrapper).trigger('click')
    expect(strip(wrapper).exists()).toBe(false)
    expect(wrapper.findAll('[data-state="later"] li[data-reference]')).toHaveLength(2)
    const fold = wrapper.get('.column-fold-button')
    expect(fold.attributes('aria-label')).toBe('Fold Later')
    expect(fold.attributes('aria-expanded')).toBe('true')

    // Another board of the same space opens it as it was left; another space does not.
    expect(strip(board()).exists()).toBe(false)
    expect(strip(board({ spaceId: 'space-b' })).exists()).toBe(true)

    await fold.trigger('click')
    expect(strip(wrapper).exists()).toBe(true)
    // Folded again, the choice agrees with the rule and is forgotten.
    expect(localStorage.getItem('valkama-board-columns')).toBe('{"space-a":{}}')
  })

  it('opens under a filter while it holds a match, and stays folded while it holds none', () => {
    const matched = space.filter((item) => item.number === 11)
    expect(strip(board({ items: matched, filtered: true })).exists()).toBe(false)
    const elsewhere = space.filter((item) => item.number === 13)
    expect(strip(board({ items: elsewhere, filtered: true })).exists()).toBe(true)
  })

  it('stands as a narrow strip over the lanes too, its cells there holding nothing', async () => {
    const wrapper = board({ grouping: 'goal' })
    const head = wrapper.get('.lanes-head .column-fold')
    expect(head.attributes('aria-label')).toBe('Unfold Later')
    expect(head.text()).toContain('2')
    expect(wrapper.findAll('.lane-folded').length).toBeGreaterThan(0)
    expect(wrapper.find('li[data-reference="MAIN-11"]').exists()).toBe(false)
    await head.trigger('click')
    expect(wrapper.find('.lane-folded').exists()).toBe(false)
    expect(wrapper.get('.lanes-fold').attributes('aria-label')).toBe('Fold Later')
  })
})
