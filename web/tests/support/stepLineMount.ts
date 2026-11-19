/**
 * A step line as its specs mount it: a window of five hours from 11:00 UTC on 6 March 2030, its
 * readings made up by the hour, its words, and the pointer moved over a field the browser would
 * draw 300 px wide, which jsdom lays out for it.
 */
import { mount } from '@vue/test-utils'

import StepLine from '@/shared/ui/StepLine.vue'
import type { StepAhead, StepPoint, StepWords } from '@/shared/ui/windowGeometry.ts'

export const START = Date.UTC(2030, 2, 6, 11)
export const HOUR = 3_600_000
export const point = (key: string, hours: number, value: number): StepPoint => ({
  key,
  at: START + hours * HOUR,
  value,
  text: `${key}: ${value}%`,
  timeText: key,
  valueText: `${value}%`,
  noteText: 'the poll',
})
export const WORDS: StepWords = {
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
export function openLine(
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

/** How far past each edge of the field its one layer runs, as the browser lays it out. */
export const HIT = 6

/**
 * Points at `x` of a field the browser draws 300 px wide, as its drawing's 300 across, or takes
 * the pointer off the field with null. jsdom lays nothing out, so the field and its layer are
 * given the boxes a browser gives them.
 */
export async function pointAt(line: ReturnType<typeof openLine>, x: number | null) {
  const field = line.get('[data-region="field"]').element
  const layer = line.get('[data-region="hover"]')
  field.getBoundingClientRect = () => new DOMRect(0, 0, 300, 100)
  layer.element.getBoundingClientRect = () => new DOMRect(-HIT, 0, 300 + 2 * HIT, 100)
  await (x === null ? layer.trigger('pointerleave') : layer.trigger('pointermove', { clientX: x }))
}

/** The same window switched to the whole of it, which the geometry below is worked out over. */
export async function stepLine(points: StepPoint[], end = START + 3 * HOUR) {
  const line = openLine(points, end)
  await line.get('[role="radio"]:nth-child(2)').trigger('click')
  return line
}
