/**
 * Every number above the stage counts one population: the space, or a chain
 * with its root. A view that draws fewer items says what it leaves out, so the
 * reader can add the numbers on screen up to the counts line; the grouped
 * board's epics are said by its lanes, not by the bar. The filter is the
 * workspace's: every view's `filter` event reaches it, and the address keeps it.
 */
import { defineComponent, h, nextTick, shallowRef } from 'vue'
import { createI18n } from 'vue-i18n'

import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import PlanningWorkspace from '@/pages/planning/PlanningWorkspace.vue'

import WorkItemBoard from '@/widgets/work-item-views/components/WorkItemBoard.vue'
import WorkItemList from '@/widgets/work-item-views/components/WorkItemList.vue'

import type { WorkItemChain } from '@/shared/api/planningChainApi.ts'
import type { PlanningReadModel, WorkItemBrief } from '@/shared/api/planningModel.ts'
import { messages } from '@/shared/i18n/index.ts'

import { boardEpic, boardItem, boardWorkflow } from '../fixtures/board.ts'
import { emptyChain } from '../fixtures/chain.ts'

/** The graph as the workspace hands it over: the chain's name and the number on its chip. */
vi.mock('@/pages/planning/utils/graphView.ts', () => {
  const component = defineComponent({
    props: { chain: { type: Object, default: null }, items: { type: Array, default: () => [] } },
    setup: (props) => () =>
      h('div', { class: 'graph-double' }, props.chain ? `chip ${String(props.chain.total)}` : ''),
  })
  return {
    graphView: { component, ready: shallowRef(true), load: async () => component, prefetch() {} },
  }
})

const epic = boardEpic(1)
const closedEpic = boardEpic(2, 'done')
const space: WorkItemBrief[] = [
  boardItem(10, 'backlog', { parent_id: epic.work_item_id }),
  boardItem(11, 'backlog', { parent_id: epic.work_item_id }),
  boardItem(12, 'backlog'),
  boardItem(13, 'todo', { parent_id: epic.work_item_id }),
  epic,
  boardItem(20, 'done', { parent_id: closedEpic.work_item_id }),
  closedEpic,
]

/** The chain rooted at MAIN-1 with two members; the root is not one of them. */
function chain(): WorkItemChain {
  const base = emptyChain()
  const members = [space[0], space[3]]
  return {
    ...base,
    root: { ...base.root, work_item_id: epic.work_item_id, reference: 'MAIN-1' },
    total: members.length,
    open: members.length,
    members: members.map((member, index) => ({
      work_item_id: member.work_item_id,
      reference: member.reference,
      title: member.title,
      state: { ...member.state },
      claim_ref: '',
      claim_state: null,
      parent_reference: 'MAIN-1',
      created_at: member.created_at,
      closed_at: null,
      ready: member.ready,
      rank: index + 1,
    })),
  }
}

const model: PlanningReadModel = {
  interface_version: 'valkama-planning-read-model',
  planning_spaces: [],
  planning_space: null,
  workflow: boardWorkflow,
  work_items: space,
  links: [],
  stale_claims: [],
}

function workspace(props: Partial<InstanceType<typeof PlanningWorkspace>['$props']>) {
  const wrapper = mount(PlanningWorkspace, {
    attachTo: document.body,
    props: {
      model,
      routeState: undefined,
      stale: false,
      stateBytes: 2048,
      version: 1,
      view: 'kanban' as const,
      writable: true,
      // The route answers a write with the state it was given, as the shell does.
      onState: (state: Record<string, string | number | boolean>) =>
        wrapper.setProps({ routeState: state }),
      ...props,
    },
    global: { plugins: [createI18n({ legacy: false, locale: 'en', messages })] },
  })
  return wrapper
}

/** The line of state, then what the view leaves out. */
const figures = (wrapper: ReturnType<typeof workspace>) =>
  wrapper.findAll('.workspace-figures, .workspace-left-out').map((figure) => figure.text())
const countsLine = (wrapper: ReturnType<typeof workspace>) => figures(wrapper).join(' · ')

beforeEach(() => localStorage.clear())
afterEach(() => {
  document.body.innerHTML = ''
})

describe('one population above the stage', () => {
  it('gives the chain chip the number the counts line and the board count', () => {
    const wrapper = workspace({ chain: chain() })
    const tiles = wrapper.findAll('[data-reference]').length
    expect(tiles).toBe(3)
    expect(wrapper.get('.workspace-chip').text()).toBe(`Chain MAIN-1 · ${tiles}`)
    expect(countsLine(wrapper)).toBe(`3 open of ${tiles}`)
  })

  it('counts the chain, not the space, while the graph draws the chain', () => {
    const wrapper = workspace({ chain: chain(), view: 'graph' })
    expect(countsLine(wrapper)).toBe('3 open of 3')
    expect(wrapper.get('.graph-double').text()).toBe('chip 3')
  })

  it('counts a search inside the chain while the graph draws the chain', async () => {
    const wrapper = workspace({ chain: chain(), view: 'graph' })
    await wrapper.get('input[role="combobox"]').setValue('MAIN-1')
    expect(wrapper.get('.workspace-figures').text()).toBe('3 of 3 open · Reset')
  })

  it('says how many epics the grouped board draws as rows, and counts the rest in its columns', () => {
    const wrapper = workspace({ grouping: 'epic' })
    expect(countsLine(wrapper)).toBe('5 open of 7 · 2 epics as rows')
    const columns = wrapper
      .findAll('.lanes-state-count')
      .reduce((sum, count) => sum + Number(count.text()), 0)
    // Two epics head lanes: the number the lanes' own head is to say.
    expect(columns + 2).toBe(7)
  })

  it('answers a filter with what it lets through of the open work', async () => {
    const wrapper = workspace({ grouping: 'epic' })
    await wrapper.get('input[role="combobox"]').setValue('item 1')
    // MAIN-1 heads a lane; MAIN-10 to MAIN-13 are tiles; all five are open.
    expect(figures(wrapper)).toEqual(['5 of 5 open · 1 epic as a row · Reset'])
  })

  it('says how many parents the whole-space graph draws as groups rather than nodes', () => {
    const wrapper = workspace({ view: 'graph' })
    expect(countsLine(wrapper)).toBe(
      '5 open of 7 · 2 parent tasks are drawn as groups, not nodes (1 open)',
    )
  })

  it('leaves nothing out of the flat board, the list or a chain graph', () => {
    expect(countsLine(workspace({ view: 'kanban' }))).toBe('5 open of 7')
    expect(countsLine(workspace({ view: 'list' }))).toBe('5 open of 7')
    expect(countsLine(workspace({ view: 'graph', chain: chain() }))).toBe('3 open of 3')
  })
})

describe('one filter for every view', () => {
  it('takes a view’s filter event as a token, writes it to the address, and narrows', async () => {
    const wrapper = workspace({ view: 'list', routeState: { view: 'list' } })
    const list = wrapper.getComponent(WorkItemList)
    list.vm.$emit('filter', { facet: 'kind', value: 'epic' })
    await nextTick()
    expect(wrapper.emitted('state')?.at(-1)).toEqual([{ view: 'list', kind: 'epic' }])
    expect(list.props('items').map((item) => item.reference)).toEqual(['MAIN-1', 'MAIN-2'])
    expect(wrapper.get('.workspace-chips').text()).toBe('Kind: Epic')
    // The list marks the glyph already in the filter as the way back out of it.
    expect(list.props('filter')).toEqual({ text: '', kind: ['epic'] })
    // The same mark clicked again takes it out.
    list.vm.$emit('filter', { facet: 'kind', value: 'epic' })
    await nextTick()
    expect(list.props('items')).toHaveLength(space.length)
  })

  it('hands the board the filter, and takes a mark from the card beside the views', async () => {
    const wrapper = workspace({ routeState: undefined })
    // What the card's label chips call through the surface.
    wrapper.vm.toggleFilter({ facet: 'labels', value: 'ui' })
    await nextTick()
    // The board marks a chip already in the filter as the way back out of it.
    expect(wrapper.getComponent(WorkItemBoard).props('filter')).toEqual({
      text: '',
      labels: ['ui'],
    })
    expect(wrapper.emitted('state')?.at(-1)).toEqual([{ labels: 'ui' }])
  })

  it('reads the filter the address holds, and drops it when the address does', async () => {
    const wrapper = workspace({ view: 'list', routeState: { view: 'list', labels: 'missing' } })
    expect(wrapper.find('.data-empty').exists()).toBe(true)
    expect(wrapper.get('.data-empty').text()).toContain('No work matches this filter.')
    // Back, or a space switch, to an address without a filter.
    await wrapper.setProps({ routeState: { view: 'list' } })
    expect(wrapper.find('.data-empty').exists()).toBe(false)
    expect(wrapper.getComponent(WorkItemList).props('items')).toHaveLength(space.length)
  })
})
