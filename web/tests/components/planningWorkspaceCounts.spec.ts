/**
 * Every number above the stage counts one population: the space, or a chain
 * with its root. A view that draws fewer items says what it leaves out, so the
 * reader can add the numbers on screen up to the counts line.
 */
import { defineComponent, h, shallowRef } from 'vue'
import { createI18n } from 'vue-i18n'

import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import PlanningWorkspace from '@/pages/planning/PlanningWorkspace.vue'

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
  return mount(PlanningWorkspace, {
    attachTo: document.body,
    props: { model, stale: false, version: 1, view: 'kanban', writable: true, ...props },
    global: { plugins: [createI18n({ legacy: false, locale: 'en', messages })] },
  })
}

/** The figures the bar shows beside the action, one entry each. */
const figures = (wrapper: ReturnType<typeof workspace>) =>
  wrapper.findAll('.workspace-figures > span').map((figure) => figure.text())
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
    expect(countsLine(wrapper)).toBe(`3 open of ${tiles} · 0 open claimed`)
  })

  it('counts the chain, not the space, while the graph draws the chain', () => {
    const wrapper = workspace({ chain: chain(), view: 'graph' })
    expect(countsLine(wrapper)).toBe('3 open of 3 · 0 open claimed')
    expect(wrapper.get('.graph-double').text()).toBe('chip 3')
  })

  it('counts a search inside the chain while the graph draws the chain', async () => {
    const wrapper = workspace({ chain: chain(), view: 'graph' })
    await wrapper.get('input').setValue('MAIN-1')
    expect(wrapper.get('[role="status"]').text()).toBe('3 shown of 3')
  })

  it('says how many epics head lanes instead of standing in the columns', () => {
    const wrapper = workspace({ grouping: 'epic' })
    expect(countsLine(wrapper)).toBe(
      '5 open of 7 · 0 open claimed · lane epics outside the columns: 2',
    )
    const columns = wrapper
      .findAll('.lanes-state-count')
      .reduce((sum, count) => sum + Number(count.text()), 0)
    expect(columns + 2).toBe(7)
  })

  it('says what a filter leaves of the lane epics', async () => {
    const wrapper = workspace({ grouping: 'epic' })
    await wrapper.get('input').setValue('item 1')
    // MAIN-1 heads a lane; MAIN-10 to MAIN-13 are tiles.
    expect(figures(wrapper)).toEqual([
      '5 open of 7 · 0 open claimed',
      '5 shown of 7',
      'lane epics outside the columns: 1',
    ])
  })

  it('says how many parents the whole-space graph draws as groups rather than nodes', () => {
    const wrapper = workspace({ view: 'graph' })
    expect(countsLine(wrapper)).toBe(
      '5 open of 7 · 0 open claimed · parents not drawn on the graph: 2, 1 of them open',
    )
  })

  it('leaves nothing out of the flat board, the list or a chain graph', () => {
    expect(countsLine(workspace({ view: 'kanban' }))).toBe('5 open of 7 · 0 open claimed')
    expect(countsLine(workspace({ view: 'list' }))).toBe('5 open of 7 · 0 open claimed')
    expect(countsLine(workspace({ view: 'graph', chain: chain() }))).toBe(
      '3 open of 3 · 0 open claimed',
    )
  })
})
