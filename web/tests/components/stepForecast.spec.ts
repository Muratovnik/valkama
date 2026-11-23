/**
 * A step line's forecast past its readings, held to what a reader must be able to tell; the places
 * past the readings and how they are walked are held in `windowCharts.spec.ts`. The oracle is the
 * requirement, worked out by hand: the forecast is one dashed line of the readings' width from
 * where they end at now along the faster pace, ended at the run-out on the level of the whole
 * window with nothing past it, or at the reset at its share; a week's range down to the slower
 * pace is a quiet fill under it where it is a few pixels tall; its end is the forecast's place, a
 * round dot, never a ring and never a dash; a window spent already has run out at now and draws no
 * line; a frame that ends before the line's end cuts it there, its hint saying the reset stands
 * past it; and the legend names it by a short dashed line.
 */
import { describe, expect, it } from 'vitest'

import type { StepAhead } from '@/shared/ui/windowGeometry.ts'

import { AHEAD, axisWords, READ, targets } from '../support/stepAhead.ts'
import { corners, declared } from '../support/stepDrawing.ts'
import { dragFrame, HOUR, openLine, START } from '../support/stepLineMount.ts'

describe('a step line’s forecast', () => {
  it('draws the forecast as one dashed line to the run-out, the range a fill under it, which its legend names', async () => {
    const line = openLine(READ, START + 3 * HOUR)
    expect(line.find('[data-mark="forecast"]').exists()).toBe(false)
    expect(line.find('[data-key="ahead"]').exists()).toBe(false)
    await line.setProps({ ahead: AHEAD })
    // One line, from now, 180 of 300 at 50 %, along the faster edge to the run-out at four hours,
    // 240 of 300 on the level of the whole window, and nothing past it toward the reset.
    const forecast = line.findAll('[data-mark="forecast"]')
    expect(forecast).toHaveLength(1)
    expect(corners(forecast[0]?.attributes('d'))).toEqual([
      [180, 50],
      [240, 0],
    ])
    expect(forecast[0]?.classes()).toContain('step-forecast')
    // The range down to the slower edge, which stands at 60 % at the run-out, filled under it.
    const range = line.get('[data-mark="range"]').attributes('d') ?? ''
    // A closed shape: its last move back to its start, and its close.
    expect(range.trim().endsWith('Z')).toBe(true)
    expect(corners(range.replace(/\s*Z$/u, ''))).toEqual([
      [180, 50],
      [240, 0],
      [240, 40],
      [180, 50],
    ])
    expect(line.find('.hatched').exists()).toBe(false)
    expect(line.get('[data-key="ahead"]').text()).toBe('Forecast')
    expect(line.find('[data-key="ahead"] [data-mark="dash"]').exists()).toBe(true)
    line.unmount()
  })

  it('ends a forecast that lasts at the reset at its share, with no fill for a range of one value', async () => {
    const line = openLine(READ, START + 3 * HOUR)
    const course = [
      { at: START + 3 * HOUR, value: 50 },
      { at: START + 5 * HOUR, value: 70 },
    ]
    const forecast = { ...AHEAD.forecast, high: course, low: course }
    await line.setProps({ ahead: { ...AHEAD, forecast } as StepAhead })
    expect(corners(line.get('[data-mark="forecast"]').attributes('d'))).toEqual([
      [180, 50],
      [300, 30],
    ])
    expect(line.find('[data-mark="range"]').exists()).toBe(false)
    line.unmount()
  })

  it('draws no forecast line for a window spent already, which ran out at its start', async () => {
    const line = openLine(READ, START + 3 * HOUR)
    const spent = [
      { at: START + 3 * HOUR, value: 100 },
      { at: START + 5 * HOUR, value: 100 },
    ]
    await line.setProps({
      ahead: {
        ...AHEAD,
        value: 100,
        forecast: { ...AHEAD.forecast, high: spent, low: spent },
      } as StepAhead,
    })
    expect(line.find('[data-mark="forecast"]').exists()).toBe(false)
    expect(line.find('[data-target="reset"]').exists()).toBe(false)
    line.unmount()
  })

  it('marks a forecast of one value at the reset with a round dot at that value, no ring', async () => {
    const line = openLine(READ, START + 3 * HOUR)
    // Five hours that last to the reset at 70 %: one course for both edges, so one value there.
    const course = [
      { at: START + 3 * HOUR, value: 50 },
      { at: START + 5 * HOUR, value: 70 },
    ]
    const forecast = { ...AHEAD.forecast, high: course, low: course }
    await line.setProps({ ahead: { ...AHEAD, forecast } as StepAhead })
    const mark = line.get('[data-target="reset"] [data-mark="place"]')
    expect(mark.attributes('data-shape')).toBe('dot')
    expect(mark.classes()).toContain('step-reset-mark')
    // The dot half the least width of its box before the box's end, which runs that far past it.
    expect(declared(mark)).toEqual({
      '--step-high': 0.3,
      '--step-low': 0.3,
      '--step-side': 'calc(100% - var(--step-reach) / 2)',
    })
    line.unmount()
  })

  it('narrowed by a frame that ends before the reset, cuts the forecast’s line there and says the reset is past it', async () => {
    const line = openLine(READ, START + 3 * HOUR, AHEAD)
    // Whole, the line runs to its run-out and says nothing past the plot.
    expect(targets(line).map(({ hint }) => hint)).toEqual([
      'Now: 50%\nLast reading at h1.5',
      'Forecast by the reset: 70%–100%\nResets at h5',
    ])
    // Dragged over the first four hours of five, 240 of 300.
    await dragFrame(line, 0, 240)
    expect(axisWords(line)).toEqual(['h0', 'h4'])
    // Four hours across, the run-out at the plot's end: the line ends there, and the reset stands
    // past the frame, which the hint says.
    expect(targets(line).map(({ kind, hint }) => [kind, hint])).toEqual([
      ['now', 'Now: 50%\nLast reading at h1.5'],
      ['reset', 'Forecast by the reset: 70%–100%\nResets at h5\nPast the right edge'],
    ])
    line.unmount()
    // Over the first three and a half hours, half way to the run-out: the line cut at the plot's
    // end, at 75 %, and its dot there.
    const short = openLine(READ, START + 3 * HOUR, AHEAD)
    await dragFrame(short, 0, 210)
    expect(axisWords(short)).toEqual(['h0', 'h3.5'])
    expect(declared(short.get('.step-reset-mark'))).toEqual({
      '--step-high': 0.25,
      '--step-low': 0.25,
      '--step-side': 'calc(100% - var(--step-reach) / 2)',
    })
    expect(corners(short.get('[data-mark="forecast"]').attributes('d')).at(-1)).toEqual([300, 25])
    short.unmount()
  })
})
