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
    const more = wrapper.get('.lane-cell[data-state="backlog"] .lane-more')
    expect(more.text()).toBe('Show all · 5')
    // A cell that holds no more than it draws offers nothing.
    expect(wrapper.find('.lane-cell[data-state="todo"] .lane-more').exists()).toBe(false)
    await more.trigger('click')
    expect(backlog(wrapper)).toHaveLength(5)
    expect(wrapper.find('.lane-cell[data-state="backlog"] .lane-more').exists()).toBe(false)
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
    expect(wrapper.find('.lane-cell[data-state="backlog"] .lane-more').exists()).toBe(false)
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
    await doneCell(wrapper).get('.lane-more').trigger('click')
    expect(doneCell(wrapper).findAll('[data-reference]')).toHaveLength(4)
    expect(doneCell(wrapper).find('.lane-more').exists()).toBe(false)
  })

  it('keeps the arrows reaching its Show all button, which is a Tab stop too', async () => {
    const wrapper = finishedBoard()
    tile(wrapper, 'MAIN-10').element.focus()
    await tile(wrapper, 'MAIN-10').trigger('keydown', { key: 'ArrowRight' })
    expect(document.activeElement).toBe(doneCell(wrapper).get('.lane-more').element)
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
    expect(doneCell(wrapper).find('.lane-more').exists()).toBe(false)
  })
})
