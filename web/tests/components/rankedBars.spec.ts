import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import type { RankedRow, RankedWords } from '@/shared/ui/chartGeometry.ts'
import RankedBars from '@/shared/ui/RankedBars.vue'
import RankedBarsTable from '@/shared/ui/RankedBarsTable.vue'

const words: RankedWords = {
  category: 'Project',
  value: 'Time',
  empty: 'No time recorded in this range.',
}

const rows: RankedRow[] = [
  { key: 'none', label: 'No task', value: 90, valueText: '1 h 30 min', kind: 'none' },
  { key: 'docs', label: 'Docs', value: 30, valueText: '30 min', actionable: true, slot: 2 },
  { key: 'core', label: 'Core', value: 120, valueText: '2 h', actionable: true, slot: 1 },
  { key: 'unknown', label: 'Unknown', value: 10, valueText: '10 min', kind: 'unknown' },
  { key: 'web', label: 'Web', value: 60, valueText: '1 h' },
  { key: 'other', label: 'Other (4)', value: 15, valueText: '15 min', kind: 'other' },
]

const mountBars = (given: RankedRow[] = rows) =>
  mount(RankedBars, { props: { label: 'Time by project', rows: given, words } })

/**
 * The ranked chart reads as a list in the order it is drawn: the categories ranked, then the rows
 * that are not categories after them, apart. A row that opens something is a native button, so
 * it is in the Tab order and Enter and Space press it; a row that opens nothing is no control.
 */
describe('ranked bars', () => {
  it('is a figure named by its label, the categories an ordered list and the rest a list after it', () => {
    const chart = mountBars()

    expect(chart.get('figure').attributes('aria-label')).toBe('Time by project')
    const lists = chart.findAll('.ranked-list')
    expect(lists.map((list) => list.element.tagName)).toEqual(['OL', 'UL'])
    expect(lists[0]?.findAll('.ranked-label').map((label) => label.text())).toEqual([
      'Core',
      'Web',
      'Docs',
    ])
    expect(lists[1]?.findAll('.ranked-row').map((row) => row.attributes('data-kind'))).toEqual([
      'other',
      'none',
      'unknown',
    ])
  })

  it('names each row by its words and value, and draws its bar as its share of the longest', () => {
    const chart = mountBars()
    const core = chart.get('[data-key="core"]')

    expect(core.text()).toBe('Core2 h')
    expect(core.get('.ranked-track').attributes('aria-hidden')).toBe('true')
    expect(core.get('.ranked-bar').attributes('style')).toContain('inline-size: 100%')
    expect(chart.get('[data-key="web"] .ranked-bar').attributes('style')).toContain(
      'inline-size: 50%',
    )
  })

  it('paints the categories in their slot and the rows that are not categories in the neutral', () => {
    const chart = mountBars()

    expect(chart.get('[data-key="docs"] .ranked-bar').attributes('data-slot')).toBe('2')
    expect(chart.get('[data-key="web"] .ranked-bar').attributes('data-slot')).toBe('1')
    for (const key of ['other', 'none', 'unknown'])
      expect(chart.get(`[data-key="${key}"] .ranked-bar`).attributes('data-slot')).toBe('other')
  })

  it('makes a row that opens something a button that says which row, and leaves the others inert', async () => {
    const chart = mountBars()
    const docs = chart.get('[data-key="docs"]')

    expect(docs.element.tagName).toBe('BUTTON')
    expect(docs.attributes('type')).toBe('button')
    expect(chart.get('[data-key="web"]').element.tagName).toBe('DIV')
    expect(chart.findAll('button')).toHaveLength(2)

    await docs.trigger('click')
    await chart.get('[data-key="web"]').trigger('click')
    expect(chart.emitted('select')).toEqual([['docs']])
  })

  it('says there is nothing in one status rather than drawing an empty list', () => {
    const chart = mountBars([])

    expect(chart.find('.ranked-list').exists()).toBe(false)
    expect(chart.get('[role="status"]').text()).toBe(words.empty)
  })
})

const mountTable = (given: RankedRow[] = rows) =>
  mount(RankedBarsTable, { props: { label: 'Time by project', rows: given, words } })

describe('the ranked table', () => {
  it('holds every row the chart draws, in its order, under a caption and named columns', () => {
    const table = mountTable()

    expect(table.get('caption').text()).toBe('Time by project')
    expect(table.findAll('thead th').map((cell) => cell.text())).toEqual(['Project', 'Time'])
    const body = table
      .findAll('tbody tr')
      .map((row) => [row.get('th').text(), row.get('td').text()])
    expect(body).toEqual([
      ['Core', '2 h'],
      ['Web', '1 h'],
      ['Docs', '30 min'],
      ['Other (4)', '15 min'],
      ['No task', '1 h 30 min'],
      ['Unknown', '10 min'],
    ])
    expect(table.findAll('tbody th').every((cell) => cell.attributes('scope') === 'row')).toBe(true)
  })

  it('opens from the row name what the chart opens, and nothing else', async () => {
    const table = mountTable()
    const presses = table.findAll('button')

    expect(presses.map((press) => press.text())).toEqual(['Core', 'Docs'])
    await presses[1]?.trigger('click')
    expect(table.emitted('select')).toEqual([['docs']])
  })

  it('says there is nothing in the same words as the chart', () => {
    expect(mountTable([]).get('[role="status"]').text()).toBe(words.empty)
  })
})
