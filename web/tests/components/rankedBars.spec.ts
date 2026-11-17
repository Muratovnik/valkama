import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import type { RankedRow, RankedWords } from '@/shared/ui/chartGeometry.ts'
import RankedBars from '@/shared/ui/RankedBars.vue'
import RankedBarsTable from '@/shared/ui/RankedBarsTable.vue'
import { tooltipOf } from '@/shared/ui/tooltipAnchors.ts'

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

/** A share as the caller says it, the words its own. */
const share = (ratio: number) => `${Math.round(ratio * 100)}% of the total`

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

  it('paints the categories in their slot, and gives the rows that are not categories their figure and no bar', () => {
    const chart = mountBars()

    expect(chart.get('[data-key="docs"] .ranked-bar').attributes('data-slot')).toBe('2')
    expect(chart.get('[data-key="web"] .ranked-bar').attributes('data-slot')).toBe('1')
    for (const key of ['other', 'none', 'unknown']) {
      expect(chart.find(`[data-key="${key}"] .ranked-bar`).exists()).toBe(false)
      expect(chart.get(`[data-key="${key}"] .ranked-value`).text()).not.toBe('')
    }
  })

  it('scales the categories by the largest of them, however large a row that is not one', () => {
    const chart = mountBars([
      ...rows,
      { key: 'tail', label: 'Other (40)', value: 4000, valueText: '66 h', kind: 'other' },
    ])

    expect(chart.get('[data-key="core"] .ranked-bar').attributes('style')).toContain(
      'inline-size: 100%',
    )
    expect(chart.get('[data-key="docs"] .ranked-bar').attributes('style')).toContain(
      'inline-size: 25%',
    )
  })

  it('keeps a name to one line, and gives its row a hint of what the row does not print', () => {
    const chart = mount(RankedBars, {
      props: {
        label: 'Time by project',
        words,
        formatShare: share,
        rows: [
          {
            key: 'acct',
            label: 'a1b2c3d4',
            detail: 'a1b2c3d4-0000-4000-8000-00000000abcd',
            value: 3,
            valueText: '3 h',
          },
          { key: 'web', label: 'Web', value: 1, valueText: '1 h' },
        ],
      },
    })
    const account = chart.get('[data-key="acct"]')
    const web = chart.get('[data-key="web"]')

    expect(account.get('.ranked-label').classes()).toContain('one-line')
    // The row is the mark: its hint is what it leaves out and its share, never its printed words.
    expect(account.attributes('data-tooltip-kind')).toBe('detail')
    expect(account.attributes('data-tooltip')).toBe(
      'a1b2c3d4-0000-4000-8000-00000000abcd\n75% of the total',
    )
    expect(tooltipOf(account.element)?.words).toBe('a1b2c3d4')
    expect(tooltipOf(account.element)?.clipped).toBe(false)
    expect(web.attributes('data-tooltip')).toBe('25% of the total')
    // A whole given where the rows are not all of it.
    const part = mount(RankedBars, {
      props: {
        label: 'x',
        words,
        formatShare: share,
        whole: 10,
        rows: [{ key: 'web', label: 'Web', value: 1, valueText: '1 h' }],
      },
    })
    expect(part.get('[data-key="web"]').attributes('data-tooltip')).toBe('10% of the total')
  })

  it('with nothing to add, gives a row the hint of its name, shown only while it is cut', () => {
    const web = mountBars([{ key: 'web', label: 'Web', value: 1, valueText: '1 h' }]).get(
      '[data-key="web"]',
    )
    expect(web.attributes('data-tooltip')).toBe('Web')
    expect(tooltipOf(web.element)?.clipped).toBe(true)
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

/**
 * A list of names of free text, tasks by their titles: each name on lines of its own, two at most,
 * where the one-line chart cuts it to one; the rows that are not categories apart under a rule with
 * a bar each in a neutral, on one scale with the categories, where the chart of identifiers draws
 * them none; and a strip of the whole over the rows, every row a part in its hue, in their order.
 */
describe('a ranked list of free text', () => {
  const tasks: RankedRow[] = [
    { key: 't2', label: 'MAIN-2 Write the release notes', value: 30, valueText: '30 min', slot: 2 },
    { key: 'none', label: 'No task', value: 90, valueText: '1 h 30 min', kind: 'none', slot: 2 },
    { key: 't1', label: 'MAIN-1 Answer the review', value: 60, valueText: '1 h', slot: 1 },
    { key: 'other', label: 'Other, 4 more', value: 20, valueText: '20 min', kind: 'other' },
  ]
  const mountList = (freeText: boolean, given: RankedRow[] = tasks) =>
    mount(RankedBars, { props: { label: 'Time by task', rows: given, words, freeText } })

  it('clamps each name to lines of its own instead of one', () => {
    const list = mountList(true)
    const label = list.get('[data-key="t1"] .ranked-label')
    expect(list.get('figure').classes()).toContain('ranked-free')
    expect(label.classes()).toContain('ranked-clamp')
    expect(label.classes()).not.toContain('one-line')
    // The control: the chart of identifiers keeps its one line.
    const chart = mountList(false).get('[data-key="t1"] .ranked-label')
    expect(chart.classes()).toContain('one-line')
    expect(chart.classes()).not.toContain('ranked-clamp')
  })

  it('sets the rows that are not categories apart, each with a neutral bar on one scale', () => {
    const list = mountList(true)
    const [ranked, rest] = list.findAll('.ranked-list')
    expect(
      ranked?.findAll('.ranked-row').map((row) => row.get('.ranked-line').attributes('data-key')),
    ).toEqual(['t1', 't2'])
    expect(rest?.findAll('.ranked-row').map((row) => row.attributes('data-kind'))).toEqual([
      'other',
      'none',
    ])
    // Work on no task, the largest row, is the whole bar; the categories are measured by it.
    const bar = (key: string) => list.get(`[data-key="${key}"] .ranked-bar`)
    expect(bar('none').attributes('style')).toContain('inline-size: 100%')
    expect(bar('t1').attributes('style')).toContain('inline-size: 66.6')
    expect(bar('other').attributes('style')).toContain('inline-size: 22.2')
    // In the neutrals whatever hue the host gave: the darker for no task, the lighter for the rest.
    expect(bar('none').attributes('data-slot')).toBe('apart')
    expect(bar('other').attributes('data-slot')).toBe('other')
    expect(bar('t2').attributes('data-slot')).toBe('2')
  })

  it('draws the strip of the whole over the rows, every row in its hue and in their order', () => {
    const strip = mountList(true).get('.mini-share-bar')
    // A picture of what the rows say, so nothing a screen reader reads twice.
    expect(strip.attributes('aria-hidden')).toBe('true')
    expect(
      strip
        .findAll('.mini-share-part')
        .map((part) => [
          part.attributes('data-key'),
          part.attributes('data-slot'),
          part.attributes('style'),
          part.classes('mini-share-apart'),
        ]),
    ).toEqual([
      ['t1', '1', 'flex-grow: 0.3;', false],
      ['t2', '2', 'flex-grow: 0.15;', false],
      ['other', 'other', 'flex-grow: 0.1;', false],
      ['none', 'apart', 'flex-grow: 0.45;', true],
    ])
    expect(mountList(false).find('.mini-share-bar').exists()).toBe(false)
  })

  it('puts each part of a pair on a line of its own', () => {
    const pair = mountList(true, [
      {
        key: 'p',
        label: 'MAIN-1 Answer the review · opus',
        labelEnd: ' · opus',
        value: 1,
        valueText: '1 h',
      },
    ]).get('.pair-name')
    expect(pair.classes()).toContain('pair-stacked')
    expect(pair.findAll('span').map((part) => part.text())).toEqual([
      'MAIN-1 Answer the review',
      '· opus',
    ])
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
