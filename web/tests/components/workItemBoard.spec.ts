/**
 * The board as the operator meets it: grouped by goal or not, lanes folded the
 * way their work implies and the way the operator left them, and a tile moved to
 * another column with the move said aloud. Nothing places a tile by hand.
 *
 * A drag is the browser suite's to prove, because the drop library needs real
 * pointer geometry. Here the library is a stand-in that keeps each stack's
 * options, and a drop is its end handed the stacks a real one would name.
 */
import { createPinia, setActivePinia } from 'pinia'

import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import PlanningWorkspace from '@/pages/planning/PlanningWorkspace.vue'

import type { WorkItemChain } from '@/shared/api/planningChainApi.ts'
import type { PlanningEdge, WorkItemRow } from '@/shared/api/planningModel.ts'
import { messages } from '@/shared/i18n/index.ts'
import type { MenuEntry } from '@/shared/ui/menuEntries.ts'
import VMenu from '@/shared/ui/VMenu.vue'

import { boardId, boardItem, boardWorkflow } from '../fixtures/board.ts'
import { emptyChain } from '../fixtures/chain.ts'
import { board, goal, i18n, live, space, tile } from '../support/workItemBoardHarness.ts'

/** Each stack's list and the options it gave the drop library, in mount order. */
const sortables = vi.hoisted(
  () =>
    [] as { list: { value: HTMLElement | null }; options: { onEnd: (event: object) => void } }[],
)
vi.mock('@vueuse/integrations/useSortable', () => ({
  useSortable: (list: (typeof sortables)[number]['list'], _items: unknown, options: object) => {
    sortables.push({ list, options: options as (typeof sortables)[number]['options'] })
    return { option: vi.fn() }
  },
}))

/** A drop as the library ends one: the tile already in the stack of `state`, at `at`. */
function drop(wrapper: ReturnType<typeof board>, reference: string, state: string, at = 0) {
  const item = wrapper.get(`li[data-reference="${reference}"]`).element as HTMLElement
  const from = item.parentElement as HTMLElement
  const to = wrapper.get(`.work-item-stack[data-state="${state}"]`).element as HTMLElement
  const oldIndex = [...from.children].indexOf(item)
  to.insertBefore(item, to.children[at] ?? null)
  const sortable = sortables.find((entry) => entry.list.value === from)
  sortable?.options.onEnd({ from, to, item, oldIndex })
}

beforeEach(() => {
  localStorage.clear()
  setActivePinia(createPinia())
})
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

describe('the board grouped by goal', () => {
  it('heads each lane with its goal and its counts, the work under no goal last', () => {
    const wrapper = board({ grouping: 'goal' })
    const lanes = wrapper.findAll('.board-lane')
    expect(lanes.map((lane) => lane.attributes('aria-label'))).toEqual([
      'Item 1',
      'Item 2',
      'No goal',
    ])
    expect(lanes[0].get('.lane-reference').text()).toBe('MAIN-1')
    expect(lanes[0].get('.lane-counts').text()).toBe('0 of 3 closed')
    expect(lanes[0].get('.lane-state').text()).toBe('In progress')
    expect(lanes[1].get('.lane-counts').text()).toBe('1 of 1 closed')
    // The goal is the lane, never a tile in it.
    expect(wrapper.find('[data-reference="MAIN-1"]').exists()).toBe(false)
    expect(lanes[0].findAll('[data-reference]').map((item) => item.text())).toEqual([
      expect.stringContaining('MAIN-10'),
      expect.stringContaining('MAIN-11'),
      expect.stringContaining('MAIN-13'),
    ])
  })

  it('folds a lane with nothing open, and remembers what the operator chose per space', async () => {
    const wrapper = board({ grouping: 'goal' })
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

    const again = board({ grouping: 'goal' })
    expect(
      again.findAll('.lane-toggle').map((toggle) => toggle.attributes('aria-expanded')),
    ).toEqual(['false', 'true', 'true'])
    again.unmount()
    // Another space has choices of its own.
    const other = board({ grouping: 'goal', spaceId: 'space-b' })
    expect(
      other.findAll('.lane-toggle').map((toggle) => toggle.attributes('aria-expanded')),
    ).toEqual(['true', 'false', 'true'])
  })

  it('asks for a goal’s chain on the board and opens its card from the lane', async () => {
    const wrapper = board({ grouping: 'goal' })
    const lane = wrapper.findAll('.board-lane')[0]
    await lane.get('[aria-label="Show the chain of MAIN-1 on the board"]').trigger('click')
    await lane.get('[aria-label="Open MAIN-1"]').trigger('click')
    expect(wrapper.emitted('chain')).toEqual([['MAIN-1']])
    expect(wrapper.emitted('open')).toEqual([['MAIN-1']])
  })
})

describe('a tile on the board is never placed by hand', () => {
  it('is described by a hint of the arrows alone, in both languages', () => {
    for (const grouping of ['none', 'goal'] as const) {
      const wrapper = board({ grouping })
      expect(wrapper.get('[id$="-keys"]').text()).toBe(messages.en.workItem.order.hint)
      // No note says a shared order beside the hint: nothing is placed by hand to be told of.
      expect(wrapper.text()).not.toMatch(/order is shared/iu)
      wrapper.unmount()
    }
    expect(messages.en.workItem.order.hint).toBe('Arrow keys move focus between work items.')
    expect(messages.ru.workItem.order.hint).toBe('Стрелки переводят фокус между задачами.')
  })

  it('takes Alt+ArrowUp and Alt+ArrowDown for nothing: no write, no focus moved', async () => {
    for (const grouping of ['none', 'goal'] as const) {
      const wrapper = board({ grouping })
      tile(wrapper, 'MAIN-11').element.focus()
      for (const key of ['ArrowUp', 'ArrowDown']) {
        await tile(wrapper, 'MAIN-11').trigger('keydown', { key, altKey: true })
      }
      expect(wrapper.emitted('place')).toBeUndefined()
      expect(document.activeElement).toBe(tile(wrapper, 'MAIN-11').element)
      expect(tile(wrapper, 'MAIN-11').attributes('aria-keyshortcuts')).toBeUndefined()
      wrapper.unmount()
    }
  })

  it('sends nothing for a tile dropped elsewhere in its own column', async () => {
    const wrapper = board()
    drop(wrapper, 'MAIN-10', 'backlog', 2)
    await wrapper.vm.$nextTick()
    expect(wrapper.emitted('place')).toBeUndefined()
    // Put back where Vue drew it: the order is the one the server sent.
    expect(
      wrapper
        .findAll('[data-state="backlog"] li[data-reference]')
        .map((li) => li.attributes('data-reference')),
    ).toEqual(['MAIN-10', 'MAIN-11', 'MAIN-12'])
  })

  it('sends a tile dropped in another column as that state alone, and says it went last', async () => {
    const wrapper = board()
    drop(wrapper, 'MAIN-10', 'todo')
    expect(wrapper.emitted('place')).toEqual([[{ reference: 'MAIN-10', state: 'todo' }]])
    await flushPromises()
    expect(live(wrapper)).toBe('MAIN-10 moved: 2 of 2 in Todo')
  })

  it('draws a column a page at a time, its count the whole state’s', () => {
    const many = Array.from({ length: 35 }, (_, at) => boardItem(100 + at))
    const wrapper = board({ items: many, spaceItems: many })
    expect(wrapper.findAll('[data-state="backlog"] li[data-reference]')).toHaveLength(30)
    expect(wrapper.get('[data-state="backlog"] .column-count').text()).toBe('35')
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
    const order = (grouping: 'goal' | 'none') => {
      const wrapper = board({ workflow, grouping })
      const row = grouping === 'goal' ? wrapper.findAll('.lane-cells')[0] : wrapper
      return row
        .findAll(grouping === 'goal' ? '.lane-cell' : '.work-item-column')
        .map((column) => column.attributes('data-state'))
    }
    expect(order('none')).toEqual(['backlog', 'todo', 'dev', 'blocked', 'done'])
    expect(order('goal')).toEqual(['backlog', 'todo', 'dev', 'blocked', 'done'])
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
    // The priority glyph is read, not pressed as a filter: it is no button and
    // adds nothing to the filter. It lies on the sheet, so it opens the card.
    const glyph = wrapper.get('[data-reference="MAIN-10"] [data-facet="priority"]')
    expect(glyph.element.tagName).toBe('SPAN')
    await glyph.trigger('click')
    expect(wrapper.emitted('filter')).toHaveLength(1)
    expect(wrapper.emitted('open')).toEqual([['MAIN-10']])
    // So does the title.
    await tile(wrapper, 'MAIN-10').trigger('click')
    expect(wrapper.emitted('open')).toEqual([['MAIN-10'], ['MAIN-10']])
  })

  it('stays one Tab stop however many marks filter', () => {
    const wrapper = board({ items: labelled, spaceItems: labelled })
    const focusable = wrapper
      .get('[data-reference="MAIN-10"]')
      .findAll('button, a, [tabindex]')
      .filter((element) => (element.element as HTMLElement).tabIndex >= 0)
    expect(focusable.map((element) => element.classes())).toEqual([['tile-open']])
  })

  it('opens the card from a press on what stops the work', async () => {
    const wrapper = board({ links: [{ from: boardId(13), to: boardId(10), kind: 'blocks' }] })
    await wrapper.get('[data-reference="MAIN-10"] [data-facet="readiness"]').trigger('click')
    expect(wrapper.emitted('open')).toEqual([['MAIN-10']])
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
    expect(stops(wrapper)).toEqual(['MAIN-10', 'MAIN-13', 'MAIN-20'])
    tile(wrapper, 'MAIN-10').element.focus()
    await tile(wrapper, 'MAIN-10').trigger('keydown', { key: 'ArrowDown' })
    expect(focused()).toBe('MAIN-11')
    await wrapper.vm.$nextTick()
    expect(stops(wrapper)).toEqual(['MAIN-11', 'MAIN-13', 'MAIN-20'])
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
    // Dev holds only the goal, which is no tile: the walk goes on to Done.
    await tile(wrapper, 'MAIN-13').trigger('keydown', { key: 'ArrowRight' })
    expect(focused()).toBe('MAIN-20')
    await tile(wrapper, 'MAIN-20').trigger('keydown', { key: 'ArrowRight' })
    expect(focused()).toBe('MAIN-20')
    await tile(wrapper, 'MAIN-20').trigger('keydown', { key: 'ArrowLeft' })
    expect(focused()).toBe('MAIN-13')
  })

  it('crosses only between the cells of one lane, past the empty ones', async () => {
    const wrapper = board({ grouping: 'goal' })
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

function chainOf(members: WorkItemRow[]): WorkItemChain {
  const chain = emptyChain()
  return {
    ...chain,
    root: { ...chain.root, work_item_id: goal.work_item_id, reference: 'MAIN-1' },
    total: members.length,
    open: members.length,
    members: members.map((member) => ({
      work_item_id: member.work_item_id,
      reference: member.reference,
      title: member.title,
      kind: member.kind,
      state: member.state,
      open: member.open,
      container_state: member.container_state,
      claim_ref: '',
      claim_state: null,
      parent_reference: 'MAIN-1',
      created_at: member.created_at,
      closed_at: null,
      workable: member.workable,
      queue_order: member.queue_order,
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
      viewPlace: 'scope:MAIN',
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
      // The board draws the root as no tile: a goal is a lane once accepted, here as its chip.
      const root = view === 'list' ? ['MAIN-1'] : []
      expect(shown).toEqual(new Set([...root, 'MAIN-10', 'MAIN-13']))
      const chip = wrapper.get('.workspace-chip')
      expect(chip.text()).toBe('Chain MAIN-1 · 3')
      expect(chip.attributes('aria-label')).toBe('Leave chain MAIN-1 and show the whole space')
      await chip.trigger('click')
      expect(wrapper.emitted('exit-chain')).toHaveLength(1)
      expect(wrapper.text()).toContain('3 open of 3')
    },
  )

  it('offers the grouping in the view’s menu on the board and hands the choice up', () => {
    const wrapper = workspace('kanban')
    const entries = wrapper.getComponent(VMenu).props('entries') as MenuEntry[]
    const grouping = entries.find((entry) => entry.key === 'grouping')
    if (grouping?.kind !== 'choice') throw new Error('the grouping is a choice of the view’s menu')
    expect(grouping.value).toBe('none')
    expect(grouping.options.map((option) => option.label)).toEqual([
      'No grouping',
      'By goal',
      'By stage',
      'By project',
    ])
    grouping.select('goal')
    expect(wrapper.emitted('group')).toEqual([['goal']])
  })
})
