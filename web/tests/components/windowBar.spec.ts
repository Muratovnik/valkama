/**
 * The window bar of a limit and its table, held to what a reader must be able to tell. The oracle
 * is the requirement, worked out by hand: a window bar fills as far as the share spent, stops at
 * its end past 100 %, stands its pace tick where steady use would be and says it all in words; a
 * fresh 0 % draws the track and its tick and no fill, a window that is not fresh is as solid as a
 * fresh one and says so in its words, and one with no figure the track alone. Its forecast is a
 * hatched tail from the share spent to the share at the reset, parted where the slower pace ends,
 * never past the track's end; with nothing ahead it has none. The table holds every figure the
 * bar draws, the forecast too.
 */
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import WindowBar from '@/shared/ui/WindowBar.vue'
import WindowBarTable from '@/shared/ui/WindowBarTable.vue'

const style = (element: { attributes: (name: string) => string | undefined }) =>
  element.attributes('style') ?? ''

/** The parts of a bar's tail: which, where it starts and how long, and whether it rounds an end. */
const tail = (bar: ReturnType<typeof mount>) =>
  bar.findAll('.window-ahead').map((part) => ({
    part: part.attributes('data-part'),
    style: style(part),
    hatched: part.classes('forecast-hatch'),
    start: part.classes('window-ahead-start'),
    end: part.classes('window-ahead-end'),
  }))

describe('the window bar', () => {
  it('fills as far as the share spent and stands its tick where steady use would be', () => {
    const bar = mount(WindowBar, {
      props: { label: 'Five hours: 62% used, steady 40%', used: 62, even: 40, value: '62% used' },
    })
    const track = bar.get('.window-track')
    expect(track.attributes('role')).toBe('img')
    expect(track.attributes('aria-label')).toBe('Five hours: 62% used, steady 40%')
    expect(style(bar.get('.window-fill'))).toContain('inline-size: 62%')
    expect(style(bar.get('.window-tick'))).toContain('inset-inline-start: 40%')
    expect(bar.get('.window-value').text()).toBe('62% used')
    expect(bar.find('.window-ahead').exists()).toBe(false)
  })

  it('stops at its end past 100 % and says how far past in its words', () => {
    const bar = mount(WindowBar, {
      props: { label: 'Week: 104% used', used: 104, even: 120, value: '104% used' },
    })
    expect(style(bar.get('.window-fill'))).toContain('inline-size: 100%')
    expect(style(bar.get('.window-tick'))).toContain('inset-inline-start: 100%')
    expect(bar.get('.window-value').text()).toBe('104% used')
  })

  it('tells a fresh zero, a window that is not fresh and no figure apart', () => {
    const zero = mount(WindowBar, {
      props: { label: '0% used, fresh', used: 0, even: 20, value: '0% used', note: 'fresh' },
    })
    expect(zero.find('.window-fill').exists()).toBe(false)
    expect(zero.find('.window-tick').exists()).toBe(true)
    expect(zero.get('.window-note').text()).toBe('fresh')

    // A reading is final however old: a silent window's fill is the fresh one's, its state words.
    const silent = mount(WindowBar, {
      props: { label: '88% used, silent 3 d', used: 88, value: '88%', note: 'silent 3 d' },
    })
    expect(silent.get('.window-fill').classes()).toEqual(['window-fill'])
    expect(silent.get('.window-note').text()).toBe('silent 3 d')

    const none = mount(WindowBar, { props: { label: 'No figure', used: null } })
    expect(none.find('.window-fill').exists()).toBe(false)
    expect(none.find('.window-tick').exists()).toBe(false)
    expect(none.find('.window-words').exists()).toBe(false)
  })

  it('draws a range ahead as a hatched tail from the share spent, parted where the slower pace ends', () => {
    // Both paces spend to 70 %, so that much is one part; the faster spends 14 more, the second.
    const bar = mount(WindowBar, {
      props: { label: 'Week', used: 62, even: 40, forecast: { low: 70, high: 84 } },
    })
    expect(tail(bar)).toEqual([
      {
        part: 'near',
        style:
          'inset-inline-start: calc(62% + var(--space-half)); inline-size: calc(8% - var(--space-half));',
        hatched: true,
        start: false,
        end: false,
      },
      {
        part: 'far',
        style:
          'inset-inline-start: calc(70% + var(--space-half)); inline-size: calc(14% - var(--space-half));',
        hatched: true,
        start: false,
        end: true,
      },
    ])
    // The share spent stays solid: the tail is drawn beside it, not over it.
    expect(style(bar.get('.window-fill'))).toContain('inline-size: 62%')
  })

  it('draws one value ahead as one part, from the track’s start at 0 % and to its end when it runs out', () => {
    const zero = mount(WindowBar, {
      props: { label: 'Five hours', used: 0, forecast: { low: 12, high: 12 } },
    })
    expect(tail(zero)).toEqual([
      {
        part: 'near',
        style: 'inset-inline-start: 0%; inline-size: 12%;',
        hatched: true,
        start: true,
        end: true,
      },
    ])
    const runs = mount(WindowBar, {
      props: { label: 'Five hours', used: 74, forecast: { low: 100, high: 100 } },
    })
    expect(tail(runs).map(({ style: drawn }) => drawn)).toEqual([
      'inset-inline-start: calc(74% + var(--space-half)); inline-size: calc(26% - var(--space-half));',
    ])
  })

  it('stops its tail at the track’s end and draws none with nothing ahead', () => {
    const past = mount(WindowBar, {
      props: { label: 'Week', used: 90, forecast: { low: 97.5, high: 104 } },
    })
    expect(tail(past).at(-1)?.style).toBe(
      'inset-inline-start: calc(97.5% + var(--space-half)); inline-size: calc(2.5% - var(--space-half));',
    )
    const none = [
      { used: 104, forecast: { low: 104, high: 104 } },
      { used: 100, forecast: { low: 100, high: 100 } },
      { used: 62, forecast: { low: 62, high: 62 } },
      { used: 62, forecast: null },
      { used: null, forecast: { low: 40, high: 50 } },
    ]
    for (const props of none)
      expect(
        tail(mount(WindowBar, { props: { label: 'Week', ...props } })),
        JSON.stringify(props),
      ).toEqual([])
  })

  it('as a table holds each window’s figures in words, a row a window', () => {
    const table = mount(WindowBarTable, {
      props: {
        label: 'Week of Work',
        rows: [
          {
            key: 'week',
            label: 'Week',
            valueText: '41%',
            evenText: '57%',
            noteText: 'fresh',
            forecastText: 'By the reset: 57% to 61%',
          },
          {
            key: 'week_model:model-a',
            label: 'Week, model-a',
            valueText: '13%',
            evenText: '57%',
            noteText: 'silent 3 d',
            forecastText: 'Too few readings for a forecast',
          },
        ],
        words: {
          name: 'Window',
          value: 'Used',
          even: 'Steady',
          note: 'State',
          forecast: 'Forecast',
          empty: 'None',
        },
      },
    })
    expect(table.get('caption').text()).toBe('Week of Work')
    expect(table.findAll('thead th').map((cell) => cell.text())).toEqual([
      'Window',
      'Used',
      'Steady',
      'State',
      'Forecast',
    ])
    expect(
      table.findAll('tbody tr').map((row) => row.findAll('th, td').map((cell) => cell.text())),
    ).toEqual([
      ['Week', '41%', '57%', 'fresh', 'By the reset: 57% to 61%'],
      ['Week, model-a', '13%', '57%', 'silent 3 d', 'Too few readings for a forecast'],
    ])
  })
})
