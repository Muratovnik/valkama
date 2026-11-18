/**
 * A window's readings as a step line, held to what a reader must be able to tell; its bar is held
 * apart (`windowBar.spec.ts`). The oracle is the requirement, worked out by hand. A step line draws
 * readings as steps — flat to the next reading and up or down there, never a slope — held to the
 * moment the answer was read, beside a line of steady pace from nothing to the whole; each
 * reading says itself in a hint over the step it holds, one Tab stop walked by the arrows. A
 * running window opens on its start to now and a third as long past
 * it, now at three quarters of the plot, and its switch shows the whole window; a frame stretched
 * with Shift and an arrow narrows the line to the readings it covers, and the switch takes it
 * back. Past the last reading it points at «now» and runs the forecast's corridor to the reset,
 * each a place with its own hint, walked on after the readings, its mark painted only while
 * pointed at; the legend names the corridor. Its table holds every reading and the forecast.
 */
import { nextTick } from 'vue'

import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import StepLine from '@/shared/ui/StepLine.vue'
import StepLineTable from '@/shared/ui/StepLineTable.vue'
import type { StepAhead, StepPoint, StepWords } from '@/shared/ui/windowGeometry.ts'

import { corners, declared, placement, style } from '../support/stepDrawing.ts'

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
  ahead: 'To now and the forecast',
  whole: 'Whole window',
  views: 'Span of the readings',
  top: '100%',
  time: 'Time',
  value: 'Used',
  note: 'Source',
  empty: 'No readings',
  past: 'Past the right edge',
}

/** A moment as the axis names it: the hours since the window's start, «h3». */
const moment = (at: number) => `h${(at - START) / HOUR}`

/** A window of five hours, read three hours in, as it opens: to now and the forecast. */
function openLine(
  points: StepPoint[],
  end = START + 3 * HOUR,
  ahead: StepAhead | null = null,
  ended = false,
) {
  return mount(StepLine, {
    attachTo: document.body,
    props: {
      label: 'Five hours of Work',
      from: START,
      to: START + 5 * HOUR,
      end,
      moment,
      points,
      words: WORDS,
      even: true,
      legend: { line: 'Used', even: 'Steady pace', ahead: 'Forecast' },
      ahead,
      ended,
    },
  })
}

/**
 * Past a reading of 50 % three hours in: «now», and a corridor to the reset at five hours, its
 * slower edge to 70 % and its faster reaching 100 % at four hours and flat on.
 */
const AHEAD: StepAhead = {
  value: 50,
  now: { name: 'Now', figure: '50%', notes: ['Last reading at h1.5'] },
  forecast: {
    name: 'Forecast by the reset',
    figure: '70%–100%',
    notes: ['Resets at h5'],
    high: [
      { at: START + 3 * HOUR, value: 50 },
      { at: START + 4 * HOUR, value: 100 },
      { at: START + 5 * HOUR, value: 100 },
    ],
    low: [
      { at: START + 3 * HOUR, value: 50 },
      { at: START + 5 * HOUR, value: 70 },
    ],
  },
}
const READ = [point('12:00', 1, 20), point('12:30', 1.5, 50)]

/** The span a step line shows, as the radio of its switch that is checked says it. */
const checked = (line: ReturnType<typeof openLine>) =>
  line.findAll('[role="radio"]').map((one) => [one.text(), one.attributes('aria-checked')])

/** The same window switched to the whole of it, which the geometry below is worked out over. */
async function stepLine(points: StepPoint[], end = START + 3 * HOUR) {
  const line = openLine(points, end)
  await line.get('[role="radio"]:nth-child(2)').trigger('click')
  return line
}

describe('the step line', () => {
  it('draws readings as steps held to the moment read, never a slope between them', async () => {
    // Over five hours on a plot 300 wide and 100 high: an hour is 60 across, a percent 1 up.
    const line = await stepLine([point('12:00', 1, 20), point('12:30', 1.5, 50)])
    expect(corners(line.get('.step-path').attributes('d'))).toEqual([
      [60, 80],
      [90, 80],
      [90, 50],
      [180, 50],
    ])
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

  it('sets its top at the highest reading where one ran past the whole', async () => {
    const line = await stepLine([point('12:00', 1, 50), point('13:00', 2, 125)])
    // 50 of 125 stands at 60 of 100; 125 at the top.
    expect(corners(line.get('.step-path').attributes('d'))).toEqual([
      [60, 60],
      [120, 60],
      [120, 0],
      [180, 0],
    ])
  })

  // A line over the plot once said one reading at a time; each reading now has its own hint.
  it('gives each reading a hint over the whole step it holds, and no line over the plot', async () => {
    const line = await stepLine([point('12:00', 1, 20), point('12:30', 1.5, 50)])
    const reach = line.findAll('.step-reach')
    expect(reach.map((one) => one.attributes('data-tooltip'))).toEqual(['12:00: 20%', '12:30: 50%'])
    expect(reach.map((one) => one.attributes('data-tooltip-kind'))).toEqual(['detail', 'detail'])
    // An hour in to half past, and half past to the moment read, of a five-hour plot.
    expect(reach.map((one) => placement(one))).toEqual([
      { start: 20, size: 10 },
      { start: 30, size: 30 },
    ])
    // What the figure prints is its head, its top and its ends: no reading's words, at rest or
    // while one is pointed at, since a reading says itself in its hint alone.
    const printed = () => line.get('[data-chart="steps"]').text()
    const said = ['12:00', '12:30', '20%', '50%']
    expect([WORDS.top, 'h0', 'h5'].filter((words) => printed().includes(words))).toHaveLength(3)
    expect(said.filter((words) => printed().includes(words))).toEqual([])
    await reach[0]?.trigger('pointerenter')
    expect(line.findAll('.step-mark').map((one) => one.classes('step-shown'))).toEqual([
      true,
      false,
    ])
    expect(said.filter((words) => printed().includes(words))).toEqual([])
  })

  it('makes its readings one Tab stop, the latest, walked with the arrows', async () => {
    const line = await stepLine([
      point('12:00', 1, 20),
      point('12:30', 1.5, 50),
      point('13:00', 2, 60),
    ])
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

  it('with no reading draws its floor alone and says so', async () => {
    const line = await stepLine([])
    expect(line.find('.step-path').exists()).toBe(false)
    expect(line.get('.step-empty').text()).toBe('No readings')
  })

  it('opens a running window on its start to now and a third past it, now at three quarters', () => {
    const line = openLine([point('12:00', 1, 20), point('12:30', 1.5, 50)])
    expect(checked(line)).toEqual([
      ['To now and the forecast', 'true'],
      ['Whole window', 'false'],
    ])
    // Four hours across 300: an hour is 75, so now, three hours in, stands at 225 of 300.
    expect(corners(line.get('.step-path').attributes('d'))).toEqual([
      [75, 80],
      [112.5, 80],
      [112.5, 50],
      [225, 50],
    ])
    // Steady use at the span's end, four hours of five, is 80 %.
    const even = line.get('.step-even')
    expect([even.attributes('y1'), even.attributes('y2')]).toEqual(['100', '20'])
    expect(line.findAll('.step-axis span').map((one) => one.text())).toEqual(['h0', 'h4'])
    // Its switch, which a window past its reset has not.
    expect(line.find('[role="radiogroup"]').exists()).toBe(true)
    line.unmount()
  })

  it('opens a window past its reset on the whole window, with nothing to switch', () => {
    const line = openLine([point('12:00', 1, 20)], START + 5 * HOUR)
    expect(line.find('[role="radiogroup"]').exists()).toBe(false)
    expect(line.findAll('.step-axis span').map((one) => one.text())).toEqual(['h0', 'h5'])
    line.unmount()
  })

  it('opens a window reset since it was read on the whole window, its line held to the reading', () => {
    // Read three hours in, and reset by the page's moment.
    const line = openLine([point('12:00', 1, 20)], START + 3 * HOUR, null, true)
    expect(line.find('[role="radiogroup"]').exists()).toBe(false)
    expect(line.findAll('.step-axis span').map((one) => one.text())).toEqual(['h0', 'h5'])
    // Five hours across 300: the line holds to three hours in, 180, not to the reset.
    expect(corners(line.get('.step-path').attributes('d'))).toEqual([
      [60, 80],
      [180, 80],
    ])
    line.unmount()
  })

  it('narrows to the readings a frame stretched with Shift covers, and switches back', async () => {
    const line = openLine([point('12:00', 1, 20), point('12:30', 1.5, 50), point('13:00', 2, 60)])
    const first = line.get('[data-reading="0"]')
    ;(first.element as HTMLElement).focus()
    await first.trigger('keydown', { key: 'ArrowRight', shiftKey: true })
    await nextTick()
    // While Shift is held the frame stands over the two readings and nothing is narrowed yet.
    expect(line.find('.step-span').exists()).toBe(true)
    expect(line.findAll('.step-axis span').map((one) => one.text())).toEqual(['h0', 'h4'])
    await line.get('[data-reading="1"]').trigger('keyup', { key: 'Shift' })
    // From the first reading to the third, where the second's step ends.
    expect(line.findAll('.step-axis span').map((one) => one.text())).toEqual(['h1', 'h2'])
    expect(line.find('.step-span').exists()).toBe(false)
    expect(checked(line)).toEqual([
      ['To now and the forecast', 'false'],
      ['Whole window', 'false'],
    ])
    await line.get('[role="radio"]:nth-child(2)').trigger('click')
    expect(line.findAll('.step-axis span').map((one) => one.text())).toEqual(['h0', 'h5'])
    line.unmount()
  })

  it('as a table holds every reading, oldest first, and the forecast after them', () => {
    const table = mount(StepLineTable, {
      props: {
        label: 'Readings of Work',
        points: [point('12:00', 1, 20), point('12:30', 1.5, 50)],
        words: WORDS,
        forecast: {
          name: 'Forecast by the reset',
          figure: '70%–100%',
          notes: ['Runs out', 'At h5'],
        },
      },
    })
    expect(
      table.findAll('tbody tr').map((row) => row.findAll('th, td').map((cell) => cell.text())),
    ).toEqual([
      ['12:00', '20%', 'the poll'],
      ['12:30', '50%', 'the poll'],
      ['Forecast by the reset', '70%–100%', 'Runs out; At h5'],
    ])
    expect(mount(StepLineTable, { props: { label: 'x', points: [], words: WORDS } }).text()).toBe(
      'No readings',
    )
  })
})

/** The places past the readings: which, their hint, the stretch they take, whether painted. */
const targets = (line: ReturnType<typeof openLine>) =>
  line.findAll('.step-target').map((target) => ({
    kind: target.attributes('data-target'),
    stop: target.attributes('data-stop'),
    hint: target.attributes('data-tooltip'),
    reach: placement(target),
    shown: target.get('.step-target-mark').classes('step-shown'),
  }))

/** The step the reach of «now» takes past its start: the line's own width for a pointer. */
const REACH = 'var(--step-reach)'

describe('the step line past its readings', () => {
  it('points at now and at the forecast by the reset, each with its own hint, painted only when pointed at', async () => {
    const line = await stepLine(READ, START + 3 * HOUR)
    await line.setProps({ ahead: AHEAD })
    // Over the whole five hours now stands at 60 %, and the corridor runs from there to the end.
    expect(targets(line)).toEqual([
      {
        kind: 'now',
        stop: '2',
        hint: 'Now: 50%\nLast reading at h1.5',
        reach: { start: 60, end: 'auto', size: REACH },
        shown: false,
      },
      {
        kind: 'reset',
        stop: '3',
        hint: 'Forecast by the reset: 70%–100%\nResets at h5',
        // From past now's reach, and never so far on that its own reach leaves the plot.
        reach: { start: `min(calc(60% + ${REACH}), calc(100% - ${REACH}))`, end: 0, size: 'auto' },
        shown: false,
      },
    ])
    // The readings keep their own stretches and are still the first places; the last holds only
    // its own step, since «now» takes the pointer from the line's end on.
    expect(line.findAll('.step-reach').map((one) => declared(one)['min-inline-size'])).toEqual([
      undefined,
      0,
    ])
    await line.get('[data-target="reset"]').trigger('pointerenter')
    expect(targets(line).map(({ shown }) => shown)).toEqual([false, true])
    expect(line.findAll('.step-mark').map((one) => one.classes('step-shown'))).toEqual([
      false,
      false,
    ])
    await line.get('[data-target="reset"]').trigger('pointerleave')
    expect(targets(line).map(({ shown }) => shown)).toEqual([false, false])
    // The reset's mark spans the corridor's end, from its faster edge at 100 % to its slower at 70 %.
    expect(declared(line.get('.step-reset-mark'))).toEqual({
      '--step-high': 0,
      '--step-low': 0.3,
      '--step-side': 100,
    })
    line.unmount()
  })

  it('draws the corridor as a hatch between its edges, which its legend names', async () => {
    const line = await stepLine(READ, START + 3 * HOUR)
    expect(line.find('.step-ahead').exists()).toBe(false)
    expect(line.find('[data-key="ahead"]').exists()).toBe(false)
    await line.setProps({ ahead: AHEAD })
    const corridor = line.get('.step-ahead')
    expect(corridor.classes()).toContain('hatched')
    // From now, 60 % across, along the faster edge to 100 % at 80 % across and flat to the end,
    // then back along the slower edge from 70 % at the end to 50 % at now.
    const clip = style(corridor)
    const places = [
      ...clip.matchAll(
        /(\d+(?:\.\d+)?)% calc\(var\(--step-inset\) \+ \(100% - 2 \* var\(--step-inset\)\) \* ([\d.]+) ([+-])/gu,
      ),
    ].map(([, x, y, side]) => [Number(x), Number(y), side])
    expect(places).toEqual([
      [60, 0.5, '-'],
      [80, 0, '-'],
      [100, 0, '-'],
      [100, 0.3, '+'],
      [60, 0.5, '+'],
    ])
    expect(line.get('[data-key="ahead"]').text()).toBe('Forecast')
    line.unmount()
  })

  it('walks on from the latest reading to now and the forecast, and back', async () => {
    const line = await stepLine(READ, START + 3 * HOUR)
    await line.setProps({ ahead: AHEAD })
    const latest = line.get('[data-reading="1"]')
    expect(latest.attributes('tabindex')).toBe('0')
    ;(latest.element as HTMLElement).focus()
    await latest.trigger('keydown', { key: 'ArrowRight' })
    await nextTick()
    expect((document.activeElement as HTMLElement).dataset.target).toBe('now')
    await line.get('[data-target="now"]').trigger('keydown', { key: 'End' })
    await nextTick()
    expect((document.activeElement as HTMLElement).dataset.target).toBe('reset')
    expect(targets(line).map(({ shown }) => shown)).toEqual([false, true])
    await line.get('[data-target="reset"]').trigger('keydown', { key: 'ArrowLeft' })
    await line.get('[data-target="now"]').trigger('keydown', { key: 'ArrowLeft' })
    await nextTick()
    expect((document.activeElement as HTMLElement).dataset.reading).toBe('1')
    line.unmount()
  })

  it('opened on now and a third past it, cuts the corridor at the plot’s end and says the reset is past it', () => {
    const line = openLine(READ, START + 3 * HOUR, AHEAD)
    // Four hours across: now at 75 %, the faster edge at 100 % at the plot's end, the slower at 60 %.
    expect(targets(line).map(({ kind, hint }) => [kind, hint])).toEqual([
      ['now', 'Now: 50%\nLast reading at h1.5'],
      ['reset', 'Forecast by the reset: 70%–100%\nResets at h5\nPast the right edge'],
    ])
    expect(declared(line.get('.step-reset-mark'))).toEqual({
      '--step-high': 0,
      '--step-low': 0.4,
      '--step-side': 100,
    })
    line.unmount()
  })

  it('with no forecast to draw points at now alone, which takes the pointer to the plot’s end', async () => {
    const line = await stepLine(READ, START + 3 * HOUR)
    await line.setProps({ ahead: { ...AHEAD, forecast: null } })
    expect(line.find('.step-ahead').exists()).toBe(false)
    expect(line.find('[data-key="ahead"]').exists()).toBe(false)
    expect(targets(line).map(({ kind, reach }) => [kind, reach])).toEqual([
      ['now', { start: 60, end: 0, size: 'auto' }],
    ])
    // Read at the reset, now stands at the plot's end and takes the pointer over the last 24px.
    await line.setProps({ end: START + 5 * HOUR })
    expect(targets(line).map(({ reach }) => reach)).toEqual([
      { start: 'auto', end: 0, size: REACH },
    ])
    line.unmount()
  })

  it('with nothing ahead, a window past its reset, draws no place past its readings', () => {
    const line = openLine(READ, START + 5 * HOUR)
    expect(line.findAll('.step-target')).toHaveLength(0)
    expect(line.find('.step-ahead').exists()).toBe(false)
    // With no «now» after it, the last reading is as wide as a pointer can hit, as every other.
    expect(line.findAll('.step-reach')).toHaveLength(READ.length)
    expect(line.findAll('.step-reach').some((one) => 'min-inline-size' in declared(one))).toBe(
      false,
    )
    line.unmount()
  })
})
