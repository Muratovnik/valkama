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
  whole: 'Whole window',
  now: 'Now',
  start: 'start h0',
  reset: 'resets h5',
  top: '100%',
  time: 'Time',
  value: 'Used',
  note: 'Source',
  empty: 'No readings',
  past: 'Past the right edge',
}

/** A moment as the axis names an end of a frame: the hours since the window's start, «h3». */
const moment = (at: number) => `h${(at - START) / HOUR}`

/** A window of five hours, read three hours in, shown whole: from its start to its reset. */
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

/** A mouse's pointer event at `clientX`, as the browser sends one. */
const pointer = (type: string, clientX: number) =>
  new PointerEvent(type, { bubbles: true, button: 0, clientX, pointerId: 1, pointerType: 'mouse' })

/**
 * Drags a frame along the field from `from` to `to` of a field the browser draws 300 px wide, as a
 * mouse does: pressed, moved and let go. jsdom lays nothing out, so the field is given the box and
 * the width a browser gives it.
 */
export async function dragFrame(line: ReturnType<typeof openLine>, from: number, to: number) {
  // The field's listeners are bound once it is mounted, a tick after the line is.
  await line.vm.$nextTick()
  const field = line.get('[data-region="field"]')
  field.element.getBoundingClientRect = () => new DOMRect(0, 0, 300, 100)
  Object.defineProperty(field.element, 'clientWidth', { configurable: true, value: 300 })
  field.element.dispatchEvent(pointer('pointerdown', from))
  document.dispatchEvent(pointer('pointermove', to))
  document.dispatchEvent(pointer('pointerup', to))
  await line.vm.$nextTick()
}
