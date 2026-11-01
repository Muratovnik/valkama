/**
 * The board as the operator meets it: grouped by epic or not, lanes folded the
 * way their work implies and the way the operator left them, and a tile moved
 * from the keyboard with the move said aloud.
 *
 * A drag is the browser suite's to prove, because the drop library needs real
 * pointer geometry; what a drop is handed up as is the same move tested here.
 */
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import PlanningWorkspace from '@/pages/planning/PlanningWorkspace.vue'

import type { WorkItemChain } from '@/shared/api/planningChainApi.ts'
import type { PlanningEdge, WorkItemBrief } from '@/shared/api/planningModel.ts'
import { messages } from '@/shared/i18n/index.ts'

import { boardId, boardItem, boardWorkflow } from '../fixtures/board.ts'
import { emptyChain } from '../fixtures/chain.ts'
import { board, epic, i18n, live, space, tile } from '../support/workItemBoardHarness.ts'

beforeEach(() => localStorage.clear())
afterEach(() => {
  document.body.innerHTML = ''
})

/**
 * A block from an item in another space, which the space's items do not hold:
 * the view's link names its source's state instead.
 */
const foreignBlock = (finished: boolean): PlanningEdge => ({
  from: '00000000-0000-4000-8000-00000000f001',
  to: boardId(10),
  kind: 'blocks',
  reference: 'OTHER-5',
  state_name: finished ? 'Done' : 'Dev',
  state_category: finished ? 'completed' : 'active',
  is_terminal: finished,
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
    // Finished work is counted in its Done cell and drawn only on request.
    expect(wrapper.find('[data-reference="MAIN-20"]').exists()).toBe(false)
    const done = wrapper.get('.lane-cell[data-state="done"] .lane-more')
    expect(done.text()).toBe('Show all · 1')
    await done.trigger('click')
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

describe('the order hint of the grouped board', () => {
  it('says the order is shared by the whole board, one order per state, across epics', () => {
    const wrapper = board({ grouping: 'epic' })
    expect(wrapper.get('[id$="-reorder"]').text()).toBe(messages.en.workItem.order.hint)
    expect(messages.en.workItem.order.hint).toContain('one order per state, across all epics')
    expect(messages.ru.workItem.order.hint).toContain('один порядок на состояние, для всех эпиков')
  })

  it('shows a reorder made in a lane that the order is the whole board’s, for a few seconds', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      const wrapper = board({ grouping: 'epic' })
      const note = wrapper.get('.board-order-note')
      expect(note.classes()).not.toContain('shown')
      // Seen, not read twice: the tiles' description already carries it.
      expect(note.attributes('aria-hidden')).toBe('true')
      expect(note.text()).toBe(messages.en.workItem.order.shared)
      await tile(wrapper, 'MAIN-11').trigger('keydown', { key: 'ArrowUp', altKey: true })
      expect(note.classes()).toContain('shown')
      vi.advanceTimersByTime(5000)
      // A second move inside the window keeps it up for its own few seconds. The
      // harness keeps no order, so the tile is still second and moves up again.
      await tile(wrapper, 'MAIN-11').trigger('keydown', { key: 'ArrowUp', altKey: true })
      vi.advanceTimersByTime(5000)
      await wrapper.vm.$nextTick()
      expect(note.classes()).toContain('shown')
      vi.advanceTimersByTime(1000)
      await wrapper.vm.$nextTick()
      expect(note.classes()).not.toContain('shown')
    } finally {
      vi.useRealTimers()
    }
  })

  it('says nothing of the kind on the flat board, where a column is the whole order', async () => {
    const wrapper = board()
    await tile(wrapper, 'MAIN-10').trigger('keydown', { key: 'ArrowDown', altKey: true })
    expect(wrapper.find('.board-order-note').exists()).toBe(false)
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

  it('hands focus back to the tile it moved once the move is drawn, and brings it into view', async () => {
    const wrapper = board()
    const moved = tile(wrapper, 'MAIN-10').element
    // The element survives the move, still focused: focusing it again scrolls
    // nothing, so being brought into view has to be asked for.
    const scroll = vi.fn()
    Object.defineProperty(moved, 'scrollIntoView', { value: scroll, configurable: true })
    moved.focus()
    await tile(wrapper, 'MAIN-10').trigger('keydown', { key: 'ArrowDown', altKey: true })
    const [first, ...rest] = space
    await wrapper.setProps({ items: [rest[0], first, ...rest.slice(1)] })
    await wrapper.vm.$nextTick()
    expect(document.activeElement).toBe(moved)
    expect(scroll).toHaveBeenCalledWith({ block: 'nearest', inline: 'nearest' })
  })

  it('draws a column a page at a time, and a tile moved past that page where it lands', async () => {
    const many = Array.from({ length: 35 }, (_, at) => boardItem(100 + at))
    const wrapper = board({ items: many, spaceItems: many })
    const drawn = () => wrapper.findAll('[data-state="backlog"] li[data-reference]').length
    expect(drawn()).toBe(30)
    expect(wrapper.get('[data-state="backlog"] .column-count').text()).toBe('35')
    await tile(wrapper, 'MAIN-129').trigger('keydown', { key: 'ArrowDown', altKey: true })
    expect(wrapper.emitted('place')).toEqual([
      [{ reference: 'MAIN-129', state: 'backlog', rank: 'after:MAIN-130' }],
    ])
    expect(drawn()).toBe(35)
  })
})

const stops = (wrapper: ReturnType<typeof board>) =>
  wrapper
    .findAll('li[data-reference] .tile-open[tabindex="0"]')
    .map((button) => button.element.closest('li')?.dataset.reference)
const focused = () => document.activeElement?.closest('li')?.dataset.reference

describe('the columns of the board', () => {
  it('stands the terminal states last, so a state after Done is read before it', () => {
    const blocked = {
      ...boardWorkflow.states[0],
      state_id: 'blocked-state',
      key: 'blocked',
      name: 'Blocked',
      category: 'blocked' as const,
      position: 9,
    }
    const workflow = { ...boardWorkflow, states: [...boardWorkflow.states, blocked] }
    const order = (grouping: 'epic' | 'none') => {
      const wrapper = board({ workflow, grouping })
      const row = grouping === 'epic' ? wrapper.findAll('.lane-cells')[0] : wrapper
      return row
        .findAll(grouping === 'epic' ? '.lane-cell' : '.work-item-column')
        .map((column) => column.attributes('data-state'))
    }
    expect(order('none')).toEqual(['backlog', 'todo', 'dev', 'blocked', 'done'])
    expect(order('epic')).toEqual(['backlog', 'todo', 'dev', 'blocked', 'done'])
  })
})

describe('a tile on the board', () => {
  const labelled = space.map((item) =>
    item.reference === 'MAIN-10'
      ? { ...item, labels: ['agent-packets', 'coordinator'], priority: 'high' as const }
      : item,
  )

  it('adds a label to the filter from its chip, without opening the card', async () => {
    const wrapper = board({ items: labelled, spaceItems: labelled })
    const chip = wrapper.get('[data-reference="MAIN-10"] .label-chip')
    await chip.trigger('click')
    expect(wrapper.emitted('filter')).toEqual([[{ facet: 'labels', value: 'agent-packets' }]])
    expect(wrapper.emitted('open')).toBeUndefined()
    // The priority glyph filters as well, also without opening anything.
    await wrapper.get('[data-reference="MAIN-10"] [data-facet="priority"]').trigger('click')
    expect(wrapper.emitted('filter')?.[1]).toEqual([{ facet: 'priority', value: 'high' }])
    expect(wrapper.emitted('open')).toBeUndefined()
    // The title opens it.
    await tile(wrapper, 'MAIN-10').trigger('click')
    expect(wrapper.emitted('open')).toEqual([['MAIN-10']])
  })

  it('stays one Tab stop however many marks filter', () => {
    const wrapper = board({ items: labelled, spaceItems: labelled })
    const focusable = wrapper
      .get('[data-reference="MAIN-10"]')
      .findAll('button, a, [tabindex]')
      .filter((element) => (element.element as HTMLElement).tabIndex >= 0)
    expect(focusable.map((element) => element.classes())).toEqual([['tile-open']])
  })

  it('names an open blocker, never a finished one, and never says workable', () => {
    const open = board({ links: [{ from: boardId(13), to: boardId(10), kind: 'blocks' }] })
    expect(
      open.get('[data-reference="MAIN-10"] [data-facet="readiness"] .facet-word-hidden').text(),
    ).toBe('Waiting on MAIN-13')
    const finished = board({ links: [{ from: boardId(20), to: boardId(11), kind: 'blocks' }] })
    expect(finished.find('[data-reference="MAIN-11"] [data-facet="readiness"]').exists()).toBe(
      false,
    )
    expect(finished.text()).not.toMatch(/workable/iu)
  })

  it('names an open blocker from another space, and not a finished one', () => {
    // The view's link names its source's state; the source is not among the
    // space's items, which is all the board used to look in.
    expect(
      board({ links: [foreignBlock(false)] })
        .get('[data-reference="MAIN-10"] [data-facet="readiness"] .facet-word-hidden')
        .text(),
    ).toBe('Waiting on OTHER-5')
    expect(
      board({ links: [foreignBlock(true)] })
        .find('[data-reference="MAIN-10"] [data-facet="readiness"]')
        .exists(),
    ).toBe(false)
  })
})

describe('walking the board from the keyboard', () => {
  it('makes each column one Tab stop that follows the tile focused in it', async () => {
    const wrapper = board()
    expect(stops(wrapper)).toEqual(['MAIN-10', 'MAIN-13', 'MAIN-1', 'MAIN-20'])
    tile(wrapper, 'MAIN-10').element.focus()
    await tile(wrapper, 'MAIN-10').trigger('keydown', { key: 'ArrowDown' })
    expect(focused()).toBe('MAIN-11')
    await wrapper.vm.$nextTick()
    expect(stops(wrapper)).toEqual(['MAIN-11', 'MAIN-13', 'MAIN-1', 'MAIN-20'])
    await tile(wrapper, 'MAIN-11').trigger('keydown', { key: 'End' })
    expect(focused()).toBe('MAIN-12')
    await tile(wrapper, 'MAIN-12').trigger('keydown', { key: 'Home' })
    expect(focused()).toBe('MAIN-10')
    // Nothing above the first tile: focus stays, and the key is not left to scroll the board.
    const up = new KeyboardEvent('keydown', { key: 'ArrowUp', cancelable: true, bubbles: true })
    tile(wrapper, 'MAIN-10').element.dispatchEvent(up)
    expect(focused()).toBe('MAIN-10')
    expect(up.defaultPrevented).toBe(true)
    // No move is asked for by a bare arrow.
    expect(wrapper.emitted('place')).toBeUndefined()
  })

  it('crosses to the nearest column with work, at the same place or the last one', async () => {
    const wrapper = board()
    tile(wrapper, 'MAIN-11').element.focus()
    await tile(wrapper, 'MAIN-11').trigger('keydown', { key: 'ArrowRight' })
    expect(focused()).toBe('MAIN-13')
    await tile(wrapper, 'MAIN-13').trigger('keydown', { key: 'ArrowRight' })
    expect(focused()).toBe('MAIN-1')
    await tile(wrapper, 'MAIN-1').trigger('keydown', { key: 'ArrowRight' })
    expect(focused()).toBe('MAIN-20')
    await tile(wrapper, 'MAIN-20').trigger('keydown', { key: 'ArrowRight' })
    expect(focused()).toBe('MAIN-20')
    await tile(wrapper, 'MAIN-20').trigger('keydown', { key: 'ArrowLeft' })
    expect(focused()).toBe('MAIN-1')
  })

  it('crosses only between the cells of one lane, past the empty ones', async () => {
    const wrapper = board({ grouping: 'epic' })
    tile(wrapper, 'MAIN-11').element.focus()
    await tile(wrapper, 'MAIN-11').trigger('keydown', { key: 'ArrowRight' })
    expect(focused()).toBe('MAIN-13')
    // Dev and Done of this lane are empty, and the lane below is another row.
    await tile(wrapper, 'MAIN-13').trigger('keydown', { key: 'ArrowRight' })
    expect(focused()).toBe('MAIN-13')
    await tile(wrapper, 'MAIN-13').trigger('keydown', { key: 'ArrowLeft' })
    expect(focused()).toBe('MAIN-10')
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
      routeState: undefined,
      stale: false,
      stateBytes: 2048,
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
      // The list draws its rows once it has measured its own width.
      await flushPromises()
      const shown = new Set(
        wrapper
          .findAll('[data-reference], tbody tr')
          .map((row) => row.text().match(/MAIN-\d+/u)?.[0]),
      )
      shown.delete(undefined)
      expect(shown).toEqual(new Set(['MAIN-1', 'MAIN-10', 'MAIN-13']))
      const chip = wrapper.get('.workspace-chip')
      expect(chip.text()).toBe('Chain MAIN-1 · 3')
      expect(chip.attributes('aria-label')).toBe('Leave chain MAIN-1 and show the whole space')
      await chip.trigger('click')
      expect(wrapper.emitted('exit-chain')).toHaveLength(1)
      expect(wrapper.text()).toContain('3 open of 3')
    },
  )

  it('offers the grouping on the board and hands the choice up', async () => {
    const wrapper = workspace('kanban')
    const grouping = wrapper.get('[role="switch"][aria-label="Group the board by epic"]')
    expect(grouping.attributes('aria-checked')).toBe('false')
    expect(grouping.text()).toBe('By epic')
    await grouping.trigger('click')
    expect(wrapper.emitted('group')).toEqual([['epic']])
  })
})
