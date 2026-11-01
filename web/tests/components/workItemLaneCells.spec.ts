import { flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import WorkItemLaneCell from '@/widgets/work-item-views/components/WorkItemLaneCell.vue'

import { boardItem } from '../fixtures/board.ts'
import { board, epic, tile } from '../support/workItemBoardHarness.ts'

beforeEach(() => localStorage.clear())
afterEach(() => {
  document.body.innerHTML = ''
})

const doneCell = (wrapper: ReturnType<typeof board>) => wrapper.get('.lane-cell[data-state="done"]')

const backlog = (wrapper: ReturnType<typeof board>) =>
  wrapper.findAll('.lane-cell[data-state="backlog"] li[data-reference]').map((item) => item.text())

describe('a lane cell', () => {
  const crowded = [
    epic,
    ...Array.from({ length: 5 }, (_, at) =>
      boardItem(30 + at, 'backlog', { parent_id: epic.work_item_id }),
    ),
    boardItem(36, 'todo', { parent_id: epic.work_item_id }),
  ]
  const crowdedBoard = () => board({ grouping: 'epic', items: crowded, spaceItems: crowded })

  it('draws its first three tiles and offers the rest by their count', async () => {
    const wrapper = crowdedBoard()
    expect(backlog(wrapper)).toHaveLength(3)
    expect(backlog(wrapper)[0]).toContain('MAIN-30')
    const more = wrapper.get<HTMLElement>('.lane-cell[data-state="backlog"] .lane-more')
    expect(more.text()).toBe('Show all · 5')
    // A cell that holds no more than it draws offers nothing.
    expect(wrapper.find('.lane-cell[data-state="todo"] .lane-more').exists()).toBe(false)
    await more.trigger('click')
    await flushPromises()
    expect(backlog(wrapper)).toHaveLength(5)
  })

  it('opens and closes as a disclosure, with focus on what it revealed and then on itself', async () => {
    const wrapper = crowdedBoard()
    const cell = wrapper.get('.lane-cell[data-state="backlog"]')
    const more = cell.get('.lane-more')
    const list = cell.get('ul')
    expect(more.attributes('aria-expanded')).toBe('false')
    expect(more.attributes('aria-controls')).toBe(list.attributes('id'))
    expect(list.attributes('id')).toBeTruthy()

    await more.trigger('click')
    await flushPromises()
    expect(backlog(wrapper)).toHaveLength(5)
    expect(more.text()).toBe('Show fewer')
    expect(more.attributes('aria-expanded')).toBe('true')
    // The toggle stays at the end of the cell, after the tiles it revealed.
    expect(cell.element.lastElementChild).toBe(more.element)
    // Focus goes to the first tile it revealed, not to the page.
    expect(document.activeElement).toBe(tile(wrapper, 'MAIN-33').element)

    await more.trigger('click')
    await flushPromises()
    expect(backlog(wrapper)).toHaveLength(3)
    expect(more.text()).toBe('Show all · 5')
    expect(more.attributes('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(more.element)
  })

  it('closes a cell a landing opened, once the reader asks', async () => {
    const wrapper = crowdedBoard()
    const todoCell = wrapper
      .findAllComponents(WorkItemLaneCell)
      .find((cell) => cell.props('state').key === 'todo')
    todoCell?.vm.$emit(
      'place',
      { reference: 'MAIN-36', state: 'backlog', rank: 'last' },
      { keyboard: false, position: 6, total: 6 },
    )
    await flushPromises()
    const more = wrapper.get<HTMLElement>('.lane-cell[data-state="backlog"] .lane-more')
    expect(more.text()).toBe('Show fewer')
    await more.trigger('click')
    await flushPromises()
    expect(backlog(wrapper)).toHaveLength(3)
    expect(more.attributes('aria-expanded')).toBe('false')
  })

  it('walks from a tile to the toggle and back from it with the arrows', async () => {
    const wrapper = crowdedBoard()
    const more = wrapper.get<HTMLElement>('.lane-cell[data-state="backlog"] .lane-more')
    tile(wrapper, 'MAIN-32').element.focus()
    await tile(wrapper, 'MAIN-32').trigger('keydown', { key: 'ArrowDown' })
    expect(document.activeElement).toBe(more.element)
    await more.trigger('keydown', { key: 'ArrowUp' })
    expect(document.activeElement).toBe(tile(wrapper, 'MAIN-32').element)
    more.element.focus()
    await more.trigger('keydown', { key: 'Home' })
    expect(document.activeElement).toBe(tile(wrapper, 'MAIN-30').element)
    more.element.focus()
    // Across the row from the toggle: the next cell's nearest tile.
    await more.trigger('keydown', { key: 'ArrowRight' })
    expect(document.activeElement).toBe(tile(wrapper, 'MAIN-36').element)
    // Alt moves nothing from the toggle.
    more.element.focus()
    await more.trigger('keydown', { key: 'ArrowUp', altKey: true })
    expect(document.activeElement).toBe(more.element)
    expect(wrapper.emitted('place')).toBeUndefined()
  })

  it('shows a tile moved past what it draws, so the moved tile can keep focus', async () => {
    const wrapper = crowdedBoard()
    await tile(wrapper, 'MAIN-32').trigger('keydown', { key: 'ArrowDown', altKey: true })
    expect(wrapper.emitted('place')).toEqual([
      [{ reference: 'MAIN-32', state: 'backlog', rank: 'after:MAIN-33' }],
    ])
    expect(backlog(wrapper)).toHaveLength(5)
  })

  it('shows an open cell whole once a dropped tile lands past what it draws', async () => {
    const wrapper = crowdedBoard()
    // A drop from the second column of the same lane to the fourth place of Backlog.
    const todoCell = wrapper
      .findAllComponents(WorkItemLaneCell)
      .find((cell) => cell.props('state').key === 'todo')
    todoCell?.vm.$emit(
      'place',
      { reference: 'MAIN-36', state: 'backlog', rank: 'last' },
      { keyboard: false, position: 6, total: 6 },
    )
    await flushPromises()
    expect(backlog(wrapper)).toHaveLength(5)
    expect(wrapper.get('.lane-cell[data-state="backlog"] .lane-more').text()).toBe('Show fewer')
  })

  it('keeps an open cell at its limit when a drop lands among the tiles it draws', async () => {
    const wrapper = crowdedBoard()
    const todoCell = wrapper
      .findAllComponents(WorkItemLaneCell)
      .find((cell) => cell.props('state').key === 'todo')
    todoCell?.vm.$emit(
      'place',
      { reference: 'MAIN-36', state: 'backlog', rank: 'before:MAIN-31' },
      { keyboard: false, position: 2, total: 6 },
    )
    await flushPromises()
    expect(backlog(wrapper)).toHaveLength(3)
    expect(wrapper.get('.lane-cell[data-state="backlog"] .lane-more').text()).toBe('Show all · 5')
  })
})

const laneCells = (wrapper: ReturnType<typeof board>, lane: string) =>
  wrapper
    .findAllComponents(WorkItemLaneCell)
    .filter((cell) => cell.props('group') === `lane:${lane}`)

describe('an empty lane cell', () => {
  const twoLanes = [
    epic,
    boardItem(10, 'backlog', { parent_id: epic.work_item_id }),
    boardItem(12, 'backlog'),
  ]
  const twoLaneBoard = () => board({ grouping: 'epic', items: twoLanes, spaceItems: twoLanes })

  it('is marked empty, and only the cells a dragged tile could land in are marked landable', async () => {
    const wrapper = twoLaneBoard()
    const own = laneCells(wrapper, epic.work_item_id)
    const lanes = new Set(
      wrapper.findAllComponents(WorkItemLaneCell).map((cell) => cell.props('group')),
    )
    const other = [...lanes].find((group) => group !== `lane:${epic.work_item_id}`) ?? ''
    const elsewhere = laneCells(wrapper, other.slice('lane:'.length))
    const emptyTodo = own.find((cell) => cell.props('state').key === 'todo')
    expect(emptyTodo?.classes()).toContain('empty')
    expect(own.find((cell) => cell.props('state').key === 'backlog')?.classes()).not.toContain(
      'empty',
    )
    expect(wrapper.findAll('.lane-cell.landable')).toHaveLength(0)

    own.find((cell) => cell.props('state').key === 'backlog')?.vm.$emit('dragging', true)
    await flushPromises()
    expect(own.every((cell) => cell.classes().includes('landable'))).toBe(true)
    expect(elsewhere.length).toBeGreaterThan(0)
    expect(elsewhere.some((cell) => cell.classes().includes('landable'))).toBe(false)

    own.find((cell) => cell.props('state').key === 'backlog')?.vm.$emit('dragging', false)
    await flushPromises()
    expect(wrapper.findAll('.lane-cell.landable')).toHaveLength(0)
  })
})

describe('a terminal cell of the board grouped by epic', () => {
  const finished = [
    epic,
    boardItem(10, 'backlog', { parent_id: epic.work_item_id }),
    ...Array.from({ length: 4 }, (_, at) =>
      boardItem(40 + at, 'done', { parent_id: epic.work_item_id }),
    ),
  ]
  const finishedBoard = () => board({ grouping: 'epic', items: finished, spaceItems: finished })

  it('draws none of its tiles, offers them by their count, and draws them on demand', async () => {
    const wrapper = finishedBoard()
    expect(doneCell(wrapper).findAll('[data-reference]')).toHaveLength(0)
    expect(doneCell(wrapper).get('.lane-more').text()).toBe('Show all · 4')
    const more = doneCell(wrapper).get('.lane-more')
    await more.trigger('click')
    await flushPromises()
    expect(doneCell(wrapper).findAll('[data-reference]')).toHaveLength(4)
    expect(document.activeElement).toBe(tile(wrapper, 'MAIN-40').element)
    await more.trigger('click')
    await flushPromises()
    expect(doneCell(wrapper).findAll('[data-reference]')).toHaveLength(0)
    expect(document.activeElement).toBe(more.element)
  })

  it('keeps the arrows reaching its Show all button, and leading back from it', async () => {
    const wrapper = finishedBoard()
    const more = doneCell(wrapper).get('.lane-more')
    tile(wrapper, 'MAIN-10').element.focus()
    await tile(wrapper, 'MAIN-10').trigger('keydown', { key: 'ArrowRight' })
    expect(document.activeElement).toBe(more.element)
    // No dead end: the arrows go back across the lane to the tile they came from.
    await more.trigger('keydown', { key: 'ArrowLeft' })
    expect(document.activeElement).toBe(tile(wrapper, 'MAIN-10').element)
  })

  it('shows the cell whole once a move lands in it, so the moved tile stays in sight', async () => {
    const wrapper = finishedBoard()
    // A drop from the backlog cell of the same lane into Done is handed up by that cell.
    const backlogCell = wrapper
      .findAllComponents(WorkItemLaneCell)
      .find((cell) => cell.props('state').key === 'backlog')
    backlogCell?.vm.$emit(
      'place',
      { reference: 'MAIN-10', state: 'done', rank: 'last' },
      { keyboard: false, position: 5, total: 5 },
    )
    await flushPromises()
    expect(doneCell(wrapper).findAll('[data-reference]')).toHaveLength(4)
    expect(doneCell(wrapper).get('.lane-more').text()).toBe('Show fewer')
  })
})
