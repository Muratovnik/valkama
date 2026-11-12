/**
 * The value axis of a chart of time: round steps in one unit, chosen by the largest value —
 * minutes up to two hours, hours up to four days, days past that — each a whole count of it:
 * «0, 20 min, 40 min, 60 min», «0, 25 h, 50 h, 75 h, 100 h», «0, 5 d, 10 d». A step said in
 * two units, «4 d 4 h», reads as a figure rather than a step, and steps of hours that are not
 * a whole number of days said that way were the four different shapes of one axis. A figure, a
 * readout or a table still says a span in its two largest units (`spanWords`).
 */
import type { SpanWords } from '@/shared/lib/timeSpan.ts'
import { valueTicks } from '@/shared/ui/chartGeometry.ts'
import type { ValueAxis } from '@/shared/ui/chartGeometry.ts'

const MINUTE = 60
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** Each unit, the largest value it is chosen up to, and its word. */
const UNITS: readonly { say: 'days' | 'hours' | 'minutes'; seconds: number; upTo: number }[] = [
  { seconds: MINUTE, upTo: 2 * HOUR, say: 'minutes' },
  { seconds: HOUR, upTo: 4 * DAY, say: 'hours' },
  { seconds: DAY, upTo: Number.POSITIVE_INFINITY, say: 'days' },
]

/**
 * The axis of a chart whose values count `unitSeconds` seconds each (3600 for a chart in hours),
 * with the unit's words of the catalog (`spanWordsOf`).
 */
export function durationAxis(
  words: Pick<SpanWords, 'days' | 'hours' | 'minutes'>,
  unitSeconds: number,
): ValueAxis {
  return (largest) => {
    const seconds = Math.max(0, largest) * unitSeconds
    const unit = UNITS.find((one) => seconds <= one.upTo) ?? UNITS.at(-1)
    if (!unit) return [{ value: 0, text: '0' }]
    return valueTicks(seconds / unit.seconds, 4, true).map((count) => ({
      value: (count * unit.seconds) / unitSeconds,
      text: count === 0 ? '0' : words[unit.say](count),
    }))
  }
}
