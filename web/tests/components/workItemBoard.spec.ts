/**
 * The board as the operator meets it: grouped by epic or not, lanes folded the
 * way their work implies and the way the operator left them, and a tile moved
 * from the keyboard with the move said aloud.
 *
 * A drag is the browser suite's to prove, because the drop library needs real
 * pointer geometry; what a drop is handed up as is the same move tested here.
 */
import { createI18n } from 'vue-i18n'

import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import PlanningWorkspace from '@/pages/planning/PlanningWorkspace.vue'

import WorkItemBoard from '@/widgets/work-item-views/components/WorkItemBoard.vue'

import type { WorkItemChain } from '@/shared/api/planningChainApi.ts'
import type { WorkItemBrief } from '@/shared/api/planningModel.ts'
import { messages } from '@/shared/i18n/index.ts'

import { boardEpic, boardItem, boardWorkflow } from '../fixtures/board.ts'
import { emptyChain } from '../fixtures/chain.ts'

const i18n = () => createI18n({ legacy: false, locale: 'en', messages })

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

function board(props: Partial<InstanceType<typeof WorkItemBoard>['$props']> = {}) {
  return mount(WorkItemBoard, {
    attachTo: document.body,
    props: {
      items: space,
      links: [],
      workflow: boardWorkflow,
      spaceId: 'space-a',
      spaceItems: space,
      writable: true,
      ...props,
    },
    global: { plugins: [i18n()] },
  })
}

function tile(wrapper: ReturnType<typeof board>, reference: string) {
  return wrapper.get(`[data-reference="${reference}"] .work-item-tile`)
}

function live(wrapper: ReturnType<typeof board>) {
  return wrapper.get('[role="status"]').text()
}

beforeEach(() => localStorage.clear())
afterEach(() => {
  document.body.innerHTML = ''
})

describe('the board grouped by epic', () => {
  it('heads each lane with its epic and its counts, the work under no epic last', () => {
    const wrapper = board({ grouping: 'epic' })
    const lanes = wrapper.findAll('.board-lane')
    expect(lanes.map((lane) => lane.attributes('aria-label'))).toEqual([
      'Item 1',
      'Item 2',
      'No epic',
    ])
    expect(lanes[0].get('.lane-reference').text()).toBe('MAIN-1')
    expect(lanes[0].get('.lane-counts').text()).toBe('3 open · 0 closed')
    expect(lanes[0].get('.lane-state').text()).toBe('Dev')
    expect(lanes[1].get('.lane-counts').text()).toBe('0 open · 1 closed')
    // The epic is the lane, never a tile in it.
    expect(wrapper.find('[data-reference="MAIN-1"]').exists()).toBe(false)
    expect(lanes[0].findAll('[data-reference]').map((item) => item.text())).toEqual([
      expect.stringContaining('MAIN-10'),
      expect.stringContaining('MAIN-11'),
      expect.stringContaining('MAIN-13'),
    ])
  })

  it('folds a lane with nothing open, and remembers what the operator chose per space', async () => {
    const wrapper = board({ grouping: 'epic' })
    const toggles = () => wrapper.findAll('.lane-toggle')
    expect(toggles().map((toggle) => toggle.attributes('aria-expanded'))).toEqual([
      'true',
      'false',
      'true',
    ])
    expect(wrapper.find('[data-reference="MAIN-20"]').exists()).toBe(false)
    await toggles()[1].trigger('click')
    await toggles()[0].trigger('click')
    expect(wrapper.find('[data-reference="MAIN-20"]').exists()).toBe(true)
    expect(wrapper.find('[data-reference="MAIN-10"]').exists()).toBe(false)
    wrapper.unmount()

    const again = board({ grouping: 'epic' })
    expect(
      again.findAll('.lane-toggle').map((toggle) => toggle.attributes('aria-expanded')),
    ).toEqual(['false', 'true', 'true'])
    again.unmount()
    // Another space has choices of its own.
    const other = board({ grouping: 'epic', spaceId: 'space-b' })
    expect(
      other.findAll('.lane-toggle').map((toggle) => toggle.attributes('aria-expanded')),
    ).toEqual(['true', 'false', 'true'])
  })

  it('asks for an epic’s chain on the board and opens its card from the lane', async () => {
    const wrapper = board({ grouping: 'epic' })
    const lane = wrapper.findAll('.board-lane')[0]
    await lane.get('[aria-label="Show the chain of MAIN-1 on the board"]').trigger('click')
    await lane.get('[aria-label="Open MAIN-1"]').trigger('click')
    expect(wrapper.emitted('chain')).toEqual([['MAIN-1']])
    expect(wrapper.emitted('open')).toEqual([['MAIN-1']])
  })
})

describe('moving a tile from the keyboard', () => {
  it('moves it one place with Alt+ArrowDown and says where it went', async () => {
    const wrapper = board()
    await tile(wrapper, 'MAIN-10').trigger('keydown', { key: 'ArrowDown', altKey: true })
    expect(wrapper.emitted('place')).toEqual([
      [{ reference: 'MAIN-10', state: 'backlog', rank: 'after:MAIN-11' }],
    ])
    await wrapper.vm.$nextTick()
    expect(live(wrapper)).toBe('MAIN-10 moved: 2 of 3 in Backlog')
  })

  it('moves it up with Alt+ArrowUp inside its lane, before the tile above it there', async () => {
    const wrapper = board({ grouping: 'epic' })
    await tile(wrapper, 'MAIN-11').trigger('keydown', { key: 'ArrowUp', altKey: true })
    expect(wrapper.emitted('place')).toEqual([
      [{ reference: 'MAIN-11', state: 'backlog', rank: 'before:MAIN-10' }],
    ])
  })

  it('says so at the end of its column instead of moving it', async () => {
    const wrapper = board()
    await tile(wrapper, 'MAIN-10').trigger('keydown', { key: 'ArrowUp', altKey: true })
    await wrapper.vm.$nextTick()
    expect(wrapper.emitted('place')).toBeUndefined()
    expect(live(wrapper)).toBe('MAIN-10 is already first')
  })

  it('answers no other keys, and nothing at all where nothing may be written', async () => {
    const wrapper = board()
    await tile(wrapper, 'MAIN-10').trigger('keydown', { key: 'ArrowDown' })
    await tile(wrapper, 'MAIN-10').trigger('keydown', {
      key: 'ArrowDown',
      altKey: true,
      shiftKey: true,
    })
    expect(wrapper.emitted('place')).toBeUndefined()
    expect(tile(wrapper, 'MAIN-10').attributes('aria-keyshortcuts')).toBe(
      'Alt+ArrowUp Alt+ArrowDown',
    )
    const readOnly = board({ writable: false })
    await tile(readOnly, 'MAIN-10').trigger('keydown', { key: 'ArrowDown', altKey: true })
    expect(readOnly.emitted('place')).toBeUndefined()
    expect(tile(readOnly, 'MAIN-10').attributes('aria-keyshortcuts')).toBeUndefined()
  })

  it('hands focus back to the tile it moved once the move is drawn', async () => {
    const wrapper = board()
    tile(wrapper, 'MAIN-10').element.focus()
    await tile(wrapper, 'MAIN-10').trigger('keydown', { key: 'ArrowDown', altKey: true })
    const [moved, ...rest] = space
    await wrapper.setProps({ items: [rest[0], moved, ...rest.slice(1)] })
    await wrapper.vm.$nextTick()
    expect(document.activeElement).toBe(tile(wrapper, 'MAIN-10').element)
  })
})

function chainOf(members: WorkItemBrief[]): WorkItemChain {
  const chain = emptyChain()
  return {
    ...chain,
    root: { ...chain.root, work_item_id: epic.work_item_id, reference: 'MAIN-1' },
    total: members.length,
    open: members.length,
    members: members.map((member, index) => ({
      work_item_id: member.work_item_id,
      reference: member.reference,
      title: member.title,
      state: {
        key: member.state.key,
        name: member.state.name,
        category: member.state.category,
        is_terminal: member.state.is_terminal,
      },
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

function workspace(view: 'kanban' | 'list') {
  return mount(PlanningWorkspace, {
    props: {
      model: {
        interface_version: 'valkama-planning-read-model' as const,
        planning_spaces: [],
        planning_space: null,
        workflow: boardWorkflow,
        work_items: space,
        links: [],
        stale_claims: [],
      },
      chain: chainOf([space[0], space[3]]),
      stale: false,
      version: 1,
      view,
      writable: true,
    },
    global: { plugins: [i18n()] },
  })
}

describe('a chain narrows the board and the list', () => {
  it.each(['kanban', 'list'] as const)(
    'draws only the chain and its root in the %s view, with the chip to leave it',
    async (view) => {
      const wrapper = workspace(view)
      const shown = new Set(
        wrapper
          .findAll('[data-reference], tbody tr')
          .map((row) => row.text().match(/MAIN-\d+/u)?.[0]),
      )
      shown.delete(undefined)
      expect(shown).toEqual(new Set(['MAIN-1', 'MAIN-10', 'MAIN-13']))
      const chip = wrapper.get('.workspace-chip')
      expect(chip.text()).toBe('Chain MAIN-1 · 2')
      expect(chip.attributes('aria-label')).toBe('Leave chain MAIN-1 and show the whole space')
      await chip.trigger('click')
      expect(wrapper.emitted('exit-chain')).toHaveLength(1)
      expect(wrapper.text()).toContain('3 open of 3')
    },
  )

  it('offers the grouping on the board and hands the choice up', async () => {
    const wrapper = workspace('kanban')
    const segment = wrapper.findAll('[aria-label="Board grouping"] button')
    expect(segment.map((entry) => entry.text())).toEqual(['No grouping', 'By epic'])
    await segment[1].trigger('click')
    expect(wrapper.emitted('group')).toEqual([['epic']])
  })
})
