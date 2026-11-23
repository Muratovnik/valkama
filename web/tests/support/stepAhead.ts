/**
 * A step line past its readings, as the specs of its forecast and its places hold it: a window of
 * five hours read at 50 % an hour and a half in and now three hours in, with what it draws past its
 * readings (`AHEAD`), and the places a line stands past them as a spec reads them (`targets`).
 */
import type { StepAhead } from '@/shared/ui/windowGeometry.ts'

import { placement } from './stepDrawing.ts'
import { HOUR, openLine, point, START } from './stepLineMount.ts'

/**
 * Past a reading of 50 % three hours in: «now», and a forecast to the reset at five hours, its
 * slower edge to 70 % and its faster reaching 100 % at four hours and flat on.
 */
export const AHEAD: StepAhead = {
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
export const READ = [point('12:00', 1, 20), point('12:30', 1.5, 50)]

/** The words at the two ends of a step line's axis. */
export const axisWords = (line: ReturnType<typeof openLine>) =>
  line.findAll('[data-region="axis"] [data-moment]').map((one) => one.text())

/** The places past the readings: which, their hint, the stretch they take, whether painted. */
export const targets = (line: ReturnType<typeof openLine>) =>
  line.findAll('.step-target').map((target) => ({
    kind: target.attributes('data-target'),
    stop: target.attributes('data-stop'),
    hint: target.attributes('data-tooltip'),
    reach: placement(target),
    shown: target.get('.step-target-mark').classes('step-shown'),
  }))

/** The step the reach of «now» takes past its start: the line's own width for a pointer. */
export const REACH = 'var(--step-reach)'
/** Half the least width of a place's box: how far its box runs on either side of its mark. */
export const HALF = 'var(--step-reach) / 2'
