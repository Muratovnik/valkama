/**
 * The two chart forms of a window of a limit, held to what a reader must be able to tell. The
 * oracle is the requirement, worked out by hand: a window bar fills as far as the share spent,
 * stops at its end past 100 %, stands its pace tick where steady use would be and says it all in
 * words; a fresh 0 % draws the track and its tick and no fill, a window that is not fresh is
 * hatched rather than drawn as live, and one with no figure the track alone. A step line draws
 * readings as steps — flat to the next reading and up or down there, never a slope — held to the
 * moment the answer was read, beside a line of steady pace from nothing to the whole; each
 * reading says itself in a hint over the step it holds, one Tab stop walked by the arrows, and no
 * line stands over the plot. Each table holds every figure its chart draws.
 */
import { nextTick } from 'vue'

import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import StepLine from '@/shared/ui/StepLine.vue'
import StepLineTable from '@/shared/ui/StepLineTable.vue'
import WindowBar from '@/shared/ui/WindowBar.vue'
import WindowBarTable from '@/shared/ui/WindowBarTable.vue'
import type { StepPoint, StepWords } from '@/shared/ui/windowGeometry.ts'

const style = (element: { attributes: (name: string) => string | undefined }) =>
  element.attributes('style') ?? ''

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
    expect(bar.get('.window-fill').classes()).not.toContain('window-held')
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

    const held = mount(WindowBar, {
      props: { label: '88% used, silent', used: 88, held: true, value: '88%', note: 'silent' },
    })
    expect(held.get('.window-fill').classes()).toContain('window-held')
    expect(held.get('.window-note').text()).toBe('silent')

    const none = mount(WindowBar, { props: { label: 'No figure', used: null } })
    expect(none.find('.window-fill').exists()).toBe(false)
    expect(none.find('.window-tick').exists()).toBe(false)
    expect(none.find('.window-words').exists()).toBe(false)
  })

  it('as a table holds each window’s figures in words, a row a window', () => {
    const table = mount(WindowBarTable, {
      props: {
        label: 'Week of Work',
        rows: [
          { key: 'week', label: 'Week', valueText: '41%', evenText: '57%', noteText: 'fresh' },
          {
            key: 'week_model:model-a',
            label: 'Week, model-a',
            valueText: '13%',
            evenText: '57%',
            noteText: 'silent',
          },
        ],
        words: { name: 'Window', value: 'Used', even: 'Steady', note: 'State', empty: 'None' },
      },
    })
    expect(table.get('caption').text()).toBe('Week of Work')
    expect(table.findAll('thead th').map((cell) => cell.text())).toEqual([
      'Window',
      'Used',
      'Steady',
      'State',
    ])
    expect(
      table.findAll('tbody tr').map((row) => row.findAll('th, td').map((cell) => cell.text())),
    ).toEqual([
      ['Week', '41%', '57%', 'fresh'],
      ['Week, model-a', '13%', '57%', 'silent'],
    ])
  })
})

const START = Date.UTC(2030, 2, 6, 11)
const HOUR = 3_600_000
const point = (key: string, hours: number, value: number): StepPoint => ({
  key,
  at: START + hours * HOUR,
  value,
  text: `${key}: ${value}%`,
  timeText: key,
  valueText: `${value}%`,
  noteText: 'the poll',
})
const WORDS: StepWords = {
  start: '11:00',
  end: '16:00',
  top: '100%',
  time: 'Time',
  value: 'Used',
  note: 'Source',
  empty: 'No readings',
}

function stepLine(points: StepPoint[], end = START + 3 * HOUR) {
  return mount(StepLine, {
    attachTo: document.body,
    props: {
      label: 'Five hours of Work',
      from: START,
      to: START + 5 * HOUR,
      end,
      points,
      words: WORDS,
      even: true,
      legend: { line: 'Used', even: 'Steady pace' },
    },
  })
}

describe('the step line', () => {
  it('draws readings as steps held to the moment read, never a slope between them', () => {
    // Over five hours on a plot 300 wide and 100 high: an hour is 60 across, a percent 1 up.
    const line = stepLine([point('12:00', 1, 20), point('12:30', 1.5, 50)])
    expect(line.get('.step-path').attributes('d')).toBe('M60.00,80.00 H90.00 V50.00 H180.00')
    // The pace runs from nothing at the start to the whole at the reset.
    const even = line.get('.step-even')
    expect([even.attributes('y1'), even.attributes('x2'), even.attributes('y2')]).toEqual([
      '100',
      '300',
      '0',
    ])
    expect(line.attributes('aria-label')).toBe('Five hours of Work')
    expect(line.findAll('.step-mark')).toHaveLength(2)
    // Each reading is named by its words, so the plot is no image a reader cannot enter.
    expect(line.findAll('[role="img"]').map((one) => one.attributes('aria-label'))).toEqual([
      '12:00: 20%',
      '12:30: 50%',
    ])
  })

  it('sets its top at the highest reading where one ran past the whole', () => {
    const line = stepLine([point('12:00', 1, 50), point('13:00', 2, 125)])
    // 50 of 125 stands at 60 of 100; 125 at the top.
    expect(line.get('.step-path').attributes('d')).toBe('M60.00,60.00 H120.00 V0.00 H180.00')
  })

  // A line over the plot once said one reading at a time; each reading now has its own hint.
  it('gives each reading a hint over the whole step it holds, and no line over the plot', async () => {
    const line = stepLine([point('12:00', 1, 20), point('12:30', 1.5, 50)])
    expect(line.find('.step-readout').exists()).toBe(false)
    const reach = line.findAll('.step-reach')
    expect(reach.map((one) => one.attributes('data-tooltip'))).toEqual(['12:00: 20%', '12:30: 50%'])
    expect(reach.map((one) => one.attributes('data-tooltip-kind'))).toEqual(['detail', 'detail'])
    // An hour in to half past, and half past to the moment read, of a five-hour plot.
    expect(reach.map((one) => one.attributes('style'))).toEqual([
      'inset-inline-start: 20%; inline-size: 10%;',
      'inset-inline-start: 30%; inline-size: 30%;',
    ])
    await reach[0]?.trigger('pointerenter')
    expect(line.findAll('.step-mark').map((one) => one.classes('step-shown'))).toEqual([
      true,
      false,
    ])
  })

  it('makes its readings one Tab stop, the latest, walked with the arrows', async () => {
    const line = stepLine([point('12:00', 1, 20), point('12:30', 1.5, 50), point('13:00', 2, 60)])
    const stops = () => line.findAll('.step-reach').map((one) => one.attributes('tabindex'))
    expect(stops()).toEqual(['-1', '-1', '0'])
    const last = line.get('[data-reading="2"]')
    ;(last.element as HTMLElement).focus()
    await last.trigger('keydown', { key: 'Home' })
    await nextTick()
    expect((document.activeElement as HTMLElement).dataset.reading).toBe('0')
    expect(stops()).toEqual(['0', '-1', '-1'])
    await line.get('[data-reading="0"]').trigger('keydown', { key: 'ArrowRight' })
    await nextTick()
    expect((document.activeElement as HTMLElement).dataset.reading).toBe('1')
    line.unmount()
  })

  it('with no reading draws its floor alone and says so', () => {
    const line = stepLine([])
    expect(line.find('.step-path').exists()).toBe(false)
    expect(line.get('.step-empty').text()).toBe('No readings')
  })

  it('as a table holds every reading, oldest first', () => {
    const table = mount(StepLineTable, {
      props: {
        label: 'Readings of Work',
        points: [point('12:00', 1, 20), point('12:30', 1.5, 50)],
        words: WORDS,
      },
    })
    expect(
      table.findAll('tbody tr').map((row) => row.findAll('th, td').map((cell) => cell.text())),
    ).toEqual([
      ['12:00', '20%', 'the poll'],
      ['12:30', '50%', 'the poll'],
    ])
    expect(mount(StepLineTable, { props: { label: 'x', points: [], words: WORDS } }).text()).toBe(
      'No readings',
    )
  })
})
