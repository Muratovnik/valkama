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
 * them alone, and «Whole span» takes it back. Past the last reading it points at «now» and at the
 * forecast, each a place with its own hint, walked on after the readings, its mark painted only
 * while pointed at; how the forecast is drawn is held apart (`stepForecast.spec.ts`). Its table
 * holds every reading and the forecast.
 */
import { nextTick } from 'vue'

import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import StepLineTable from '@/shared/ui/StepLineTable.vue'

import { AHEAD, axisWords, HALF, REACH, READ, targets } from '../support/stepAhead.ts'
import { corners, declared, placement } from '../support/stepDrawing.ts'
import { HIT, HOUR, openLine, point, pointAt, START, WORDS } from '../support/stepLineMount.ts'

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

  it('narrows to the readings a frame stretched with Shift covers, and «Whole span» takes it back', async () => {
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
    expect(back.text()).toBe('Whole span')
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

describe('the step line past its readings', () => {
  it('points at now and at the forecast by the reset, each with its own hint, painted only when pointed at', async () => {
    const line = openLine(READ, START + 3 * HOUR)
    await line.setProps({ ahead: AHEAD })
    // Over the whole five hours now stands at 60 %, and the corridor runs from there to the end.
    // Each place's box has its middle where the pointer finds the place (`DESIGN.md`, the step
    // line): «now»'s the least width of a box around its ring.
    expect(targets(line)).toEqual([
      {
        kind: 'now',
        stop: '2',
        hint: 'Now: 50%\nLast reading at h1.5',
        reach: { start: `calc(60% - ${HALF})`, end: 'auto', size: REACH },
        shown: false,
      },
      {
        kind: 'reset',
        stop: '3',
        hint: 'Forecast by the reset: 70%–100%\nResets at h5',
        // From past now's box to half a box past the run-out at four hours of five, 80 % across,
        // where the forecast's line ends; never starting so far on that the dot is not its middle.
        reach: {
          start: `min(calc(60% + ${HALF}), calc(80% - ${HALF}))`,
          end: `calc(20% - ${HALF})`,
          size: 'auto',
        },
        shown: false,
      },
    ])
    // The readings keep their own stretches and are still the first places; the last holds only
    // its own step, since «now» takes the pointer from the line's end on.
    expect(line.findAll('.step-reach').map((one) => declared(one)['min-inline-size'])).toEqual([
      undefined,
      0,
    ])
    // The forecast's dot at the run-out, 240 of 300, pointed at a little past it.
    await pointAt(line, 240 + HIT - 1)
    expect(targets(line).map(({ shown }) => shown)).toEqual([false, true])
    expect(line.findAll('.step-mark').map((one) => one.classes('step-shown'))).toEqual([
      false,
      false,
    ])
    await pointAt(line, null)
    expect(targets(line).map(({ shown }) => shown)).toEqual([false, false])
    // Along the forecast's line, far from either mark, the forecast; at now's ring, now.
    await pointAt(line, 210)
    expect(targets(line).map(({ shown }) => shown)).toEqual([false, true])
    await pointAt(line, 180 + HIT - 1)
    expect(targets(line).map(({ shown }) => shown)).toEqual([true, false])
    // The forecast's mark is a dot at the run-out, on the level of the whole window, one place and
    // no range; «now» keeps its ring.
    expect(declared(line.get('.step-reset-mark'))).toEqual({
      '--step-high': 0,
      '--step-low': 0,
      '--step-side': 'calc(100% - var(--step-reach) / 2)',
    })
    expect(
      line.findAll('[data-mark="place"]').map((mark) => mark.attributes('data-shape')),
    ).toEqual(['ring', 'dot'])
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

  it('with no forecast to draw points at now alone, which takes the pointer to the plot’s end', async () => {
    const line = openLine(READ, START + 3 * HOUR)
    await line.setProps({ ahead: { ...AHEAD, forecast: null } })
    expect(line.find('[data-mark="forecast"]').exists()).toBe(false)
    expect(line.find('[data-key="ahead"]').exists()).toBe(false)
    // Its box around its ring, and the pointer finds it along the rest of the plot from there.
    expect(targets(line).map(({ kind, reach }) => [kind, reach])).toEqual([
      ['now', { start: `calc(60% - ${HALF})`, end: 'auto', size: REACH }],
    ])
    await pointAt(line, 290)
    expect(targets(line).map(({ shown }) => shown)).toEqual([true])
    // Read at the reset, now stands at the plot's end, its box around its ring there.
    await line.setProps({ end: START + 5 * HOUR })
    expect(targets(line).map(({ reach }) => reach)).toEqual([
      { start: `calc(100% - ${HALF})`, end: 'auto', size: REACH },
    ])
    await pointAt(line, 300 + HIT)
    expect(targets(line).map(({ shown }) => shown)).toEqual([true])
    line.unmount()
  })

  it('with nothing ahead, a window past its reset, draws no place past its readings', () => {
    const line = openLine(READ, START + 5 * HOUR)
    expect(line.findAll('.step-target')).toHaveLength(0)
    expect(line.find('[data-mark="forecast"]').exists()).toBe(false)
    // With no «now» after it, the last reading is as wide as a pointer can hit, as every other.
    expect(line.findAll('.step-reach')).toHaveLength(READ.length)
    expect(line.findAll('.step-reach').some((one) => 'min-inline-size' in declared(one))).toBe(
      false,
    )
    line.unmount()
  })
})
