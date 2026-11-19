/**
 * The windows of a limit the charts harness draws (`chartsSurface`), as their charts and tables
 * take them: a window bar in each state it draws, each with its forecast's ends, and five hours
 * of readings as a step line, with «now» and a forecast that may run out past its last reading;
 * and five hours read at their reset, two of whose readings stand minutes apart, «now» on the
 * plot's right edge with no forecast past it.
 */
import type {
  StepAhead,
  StepPoint,
  StepWords,
  WindowRow,
  WindowWords,
} from '@/shared/ui/windowGeometry.ts'

/** A bar's state in words: a stale one is silent, one with no figure says none. */
function noteOf(bar: { used: number | null; silent?: boolean }) {
  if (bar.silent) return 'silent 3 d'
  return bar.used === null ? '' : 'fresh'
}

/**
 * A window of a limit in each state its bar draws, as a panel says it beside the bar: a week's
 * range past the share spent, a window read past 100 % and one spent with nothing ahead, a fresh
 * 0 % with a tail from the track's start, a silent window, solid all the same, five hours that
 * run out before the reset, and a window with no figure.
 */
export const windowBars = [
  {
    case: 'spent',
    label: 'Week: 62% used, steady use 40%, fresh. Forecast · By the reset: 70% to 84%',
    used: 62,
    even: 40,
    forecast: { low: 70, high: 84 },
  },
  {
    case: 'over',
    label: 'Week: 104% used, steady use 100%, fresh. Forecast · Spent',
    used: 104,
    even: 100,
    forecast: { low: 104, high: 104 },
  },
  {
    case: 'zero',
    label: 'Five hours: 0% used, steady use 20%, fresh. Forecast · Lasts to the reset, 12% by then',
    used: 0,
    even: 20,
    forecast: { low: 12, high: 12 },
  },
  {
    case: 'stale',
    label: 'Week: 88% used, steady use 86%, silent 3 d. Forecast · May run out before the reset',
    used: 88,
    even: 86,
    silent: true,
    forecast: { low: 97, high: 100 },
  },
  {
    case: 'runs',
    label: 'Five hours: 74% used, steady use 70%, fresh. Forecast · Runs out at 15:40',
    used: 74,
    even: 70,
    forecast: { low: 100, high: 100 },
  },
  { case: 'none', label: 'Week: no figure', used: null, even: null, forecast: null },
].map(({ silent, ...bar }) => ({
  ...bar,
  'data-case': bar.case,
  'value': bar.used === null ? 'No figure' : `${bar.used}% used`,
  'note': noteOf({ used: bar.used, silent }),
}))

export const windowRows: WindowRow[] = windowBars.map((bar) => ({
  key: bar.case,
  label: bar.label.slice(0, bar.label.indexOf(':')),
  valueText: bar.used === null ? '—' : `${bar.used}%`,
  evenText: bar.even === null ? '—' : `${bar.even}%`,
  noteText: bar.note,
  forecastText: bar.label.includes('Forecast · ')
    ? bar.label.slice(bar.label.indexOf('Forecast · ') + 'Forecast · '.length)
    : 'Too few readings for a forecast',
}))
export const windowWords: WindowWords = {
  name: 'Window',
  value: 'Used',
  even: 'Steady use',
  note: 'State',
  forecast: 'Forecast',
  empty: 'No window',
}

/** Five hours from 11:00, read four times, the last one held to 14:30, the moment read. */
const STEP_START = Date.UTC(2030, 2, 6, 11)
const STEP_HOUR = 3_600_000

/** Readings at so many hours from 11:00, each with its value, as a step line takes them. */
const readingsAt = (readings: number[][]): StepPoint[] =>
  readings.map(([hours = 0, value = 0]) => {
    const minutes = Math.round(hours * 60)
    const time = `${11 + Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`
    return {
      key: time,
      at: STEP_START + hours * STEP_HOUR,
      value,
      text: `${time}, ${value}%, the poll`,
      timeText: time,
      valueText: `${value}%`,
      noteText: 'the poll',
    }
  })

export const stepPoints = readingsAt([
  [0.5, 10],
  [1.25, 22],
  [2, 22.5],
  [3, 58],
])
export const stepWords: StepWords = {
  whole: 'Whole window',
  now: 'Now',
  start: 'start 11:00',
  reset: 'resets 16:00',
  top: '100%',
  time: 'Time',
  value: 'Used',
  note: 'Source',
  empty: 'No readings in this window',
  past: 'The reset is past the right edge of the framed span',
}
/**
 * Past the last reading, read at 14:30: «now» at 58 %, and a forecast that may run out, its
 * faster pace reaching 100 % at 15:40 and its slower 84 % by the reset at 16:00.
 */
export const stepAhead: StepAhead = {
  value: 58,
  now: { name: 'Now', figure: '58%', notes: ['Last reading at 14:00, 30 min ago, from the poll'] },
  forecast: {
    name: 'Forecast by the reset',
    figure: '84%–100%',
    notes: ['May run out before the reset: 84% or more by then', 'Resets 16:00, in 1 h 30 min'],
    high: [
      { at: STEP_START + 3.5 * STEP_HOUR, value: 58 },
      { at: STEP_START + (4 + 2 / 3) * STEP_HOUR, value: 100 },
      { at: STEP_START + 5 * STEP_HOUR, value: 100 },
    ],
    low: [
      { at: STEP_START + 3.5 * STEP_HOUR, value: 58 },
      { at: STEP_START + 5 * STEP_HOUR, value: 84 },
    ],
  },
}
export const stepProps = {
  label:
    'Five hours from 11:00 to 16:00: 10% at 11:30, 22% at 12:15, 22.5% at 13:00, 58% at 14:00. Forecast · May run out before the reset: 84% or more by then',
  from: STEP_START,
  to: STEP_START + 5 * STEP_HOUR,
  end: STEP_START + 3.5 * STEP_HOUR,
  // The moment's hours and minutes on the UTC clock, «14:30».
  moment: (at: number) => new Date(at).toISOString().slice(11, 16),
  points: stepPoints,
  words: stepWords,
  even: true,
  legend: { line: 'Used', even: 'Steady use', ahead: 'Forecast' },
  ahead: stepAhead,
}

/**
 * Five hours read at their reset, 16:00: two readings five minutes apart, at 12:30 and 12:35, a
 * step a pointer is wider than, and «now» at 45 % on the plot's right edge, with no forecast.
 */
export const stepCloseProps = {
  ...stepProps,
  label: 'Five hours from 11:00 to 16:00: 8% at 11:15, 30% at 12:30, 31% at 12:35, 45% at 14:00.',
  end: STEP_START + 5 * STEP_HOUR,
  points: readingsAt([
    [0.25, 8],
    [1.5, 30],
    [1.5 + 5 / 60, 31],
    [3, 45],
  ]),
  ahead: {
    value: 45,
    now: { name: 'Now', figure: '45%', notes: ['Last reading at 14:00, 2 h ago, from the poll'] },
    forecast: null,
  },
}
