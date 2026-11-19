/**
 * A window's readings as a step line, held to what a reader must be able to tell; its bar is held
 * apart (`windowBar.spec.ts`). The oracle is the requirement, worked out by hand. A step line draws
 * readings as steps — flat to the next reading and up or down there, never a slope — held to the
 * moment the answer was read, beside a line of steady pace from nothing to the whole; each
 * reading says itself in a hint, found by the pointer at its mark or along the step it holds
 * through one layer over the field, one Tab stop walked by the arrows. Every
 * line shows its whole window, its axis naming its start and its reset, a running window's now
 * marked across the plot and one past its reset drawn in the neutral ink; a frame stretched with
 * Shift and an arrow, or dragged, narrows the line to the moments it covers, its axis then naming
 * them alone, and «Whole window» takes it back. Past the last reading it points at «now» and runs the forecast's corridor to the reset,
 * each a place with its own hint, walked on after the readings, its mark painted only while
 * pointed at; the legend names the corridor. Its table holds every reading and the forecast.
 */
import { nextTick } from 'vue'

import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import StepLineTable from '@/shared/ui/StepLineTable.vue'
import type { StepAhead } from '@/shared/ui/windowGeometry.ts'

import { corners, declared, placement, style } from '../support/stepDrawing.ts'
import {
  dragFrame,
  HIT,
  HOUR,
  openLine,
  point,
  pointAt,
  START,
  WORDS,
} from '../support/stepLineMount.ts'

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

/** The words at the two ends of a step line's axis. */
const axisWords = (line: ReturnType<typeof openLine>) =>
  line.findAll('[data-region="axis"] [data-moment]').map((one) => one.text())

describe('the step line', () => {
  it('draws readings as steps held to the moment read, never a slope between them', async () => {
    // Over five hours on a plot 300 wide and 100 high: an hour is 60 across, a percent 1 up.
    const line = openLine([point('12:00', 1, 20), point('12:30', 1.5, 50)])
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
    const line = openLine([point('12:00', 1, 50), point('13:00', 2, 125)])
    // 50 of 125 stands at 60 of 100; 125 at the top.
    expect(corners(line.get('.step-path').attributes('d'))).toEqual([
      [60, 60],
      [120, 60],
      [120, 0],
      [180, 0],
    ])
  })

  // A line over the plot once said one reading at a time; each reading now has its own hint.
  it('gives each reading a hint of its own and a box over the step it holds, no line over the plot', async () => {
    const line = openLine([point('12:00', 1, 20), point('12:30', 1.5, 50)])
    const reach = line.findAll('.step-reach')
    expect(reach.map((one) => one.attributes('data-tooltip'))).toEqual(['12:00: 20%', '12:30: 50%'])
    expect(reach.map((one) => one.attributes('data-tooltip-kind'))).toEqual(['detail', 'detail'])
    // An hour in to half past, and half past to the moment read, of a five-hour plot: the box
    // the keyboard's ring is drawn on.
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
    // The first reading's step, an hour in to half past: 60 to 90 of 300.
    await pointAt(line, 75)
    expect(line.findAll('.step-mark').map((one) => one.classes('step-shown'))).toEqual([
      true,
      false,
    ])
    expect(said.filter((words) => printed().includes(words))).toEqual([])
    await pointAt(line, null)
    expect(line.findAll('.step-mark').map((one) => one.classes('step-shown'))).toEqual([
      false,
      false,
    ])
  })

  it('takes the pointer with one layer over its field, past which nothing in the plot takes it', async () => {
    const line = openLine(READ)
    await line.setProps({ ahead: AHEAD })
    // One layer, half a mark past each edge of the field.
    expect(line.findAll('[data-region="hover"]')).toHaveLength(1)
    // Each reading's box and each place's stands with no pointer handler of its own.
    const stops = line.findAll('[data-stop]')
    expect(stops).toHaveLength(4)
    await stops[1]?.trigger('pointerenter')
    await stops[1]?.trigger('pointermove', { clientX: 90 })
    expect(line.findAll('.step-shown')).toHaveLength(0)
    line.unmount()
  })

  it('makes its readings one Tab stop, the latest, walked with the arrows', async () => {
    const line = openLine([point('12:00', 1, 20), point('12:30', 1.5, 50), point('13:00', 2, 60)])
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
    const line = openLine([])
    expect(line.find('.step-path').exists()).toBe(false)
    expect(line.get('.step-empty').text()).toBe('No readings')
  })

  it('shows a running window whole, its axis naming its start and its reset, and marks now', async () => {
    const line = openLine([point('12:00', 1, 20), point('12:30', 1.5, 50)])
    // Five hours across 300: an hour is 60, so now, three hours in, stands at 180 of 300.
    expect(corners(line.get('.step-path').attributes('d'))).toEqual([
      [60, 80],
      [90, 80],
      [90, 50],
      [180, 50],
    ])
    const even = line.get('.step-even')
    expect([even.attributes('y1'), even.attributes('y2')]).toEqual(['100', '0'])
    // The right end names the reset, never a bare time that reads as now.
    expect(axisWords(line)).toEqual(['start h0', 'resets h5'])
    expect(line.find('[data-step="whole"]').exists()).toBe(false)
    // Now is marked only on a window that runs, with something ahead of its readings, and the
    // legend names its hairline while it is.
    expect(line.find('[data-mark="now"]').exists()).toBe(false)
    expect(line.find('[data-key="now"]').exists()).toBe(false)
    await line.setProps({ ahead: AHEAD })
    // Five hours across 300: now, three hours in, at 180, up the whole drawing.
    const now = line.get('[data-mark="now"]')
    expect([now.attributes('x1'), now.attributes('x2')]).toEqual(['180', '180'])
    expect([now.attributes('y1'), now.attributes('y2')]).toEqual(['0', '100'])
    expect(line.get('[data-region="head"] [data-key="now"]').text()).toBe('Now')
    expect(line.find('[data-muted]').exists()).toBe(false)
    line.unmount()
  })

  it('draws a window past its reset whole, in the neutral ink, with no now', () => {
    const line = openLine([point('12:00', 1, 20)], START + 5 * HOUR, null, true)
    expect(line.find('[data-chart="steps"][data-muted]').exists()).toBe(true)
    expect(line.get('.swatch-line').classes()).toContain('swatch-muted')
    expect(axisWords(line)).toEqual(['start h0', 'resets h5'])
    expect(line.find('[data-mark="now"]').exists()).toBe(false)
    expect(line.find('[data-key="now"]').exists()).toBe(false)
    line.unmount()
  })

  it('holds the line of a window reset since it was read to the reading, whole', () => {
    // Read three hours in, and reset by the page's moment.
    const line = openLine([point('12:00', 1, 20)], START + 3 * HOUR, null, true)
    expect(axisWords(line)).toEqual(['start h0', 'resets h5'])
    // Five hours across 300: the line holds to three hours in, 180, not to the reset.
    expect(corners(line.get('.step-path').attributes('d'))).toEqual([
      [60, 80],
      [180, 80],
    ])
    line.unmount()
  })

  it('marks the top of its scale with a line at its level, which a line at 100 % meets', () => {
    const line = openLine([point('12:00', 1, 100)])
    const ceiling = line.get('[data-mark="ceiling"]')
    expect([ceiling.attributes('y1'), ceiling.attributes('y2')]).toEqual(['0', '0'])
    // The reading at 100 % runs at the ceiling's height.
    expect(corners(line.get('.step-path').attributes('d'))).toEqual([
      [60, 0],
      [180, 0],
    ])
    line.unmount()
  })

  it('narrows to the readings a frame stretched with Shift covers, and «Whole window» takes it back', async () => {
    const line = openLine([point('12:00', 1, 20), point('12:30', 1.5, 50), point('13:00', 2, 60)])
    const first = line.get('[data-reading="0"]')
    ;(first.element as HTMLElement).focus()
    await first.trigger('keydown', { key: 'ArrowRight', shiftKey: true })
    await nextTick()
    // While Shift is held the frame stands over the two readings and nothing is narrowed yet.
    expect(line.find('.step-span').exists()).toBe(true)
    expect(axisWords(line)).toEqual(['start h0', 'resets h5'])
    expect(line.find('[data-step="whole"]').exists()).toBe(false)
    await line.get('[data-reading="1"]').trigger('keyup', { key: 'Shift' })
    // From the first reading to the third, where the second's step ends: its moments alone.
    expect(axisWords(line)).toEqual(['h1', 'h2'])
    expect(line.find('.step-span').exists()).toBe(false)
    const back = line.get('[data-step="whole"]')
    expect(back.text()).toBe('Whole window')
    await back.trigger('click')
    expect(axisWords(line)).toEqual(['start h0', 'resets h5'])
    expect(line.find('[data-step="whole"]').exists()).toBe(false)
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
    const line = openLine(READ, START + 3 * HOUR)
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
    // The forecast's mark at the plot's end, pointed at half a mark past the field's edge.
    await pointAt(line, 300 + HIT - 1)
    expect(targets(line).map(({ shown }) => shown)).toEqual([false, true])
    expect(line.findAll('.step-mark').map((one) => one.classes('step-shown'))).toEqual([
      false,
      false,
    ])
    await pointAt(line, null)
    expect(targets(line).map(({ shown }) => shown)).toEqual([false, false])
    // Along the corridor, far from either ring, the forecast; at now's ring, now.
    await pointAt(line, 240)
    expect(targets(line).map(({ shown }) => shown)).toEqual([false, true])
    await pointAt(line, 180 + HIT - 1)
    expect(targets(line).map(({ shown }) => shown)).toEqual([true, false])
    // The reset's mark spans the corridor's end, from its faster edge at 100 % to its slower at 70 %,
    // a range rather than a ring; «now» keeps its ring.
    expect(declared(line.get('.step-reset-mark'))).toEqual({
      '--step-high': 0,
      '--step-low': 0.3,
      '--step-side': 100,
    })
    expect(
      line.findAll('[data-mark="place"]').map((mark) => mark.attributes('data-shape')),
    ).toEqual(['ring', 'range'])
    expect(line.get('.step-reset-mark').classes()).not.toContain('step-reset-point')
    line.unmount()
  })

  it('ends a silent window’s line at its last reading, and holds a fresh one’s to now', async () => {
    const line = openLine(READ, START + 3 * HOUR)
    const path = () => corners(line.get('.step-path').attributes('d'))
    // Over five hours: the last reading, half past twelve, at 90 of 300; now, three hours in, at 180.
    await line.setProps({ ahead: AHEAD })
    expect(path().at(-1)).toEqual([180, 50])
    await line.setProps({ silent: true })
    expect(path().at(-1)).toEqual([90, 50])
    // No stroke past the last reading toward now.
    expect(path().filter(([x]) => x > 90)).toEqual([])
    // «Now» keeps its place and its hint.
    expect(targets(line)[0]).toMatchObject({ kind: 'now', hint: 'Now: 50%\nLast reading at h1.5' })
    line.unmount()
  })

  it('ends the line of a window silent by its reset at its last reading, as a running one’s', async () => {
    // Read at the reset, five hours in; fresh by then, the line holds to the reset, 300 of 300.
    const line = openLine(READ, START + 5 * HOUR, null, true)
    const path = () => corners(line.get('.step-path').attributes('d'))
    expect(path().at(-1)).toEqual([300, 50])
    // Silent by then, it ends at the last reading, half past twelve, 90 of 300.
    await line.setProps({ silent: true })
    expect(path().at(-1)).toEqual([90, 50])
    expect(path().filter(([x]) => x > 90)).toEqual([])
    line.unmount()
  })

  it('draws the corridor as a hatch between its edges, which its legend names', async () => {
    const line = openLine(READ, START + 3 * HOUR)
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
    const line = openLine(READ, START + 3 * HOUR)
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

  it('marks a forecast of one value at the reset with a dash at that value, no ring', async () => {
    const line = openLine(READ, START + 3 * HOUR)
    // Five hours that last to the reset at 70 %: one course for both edges, so one value there.
    const course = [
      { at: START + 3 * HOUR, value: 50 },
      { at: START + 5 * HOUR, value: 70 },
    ]
    const forecast = { ...AHEAD.forecast, high: course, low: course }
    await line.setProps({ ahead: { ...AHEAD, forecast } as StepAhead })
    const mark = line.get('[data-target="reset"] [data-mark="place"]')
    expect(mark.attributes('data-shape')).toBe('point')
    expect(mark.classes()).toEqual(expect.arrayContaining(['step-reset-mark', 'step-reset-point']))
    expect(declared(mark)).toEqual({ '--step-high': 0.3, '--step-low': 0.3, '--step-side': 100 })
    line.unmount()
  })

  it('narrowed by a frame that ends before the reset, cuts the corridor there and says the reset is past it', async () => {
    const line = openLine(READ, START + 3 * HOUR, AHEAD)
    // Whole, the corridor runs to the reset and says nothing past it.
    expect(targets(line).map(({ hint }) => hint)).toEqual([
      'Now: 50%\nLast reading at h1.5',
      'Forecast by the reset: 70%–100%\nResets at h5',
    ])
    // Dragged over the first four hours of five, 240 of 300.
    await dragFrame(line, 0, 240)
    expect(axisWords(line)).toEqual(['h0', 'h4'])
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
    const line = openLine(READ, START + 3 * HOUR)
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
